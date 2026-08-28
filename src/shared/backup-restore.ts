/**
 * Shared backup and restore contract for hosted resources.
 *
 * This module is intentionally platform-free. A hosted node supplies the resource adapter and
 * the host shell supplies the actual file/archive publisher. The portable manifest carries safe
 * intent and evidence only. Credentials, provider sessions, machine paths, process state, host
 * identifiers, caches, and generated runtime data are omissions, never portable values.
 */

export const BACKUP_RESTORE_SCHEMA = 'nodeterm-hosted-backup' as const
export const BACKUP_RESTORE_SCHEMA_VERSION = 1 as const
export const BACKUP_RESTORE_ARCHIVE_FORMAT = 'zip' as const

export const BACKUP_RESTORE_LIMITS = {
  maxManifestBytes: 1024 * 1024,
  maxArchiveBytes: 512 * 1024 * 1024,
  maxRawBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 60_000,
  maxOmissions: 2_000,
  maxResourceIdBytes: 256,
  maxDisplayLabelBytes: 512,
  maxVersionBytes: 128,
  maxOwnerBytes: 256,
  maxDetailBytes: 2_048,
  maxPathBytes: 4_096,
  maxSearchBytes: 4_096
} as const

export type BackupRestoreEdition = 'community' | 'enterprise' | 'unknown'
export type BackupRestoreResourceKind =
  | 'service'
  | 'database'
  | 'uploads'
  | 'configuration'
  | 'volume'
  | 'project'
  | 'custom'
export type BackupRestoreOwnership = 'owned' | 'adopted' | 'external' | 'unknown'
export type BackupRestoreSourceKind = 'local' | 'host' | 'remote'

export interface BackupRestoreVersion {
  product: string
  version: string
  schema: number
}

export interface BackupRestoreResourceDescriptor {
  resourceId: string
  displayLabel: string
  kind: BackupRestoreResourceKind
  edition: BackupRestoreEdition
  version: BackupRestoreVersion
  source: BackupRestoreSourceKind
  ownership: BackupRestoreOwnership
  /** Opaque stable owner id, never a username, host name, path, or credential. */
  ownerId?: string
}

export type BackupRestoreOmissionReason =
  | 'credential'
  | 'provider-session'
  | 'machine-path'
  | 'host-identifier'
  | 'process-state'
  | 'cache'
  | 'generated-runtime'
  | 'unsupported'
  | 'unavailable'

export interface BackupRestoreOmission {
  path: string
  reason: BackupRestoreOmissionReason
  detail: string
}

export interface BackupRestoreEntryMetadata {
  path: string
  sha256: string
  rawBytes: number
  compressedBytes: number
  required: boolean
}

export interface BackupRestoreManifest {
  schema: typeof BACKUP_RESTORE_SCHEMA
  schemaVersion: typeof BACKUP_RESTORE_SCHEMA_VERSION
  backupId: string
  createdAt: string
  framework: BackupRestoreVersion
  product: string
  edition: BackupRestoreEdition
  resource: BackupRestoreResourceDescriptor
  entries: BackupRestoreEntryMetadata[]
  omissions: BackupRestoreOmission[]
  totals: { rawBytes: number; compressedBytes: number }
}

export interface BackupRestoreEntry {
  path: string
  data: Uint8Array
  compressedBytes?: number
  required?: boolean
}

export async function sha256BackupBytes(data: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new BackupRestoreError('hash', 'SHA-256 is unavailable in this surface.')
  const owned = new Uint8Array(data.byteLength)
  owned.set(data)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', owned)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type BackupRestoreErrorCode =
  | 'manifest'
  | 'unsupported-version'
  | 'unsupported-edition'
  | 'resource-mismatch'
  | 'ownership'
  | 'required-entry'
  | 'unknown-entry'
  | 'unsafe-path'
  | 'duplicate-entry'
  | 'case-collision'
  | 'entry-limit'
  | 'raw-limit'
  | 'compressed-limit'
  | 'hash'
  | 'destination-collision'
  | 'cancelled'
  | 'rollback'

export class BackupRestoreError extends Error {
  readonly code: BackupRestoreErrorCode
  constructor(code: BackupRestoreErrorCode, message: string) {
    super(message)
    this.name = 'BackupRestoreError'
    this.code = code
  }
}

const SHA256 = /^[0-9a-f]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_:-]{0,127}$/
const SAFE_PRODUCT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/
const RESERVED_SEGMENT = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function boundedText(value: unknown, label: string, maxBytes: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || utf8Bytes(value) > maxBytes ||
      [...value].some((char) => char < ' ' || char === '\u007f') || (pattern && !pattern.test(value))) {
    throw new BackupRestoreError('manifest', `${label} is invalid.`)
  }
  return value
}

function unknownFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const accepted = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) throw new BackupRestoreError('manifest', `${label} contains an unknown field: ${key}`)
  }
}

/** Reject archive paths that could escape the destination or collide after extraction. */
export function validateBackupArchivePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new BackupRestoreError('unsafe-path', 'Backup archive path is empty or contains a NUL byte.')
  }
  if (utf8Bytes(value) > BACKUP_RESTORE_LIMITS.maxPathBytes || value.includes('\\') || value.startsWith('/') ||
      /^[A-Za-z]:/.test(value) || value.normalize('NFC') !== value) {
    throw new BackupRestoreError('unsafe-path', `Backup archive path is not a safe relative path: ${value}`)
  }
  const parts = value.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..' || /[ .]$/.test(part) ||
      part.includes(':') || RESERVED_SEGMENT.test(part))) {
    throw new BackupRestoreError('unsafe-path', `Backup archive path contains an unsafe segment: ${value}`)
  }
  return value
}

export function backupArchivePathKey(value: string): string {
  return validateBackupArchivePath(value).normalize('NFC').toLocaleLowerCase('en-US')
}

function validateVersion(value: unknown, label: string): BackupRestoreVersion {
  if (!record(value)) throw new BackupRestoreError('manifest', `${label} is invalid.`)
  unknownFields(value, ['product', 'version', 'schema'], label)
  const product = boundedText(value.product, `${label} product`, 128, SAFE_PRODUCT)
  const version = boundedText(value.version, `${label} version`, BACKUP_RESTORE_LIMITS.maxVersionBytes, SAFE_VERSION)
  const schema = value.schema
  if (typeof schema !== 'number' || !Number.isSafeInteger(schema) || schema < 1 || schema > 100) {
    throw new BackupRestoreError('unsupported-version', `${label} schema is unsupported.`)
  }
  return { product, version, schema }
}

export function validateBackupResourceDescriptor(value: unknown): BackupRestoreResourceDescriptor {
  if (!record(value)) throw new BackupRestoreError('resource-mismatch', 'Backup resource descriptor is invalid.')
  unknownFields(value, ['resourceId', 'displayLabel', 'kind', 'edition', 'version', 'source', 'ownership', 'ownerId'], 'Backup resource')
  const resourceId = boundedText(value.resourceId, 'Backup resource id', BACKUP_RESTORE_LIMITS.maxResourceIdBytes, SAFE_ID)
  const displayLabel = boundedText(value.displayLabel, 'Backup resource label', BACKUP_RESTORE_LIMITS.maxDisplayLabelBytes)
  const kinds: BackupRestoreResourceKind[] = ['service', 'database', 'uploads', 'configuration', 'volume', 'project', 'custom']
  const editions: BackupRestoreEdition[] = ['community', 'enterprise', 'unknown']
  const sources: BackupRestoreSourceKind[] = ['local', 'host', 'remote']
  const ownership: BackupRestoreOwnership[] = ['owned', 'adopted', 'external', 'unknown']
  if (!kinds.includes(value.kind as BackupRestoreResourceKind) || !editions.includes(value.edition as BackupRestoreEdition) ||
      !sources.includes(value.source as BackupRestoreSourceKind) || !ownership.includes(value.ownership as BackupRestoreOwnership)) {
    throw new BackupRestoreError('resource-mismatch', 'Backup resource kind, edition, source, or ownership is unsupported.')
  }
  const descriptor: BackupRestoreResourceDescriptor = {
    resourceId,
    displayLabel,
    kind: value.kind as BackupRestoreResourceKind,
    edition: value.edition as BackupRestoreEdition,
    version: validateVersion(value.version, 'Backup resource version'),
    source: value.source as BackupRestoreSourceKind,
    ownership: value.ownership as BackupRestoreOwnership
  }
  if (value.ownerId !== undefined) descriptor.ownerId = boundedText(value.ownerId, 'Backup owner id', BACKUP_RESTORE_LIMITS.maxOwnerBytes, SAFE_ID)
  if ((descriptor.ownership === 'owned' || descriptor.ownership === 'adopted') && !descriptor.ownerId) {
    throw new BackupRestoreError('ownership', 'Owned or adopted resources require an opaque owner id.')
  }
  return descriptor
}

