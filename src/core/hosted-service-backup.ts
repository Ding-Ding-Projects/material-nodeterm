/**
 * Shared archive and restore engine for hosted services.
 *
 * Service adapters own provider-specific export and import work. This module owns the part that
 * must never drift between GitLab, Nextcloud, Open WebUI, or a future hosted service: identity and
 * edition compatibility, ownership adoption, bounded ZIP framing, per-resource hashes, local-only
 * staging, cancellation, storage preflight, atomic publication, and rollback around mutation.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_KDF_PARAMS,
  decryptPayload,
  deriveVaultKey,
  encryptPayload,
  newSalt
} from './password-manager/crypto'
import { renameAtomic, tempNameFor } from './fs-atomic'
import { openContainer, packContainer, type ContainerEntry } from './project-archive-container'
import {
  HOSTED_BACKUP_LIMITS,
  HOSTED_BACKUP_MIMETYPE,
  type HostedBackupCompatibilityResult,
  type HostedBackupCompatibilityTarget,
  type HostedBackupConfirmation,
  type HostedBackupEdition,
  type HostedBackupManifest,
  type HostedBackupOmission,
  type HostedBackupResourceInput,
  type HostedBackupResourceManifest,
  HostedBackupContractError,
  checkHostedBackupCompatibility,
  requireHostedBackupConfirmation,
  validateHostedBackupArchivePath,
  validateHostedBackupId,
  validateHostedBackupManifest,
  validateHostedBackupVersion
} from '../shared/hosted-service-backup'

export * from '../shared/hosted-service-backup'

const MANIFEST_PATH = 'manifest.json'
const OMISSIONS_PATH = 'omissions.json'
const MIMETYPE_PATH = 'mimetype'
const ENCRYPTED_KIND = 'nodeterm-hosted-backup-encrypted'
const ENCRYPTED_VERSION = 1
const DEFAULT_STORAGE_MARGIN = 16 * 1024 * 1024

interface HostedEncryptedEnvelope {
  kind: typeof ENCRYPTED_KIND
  version: typeof ENCRYPTED_VERSION
  savedAt: string
  kdf: typeof DEFAULT_KDF_PARAMS
  salt: string
  payload: ReturnType<typeof encryptPayload>
}

export interface HostedServiceBackupSnapshot {
  serviceId: string
  serviceVersion: string
  serviceEdition: HostedBackupEdition
  ownerId: string
  resources: readonly HostedBackupResourceInput[]
  /** Machine-local, credential, unsupported, or external resources stay here and never enter ZIP. */
  omissions?: readonly HostedBackupOmission[]
}

export interface HostedBackupProgress {
  operation: 'backup' | 'restore'
  phase: 'preflight' | 'hashing' | 'packing' | 'encrypting' | 'staging' | 'applying' | 'rolling-back' | 'complete'
  completedBytes: number
  totalBytes: number
  completedResources: number
  totalResources: number
}

export interface HostedBackupOperationOptions {
  exporterVersion?: string
  minimumReaderVersion?: string
  now?: number
  encryption?: 'none' | 'password'
  password?: string
  signal?: AbortSignal
  onProgress?: (progress: HostedBackupProgress) => void
}

export interface HostedServiceBackupArtifact {
  bytes: Buffer
  manifest: HostedBackupManifest
  archiveSha256: string
  encrypted: boolean
}

export interface HostedBackupReadResult {
  manifest: HostedBackupManifest
  resources: ReadonlyMap<string, Buffer>
  omissions: readonly HostedBackupOmission[]
  archiveSha256: string
  encrypted: boolean
}

export interface HostedBackupStoragePreflight {
  ok: boolean
  availableBytes: number
  requiredBytes: number
  safetyMarginBytes: number
  message: string
}

export interface HostedBackupRestorePreview {
  manifest: HostedBackupManifest
  compatibility: HostedBackupCompatibilityResult
  includedResources: readonly HostedBackupResourceManifest[]
  omittedResources: readonly HostedBackupOmission[]
  requiresConfirmation: true
  canRestore: boolean
}

