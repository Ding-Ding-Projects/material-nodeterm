/**
 * Portable contract shared by hosted-service backup producers and restore consumers.
 *
 * The contract is deliberately free of filesystem, process, Electron, and provider imports.
 * A hosted service supplies portable resource bytes through the core adapter, while this module
 * describes the identity and compatibility facts that must travel with those bytes. Machine-local
 * bindings, credentials, daemon identifiers, and absolute paths are represented as omissions.
 */

export const HOSTED_BACKUP_SCHEMA = 'nodeterm-hosted-service-backup' as const
export const HOSTED_BACKUP_SCHEMA_VERSION = 1 as const
export const HOSTED_BACKUP_MIMETYPE = 'application/x-nodeterm-hosted-backup' as const

export const HOSTED_BACKUP_LIMITS = {
  maxManifestBytes: 1024 * 1024,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxCompressedBytes: 1024 * 1024 * 1024,
  maxRawBytes: 2 * 1024 * 1024 * 1024,
  maxResourceBytes: 2 * 1024 * 1024 * 1024,
  maxResources: 10_000,
  maxOmissions: 2_000,
  maxIdBytes: 256,
  maxTextBytes: 1024
} as const

export type HostedBackupEdition = 'community' | 'enterprise' | 'aio' | 'managed' | string
export type HostedBackupResourceKind =
  | 'database'
  | 'volume'
  | 'configuration'
  | 'upload'
  | 'media'
  | 'index'
  | 'other'

export type HostedBackupOmissionReason =
  | 'machine-local'
  | 'credential'
  | 'unsupported'
  | 'external'
  | 'size-limit'

export interface HostedBackupOmission {
  /** A logical identifier only. Absolute paths and provider identifiers are forbidden. */
  resourceId: string
  reason: HostedBackupOmissionReason
  detail: string
}

export interface HostedBackupResourceManifest {
  resourceId: string
  kind: HostedBackupResourceKind
  version: string
  edition: HostedBackupEdition
  required: boolean
  rawBytes: number
  compressedBytes: number
  sha256: string
  archivePath: string
}

export interface HostedBackupManifest {
  schema: typeof HOSTED_BACKUP_SCHEMA
  schemaVersion: typeof HOSTED_BACKUP_SCHEMA_VERSION
  exporterVersion: string
  minimumReaderVersion: string
  createdAt: string
  service: {
    serviceId: string
    version: string
    edition: HostedBackupEdition
    ownerId: string
  }
  encryption: {
    mode: 'none' | 'password'
    algorithm?: 'AES-256-GCM'
    kdf?: 'scrypt'
  }
  resources: HostedBackupResourceManifest[]
  omissions: HostedBackupOmission[]
  rawBytes: number
  compressedBytes: number
  payloadSha256: string
}

export interface HostedBackupResourceInput {
  resourceId: string
  kind: HostedBackupResourceKind
  version: string
  edition: HostedBackupEdition
  required?: boolean
  /** The bytes are copied into the archive and never retained by the framework. */
  data: Uint8Array
}

export interface HostedBackupTargetResource {
  resourceId: string
  kind: HostedBackupResourceKind
  /** Target accepts this resource version or a newer compatible one. */
  version: string
  edition: HostedBackupEdition
  capacityBytes: number
  writable: boolean
  required?: boolean
}

export interface HostedBackupCompatibilityTarget {
  serviceId: string
  version: string
  editions: readonly HostedBackupEdition[]
  ownerId: string
  resources: readonly HostedBackupTargetResource[]
}

export interface HostedBackupCompatibilityIssue {
  code:
    | 'service'
    | 'owner'
    | 'version'
    | 'edition'
    | 'resource-missing'
    | 'resource-kind'
    | 'resource-version'
    | 'resource-edition'
    | 'resource-capacity'
    | 'resource-readonly'
  resourceId?: string
  message: string
}

export interface HostedBackupCompatibilityResult {
  compatible: boolean
  transferableOwnership: boolean
  issues: HostedBackupCompatibilityIssue[]
  warnings: string[]
}

