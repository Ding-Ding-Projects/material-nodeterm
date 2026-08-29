/** Platform-free schema 3 portable project envelope.
 *
 * This module describes the interchange contract only. It deliberately has no filesystem,
 * process, Electron, credential, or machine-state imports. Callers provide entry bytes and may
 * persist the validated result in whatever archive implementation they use.
 */

export const PORTABLE_PROJECT_SCHEMA = 'nodeterm-portable-project' as const
export const PORTABLE_PROJECT_SCHEMA_VERSION = 3 as const

/** Archive framing is required, but the manifest is not part of its own hashed payload list. */
export const PORTABLE_PROJECT_ARCHIVE_REQUIRED_ENTRIES = ['manifest.json', 'project.json', 'history.bundle'] as const
export const PORTABLE_PROJECT_REQUIRED_ENTRIES = ['project.json', 'history.bundle'] as const
export const PORTABLE_PROJECT_OPTIONAL_ENTRIES = [
  'repository.bundle',
  'files/',
  'assets/media/',
  'sidecars/',
  'attachments/'
] as const

export const PORTABLE_PROJECT_LIMITS = {
  maxManifestBytes: 1024 * 1024,
  maxEntryCount: 60_000,
  maxRawBytes: 2 * 1024 * 1024 * 1024,
  maxCompressedBytes: 512 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxPathBytes: 4096,
  maxOmissionCount: 2_000,
  maxMigrationDepth: 16,
  maxMigrationNodes: 20_000
} as const

export interface PortableProjectEntryMetadata {
  path: string
  sha256: string
  rawBytes: number
  compressedBytes: number
  required: boolean
}

export interface PortableProjectOmission {
  path: string
  reason: 'unknown-optional' | 'machine-local' | 'credential' | 'unsupported'
  detail: string
}

export interface PortableProjectV3Manifest {
  schema: typeof PORTABLE_PROJECT_SCHEMA
  schemaVersion: typeof PORTABLE_PROJECT_SCHEMA_VERSION
  project: { name: string; color?: string }
  entries: PortableProjectEntryMetadata[]
  omissions: PortableProjectOmission[]
}

export interface PortableProjectV3Entry {
  path: string
  data: Uint8Array
  compressedBytes?: number
  required?: boolean
}

export type PortableProjectValidationErrorCode =
  | 'manifest'
  | 'required-entry'
  | 'unknown-required'
  | 'unknown-optional'
  | 'unsafe-path'
  | 'duplicate-entry'
  | 'case-collision'
  | 'entry-limit'
  | 'raw-limit'
  | 'compressed-limit'
  | 'hash'
  | 'destination-collision'
  | 'cancelled'

export class PortableProjectV3Error extends Error {
  readonly code: PortableProjectValidationErrorCode
  constructor(code: PortableProjectValidationErrorCode, message: string) {
    super(message)
    this.name = 'PortableProjectV3Error'
    this.code = code
  }
}

const SHA256 = /^[0-9a-f]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key) || !allowed.has(key)) {
      throw new PortableProjectV3Error('manifest', `Portable ${label} contains an unknown key: ${key}`)
    }
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/** Scan object keys before JSON.parse, because JSON.parse silently keeps only the last duplicate. */
export function rejectDuplicateJsonKeys(source: string): void {
  type Frame = { kind: 'object' | 'array'; state: 'key' | 'colon' | 'value' | 'comma' }
  const stack: Frame[] = []
  const skipString = (start: number): number => {
    let i = start + 1
    while (i < source.length) {
      const code = source.charCodeAt(i)
      if (code === 0x5c) { i += 2; continue }
      if (code === 0x22) return i + 1
      i++
    }
    return source.length
  }
  const skipPrimitive = (start: number): number => {
    let i = start
    while (i < source.length && !/[\s,}\]]/.test(source[i])) i++
    return i
  }
  let i = 0
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue }
    const ch = source[i]
    const top = stack[stack.length - 1]
    if (ch === '{') {
      stack.push({ kind: 'object', state: 'key' })
      i++
      continue
    }
    if (ch === '[') { stack.push({ kind: 'array', state: 'value' }); i++; continue }
    if (ch === '}' || ch === ']') { stack.pop(); i++; if (stack.length) stack[stack.length - 1].state = 'comma'; continue }
    if (ch === ':') { if (top?.kind === 'object') top.state = 'value'; i++; continue }
    if (ch === ',') { if (top) top.state = top.kind === 'object' ? 'key' : 'value'; i++; continue }
    if (ch === '"') {
      const end = skipString(i)
      if (top?.kind === 'object' && top.state === 'key') {
        const key = JSON.parse(source.slice(i, end)) as string
        const frameKeys = (top as Frame & { seen?: Set<string> }).seen ?? new Set<string>()
        ;(top as Frame & { seen: Set<string> }).seen = frameKeys
        if (frameKeys.has(key)) throw new PortableProjectV3Error('manifest', `Manifest contains a duplicate JSON key: ${key}`)
        frameKeys.add(key)
        top.state = 'colon'
      } else if (top) top.state = 'comma'
      i = end
      continue
    }
    i = skipPrimitive(i)
    if (top) top.state = 'comma'
  }
}

