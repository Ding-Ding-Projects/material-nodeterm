/** Shared, machine-local torrent downloader contract. Network handles and absolute paths never
 * cross the canvas document or the renderer bridge. */

export type TorrentSourceKind = 'magnet' | 'torrent-file'
export type TorrentTaskStatus = 'queued' | 'metadata' | 'downloading' | 'paused' | 'recoverable-paused' | 'completed' | 'seeding' | 'stopped' | 'cancelled' | 'failed'
export type TorrentIntegrityState = 'unknown' | 'checking' | 'verified' | 'failed'
export type TorrentPersistenceStatus = 'missing' | 'loaded' | 'corrupt' | 'unreadable'
export type TorrentSeedPolicy = { kind: 'never' } | { kind: 'ratio'; ratio: number } | { kind: 'minutes'; minutes: number } | { kind: 'indefinite' }

export interface TorrentNetworkConsent {
  accepted: true
  acceptedAt: number
  activationId: string
  disclosed: 'trackers-dht-peers-ip-seeding-destination'
}

export interface TorrentFileInfo {
  path: string
  name: string
  sizeBytes: number
  selected: boolean
  downloadedBytes: number
}

export interface TorrentTaskState {
  id: string
  nodeId: string
  sourceKind: TorrentSourceKind
  sourceRef: string
  networkConsent?: TorrentNetworkConsent
  name: string
  destination: string | null
  files: TorrentFileInfo[]
  status: TorrentTaskStatus
  integrity: TorrentIntegrityState
  progress: number
  downloadedBytes: number
  selectedBytes: number
  totalBytes: number
  speedBytesPerSecond: number
  peers: number
  etaSeconds: number | null
  error: string | null
  seedPolicy: TorrentSeedPolicy
  seedingRemainingSeconds: number | null
  uploadedBytes: number
  ratio: number
  createdAt: number
  updatedAt: number
}

export interface TorrentDestinationPreflight {
  path: string
  exists: boolean
  writable: boolean
  freeBytes: number | null
  requiredBytes: number
  overheadBytes: number
  quotaBytes: number
  reservedBytes: number
  ok: boolean
  reason: string | null
}

export interface TorrentAddInput {
  nodeId: string
  sourceKind: TorrentSourceKind
  sourceRef: string
  destination: string
  selectedPaths?: string[]
  seedPolicy?: TorrentSeedPolicy
  networkConsent?: TorrentNetworkConsent
}

export interface TorrentApi {
  runtime(): Promise<{ available: boolean; origin: 'bundled' | 'unavailable'; detail: string | null }>
  persistence(): Promise<{ status: TorrentPersistenceStatus; detail: string | null }>
  list(nodeId?: string): Promise<TorrentTaskState[]>
  inspect(input: { sourceKind: TorrentSourceKind; sourceRef: string }): Promise<TorrentTaskState>
  add(input: TorrentAddInput): Promise<TorrentTaskState>
  chooseFiles(taskId: string, selectedPaths: string[]): Promise<TorrentTaskState | null>
  setDestination(taskId: string, destination: string): Promise<TorrentTaskState | null>
  preflight(taskId: string): Promise<TorrentDestinationPreflight>
  start(taskId: string, consent?: TorrentNetworkConsent): Promise<TorrentTaskState | null>
  pause(taskId: string): Promise<TorrentTaskState | null>
  resume(taskId: string, consent?: TorrentNetworkConsent): Promise<TorrentTaskState | null>
  cancel(taskId: string): Promise<TorrentTaskState | null>
  retry(taskId: string, consent?: TorrentNetworkConsent): Promise<TorrentTaskState | null>
  remove(taskId: string): Promise<void>
  setSeedPolicy(taskId: string, policy: TorrentSeedPolicy): Promise<TorrentTaskState | null>
  reconcile(): Promise<TorrentTaskState[]>
  onTask(listener: (task: TorrentTaskState) => void): () => void
}