function validateOmission(value: unknown): BackupRestoreOmission {
  if (!record(value)) throw new BackupRestoreError('manifest', 'Backup omission is invalid.')
  unknownFields(value, ['path', 'reason', 'detail'], 'Backup omission')
  const reasons: BackupRestoreOmissionReason[] = ['credential', 'provider-session', 'machine-path', 'host-identifier', 'process-state', 'cache', 'generated-runtime', 'unsupported', 'unavailable']
  const path = validateBackupArchivePath(value.path)
  if (!reasons.includes(value.reason as BackupRestoreOmissionReason)) throw new BackupRestoreError('manifest', `Backup omission reason is unsupported: ${String(value.reason)}`)
  return { path, reason: value.reason as BackupRestoreOmissionReason, detail: boundedText(value.detail, 'Backup omission detail', BACKUP_RESTORE_LIMITS.maxDetailBytes) }
}

/** Validate the manifest shape before any archive payload is written or restored. */
export function validateBackupRestoreManifest(value: unknown): BackupRestoreManifest {
  if (!record(value)) throw new BackupRestoreError('manifest', 'Backup manifest must be an object.')
  unknownFields(value, ['schema', 'schemaVersion', 'backupId', 'createdAt', 'framework', 'product', 'edition', 'resource', 'entries', 'omissions', 'totals'], 'Backup manifest')
  if (value.schema !== BACKUP_RESTORE_SCHEMA || value.schemaVersion !== BACKUP_RESTORE_SCHEMA_VERSION) {
    throw new BackupRestoreError('unsupported-version', 'Backup manifest schema version is unsupported.')
  }
  const backupId = boundedText(value.backupId, 'Backup id', 128, SAFE_ID)
  const createdAt = boundedText(value.createdAt, 'Backup creation time', 64)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new BackupRestoreError('manifest', 'Backup creation time is not an ISO timestamp.')
  const framework = validateVersion(value.framework, 'Backup framework version')
  const product = boundedText(value.product, 'Backup product', 128, SAFE_PRODUCT)
  const editions: BackupRestoreEdition[] = ['community', 'enterprise', 'unknown']
  if (!editions.includes(value.edition as BackupRestoreEdition)) throw new BackupRestoreError('unsupported-edition', 'Backup edition is unsupported.')
  const resource = validateBackupResourceDescriptor(value.resource)
  if (resource.edition !== value.edition) throw new BackupRestoreError('unsupported-edition', 'Backup and resource editions do not match.')
  if (!Array.isArray(value.entries) || value.entries.length > BACKUP_RESTORE_LIMITS.maxEntries) throw new BackupRestoreError('entry-limit', 'Backup entry inventory exceeds its limit.')
  if (!Array.isArray(value.omissions) || value.omissions.length > BACKUP_RESTORE_LIMITS.maxOmissions) throw new BackupRestoreError('manifest', 'Backup omission inventory exceeds its limit.')
  if (!record(value.totals)) throw new BackupRestoreError('manifest', 'Backup totals are invalid.')
  const totals = value.totals
  if (typeof totals.rawBytes !== 'number' || !Number.isSafeInteger(totals.rawBytes) || totals.rawBytes < 0 ||
      typeof totals.compressedBytes !== 'number' || !Number.isSafeInteger(totals.compressedBytes) || totals.compressedBytes < 0) throw new BackupRestoreError('manifest', 'Backup totals are invalid.')
  const entries: BackupRestoreEntryMetadata[] = []
  const seen = new Set<string>()
  const folded = new Set<string>()
  let rawBytes = 0
  let compressedBytes = 0
  for (const item of value.entries) {
    if (!record(item)) throw new BackupRestoreError('manifest', 'Backup entry metadata is invalid.')
    unknownFields(item, ['path', 'sha256', 'rawBytes', 'compressedBytes', 'required'], 'Backup entry')
    const path = validateBackupArchivePath(item.path)
    if (path === 'manifest.json') throw new BackupRestoreError('duplicate-entry', 'The manifest is framing, not a payload entry.')
    const rawBytesValue = item.rawBytes
    const compressedBytesValue = item.compressedBytes
    if (!SHA256.test(String(item.sha256)) || typeof rawBytesValue !== 'number' || !Number.isSafeInteger(rawBytesValue) || rawBytesValue < 0 ||
        typeof compressedBytesValue !== 'number' || !Number.isSafeInteger(compressedBytesValue) || compressedBytesValue < 0 || typeof item.required !== 'boolean') throw new BackupRestoreError('manifest', `Backup entry metadata is invalid: ${path}`)
    const key = backupArchivePathKey(path)
    if (seen.has(path)) throw new BackupRestoreError('duplicate-entry', `Duplicate backup entry: ${path}`)
    if (folded.has(key)) throw new BackupRestoreError('case-collision', `Case-colliding backup entry: ${path}`)
    seen.add(path)
    folded.add(key)
    if (rawBytesValue > BACKUP_RESTORE_LIMITS.maxEntryBytes) throw new BackupRestoreError('raw-limit', `Backup entry exceeds its byte limit: ${path}`)
    rawBytes += rawBytesValue
    compressedBytes += compressedBytesValue
    if (rawBytes > BACKUP_RESTORE_LIMITS.maxRawBytes) throw new BackupRestoreError('raw-limit', 'Backup raw-byte total exceeds its limit.')
    if (compressedBytes > BACKUP_RESTORE_LIMITS.maxArchiveBytes) throw new BackupRestoreError('compressed-limit', 'Backup compressed-byte total exceeds its limit.')
    entries.push({ path, sha256: String(item.sha256).toLowerCase(), rawBytes: rawBytesValue, compressedBytes: compressedBytesValue, required: item.required })
  }
  if (!entries.some((entry) => entry.required)) throw new BackupRestoreError('required-entry', 'A hosted backup must contain a required payload entry.')
  const omissions = value.omissions.map(validateOmission)
  const omissionSeen = new Set<string>()
  for (const omission of omissions) {
    const key = backupArchivePathKey(omission.path)
    if (seen.has(omission.path) || folded.has(key) || omissionSeen.has(key)) throw new BackupRestoreError('duplicate-entry', `Backup omission collides with an entry: ${omission.path}`)
    omissionSeen.add(key)
  }
  if (rawBytes !== totals.rawBytes || compressedBytes !== totals.compressedBytes) throw new BackupRestoreError('manifest', 'Backup totals do not match the entry inventory.')
  return { schema: BACKUP_RESTORE_SCHEMA, schemaVersion: 1, backupId, createdAt, framework, product, edition: value.edition as BackupRestoreEdition, resource, entries, omissions, totals: { rawBytes, compressedBytes } }
}