export interface HostedBackupStagedResource {
  manifest: HostedBackupResourceManifest
  stagedPath: string
}

export interface HostedBackupRestoreContext {
  stagingDirectory: string
  signal?: AbortSignal
  onProgress?: (progress: HostedBackupProgress) => void
}

/** The provider adapter is the only code allowed to mutate a hosted service. */
export interface HostedServiceRestoreAdapter {
  target: HostedBackupCompatibilityTarget
  /** Absolute application-data directory used only for temporary restore staging. */
  stagingDirectory: string
  /** Snapshot current service state before the first mutation. The snapshot stays machine-local. */
  captureRollback: (resourceIds: readonly string[], context: HostedBackupRestoreContext) => Promise<unknown>
  apply: (resources: readonly HostedBackupStagedResource[], context: HostedBackupRestoreContext) => Promise<void>
  rollback: (snapshot: unknown, context: HostedBackupRestoreContext) => Promise<void>
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new HostedBackupContractError('cancelled', 'Hosted-service backup or restore was cancelled.')
}

function emit(options: HostedBackupOperationOptions, progress: HostedBackupProgress): void {
  options.onProgress?.(progress)
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function compressedLength(data: Uint8Array): number {
  const compressed = deflateRawSync(data)
  return compressed.length < data.byteLength ? compressed.length : data.byteLength
}

function canonicalPayloadHash(entries: readonly { path: string; data: Uint8Array }[]): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const pathBytes = Buffer.from(entry.path, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32LE(pathBytes.length, 0)
    hash.update(length).update(pathBytes).update(entry.data)
  }
  return hash.digest('hex')
}