export const TORRENT_DEFAULT_SEED_POLICY: TorrentSeedPolicy = { kind: 'never' }
export const TORRENT_MAX_SEED_MINUTES = 24 * 60
export const TORRENT_MAX_SEED_RATIO = 10
export const TORRENT_MAX_SOURCE_BYTES = 32 * 1024 * 1024
export const TORRENT_MAX_METADATA_BYTES = 32 * 1024 * 1024
export const TORRENT_MAX_FILES = 10_000
export const TORRENT_MAX_PATH_BYTES = 4096
export const TORRENT_PIECE_OVERHEAD_BYTES = 16 * 1024 * 1024
export const TORRENT_MAX_TASKS = 64
export const TORRENT_MAX_ACTIVE_HANDLES = 8
export const TORRENT_DESTROY_TIMEOUT_MS = 5_000
export const TORRENT_MAX_BENCODE_NODES = 100_000
export const TORRENT_MAX_DECODED_BYTES = 8 * 1024 * 1024

export const TORRENT_NODE_CATALOG_ENTRY = {
  kind: 'torrent' as const,
  label: 'Torrent downloader',
  category: 'media' as const,
  description: 'Local WebTorrent downloads with safe destinations, progress, recovery, and bounded seeding.',
  createCommand: 'new-torrent',
  machineLocalState: true
}

export const WEBTORRENT_RUNTIME_DESCRIPTOR = {
  id: 'webtorrent-runtime',
  origin: 'https://registry.npmjs.org/webtorrent/-/webtorrent-2.8.1.tgz',
  version: '2.8.1',
  sha256: '6448305d885a2c001fcf8e6f4f772268e7cda10043b78cb18805643cebed8815',
  integrity: 'sha512-qmuVOR5INopa1YnGmxfB5jAZiMOX3tZbnJ84A1IUJ8wR6iBkVFHN2Ugy4NEZjrFly0wKxvuIJgmhUlLmnLSqgg==',
  license: 'MIT',
  packagedPath: 'node_modules/webtorrent',
  requiredFiles: ['package.json', 'index.js'],
  requiredDependencies: ['bittorrent-dht', 'bittorrent-protocol', 'parse-torrent', 'torrent-discovery'],
  installMode: 'bundled' as const
} as const

/** Remove transport-bearing source material at the renderer boundary while retaining the task's
 * progress and file-selection facts. */