/** Reject, rather than repair, paths that an extractor could interpret differently. */
export function validatePortableArchivePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new PortableProjectV3Error('unsafe-path', 'Archive entry path is empty or contains a NUL byte.')
  }
  if (utf8Bytes(value) > PORTABLE_PROJECT_LIMITS.maxPathBytes) {
    throw new PortableProjectV3Error('unsafe-path', `Archive entry path exceeds ${PORTABLE_PROJECT_LIMITS.maxPathBytes} bytes.`)
  }
  const normalized = value.normalize('NFC')
  if (normalized !== value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new PortableProjectV3Error('unsafe-path', `Archive entry path is not relative: ${value}`)
  }
  const parts = value.split('/')
  const reserved = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..' || /[ .]$/.test(part) || part.includes(':') || reserved.test(part))) {
    throw new PortableProjectV3Error('unsafe-path', `Archive entry path contains an unsafe segment: ${value}`)
  }
  return value
}

/** Canonical Windows-style collision key for archive and omission paths. */
export function portableArchivePathKey(value: string): string {
  validatePortableArchivePath(value)
  return value.normalize('NFC').toLocaleLowerCase('en-US')
}

function isOptionalPath(path: string): boolean {
  return PORTABLE_PROJECT_OPTIONAL_ENTRIES.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)
}

function isRequiredPath(path: string): boolean {
  return (PORTABLE_PROJECT_REQUIRED_ENTRIES as readonly string[]).includes(path)
}