function validateSnapshot(snapshot: HostedServiceBackupSnapshot): void {
  validateHostedBackupId(snapshot.serviceId, 'service identifier')
  validateHostedBackupId(snapshot.ownerId, 'owner identifier')
  validateHostedBackupVersion(snapshot.serviceVersion, 'service version')
  if (!Array.isArray(snapshot.resources) || snapshot.resources.length > HOSTED_BACKUP_LIMITS.maxResources) {
    throw new HostedBackupContractError('limit', 'Hosted-service resource count exceeds the supported limit.')
  }
  const ids = new Set<string>()
  const foldedIds = new Set<string>()
  let bytes = 0
  for (const resource of snapshot.resources) {
    validateHostedBackupId(resource.resourceId)
    validateHostedBackupVersion(resource.version, 'resource version')
    if (ids.has(resource.resourceId)) throw new HostedBackupContractError('duplicate-resource', `Duplicate hosted-service resource: ${resource.resourceId}`)
    const foldedId = resource.resourceId.toLocaleLowerCase('en-US')
    if (foldedIds.has(foldedId)) throw new HostedBackupContractError('duplicate-resource', `Case-conflicting hosted-service resource: ${resource.resourceId}`)
    if (!(resource.data instanceof Uint8Array) || resource.data.byteLength > HOSTED_BACKUP_LIMITS.maxResourceBytes) {
      throw new HostedBackupContractError('limit', `Hosted-service resource exceeds the supported size: ${resource.resourceId}`)
    }
    ids.add(resource.resourceId)
    foldedIds.add(foldedId)
    bytes += resource.data.byteLength
    if (bytes > HOSTED_BACKUP_LIMITS.maxRawBytes) throw new HostedBackupContractError('limit', 'Hosted-service backup exceeds the raw-byte limit.')
  }
  for (const omission of snapshot.omissions ?? []) {
    validateHostedBackupId(omission.resourceId)
    if (omission.detail.length > 1024 || /(?:^|[\s(])(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(omission.detail)) {
      throw new HostedBackupContractError('manifest', `Hosted-service omission detail is not portable: ${omission.resourceId}`)
    }
    if (ids.has(omission.resourceId)) throw new HostedBackupContractError('manifest', `Resource is both included and omitted: ${omission.resourceId}`)
    if (foldedIds.has(omission.resourceId.toLocaleLowerCase('en-US'))) throw new HostedBackupContractError('manifest', `Case-conflicting hosted-service resource omission: ${omission.resourceId}`)
    ids.add(omission.resourceId)
    foldedIds.add(omission.resourceId.toLocaleLowerCase('en-US'))
  }
}

function buildManifest(
  snapshot: HostedServiceBackupSnapshot,
  payloadEntries: readonly { path: string; data: Uint8Array }[],
  options: HostedBackupOperationOptions
): HostedBackupManifest {
  let rawBytes = 0
  let compressedBytes = 0
  const resources: HostedBackupResourceManifest[] = snapshot.resources
    .map((resource) => {
      const archivePath = `resources/${resource.resourceId}`
      validateHostedBackupArchivePath(archivePath)
      const raw = resource.data.byteLength
      const compressed = compressedLength(resource.data)
      rawBytes += raw
      compressedBytes += compressed
      return {
        resourceId: resource.resourceId,
        kind: resource.kind,
        version: resource.version,
        edition: resource.edition,
        required: resource.required !== false,
        rawBytes: raw,
        compressedBytes: compressed,
        sha256: sha256(resource.data),
        archivePath
      }
    })
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
  const encryption = options.encryption === 'password'
    ? { mode: 'password' as const, algorithm: 'AES-256-GCM' as const, kdf: 'scrypt' as const }
    : { mode: 'none' as const }
  const manifest: HostedBackupManifest = {
    schema: 'nodeterm-hosted-service-backup',
    schemaVersion: 1,
    exporterVersion: options.exporterVersion ?? '0.4.3',
    minimumReaderVersion: options.minimumReaderVersion ?? '1.0.0',
    createdAt: new Date(options.now ?? Date.now()).toISOString(),
    service: {
      serviceId: snapshot.serviceId,
      version: snapshot.serviceVersion,
      edition: snapshot.serviceEdition,
      ownerId: snapshot.ownerId
    },
    encryption,
    resources,
    omissions: [...(snapshot.omissions ?? [])],
    rawBytes,
    compressedBytes,
    payloadSha256: canonicalPayloadHash(payloadEntries)
  }
  validateHostedBackupManifest(manifest)
  return manifest
}

function encryptHostedArchive(archive: Buffer, password: string, now: number): Buffer {
  if (!password) throw new HostedBackupContractError('manifest', 'Password encryption requires a password.')
  const salt = newSalt().toString('base64')
  const key = deriveVaultKey(password, salt, DEFAULT_KDF_PARAMS)
  const envelope: HostedEncryptedEnvelope = {
    kind: ENCRYPTED_KIND,
    version: ENCRYPTED_VERSION,
    savedAt: new Date(now).toISOString(),
    kdf: DEFAULT_KDF_PARAMS,
    salt,
    payload: encryptPayload(key, archive.toString('base64'))
  }
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8')
}

function decryptHostedArchive(bytes: Buffer, password?: string): { archive: Buffer; encrypted: boolean } {
  const head = bytes.subarray(0, 256).toString('utf8').trimStart()
  if (!head.startsWith('{') || !head.includes(ENCRYPTED_KIND)) return { archive: bytes, encrypted: false }
  if (!password) throw new HostedBackupContractError('manifest', 'This hosted-service backup is password protected.')
  let envelope: unknown
  try { envelope = JSON.parse(bytes.toString('utf8')) } catch { throw new HostedBackupContractError('manifest', 'Protected hosted-service backup is not valid JSON.') }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) throw new HostedBackupContractError('manifest', 'Protected hosted-service backup envelope is invalid.')
  const value = envelope as Record<string, unknown>
  if (value.kind !== ENCRYPTED_KIND || value.version !== ENCRYPTED_VERSION || typeof value.salt !== 'string' || typeof value.payload !== 'object' || value.payload === null) {
    throw new HostedBackupContractError('manifest', 'Protected hosted-service backup envelope is unsupported.')
  }
  const kdf = value.kdf
  if (typeof kdf !== 'object' || kdf === null || Array.isArray(kdf) ||
      (kdf as Record<string, unknown>).N !== DEFAULT_KDF_PARAMS.N ||
      (kdf as Record<string, unknown>).r !== DEFAULT_KDF_PARAMS.r ||
      (kdf as Record<string, unknown>).p !== DEFAULT_KDF_PARAMS.p ||
      (kdf as Record<string, unknown>).keylen !== DEFAULT_KDF_PARAMS.keylen) {
    throw new HostedBackupContractError('manifest', 'Protected hosted-service backup key settings are unsupported.')
  }
  try {
    const key = deriveVaultKey(password, value.salt, kdf as typeof DEFAULT_KDF_PARAMS)
    const decoded = decryptPayload<unknown>(key, value.payload as ReturnType<typeof encryptPayload>)
    if (typeof decoded !== 'string') throw new Error('payload')
    return { archive: Buffer.from(decoded, 'base64'), encrypted: true }
  } catch {
    throw new HostedBackupContractError('hash', 'Hosted-service backup password did not authenticate the archive.')
  }
}

function verifyContainer(
  archive: Buffer,
  password: string | undefined
): HostedBackupReadResult {
  const opened = decryptHostedArchive(archive, password)
  const entries = openContainer(opened.archive, {
    maxArchiveBytes: HOSTED_BACKUP_LIMITS.maxArchiveBytes,
    maxTotalBytes: HOSTED_BACKUP_LIMITS.maxRawBytes,
    maxEntryBytes: HOSTED_BACKUP_LIMITS.maxResourceBytes,
    maxEntries: HOSTED_BACKUP_LIMITS.maxResources + 4
  })
  if (entries.get(MIMETYPE_PATH)?.toString('utf8') !== HOSTED_BACKUP_MIMETYPE) {
    throw new HostedBackupContractError('manifest', 'This is not a nodeterm hosted-service backup.')
  }
  const manifestBytes = entries.get(MANIFEST_PATH)
  if (!manifestBytes || manifestBytes.byteLength > HOSTED_BACKUP_LIMITS.maxManifestBytes) {
    throw new HostedBackupContractError('manifest', 'Hosted-service backup manifest is missing or too large.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(manifestBytes.toString('utf8')) } catch { throw new HostedBackupContractError('manifest', 'Hosted-service backup manifest is not valid JSON.') }
  const manifest = validateHostedBackupManifest(parsed)
  const omissionBytes = entries.get(OMISSIONS_PATH)
  if (!omissionBytes) throw new HostedBackupContractError('manifest', 'Hosted-service backup omission record is missing.')
  let omissions: unknown
  try { omissions = JSON.parse(omissionBytes.toString('utf8')) } catch { throw new HostedBackupContractError('manifest', 'Hosted-service backup omission record is not valid JSON.') }
  if (!Array.isArray(omissions) || JSON.stringify(omissions) !== JSON.stringify(manifest.omissions)) {
    throw new HostedBackupContractError('manifest', 'Hosted-service omission record does not match the manifest.')
  }
  const resources = new Map<string, Buffer>()
  const payloadEntries: { path: string; data: Buffer }[] = []
  for (const resource of manifest.resources) {
    const data = entries.get(resource.archivePath)
    if (!data || data.byteLength !== resource.rawBytes || sha256(data) !== resource.sha256) {
      throw new HostedBackupContractError('hash', `Hosted-service resource hash verification failed: ${resource.resourceId}`)
    }
    resources.set(resource.resourceId, data)
    payloadEntries.push({ path: resource.archivePath, data })
  }
  if (canonicalPayloadHash(payloadEntries) !== manifest.payloadSha256) {
    throw new HostedBackupContractError('hash', 'Hosted-service backup payload hash verification failed.')
  }
  const allowed = new Set([MIMETYPE_PATH, MANIFEST_PATH, OMISSIONS_PATH, ...manifest.resources.map((resource) => resource.archivePath)])
  for (const name of entries.keys()) if (!allowed.has(name)) throw new HostedBackupContractError('manifest', `Unknown hosted-service backup entry: ${name}`)
  return {
    manifest,
    resources,
    omissions: manifest.omissions,
    archiveSha256: sha256(archive),
    encrypted: opened.encrypted
  }
}

/** Build a complete archive in memory. No destination is touched until the caller publishes it. */
export async function createHostedServiceBackup(
  snapshot: HostedServiceBackupSnapshot,
  options: HostedBackupOperationOptions = {}
): Promise<HostedServiceBackupArtifact> {
  validateSnapshot(snapshot)
  if (options.encryption === 'password' && !options.password) throw new HostedBackupContractError('manifest', 'Password encryption requires a password.')
  throwIfCancelled(options.signal)
  const totalBytes = snapshot.resources.reduce((sum, resource) => sum + resource.data.byteLength, 0)
  emit(options, { operation: 'backup', phase: 'preflight', completedBytes: 0, totalBytes, completedResources: 0, totalResources: snapshot.resources.length })
  const payloadEntries: { path: string; data: Buffer }[] = []
  for (let i = 0; i < snapshot.resources.length; i++) {
    throwIfCancelled(options.signal)
    const resource = snapshot.resources[i]
    payloadEntries.push({ path: `resources/${resource.resourceId}`, data: Buffer.from(resource.data) })
    emit(options, { operation: 'backup', phase: 'hashing', completedBytes: payloadEntries.reduce((sum, entry) => sum + entry.data.length, 0), totalBytes, completedResources: i + 1, totalResources: snapshot.resources.length })
  }
  const manifest = buildManifest(snapshot, payloadEntries, options)
  const entries: ContainerEntry[] = [
    { path: MIMETYPE_PATH, data: Buffer.from(HOSTED_BACKUP_MIMETYPE, 'utf8') },
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { path: OMISSIONS_PATH, data: Buffer.from(JSON.stringify(manifest.omissions, null, 2), 'utf8') },
    ...payloadEntries.map((entry) => ({ path: entry.path, data: entry.data }))
  ]
  emit(options, { operation: 'backup', phase: 'packing', completedBytes: totalBytes, totalBytes, completedResources: snapshot.resources.length, totalResources: snapshot.resources.length })
  const plain = packContainer(entries)
  throwIfCancelled(options.signal)
  const bytes = options.encryption === 'password'
    ? (emit(options, { operation: 'backup', phase: 'encrypting', completedBytes: totalBytes, totalBytes, completedResources: snapshot.resources.length, totalResources: snapshot.resources.length }), encryptHostedArchive(plain, options.password!, options.now ?? Date.now()))
    : plain
  const artifact = { bytes, manifest, archiveSha256: sha256(bytes), encrypted: options.encryption === 'password' }
  emit(options, { operation: 'backup', phase: 'complete', completedBytes: totalBytes, totalBytes, completedResources: snapshot.resources.length, totalResources: snapshot.resources.length })
  return artifact
}

export function inspectHostedServiceBackup(bytes: Buffer, password?: string): HostedBackupReadResult {
  if (bytes.byteLength > HOSTED_BACKUP_LIMITS.maxArchiveBytes * 2) throw new HostedBackupContractError('limit', 'Hosted-service backup is too large.')
  return verifyContainer(bytes, password)
}

export function previewHostedServiceRestore(
  bytes: Buffer,
  target: HostedBackupCompatibilityTarget,
  options: { password?: string; allowOwnershipTransfer?: boolean } = {}
): HostedBackupRestorePreview {
  const read = inspectHostedServiceBackup(bytes, options.password)
  const compatibility = checkHostedBackupCompatibility(read.manifest, target, { allowOwnershipTransfer: options.allowOwnershipTransfer })
  const availableIds = new Set(target.resources.map((resource) => resource.resourceId))
  const includedResources = read.manifest.resources.filter((resource) => availableIds.has(resource.resourceId))
  const unavailableOptional = read.manifest.resources
    .filter((resource) => !availableIds.has(resource.resourceId) && !resource.required)
    .map((resource): HostedBackupOmission => ({
      resourceId: resource.resourceId,
      reason: 'unsupported',
      detail: 'The destination did not advertise this optional resource.'
    }))
  return {
    manifest: read.manifest,
    compatibility,
    includedResources,
    omittedResources: [...read.omissions, ...unavailableOptional],
    requiresConfirmation: true,
    canRestore: compatibility.compatible
  }
}

/** Return available bytes without accepting a path from the archive. The path is local runtime state. */
export async function preflightHostedBackupStorage(
  destinationDirectory: string,
  requiredBytes: number,
  safetyMarginBytes = DEFAULT_STORAGE_MARGIN
): Promise<HostedBackupStoragePreflight> {
  if (!path.isAbsolute(destinationDirectory)) throw new HostedBackupContractError('unsafe-path', 'Hosted-service staging path must be absolute and machine-local.')
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new HostedBackupContractError('limit', 'Hosted-service storage estimate is invalid.')
  await mkdir(destinationDirectory, { recursive: true })
  const space = await statfs(destinationDirectory)
  const availableBytes = Number(space.bavail) * Number(space.bsize)
  const required = requiredBytes + Math.max(0, safetyMarginBytes)
  return {
    ok: availableBytes >= required,
    availableBytes,
    requiredBytes,
    safetyMarginBytes: Math.max(0, safetyMarginBytes),
    message: availableBytes >= required
      ? `Hosted-service restore has ${availableBytes.toLocaleString()} bytes available for ${required.toLocaleString()} bytes required.`
      : `Hosted-service restore needs ${required.toLocaleString()} bytes but only ${availableBytes.toLocaleString()} bytes are available.`
  }
}

/** Publish the finished bytes atomically. The existing destination remains untouched on failure. */
export async function writeHostedServiceBackupAtomic(
  destinationFile: string,
  artifact: HostedServiceBackupArtifact,
  options: { safetyMarginBytes?: number } = {}
): Promise<HostedBackupStoragePreflight> {
  if (!path.isAbsolute(destinationFile)) throw new HostedBackupContractError('unsafe-path', 'Hosted-service archive path must be absolute and machine-local.')
  const parent = path.dirname(destinationFile)
  const preflight = await preflightHostedBackupStorage(parent, artifact.bytes.byteLength, options.safetyMarginBytes)
  if (!preflight.ok) throw new HostedBackupContractError('limit', preflight.message)
  const temp = tempNameFor(destinationFile)
  try {
    await writeFile(temp, artifact.bytes, { mode: 0o600 })
    await renameAtomic(temp, destinationFile)
    return preflight
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

export async function readHostedServiceBackup(filePath: string, password?: string): Promise<HostedBackupReadResult> {
  if (!path.isAbsolute(filePath)) throw new HostedBackupContractError('unsafe-path', 'Hosted-service archive path must be absolute and machine-local.')
  const info = await stat(filePath)
  if (!info.isFile()) throw new HostedBackupContractError('unsafe-path', 'Hosted-service archive path is not a regular file.')
  if (info.size > HOSTED_BACKUP_LIMITS.maxArchiveBytes * 2) throw new HostedBackupContractError('limit', 'Hosted-service backup is too large.')
  const bytes = await readFile(filePath)
  return inspectHostedServiceBackup(bytes, password)
}

export async function restoreHostedServiceBackup(
  bytes: Buffer,
  adapter: HostedServiceRestoreAdapter,
  confirmation: HostedBackupConfirmation,
  options: {
    password?: string
    allowOwnershipTransfer?: boolean
    safetyMarginBytes?: number
    signal?: AbortSignal
    onProgress?: (progress: HostedBackupProgress) => void
  } = {}
): Promise<HostedBackupRestorePreview> {
  const read = inspectHostedServiceBackup(bytes, options.password)
  const compatibility = checkHostedBackupCompatibility(read.manifest, adapter.target, { allowOwnershipTransfer: options.allowOwnershipTransfer })
  if (!compatibility.compatible) throw new HostedBackupContractError('compatibility', compatibility.issues.map((issue) => issue.message).join(' '))
  const availableIds = new Set(adapter.target.resources.map((resource) => resource.resourceId))
  // Optional resources that the target does not advertise remain omissions. They are never handed
  // to an adapter that did not claim to understand them, while required resources already failed
  // the compatibility check above.
  const selectedManifest = read.manifest.resources.filter((resource) => availableIds.has(resource.resourceId))
  const resourceIds = selectedManifest.map((resource) => resource.resourceId)
  requireHostedBackupConfirmation(confirmation, adapter.target, resourceIds)
  throwIfCancelled(options.signal)
  // The adapter supplies no path in the manifest. Its service-specific staging root is carried by
  // the adapter at runtime, keeping machine-local paths out of portable state.
  if (!path.isAbsolute(adapter.stagingDirectory)) {
    throw new HostedBackupContractError('unsafe-path', 'Hosted-service adapter did not provide an absolute machine-local staging path.')
  }
  const root = adapter.stagingDirectory
  const preflight = await preflightHostedBackupStorage(root, read.manifest.rawBytes, options.safetyMarginBytes)
  if (!preflight.ok) throw new HostedBackupContractError('limit', preflight.message)
  const temp = path.join(root, `.nodeterm-hosted-restore-${process.pid}-${randomUUID()}`)
  await mkdir(temp, { recursive: true })
  const context: HostedBackupRestoreContext = { stagingDirectory: temp, signal: options.signal, onProgress: options.onProgress }
  const totalBytes = selectedManifest.reduce((sum, resource) => sum + resource.rawBytes, 0)
  let completedBytes = 0
  let rollbackSnapshot: unknown
  try {
    const staged: HostedBackupStagedResource[] = []
    for (const resource of selectedManifest) {
      throwIfCancelled(options.signal)
      const data = read.resources.get(resource.resourceId)
      if (!data) throw new HostedBackupContractError('hash', `Required hosted-service resource is unavailable: ${resource.resourceId}`)
      const target = path.join(temp, `${resource.resourceId}.resource`)
      await writeFile(target, data, { mode: 0o600 })
      staged.push({ manifest: resource, stagedPath: target })
      completedBytes += data.byteLength
      options.onProgress?.({ operation: 'restore', phase: 'staging', completedBytes, totalBytes, completedResources: staged.length, totalResources: selectedManifest.length })
    }
    throwIfCancelled(options.signal)
    rollbackSnapshot = await adapter.captureRollback(resourceIds, context)
    throwIfCancelled(options.signal)
    options.onProgress?.({ operation: 'restore', phase: 'applying', completedBytes, totalBytes, completedResources: staged.length, totalResources: staged.length })
    await adapter.apply(staged, context)
    throwIfCancelled(options.signal)
    options.onProgress?.({ operation: 'restore', phase: 'complete', completedBytes, totalBytes, completedResources: staged.length, totalResources: staged.length })
  } catch (error) {
    if (rollbackSnapshot !== undefined) {
      options.onProgress?.({ operation: 'restore', phase: 'rolling-back', completedBytes, totalBytes, completedResources: 0, totalResources: selectedManifest.length })
      await adapter.rollback(rollbackSnapshot, context).catch((rollbackError) => {
        throw new HostedBackupContractError('rollback', `Hosted-service restore failed and rollback also failed: ${String(rollbackError)}`)
      })
    }
    throw error
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
  return {
    manifest: read.manifest,
    compatibility,
    includedResources: selectedManifest,
    omittedResources: [
      ...read.omissions,
      ...read.manifest.resources
        .filter((resource) => !availableIds.has(resource.resourceId) && !resource.required)
        .map((resource): HostedBackupOmission => ({
          resourceId: resource.resourceId,
          reason: 'unsupported',
          detail: 'The destination did not advertise this optional resource.'
        }))
    ],
    requiresConfirmation: true,
    canRestore: true
  }
}