export function redactTorrentTask(task: TorrentTaskState): TorrentTaskState {
  return {
    ...task,
    sourceRef: task.sourceKind === 'magnet' ? 'magnet link (redacted)' : 'local torrent file'
  }
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function decodeMagnetPart(value: string): string {
  return decodeURIComponent(value.replaceAll('+', ' '))
}

export interface ParsedMagnet {
  infoHashes: { version: 1 | 2; encoding: 'hex' | 'base32'; value: string }[]
  displayName: string | null
  trackers: string[]
}

export function parseMagnetUri(value: unknown): ParsedMagnet {
  if (!boundedString(value, 16_384) || !/^magnet:\?/i.test(value.trim())) throw new Error('Magnet URI is missing or exceeds the 16 KiB limit.')
  const trimmed = value.trim()
  const raw = trimmed.slice(trimmed.indexOf('?') + 1)
  if (raw.length > 16_000) throw new Error('Magnet query exceeds the safety limit.')
  const hashes = new Map<string, ParsedMagnet['infoHashes'][number]>()
  let displayName: string | null = null
  const trackers: string[] = []
  let count = 0
  for (const pair of raw.split('&')) {
    if (!pair) continue
    if (++count > 128) throw new Error('Magnet URI has too many parameters.')
    const equals = pair.indexOf('=')
    const key = decodeMagnetPart(equals < 0 ? pair : pair.slice(0, equals)).toLowerCase()
    const part = decodeMagnetPart(equals < 0 ? '' : pair.slice(equals + 1))
    if (key === 'dn' && displayName === null) displayName = part.slice(0, 1024)
    if (key === 'tr' && part.length <= 2048) trackers.push(part)
    if (key !== 'xt') continue
    const match = /^urn:(btih|btmh):([a-z0-9]+)$/i.exec(part)
    if (!match) throw new Error('Magnet URI contains an invalid xt identifier.')
    const kind = match[1].toLowerCase()
    const hash = match[2].toLowerCase()
    const isV1Hex = kind === 'btih' && /^[0-9a-f]{40}$/.test(hash)
    const isV1Base32 = kind === 'btih' && /^[a-z2-7]{32}$/.test(hash)
    const isV2 = kind === 'btmh' && /^1220[0-9a-f]{64}$/.test(hash)
    if (!isV1Hex && !isV1Base32 && !isV2) throw new Error('Magnet URI contains an invalid btih or btmh identifier.')
    const parsed = { version: isV2 ? 2 as const : 1 as const, encoding: isV1Base32 ? 'base32' as const : 'hex' as const, value: hash }
    if ([...hashes.values()].some((existing) => existing.version === parsed.version && existing.value !== parsed.value)) throw new Error('Magnet URI contains conflicting identifiers.')
    hashes.set(parsed.version + ':' + parsed.value, parsed)
  }
  if (hashes.size === 0) throw new Error('Magnet URI must contain a btih or btmh identifier.')
  return { infoHashes: [...hashes.values()], displayName, trackers: [...new Set(trackers)] }
}

export function isMagnetUri(value: unknown): value is string {
  try { parseMagnetUri(value); return true } catch { return false }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|clock[$]|com[0-9]|lpt[0-9])(?:[.].*)?$/i

export function safeTorrentRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > TORRENT_MAX_PATH_BYTES) return false
  if (/[/\\\\]/.test(value[0] ?? '') || /^[a-z]:/i.test(value) || /^[/\\\\]{2}/.test(value)) return false
  if ([...value].some((char) => char < ' ' || char === '\u007f')) return false
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (parts.length === 0 || parts.some((part) => !part || part === '.' || part.length > 255)) return false
  return parts.every((part) => !part.endsWith(' ') && !part.endsWith('.') && !part.includes(':') && !WINDOWS_RESERVED.test(part))
}

type BencodeValue = number | Uint8Array | BencodeValue[] | { [key: string]: BencodeValue }

class BencodeReader {
  private index = 0
  private nodes = 0
  private decodedBytes = 0
  constructor(private readonly bytes: Uint8Array) {}
  read(depth = 0): BencodeValue {
    if (++this.nodes > TORRENT_MAX_BENCODE_NODES) throw new Error('Torrent metadata contains too many bencode nodes.')
    if (depth > 32 || this.index >= this.bytes.length) throw new Error('Torrent metadata nesting or length limit exceeded.')
    const marker = this.bytes[this.index]
    if (marker === 0x69) return this.readInteger()
    if (marker === 0x6c) return this.readList(depth)
    if (marker === 0x64) return this.readDictionary(depth)
    if (marker !== undefined && marker >= 0x30 && marker <= 0x39) return this.readBytes()
    throw new Error('Torrent metadata contains an invalid bencode value.')
  }
  position(): number { return this.index }
  private readInteger(): number {
    this.index++
    const end = this.bytes.indexOf(0x65, this.index)
    if (end < 0 || end - this.index > 32) throw new Error('Torrent metadata contains an invalid integer.')
    const text = new TextDecoder().decode(this.bytes.slice(this.index, end))
    if (!/^(0|-?[1-9][0-9]*)$/.test(text)) throw new Error('Torrent metadata contains an invalid integer.')
    const value = Number(text)
    if (!Number.isSafeInteger(value)) throw new Error('Torrent metadata integer exceeds the safe range.')
    this.index = end + 1
    return value
  }
  private readBytes(): Uint8Array {
    const colon = this.bytes.indexOf(0x3a, this.index)
    if (colon < 0 || colon - this.index > 16) throw new Error('Torrent metadata contains an invalid byte string length.')
    const text = new TextDecoder().decode(this.bytes.slice(this.index, colon))
    if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('Torrent metadata contains an invalid byte string length.')
    const length = Number(text)
    if (!Number.isSafeInteger(length) || length > TORRENT_MAX_METADATA_BYTES || colon + 1 + length > this.bytes.length) throw new Error('Torrent metadata byte string exceeds the safety limit.')
    this.index = colon + 1
    const result = this.bytes.slice(this.index, this.index + length)
    this.index += length
    this.decodedBytes += length
    if (this.decodedBytes > TORRENT_MAX_DECODED_BYTES) throw new Error('Torrent metadata decodes beyond the safety limit.')
    return result
  }
  private readList(depth: number): BencodeValue[] {
    this.index++
    const values: BencodeValue[] = []
    while (this.bytes[this.index] !== 0x65) {
      if (values.length >= TORRENT_MAX_FILES * 2) throw new Error('Torrent metadata list is too large.')
      values.push(this.read(depth + 1))
    }
    this.index++
    return values
  }
  private readDictionary(depth: number): { [key: string]: BencodeValue } {
    this.index++
    const result: { [key: string]: BencodeValue } = {}
    let previous = ''
    while (this.bytes[this.index] !== 0x65) {
      const key = this.readBytes()
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(key)
      if ([...decoded].some((char) => char < ' ' || char === '\u007f') || decoded === '__proto__' || decoded === 'constructor' || decoded === 'prototype') throw new Error('Torrent metadata contains an unsafe dictionary key.')
      if (decoded <= previous || Object.prototype.hasOwnProperty.call(result, decoded)) throw new Error('Torrent metadata dictionary keys are not strictly ordered.')
      previous = decoded
      result[decoded] = this.read(depth + 1)
    }
    this.index++
    return result
  }
}