function validateManifestShape(value: unknown): asserts value is PortableProjectV3Manifest {
  if (!isRecord(value) || value.schema !== PORTABLE_PROJECT_SCHEMA || value.schemaVersion !== 3) {
    throw new PortableProjectV3Error('manifest', 'Manifest must identify nodeterm-portable-project schema version 3.')
  }
  exactKeys(value, new Set(['schema', 'schemaVersion', 'project', 'entries', 'omissions']), 'manifest')
  if (!isRecord(value.project)) throw new PortableProjectV3Error('manifest', 'Manifest project metadata must be an object.')
  exactKeys(value.project, new Set(['name', 'color']), 'manifest project')
  if (!isRecord(value.project) || typeof value.project.name !== 'string' || value.project.name.trim().length === 0 ||
      utf8Bytes(value.project.name) > 512) {
    throw new PortableProjectV3Error('manifest', 'Manifest project name is missing or exceeds 512 UTF-8 bytes.')
  }
  if (value.project.color !== undefined && (typeof value.project.color !== 'string' || !/^#[0-9a-f]{6,8}$/i.test(value.project.color))) {
    throw new PortableProjectV3Error('manifest', 'Manifest project color is invalid; expected a 6- or 8-digit hexadecimal color.')
  }
  if (!Array.isArray(value.entries) || !Array.isArray(value.omissions)) {
    throw new PortableProjectV3Error('manifest', 'Manifest entries and omissions must be arrays.')
  }
  if (value.omissions.length > PORTABLE_PROJECT_LIMITS.maxOmissionCount) {
    throw new PortableProjectV3Error('manifest', 'Manifest omission count exceeds the portable limit.')
  }
  for (const omission of value.omissions) {
    if (!isRecord(omission) || typeof omission.path !== 'string' ||
        !['unknown-optional', 'machine-local', 'credential', 'unsupported'].includes(String(omission.reason)) ||
        typeof omission.detail !== 'string' || omission.detail.length > 1024) {
      throw new PortableProjectV3Error('manifest', 'Manifest omission metadata is invalid.')
    }
    exactKeys(omission, new Set(['path', 'reason', 'detail']), 'manifest omission')
    validatePortableArchivePath(omission.path)
  }
  const omissionPaths = new Set<string>()
  const omissionFolded = new Set<string>()
  for (const omission of value.omissions) {
    const key = portableArchivePathKey(omission.path)
    if (omissionPaths.has(omission.path)) throw new PortableProjectV3Error('duplicate-entry', `Duplicate omission path: ${omission.path}`)
    if (omissionFolded.has(key)) throw new PortableProjectV3Error('case-collision', `Case-colliding omission path: ${omission.path}`)
    omissionPaths.add(omission.path)
    omissionFolded.add(key)
  }
  if (value.entries.length > PORTABLE_PROJECT_LIMITS.maxEntryCount) {
    throw new PortableProjectV3Error('entry-limit', 'Manifest entry count exceeds the portable archive limit.')
  }
}

/** Validate manifest structure and its explicit required/optional inventory. */
export function validatePortableProjectV3Manifest(value: unknown): PortableProjectV3Manifest {
  validateManifestShape(value)
  const seen = new Set<string>()
  const folded = new Set<string>()
  let rawBytes = 0
  let compressedBytes = 0
  for (const item of value.entries) {
    if (!isRecord(item) || typeof item.path !== 'string' || !SHA256.test(String(item.sha256)) ||
        !Number.isSafeInteger(item.rawBytes) || item.rawBytes < 0 ||
        !Number.isSafeInteger(item.compressedBytes) || item.compressedBytes < 0 || typeof item.required !== 'boolean') {
      throw new PortableProjectV3Error('manifest', 'Manifest entry metadata is invalid.')
    }
    exactKeys(item, new Set(['path', 'sha256', 'rawBytes', 'compressedBytes', 'required']), 'manifest entry')
    validatePortableArchivePath(item.path)
    if (seen.has(item.path)) throw new PortableProjectV3Error('duplicate-entry', `Duplicate manifest entry: ${item.path}`)
    const key = portableArchivePathKey(item.path)
    if (folded.has(key)) throw new PortableProjectV3Error('case-collision', `Case-colliding manifest entry: ${item.path}`)
    seen.add(item.path)
    folded.add(key)
    if (item.rawBytes > PORTABLE_PROJECT_LIMITS.maxEntryBytes) throw new PortableProjectV3Error('raw-limit', `Manifest entry exceeds the per-entry limit: ${item.path}`)
    rawBytes += item.rawBytes
    compressedBytes += item.compressedBytes
    if (rawBytes > PORTABLE_PROJECT_LIMITS.maxRawBytes) throw new PortableProjectV3Error('raw-limit', 'Manifest raw-byte total exceeds the portable archive limit.')
    if (compressedBytes > PORTABLE_PROJECT_LIMITS.maxCompressedBytes) throw new PortableProjectV3Error('compressed-limit', 'Manifest compressed-byte total exceeds the portable archive limit.')
    const known = isRequiredPath(item.path) || isOptionalPath(item.path)
    if (item.required && !known) throw new PortableProjectV3Error('unknown-required', `Unknown required entry: ${item.path}`)
    if (!item.required && !known) throw new PortableProjectV3Error('unknown-optional', `Unknown optional entry must be recorded as an omission: ${item.path}`)
  }
  for (const omission of value.omissions) {
    if (seen.has(omission.path)) throw new PortableProjectV3Error('manifest', `Omission contradicts an included entry: ${omission.path}`)
    const key = portableArchivePathKey(omission.path)
    if (folded.has(key)) throw new PortableProjectV3Error('manifest', `Omission contradicts an included entry: ${omission.path}`)
  }
  for (const required of PORTABLE_PROJECT_REQUIRED_ENTRIES) {
    if (!seen.has(required)) throw new PortableProjectV3Error('required-entry', `Required entry is missing: ${required}`)
  }
  return value
}

/** Validate bytes against the manifest, including deterministic SHA-256 metadata and budgets. */
export async function validatePortableProjectV3Entries(
  manifest: PortableProjectV3Manifest,
  entries: readonly PortableProjectV3Entry[],
  digest: (data: Uint8Array) => Promise<string> = sha256Hex
): Promise<void> {
  validatePortableProjectV3Manifest(manifest)
  if (entries.length > PORTABLE_PROJECT_LIMITS.maxEntryCount) throw new PortableProjectV3Error('entry-limit', 'Archive entry count exceeds the portable archive limit.')
  const byPath = new Map<string, PortableProjectV3Entry>()
  const folded = new Set<string>()
  for (const entry of entries) {
    const path = validatePortableArchivePath(entry.path)
    const key = portableArchivePathKey(path)
    if (byPath.has(path)) throw new PortableProjectV3Error('duplicate-entry', `Duplicate archive entry: ${path}`)
    if (folded.has(key)) throw new PortableProjectV3Error('case-collision', `Case-colliding archive entry: ${path}`)
    byPath.set(path, entry)
    folded.add(key)
  }
  let raw = 0
  let compressed = 0
  for (const item of manifest.entries) {
    const entry = byPath.get(item.path)
    if (!entry) throw new PortableProjectV3Error('required-entry', `Manifest entry is absent from archive: ${item.path}`)
    const actualRaw = entry.data.byteLength
    const actualCompressed = entry.compressedBytes ?? actualRaw
    if (item.rawBytes !== actualRaw || item.compressedBytes !== actualCompressed) {
      throw new PortableProjectV3Error('manifest', `Entry size metadata does not match archive bytes: ${item.path}`)
    }
    raw += actualRaw
    compressed += actualCompressed
    if (actualRaw > PORTABLE_PROJECT_LIMITS.maxEntryBytes) throw new PortableProjectV3Error('raw-limit', `Entry exceeds the per-entry limit: ${item.path}`)
    const actual = await digest(entry.data)
    if (actual !== item.sha256) throw new PortableProjectV3Error('hash', `SHA-256 metadata does not match entry: ${item.path}`)
  }
  const manifestPaths = new Set(manifest.entries.map((item) => item.path))
  for (const path of byPath.keys()) {
    if (!manifestPaths.has(path)) {
      throw new PortableProjectV3Error(
        isOptionalPath(path) ? 'unknown-optional' : 'unknown-required',
        `Archive entry is not listed in the manifest: ${path}`
      )
    }
  }
  if (raw > PORTABLE_PROJECT_LIMITS.maxRawBytes) throw new PortableProjectV3Error('raw-limit', 'Archive raw bytes exceed the portable archive limit.')
  if (compressed > PORTABLE_PROJECT_LIMITS.maxCompressedBytes) throw new PortableProjectV3Error('compressed-limit', 'Archive compressed bytes exceed the portable archive limit.')
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) throw new PortableProjectV3Error('hash', 'SHA-256 is unavailable in this platform context.')
  const hash = await cryptoApi.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Create deterministic entry metadata. Input order is ignored so two writers produce the same
 * manifest for the same set of bytes. Unknown optional entries are represented as omissions. */
export async function createPortableProjectV3Manifest(
  project: { name: string; color?: string },
  entries: readonly PortableProjectV3Entry[],
  omissions: readonly PortableProjectOmission[] = [],
  digest: (data: Uint8Array) => Promise<string> = sha256Hex
): Promise<PortableProjectV3Manifest> {
  if (entries.length > PORTABLE_PROJECT_LIMITS.maxEntryCount) throw new PortableProjectV3Error('entry-limit', 'Archive entry count exceeds the portable archive limit.')
  const paths = entries.map((entry) => entry.path)
  const omissionsFromInventory = validatePortableInventory(paths)
  for (const entry of entries) {
    if (entry.required && !isRequiredPath(entry.path) && !isOptionalPath(entry.path)) {
      throw new PortableProjectV3Error('unknown-required', `Unknown required entry: ${entry.path}`)
    }
  }
  const omitted = new Set(omissionsFromInventory.map((item) => item.path))
  const metadata: PortableProjectEntryMetadata[] = []
  let rawBytes = 0
  let compressedBytes = 0
  for (const entry of [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const path = validatePortableArchivePath(entry.path)
    if (omitted.has(path)) continue
    const raw = entry.data.byteLength
    const compressed = entry.compressedBytes ?? raw
    if (raw > PORTABLE_PROJECT_LIMITS.maxEntryBytes) throw new PortableProjectV3Error('raw-limit', `Entry exceeds the per-entry limit: ${path}`)
    rawBytes += raw
    compressedBytes += compressed
    if (rawBytes > PORTABLE_PROJECT_LIMITS.maxRawBytes) throw new PortableProjectV3Error('raw-limit', 'Archive raw bytes exceed the portable archive limit.')
    if (compressedBytes > PORTABLE_PROJECT_LIMITS.maxCompressedBytes) throw new PortableProjectV3Error('compressed-limit', 'Archive compressed bytes exceed the portable archive limit.')
    metadata.push({
      path,
      sha256: await digest(entry.data),
      rawBytes: raw,
      compressedBytes: compressed,
      required: isRequiredPath(path)
    })
  }
  const manifest: PortableProjectV3Manifest = {
    schema: PORTABLE_PROJECT_SCHEMA,
    schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION,
    project: { name: project.name, ...(project.color ? { color: project.color } : {}) },
    entries: metadata,
    omissions: [...omissionsFromInventory, ...omissions]
  }
  if (manifest.omissions.length > PORTABLE_PROJECT_LIMITS.maxOmissionCount) throw new PortableProjectV3Error('manifest', 'Manifest omission count exceeds the portable limit.')
  validatePortableProjectV3Manifest(manifest)
  return manifest
}

/** Parse a bounded UTF-8 manifest before handing it to the structural validator. */
export function parsePortableProjectV3Manifest(bytes: Uint8Array): PortableProjectV3Manifest {
  if (bytes.byteLength > PORTABLE_PROJECT_LIMITS.maxManifestBytes) {
    throw new PortableProjectV3Error('manifest', 'Manifest exceeds the portable manifest byte limit.')
  }
  let value: unknown
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    rejectDuplicateJsonKeys(source)
    value = JSON.parse(source)
  } catch (error) {
    if (error instanceof PortableProjectV3Error) throw error
    throw new PortableProjectV3Error('manifest', 'Manifest is not valid UTF-8 JSON.')
  }
  return validatePortableProjectV3Manifest(value)
}

/** Migrate legacy project data without carrying credentials or machine-local bindings forward. */
export function migratePortableProject(version: 1 | 2, input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new PortableProjectV3Error('manifest', `Schema ${version} project data must be an object.`)
  const forbidden = /^identity$|^projectid$|credential|password|passkey|secret|token|vault|localexec|capabilityack|breadcrumb|^ssh$|cwd|defaultaccount|session|path|directory|hostname|^host$|machine|platform|environment|^env$|destination/i
  const structuralIdParents = new Set(['nodes', 'canvases', 'relationships', 'bridges', 'ropes', 'browserTabs'])
  const unsafe = new Set(['__proto__', 'prototype', 'constructor'])
  let nodes = 0
  const copy = (value: unknown, depth: number, parents: string[]): unknown => {
    if (++nodes > PORTABLE_PROJECT_LIMITS.maxMigrationNodes) throw new PortableProjectV3Error('manifest', 'Legacy project data exceeds the migration node limit.')
    if (depth > PORTABLE_PROJECT_LIMITS.maxMigrationDepth) throw new PortableProjectV3Error('manifest', 'Legacy project data exceeds the migration depth limit.')
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    if (Array.isArray(value)) return value.map((item) => copy(item, depth + 1, parents))
    if (!isRecord(value)) throw new PortableProjectV3Error('manifest', 'Legacy project data contains an unsafe value.')
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (unsafe.has(key.toLowerCase())) throw new PortableProjectV3Error('manifest', `Legacy project data contains an unsafe key: ${key}`)
      const lower = key.toLowerCase()
      if (lower === 'id' && !structuralIdParents.has(parents[parents.length - 1] ?? '')) continue
      if (forbidden.test(lower)) continue
      out[key] = copy(child, depth + 1, [...parents, lower])
    }
    return out
  }
  return copy(input, 0, []) as Record<string, unknown>
}