export class HostedBackupContractError extends Error {
  readonly code:
    | 'manifest'
    | 'unsafe-id'
    | 'unsafe-path'
    | 'duplicate-resource'
    | 'hash'
    | 'limit'
    | 'compatibility'
    | 'confirmation'
    | 'rollback'
    | 'cancelled'
  constructor(code: HostedBackupContractError['code'], message: string) {
    super(message)
    this.name = 'HostedBackupContractError'
    this.code = code
  }
}

const SHA256 = /^[0-9a-f]{64}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/
const RESOURCE_KINDS = new Set<HostedBackupResourceKind>([
  'database', 'volume', 'configuration', 'upload', 'media', 'index', 'other'
])

function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function containsHostPath(value: string): boolean {
  return /(?:^|[\s(])(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(value)
}

export function validateHostedBackupId(value: string, label = 'resource identifier'): string {
  if (!SAFE_ID.test(value) || textBytes(value) > HOSTED_BACKUP_LIMITS.maxIdBytes) {
    throw new HostedBackupContractError('unsafe-id', `Invalid ${label}.`)
  }
  return value
}

export function validateHostedBackupVersion(value: string, label = 'version'): string {
  if (!VERSION.test(value)) throw new HostedBackupContractError('manifest', `Invalid ${label}.`)
  return value
}

/** Archive paths are generated from validated ids and may never contain host paths. */
export function validateHostedBackupArchivePath(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new HostedBackupContractError('unsafe-path', 'Backup resource paths must be relative.')
  }
  const parts = value.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new HostedBackupContractError('unsafe-path', 'Backup resource paths contain an unsafe segment.')
  }
  return value
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split(/[.+_-]/).map((part) => /^\d+$/.test(part) ? Number(part) : 0)
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0)
    if (delta !== 0) return delta < 0 ? -1 : 1
  }
  return 0
}

function editionMatches(backup: HostedBackupEdition, target: readonly HostedBackupEdition[]): boolean {
  return target.includes(backup) || target.includes('*') || backup === 'managed' && target.includes('enterprise')
}