function bytesToText(value: BencodeValue | undefined, max = 4096): string | null {
  if (!(value instanceof Uint8Array) || value.length > max) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value) } catch { return null }
}

export interface TorrentMetadataSummary {
  name: string
  files: Array<{ path: string; sizeBytes: number }>
  totalBytes: number
  pieceLength: number | null
}

export function validateTorrentBencode(input: Uint8Array): TorrentMetadataSummary {
  if (!(input instanceof Uint8Array) || input.length === 0 || input.length > TORRENT_MAX_SOURCE_BYTES) throw new Error('Torrent metadata is missing or exceeds the source limit.')
  const reader = new BencodeReader(input)
  const root = reader.read()
  if (reader.position() !== input.length || typeof root !== 'object' || root === null || Array.isArray(root) || root instanceof Uint8Array) throw new Error('Torrent metadata has trailing bytes or no dictionary root.')
  const info = root.info
  if (typeof info !== 'object' || info === null || Array.isArray(info) || info instanceof Uint8Array) throw new Error('Torrent metadata has no info dictionary.')
  const name = bytesToText(info.name, 255)
  if (!name || !safeTorrentRelativePath(name)) throw new Error('Torrent metadata has an unsafe name.')
  const files: Array<{ path: string; sizeBytes: number }> = []
  if (Array.isArray(info.files)) {
    if (info.files.length > TORRENT_MAX_FILES) throw new Error('Torrent metadata contains too many files.')
    for (const item of info.files) {
      if (typeof item !== 'object' || item === null || Array.isArray(item) || item instanceof Uint8Array) throw new Error('Torrent metadata contains an invalid file entry.')
      const pathValues = item.path
      if (!Array.isArray(pathValues) || pathValues.length === 0 || pathValues.length > 64) throw new Error('Torrent metadata contains an invalid file path.')
      const parts = pathValues.map((part) => bytesToText(part, 255))
      if (parts.some((part) => !part || !safeTorrentRelativePath(part))) throw new Error('Torrent metadata contains an unsafe file path.')
      const relative = name + '/' + parts.join('/')
      if (!safeTorrentRelativePath(relative)) throw new Error('Torrent metadata contains an unsafe combined file path.')
      const size = item.length
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error('Torrent metadata contains an invalid file size.')
      files.push({ path: relative, sizeBytes: size })
    }
  } else {
    const size = info.length
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error('Torrent metadata contains an invalid file size.')
    files.push({ path: name, sizeBytes: size })
  }
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0)
  if (!Number.isSafeInteger(totalBytes)) throw new Error('Torrent payload size exceeds the safe range.')
  const pieceLength = typeof info['piece length'] === 'number' && Number.isSafeInteger(info['piece length']) && info['piece length'] > 0 ? info['piece length'] : null
  const metaVersion = info['meta version']
  if (metaVersion === 2) throw new Error('BitTorrent v2 file-tree metadata is not supported by this bounded validator.')
  if (!pieceLength || !(info.pieces instanceof Uint8Array)) throw new Error('Torrent metadata is missing a valid piece length or piece hashes.')
  const expectedPieces = Math.ceil(totalBytes / pieceLength)
  if (info.pieces.length !== expectedPieces * 20) throw new Error('Torrent metadata piece-hash length does not match the payload length.')
  return { name, files, totalBytes, pieceLength }
}