/** Build omission records for unsupported optional entries. Unknown required entries throw. */
export function validatePortableInventory(paths: readonly string[], requiredPaths: readonly string[] = PORTABLE_PROJECT_REQUIRED_ENTRIES): PortableProjectOmission[] {
  const omissions: PortableProjectOmission[] = []
  for (const raw of paths) {
    const path = validatePortableArchivePath(raw)
    if (requiredPaths.includes(path)) continue
    if (!isOptionalPath(path)) omissions.push({ path, reason: 'unknown-optional', detail: 'Optional entry is not understood by this reader and was omitted.' })
  }
  for (const required of requiredPaths) if (!paths.includes(required)) throw new PortableProjectV3Error('required-entry', `Required entry is missing: ${required}`)
  if (omissions.length > PORTABLE_PROJECT_LIMITS.maxOmissionCount) throw new PortableProjectV3Error('manifest', 'Manifest omission count exceeds the portable limit.')
  return omissions
}

/** Validate the outer archive framing separately from the hashed payload inventory. */
export function validatePortableArchiveInventory(paths: readonly string[]): PortableProjectOmission[] {
  const seen = new Set<string>()
  const folded = new Set<string>()
  for (const raw of paths) {
    const path = validatePortableArchivePath(raw)
    const key = portableArchivePathKey(path)
    if (seen.has(path)) throw new PortableProjectV3Error('duplicate-entry', `Duplicate archive entry: ${path}`)
    if (folded.has(key)) throw new PortableProjectV3Error('case-collision', `Case-colliding archive entry: ${path}`)
    seen.add(path)
    folded.add(key)
  }
  const omissions = validatePortableInventory(paths.filter((path) => path !== 'manifest.json'))
  if (!paths.includes('manifest.json')) {
    throw new PortableProjectV3Error('required-entry', 'Required archive framing entry is missing: manifest.json')
  }
  return omissions
}