/** Create a deterministic manifest from a resource descriptor and payload inventory. */
export async function createBackupRestoreManifest(
  resource: BackupRestoreResourceDescriptor,
  entries: readonly BackupRestoreEntry[],
  omissions: readonly BackupRestoreOmission[] = [],
  options: { backupId?: string; createdAt?: string; framework?: BackupRestoreVersion; product?: string; digest?: (data: Uint8Array) => Promise<string> } = {}
): Promise<BackupRestoreManifest> {
  const cleanResource = validateBackupResourceDescriptor(resource)
  const digest = options.digest ?? sha256BackupBytes
  if (entries.length > BACKUP_RESTORE_LIMITS.maxEntries) throw new BackupRestoreError('entry-limit', 'Backup entry inventory exceeds its limit.')
  const metadata: BackupRestoreEntryMetadata[] = []
  const seen = new Set<string>()
  const folded = new Set<string>()
  let rawBytes = 0
  let compressedBytes = 0
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const path = validateBackupArchivePath(entry.path)
    if (path === 'manifest.json') throw new BackupRestoreError('duplicate-entry', 'The manifest is framing, not a payload entry.')
    const key = backupArchivePathKey(path)
    if (seen.has(path)) throw new BackupRestoreError('duplicate-entry', `Duplicate backup entry: ${path}`)
    if (folded.has(key)) throw new BackupRestoreError('case-collision', `Case-colliding backup entry: ${path}`)
    seen.add(path)
    folded.add(key)
    const raw = entry.data.byteLength
    const compressed = entry.compressedBytes ?? raw
    if (raw > BACKUP_RESTORE_LIMITS.maxEntryBytes) throw new BackupRestoreError('raw-limit', `Backup entry exceeds its byte limit: ${path}`)
    rawBytes += raw
    compressedBytes += compressed
    if (rawBytes > BACKUP_RESTORE_LIMITS.maxRawBytes) throw new BackupRestoreError('raw-limit', 'Backup raw-byte total exceeds its limit.')
    if (compressedBytes > BACKUP_RESTORE_LIMITS.maxArchiveBytes) throw new BackupRestoreError('compressed-limit', 'Backup compressed-byte total exceeds its limit.')
    metadata.push({ path, sha256: (await digest(entry.data)).toLowerCase(), rawBytes: raw, compressedBytes: compressed, required: entry.required === true })
  }
  const manifest: BackupRestoreManifest = {
    schema: BACKUP_RESTORE_SCHEMA,
    schemaVersion: BACKUP_RESTORE_SCHEMA_VERSION,
    backupId: options.backupId ?? `backup-${Date.now().toString(36)}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
    framework: options.framework ?? { product: 'nodeterm', version: '1', schema: 1 },
    product: options.product ?? cleanResource.version.product,
    edition: cleanResource.edition,
    resource: cleanResource,
    entries: metadata,
    omissions: omissions.map(validateOmission),
    totals: { rawBytes, compressedBytes }
  }
  return validateBackupRestoreManifest(manifest)
}

export function serializeBackupRestoreManifest(manifest: BackupRestoreManifest): Uint8Array {
  const validated = validateBackupRestoreManifest(manifest)
  const bytes = new TextEncoder().encode(`${JSON.stringify(validated, null, 2)}\n`)
  if (bytes.byteLength > BACKUP_RESTORE_LIMITS.maxManifestBytes) throw new BackupRestoreError('manifest', 'Backup manifest exceeds its byte limit.')
  return bytes
}

export function parseBackupRestoreManifest(bytes: Uint8Array): BackupRestoreManifest {
  if (bytes.byteLength > BACKUP_RESTORE_LIMITS.maxManifestBytes) throw new BackupRestoreError('manifest', 'Backup manifest exceeds its byte limit.')
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new BackupRestoreError('manifest', 'Backup manifest is not valid UTF-8 JSON.') }
  return validateBackupRestoreManifest(value)
}

/** Validate all payload bytes against the manifest, including hashes and bounded totals. */
export async function validateBackupRestoreEntries(
  manifest: BackupRestoreManifest,
  entries: readonly BackupRestoreEntry[],
  digest: (data: Uint8Array) => Promise<string> = sha256BackupBytes
): Promise<void> {
  validateBackupRestoreManifest(manifest)
  if (entries.length > BACKUP_RESTORE_LIMITS.maxEntries) throw new BackupRestoreError('entry-limit', 'Backup payload entry count exceeds its limit.')
  const byPath = new Map<string, BackupRestoreEntry>()
  const folded = new Set<string>()
  for (const entry of entries) {
    const path = validateBackupArchivePath(entry.path)
    if (byPath.has(path)) throw new BackupRestoreError('duplicate-entry', `Duplicate backup payload: ${path}`)
    const key = backupArchivePathKey(path)
    if (folded.has(key)) throw new BackupRestoreError('case-collision', `Case-colliding backup payload: ${path}`)
    byPath.set(path, entry)
    folded.add(key)
  }
  for (const metadata of manifest.entries) {
    const entry = byPath.get(metadata.path)
    if (!entry) throw new BackupRestoreError('required-entry', `Manifest entry is absent from backup: ${metadata.path}`)
    const compressedBytes = entry.compressedBytes ?? entry.data.byteLength
    if (entry.data.byteLength !== metadata.rawBytes || compressedBytes !== metadata.compressedBytes) throw new BackupRestoreError('manifest', `Backup size metadata does not match payload: ${metadata.path}`)
    if (entry.data.byteLength > BACKUP_RESTORE_LIMITS.maxEntryBytes) throw new BackupRestoreError('raw-limit', `Backup payload exceeds its byte limit: ${metadata.path}`)
    if ((await digest(entry.data)).toLowerCase() !== metadata.sha256) throw new BackupRestoreError('hash', `Backup SHA-256 does not match payload: ${metadata.path}`)
  }
  const listed = new Set(manifest.entries.map((entry) => entry.path))
  for (const path of byPath.keys()) if (!listed.has(path)) throw new BackupRestoreError('unknown-entry', `Backup payload is not listed in its manifest: ${path}`)
}

export interface BackupRestoreCompatibility {
  allowed: boolean
  version: 'same' | 'upgrade' | 'downgrade' | 'unknown' | 'incompatible'
  edition: 'same' | 'upgrade' | 'downgrade' | 'unknown' | 'incompatible'
  ownership: 'owned' | 'adoptable' | 'external' | 'unknown'
  reasons: string[]
  warnings: string[]
}

function compareVersion(from: string, to: string): -1 | 0 | 1 | null {
  const left = from.split('.').map(Number)
  const right = to.split('.').map(Number)
  if (left.some((n) => !Number.isSafeInteger(n)) || right.some((n) => !Number.isSafeInteger(n))) return null
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0
    const b = right[i] ?? 0
    if (a < b) return -1
    if (a > b) return 1
  }
  return 0
}

/** Review a restore before publication. A review never contacts or mutates a provider. */
export function reviewBackupRestore(
  manifest: BackupRestoreManifest,
  target: BackupRestoreResourceDescriptor,
  options: { allowEditionUpgrade?: boolean; allowVersionDowngrade?: boolean; adoptExternal?: boolean } = {}
): BackupRestoreCompatibility {
  validateBackupRestoreManifest(manifest)
  validateBackupResourceDescriptor(target)
  const reasons: string[] = []
  const warnings: string[] = []
  if (manifest.resource.resourceId !== target.resourceId) reasons.push('The backup resource id does not match the selected destination resource.')
  if (manifest.resource.kind !== target.kind) reasons.push('The backup resource kind does not match the selected destination resource.')
  const editionComparison = manifest.edition === target.edition
    ? 0
    : manifest.edition === 'community' && target.edition === 'enterprise' ? -1
      : manifest.edition === 'enterprise' && target.edition === 'community' ? 1 : null
  let edition: BackupRestoreCompatibility['edition'] = 'unknown'
  if (editionComparison === 0) edition = 'same'
  else if (editionComparison === -1) edition = 'upgrade'
  else if (editionComparison === 1) edition = 'downgrade'
  else edition = 'incompatible'
  if (edition === 'upgrade' && !options.allowEditionUpgrade) reasons.push('The edition change requires explicit upgrade confirmation.')
  if (edition === 'downgrade' && !options.allowVersionDowngrade) reasons.push('Restoring to a lower edition is disabled until explicitly allowed.')
  const versionComparison = compareVersion(manifest.resource.version.version, target.version.version)
  let version: BackupRestoreCompatibility['version'] = 'unknown'
  if (versionComparison === null) version = 'unknown'
  else if (versionComparison === 0) version = 'same'
  else if (versionComparison === -1) version = 'upgrade'
  else version = 'downgrade'
  if (version === 'downgrade' && !options.allowVersionDowngrade) reasons.push('The backup is newer than the destination version; downgrade confirmation is required.')
  if (version === 'unknown') warnings.push('Version ordering could not be proven from the recorded values.')
  let ownership: BackupRestoreCompatibility['ownership']
  if (manifest.resource.ownership === 'owned' && target.ownership === 'owned' && manifest.resource.ownerId === target.ownerId) ownership = 'owned'
  else if (manifest.resource.ownership === 'adopted' || target.ownership === 'adopted' || options.adoptExternal) ownership = 'adoptable'
  else if (manifest.resource.ownership === 'external' || target.ownership === 'external') ownership = 'external'
  else ownership = 'unknown'
  if (ownership === 'external' && !options.adoptExternal) reasons.push('The source or destination is externally owned; explicit adoption is required.')
  if (ownership === 'unknown') reasons.push('Resource ownership could not be verified.')
  for (const omission of manifest.omissions) if (omission.reason === 'credential' || omission.reason === 'provider-session') warnings.push(`The restore requires local re-entry for omitted ${omission.reason} data.`)
  return { allowed: reasons.length === 0, version, edition, ownership, reasons, warnings }
}

export type BackupRestoreOperation = 'backup' | 'restore' | 'rollback'
export type BackupRestorePhase = 'preflight' | 'reading' | 'validating' | 'staging' | 'review' | 'publishing' | 'restoring' | 'rolling-back' | 'completed' | 'cancelled' | 'failed'

export interface BackupRestoreProgress {
  operationId: string
  operation: BackupRestoreOperation
  phase: BackupRestorePhase
  progress: number
  completedBytes: number
  totalBytes: number | null
  message: string
  cancellable: boolean
}

export interface BackupRestoreExecutionContext {
  signal?: AbortSignal
  onProgress?: (progress: BackupRestoreProgress) => void
}

export interface BackupRestoreTransaction<TStage, TResult> {
  operation: BackupRestoreOperation
  operationId: string
  preflight?: (signal: AbortSignal) => Promise<void>
  stage: (signal: AbortSignal, emit: (phase: BackupRestorePhase, progress: number, message: string, completedBytes?: number, totalBytes?: number | null) => void) => Promise<TStage>
  validate: (stage: TStage, signal: AbortSignal) => Promise<void>
  publish: (stage: TStage, signal: AbortSignal) => Promise<TResult>
  rollback?: (stage: TStage, signal: AbortSignal) => Promise<void>
  dispose?: (stage: TStage) => Promise<void>
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new BackupRestoreError('cancelled', 'The backup or restore was cancelled before publication.')
}

/** Run a staged transaction with truthful progress and rollback before publication is exposed. */
export async function runBackupRestoreTransaction<TStage, TResult>(
  transaction: BackupRestoreTransaction<TStage, TResult>,
  context: BackupRestoreExecutionContext = {}
): Promise<TResult> {
  const controller = new AbortController()
  const signal = context.signal ?? controller.signal
  let stage: TStage | undefined
  const emit = (phase: BackupRestorePhase, progress: number, message: string, completedBytes = 0, totalBytes: number | null = null): void => {
    context.onProgress?.({ operationId: transaction.operationId, operation: transaction.operation, phase, progress: Math.min(1, Math.max(0, progress)), completedBytes, totalBytes, message, cancellable: !['completed', 'cancelled', 'failed'].includes(phase) })
  }
  try {
    emit('preflight', 0.02, 'Checking the selected resource and destination.')
    await transaction.preflight?.(signal)
    throwIfCancelled(signal)
    stage = await transaction.stage(signal, (phase, progress, message, completedBytes, totalBytes) => {
      throwIfCancelled(signal)
      emit(phase, progress, message, completedBytes, totalBytes)
    })
    throwIfCancelled(signal)
    emit('validating', 0.75, 'Validating staged bytes and recorded resource evidence.')
    await transaction.validate(stage, signal)
    throwIfCancelled(signal)
    emit('publishing', 0.9, 'Publishing the validated result atomically.')
    const result = await transaction.publish(stage, signal)
    throwIfCancelled(signal)
    emit('completed', 1, 'The backup or restore completed and the published result was validated.')
    return result
  } catch (error) {
    const failure = error instanceof BackupRestoreError ? error : new BackupRestoreError('manifest', error instanceof Error ? error.message : String(error))
    if (stage !== undefined && transaction.rollback) {
      emit('rolling-back', 0.93, 'The operation did not publish cleanly; restoring the previous state.')
      await transaction.rollback(stage, signal).catch(() => undefined)
    }
    if (stage !== undefined) await transaction.dispose?.(stage).catch(() => undefined)
    emit(failure.code === 'cancelled' ? 'cancelled' : 'failed', 0, failure.message)
    throw failure
  }
}

export interface BackupRestoreRollbackContract {
  backupId: string
  operationId: string
  targetResourceId: string
  previousStateSha256: string
  createdAt: string
  expiresAt: string
}

export function createRollbackContract(input: {
  backupId: string
  operationId: string
  targetResourceId: string
  previousStateSha256: string
  now?: number
  ttlMs?: number
}): BackupRestoreRollbackContract {
  const now = input.now ?? Date.now()
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 24 * 60 * 60 * 1000) throw new BackupRestoreError('rollback', 'Rollback duration is outside its bounded range.')
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + ttlMs).toISOString()
  return validateRollbackContract({
    backupId: input.backupId,
    operationId: input.operationId,
    targetResourceId: input.targetResourceId,
    previousStateSha256: input.previousStateSha256,
    createdAt,
    expiresAt
  }, now)
}

export function validateRollbackContract(value: unknown, now = Date.now()): BackupRestoreRollbackContract {
  if (!record(value)) throw new BackupRestoreError('rollback', 'Rollback contract is invalid.')
  unknownFields(value, ['backupId', 'operationId', 'targetResourceId', 'previousStateSha256', 'createdAt', 'expiresAt'], 'Rollback contract')
  const result: BackupRestoreRollbackContract = {
    backupId: boundedText(value.backupId, 'Rollback backup id', 128, SAFE_ID),
    operationId: boundedText(value.operationId, 'Rollback operation id', 128, SAFE_ID),
    targetResourceId: boundedText(value.targetResourceId, 'Rollback target id', 256, SAFE_ID),
    previousStateSha256: boundedText(value.previousStateSha256, 'Rollback state hash', 64, SHA256),
    createdAt: boundedText(value.createdAt, 'Rollback creation time', 64),
    expiresAt: boundedText(value.expiresAt, 'Rollback expiry time', 64)
  }
  const created = Date.parse(result.createdAt)
  const expires = Date.parse(result.expiresAt)
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/
  if (!iso.test(result.createdAt) || !iso.test(result.expiresAt) || !Number.isFinite(created) || !Number.isFinite(expires) || expires <= created || expires <= now) throw new BackupRestoreError('rollback', 'Rollback contract is expired or has invalid timestamps.')
  return result
}

export type BackupRestoreSearchMode = 'plain' | 'regex'

export interface BackupRestoreSearchState {
  query: string
  pattern: string
  flags: string
  mode: BackupRestoreSearchMode
  valid: boolean
  error?: string
}

/** Hand-written search inventory for every list or picker owned by this framework. */
export const BACKUP_RESTORE_SEARCH_INVENTORY = [
  { id: 'backup-list', scope: 'saved backups', anchoredRegexBuilder: true },
  { id: 'resource-picker', scope: 'verified destination resources', anchoredRegexBuilder: true },
  { id: 'archive-entry-list', scope: 'validated archive entries and omissions', anchoredRegexBuilder: true },
  { id: 'restore-review', scope: 'restore review evidence and warnings', anchoredRegexBuilder: true },
  { id: 'operation-history', scope: 'backup, restore, and rollback operations', anchoredRegexBuilder: true }
] as const

export function validateBackupRestoreSearchState(value: unknown): BackupRestoreSearchState {
  if (!record(value)) throw new BackupRestoreError('manifest', 'Backup search state is invalid.')
  unknownFields(value, ['query', 'pattern', 'flags', 'mode', 'valid', 'error'], 'Backup search state')
  const text = (input: unknown, label: string, max: number): string => {
    if (typeof input !== 'string' || utf8Bytes(input) > max || [...input].some((char) => char < ' ' || char === '\u007f')) throw new BackupRestoreError('manifest', `${label} is invalid.`)
    return input
  }
  const query = text(value.query, 'Backup search query', BACKUP_RESTORE_LIMITS.maxSearchBytes)
  const pattern = text(value.pattern, 'Backup regex pattern', BACKUP_RESTORE_LIMITS.maxSearchBytes)
  const flags = text(value.flags, 'Backup regex flags', 32)
  if (value.mode !== 'plain' && value.mode !== 'regex') throw new BackupRestoreError('manifest', 'Backup search mode is invalid.')
  if (typeof value.valid !== 'boolean') throw new BackupRestoreError('manifest', 'Backup search validity is invalid.')
  if (value.error !== undefined && typeof value.error !== 'string') throw new BackupRestoreError('manifest', 'Backup search error is invalid.')
  return { query, pattern, flags, mode: value.mode, valid: value.valid, ...(value.error ? { error: value.error } : {}) }
}

export const BACKUP_RESTORE_GUIDED_CONTROLS = [
  { id: 'choose-resource', kind: 'picker', disabledReason: 'No verified owned or explicitly adopted resource is available.' },
  { id: 'choose-edition', kind: 'picker', disabledReason: 'The selected resource has no verified edition metadata.' },
  { id: 'choose-version', kind: 'picker', disabledReason: 'The selected resource has no verified version metadata.' },
  { id: 'choose-archive', kind: 'file-picker', disabledReason: 'No local archive has been selected.' },
  { id: 'review-restore', kind: 'review', disabledReason: 'Restore review is incomplete or contains an unresolved ownership mismatch.' },
  { id: 'start-backup', kind: 'action', disabledReason: 'Resource preflight or destination capacity has not passed.' },
  { id: 'start-restore', kind: 'action', disabledReason: 'Restore review has not been explicitly accepted.' },
  { id: 'cancel-operation', kind: 'action', disabledReason: 'No cancellable backup or restore operation is running.' },
  { id: 'rollback-operation', kind: 'action', disabledReason: 'No unexpired rollback contract is available.' }
] as const