export function normalizeSeedPolicy(value: unknown): TorrentSeedPolicy {
  if (typeof value !== 'object' || value === null) return TORRENT_DEFAULT_SEED_POLICY
  const raw = value as Record<string, unknown>
  if (raw.kind === 'ratio' && typeof raw.ratio === 'number' && Number.isFinite(raw.ratio)) return { kind: 'ratio', ratio: Math.min(TORRENT_MAX_SEED_RATIO, Math.max(0, raw.ratio)) }
  if (raw.kind === 'minutes' && typeof raw.minutes === 'number' && Number.isFinite(raw.minutes)) return { kind: 'minutes', minutes: Math.min(TORRENT_MAX_SEED_MINUTES, Math.max(0, Math.round(raw.minutes))) }
  if (raw.kind === 'indefinite') return { kind: 'indefinite' }
  return TORRENT_DEFAULT_SEED_POLICY
}

import { buildDocumentExport, buildTableExport, type BuiltExport, type ExportFormat } from './export'

/** Faithful structured export surface. Transport-bearing fields are omitted explicitly and the
 * omission is recorded in every format instead of silently leaking paths, URIs, trackers, peers,
 * or engine handles. */
export function buildTorrentExport(tasks: readonly TorrentTaskState[], format: ExportFormat): BuiltExport {
  const omitted = 'Omitted for privacy: source URI, trackers, destination paths, peer addresses, and engine handles.'
  const rows = tasks.map((task) => ({
    taskId: task.id, name: task.name, status: task.status, integrity: task.integrity, progress: task.progress,
    downloadedBytes: task.downloadedBytes, selectedBytes: task.selectedBytes, totalBytes: task.totalBytes,
    speedBytesPerSecond: task.speedBytesPerSecond, etaSeconds: task.etaSeconds,
    seedPolicy: JSON.stringify(task.seedPolicy),
    files: JSON.stringify(task.files.map(({ name, sizeBytes, selected, downloadedBytes }) => ({ name, sizeBytes, selected, downloadedBytes }))),
    omissions: omitted
  }))
  if (format === 'toml') return buildDocumentExport({ name: 'torrent-tasks', data: { version: 1, omissions: omitted, tasks: rows } }, format)
  return buildTableExport({
    name: 'torrent-tasks',
    columns: [
      { key: 'taskId', label: 'Task ID' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' },
      { key: 'integrity', label: 'Integrity' }, { key: 'progress', label: 'Progress' },
      { key: 'downloadedBytes', label: 'Downloaded bytes' }, { key: 'selectedBytes', label: 'Selected bytes' },
      { key: 'totalBytes', label: 'Total bytes' }, { key: 'speedBytesPerSecond', label: 'Speed bytes per second' },
      { key: 'etaSeconds', label: 'ETA seconds' }, { key: 'seedPolicy', label: 'Seeding policy' },
      { key: 'files', label: 'Files (names and sizes only)' }, { key: 'omissions', label: 'Privacy omissions' }
    ],
    rows
  }, format)
}