/** Validate the complete manifest before any resource is staged. */
export function validateHostedBackupManifest(value: unknown): HostedBackupManifest {
  if (!record(value) || value.schema !== HOSTED_BACKUP_SCHEMA || value.schemaVersion !== HOSTED_BACKUP_SCHEMA_VERSION) {
    throw new HostedBackupContractError('manifest', 'Backup manifest schema is unsupported.')
  }
  if (typeof value.exporterVersion !== 'string' || typeof value.minimumReaderVersion !== 'string' ||
      typeof value.createdAt !== 'string' || typeof value.rawBytes !== 'number' ||
      typeof value.compressedBytes !== 'number' || !SHA256.test(String(value.payloadSha256))) {
    throw new HostedBackupContractError('manifest', 'Backup manifest framing is invalid.')
  }
  validateHostedBackupVersion(value.exporterVersion, 'exporter version')
  validateHostedBackupVersion(value.minimumReaderVersion, 'minimum reader version')
  if (!Number.isSafeInteger(value.rawBytes) || value.rawBytes < 0 || value.rawBytes > HOSTED_BACKUP_LIMITS.maxRawBytes ||
      !Number.isSafeInteger(value.compressedBytes) || value.compressedBytes < 0 || value.compressedBytes > HOSTED_BACKUP_LIMITS.maxCompressedBytes) {
    throw new HostedBackupContractError('limit', 'Backup manifest byte totals exceed the supported limits.')
  }
  if (!record(value.service) || typeof value.service.serviceId !== 'string' ||
      typeof value.service.version !== 'string' || typeof value.service.edition !== 'string' ||
      typeof value.service.ownerId !== 'string') {
    throw new HostedBackupContractError('manifest', 'Backup service identity is incomplete.')
  }
  validateHostedBackupId(value.service.serviceId, 'service identifier')
  validateHostedBackupId(value.service.ownerId, 'owner identifier')
  validateHostedBackupVersion(value.service.version, 'service version')
  if (!record(value.encryption) || (value.encryption.mode !== 'none' && value.encryption.mode !== 'password')) {
    throw new HostedBackupContractError('manifest', 'Backup encryption choice is invalid.')
  }
  if (value.encryption.mode === 'password' && (value.encryption.algorithm !== 'AES-256-GCM' || value.encryption.kdf !== 'scrypt')) {
    throw new HostedBackupContractError('manifest', 'Backup password encryption metadata is invalid.')
  }
  if (!Array.isArray(value.resources) || value.resources.length > HOSTED_BACKUP_LIMITS.maxResources ||
      !Array.isArray(value.omissions) || value.omissions.length > HOSTED_BACKUP_LIMITS.maxOmissions) {
    throw new HostedBackupContractError('limit', 'Backup resource or omission count exceeds the supported limits.')
  }
  const seen = new Set<string>()
  const folded = new Set<string>()
  let raw = 0
  let compressed = 0
  for (const resource of value.resources) {
    if (!record(resource) || typeof resource.resourceId !== 'string' || typeof resource.kind !== 'string' ||
        typeof resource.version !== 'string' || typeof resource.edition !== 'string' ||
        typeof resource.required !== 'boolean' || !Number.isSafeInteger(resource.rawBytes) ||
        !Number.isSafeInteger(resource.compressedBytes) || typeof resource.archivePath !== 'string' ||
        !SHA256.test(String(resource.sha256)) || !RESOURCE_KINDS.has(resource.kind as HostedBackupResourceKind)) {
      throw new HostedBackupContractError('manifest', 'Backup resource metadata is invalid.')
    }
    validateHostedBackupId(resource.resourceId)
    validateHostedBackupVersion(resource.version, 'resource version')
    validateHostedBackupArchivePath(resource.archivePath)
    if (resource.archivePath !== `resources/${resource.resourceId}`) {
      throw new HostedBackupContractError('manifest', `Backup resource path does not match its identifier: ${resource.resourceId}`)
    }
    if (seen.has(resource.resourceId)) throw new HostedBackupContractError('duplicate-resource', `Duplicate backup resource: ${resource.resourceId}`)
    const foldedId = resource.resourceId.toLocaleLowerCase('en-US')
    if (folded.has(foldedId)) throw new HostedBackupContractError('duplicate-resource', `Case-conflicting backup resource: ${resource.resourceId}`)
    if (resource.rawBytes < 0 || resource.rawBytes > HOSTED_BACKUP_LIMITS.maxResourceBytes || resource.compressedBytes < 0) {
      throw new HostedBackupContractError('limit', `Backup resource exceeds the supported size: ${resource.resourceId}`)
    }
    seen.add(resource.resourceId)
    folded.add(foldedId)
    raw += resource.rawBytes
    compressed += resource.compressedBytes
    if (compressed > HOSTED_BACKUP_LIMITS.maxCompressedBytes) throw new HostedBackupContractError('limit', 'Backup compressed bytes exceed the supported limit.')
    if (raw > HOSTED_BACKUP_LIMITS.maxRawBytes) throw new HostedBackupContractError('limit', 'Backup raw bytes exceed the supported limit.')
  }
  for (const omission of value.omissions) {
    if (!record(omission) || typeof omission.resourceId !== 'string' || typeof omission.reason !== 'string' ||
        typeof omission.detail !== 'string' || textBytes(omission.detail) > HOSTED_BACKUP_LIMITS.maxTextBytes || containsHostPath(omission.detail)) {
      throw new HostedBackupContractError('manifest', 'Backup omission metadata is invalid.')
    }
    validateHostedBackupId(omission.resourceId)
    if (!['machine-local', 'credential', 'unsupported', 'external', 'size-limit'].includes(omission.reason)) {
      throw new HostedBackupContractError('manifest', `Unknown backup omission reason: ${omission.reason}`)
    }
    if (seen.has(omission.resourceId)) throw new HostedBackupContractError('manifest', `Omission contradicts resource: ${omission.resourceId}`)
    if (folded.has(omission.resourceId.toLocaleLowerCase('en-US'))) throw new HostedBackupContractError('manifest', `Case-conflicting backup omission: ${omission.resourceId}`)
    seen.add(omission.resourceId)
    folded.add(omission.resourceId.toLocaleLowerCase('en-US'))
  }
  if (raw !== value.rawBytes || compressed !== value.compressedBytes) {
    throw new HostedBackupContractError('manifest', 'Backup byte totals do not match resource metadata.')
  }
  return value as HostedBackupManifest
}

/** Check ownership, service release, edition, and each resource before restore mutation. */
export function checkHostedBackupCompatibility(
  manifest: HostedBackupManifest,
  target: HostedBackupCompatibilityTarget,
  options: { allowOwnershipTransfer?: boolean } = {}
): HostedBackupCompatibilityResult {
  validateHostedBackupManifest(manifest)
  const issues: HostedBackupCompatibilityIssue[] = []
  const warnings: string[] = []
  if (manifest.service.serviceId !== target.serviceId) {
    issues.push({ code: 'service', message: `Backup belongs to ${manifest.service.serviceId}, not ${target.serviceId}.` })
  }
  const transferableOwnership = manifest.service.ownerId !== target.ownerId
  if (transferableOwnership) {
    if (!options.allowOwnershipTransfer) issues.push({ code: 'owner', message: 'Backup ownership differs; explicit adoption is required.' })
    else warnings.push('Ownership differs; this restore is an explicit adoption and creates a new local binding.')
  }
  if (compareVersions(target.version, manifest.minimumReaderVersion) < 0) {
    issues.push({ code: 'version', message: `Target version ${target.version} cannot read backup minimum ${manifest.minimumReaderVersion}.` })
  }
  if (compareVersions(target.version, manifest.service.version) < 0) {
    issues.push({ code: 'version', message: `Target version ${target.version} is older than the backup service version ${manifest.service.version}.` })
  }
  if (!editionMatches(manifest.service.edition, target.editions)) {
    issues.push({ code: 'edition', message: `Edition ${manifest.service.edition} is not supported by this target.` })
  }
  const targets = new Map(target.resources.map((resource) => [resource.resourceId, resource]))
  for (const resource of manifest.resources) {
    const available = targets.get(resource.resourceId)
    if (!available) {
      if (resource.required) issues.push({ code: 'resource-missing', resourceId: resource.resourceId, message: `Required resource is unavailable: ${resource.resourceId}.` })
      else warnings.push(`Optional resource is unavailable and will be skipped: ${resource.resourceId}.`)
      continue
    }
    if (available.kind !== resource.kind) issues.push({ code: 'resource-kind', resourceId: resource.resourceId, message: `Resource kind differs for ${resource.resourceId}.` })
    if (compareVersions(available.version, resource.version) < 0) issues.push({ code: 'resource-version', resourceId: resource.resourceId, message: `Resource ${resource.resourceId} needs version ${resource.version}.` })
    if (!editionMatches(resource.edition, [available.edition])) issues.push({ code: 'resource-edition', resourceId: resource.resourceId, message: `Resource edition differs for ${resource.resourceId}.` })
    if (available.capacityBytes < resource.rawBytes) issues.push({ code: 'resource-capacity', resourceId: resource.resourceId, message: `Resource ${resource.resourceId} needs ${resource.rawBytes} bytes of capacity.` })
    if (!available.writable) issues.push({ code: 'resource-readonly', resourceId: resource.resourceId, message: `Resource ${resource.resourceId} is not writable.` })
  }
  return { compatible: issues.length === 0, transferableOwnership, issues, warnings }
}

export interface HostedBackupConfirmation {
  action: 'restore-hosted-service'
  firstKeyAccepted: boolean
  secondKeyAccepted: boolean
  sliderComplete: boolean
  targetServiceId: string
  resourceIds: readonly string[]
}

/** The framework receives a completed two-key gate result, never raw credentials. */
export function requireHostedBackupConfirmation(
  confirmation: HostedBackupConfirmation,
  target: HostedBackupCompatibilityTarget,
  resourceIds: readonly string[]
): void {
  if (confirmation.action !== 'restore-hosted-service' || confirmation.targetServiceId !== target.serviceId ||
      !confirmation.firstKeyAccepted || !confirmation.secondKeyAccepted || !confirmation.sliderComplete ||
      confirmation.resourceIds.length !== resourceIds.length || confirmation.resourceIds.some((id) => !resourceIds.includes(id))) {
    throw new HostedBackupContractError('confirmation', 'Restore requires the completed two-key confirmation for this exact service and resource set.')
  }
}
