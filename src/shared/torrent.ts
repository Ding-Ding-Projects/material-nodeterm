/**
 * Torrent Downloader contract. The canvas node stores only display intent; task records and
 * source/destination paths belong to the machine-local downloader service.
 */

export type TorrentSourceKind = 'magnet' | 'torrent-file'
export type TorrentTaskStatus =
  | 'queued'
  | 'metadata'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type TorrentSeedPolicy =
  | { kind: 'never' }
  | { kind: 'ratio'; ratio: number }
  | { kind: 'minutes'; minutes: number }

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
  name: string
  destination: string | null
  files: TorrentFileInfo[]
  status: TorrentTaskStatus
  progress: number
  downloadedBytes: number
  totalBytes: number
  speedBytesPerSecond: number
  peers: number
  etaSeconds: number | null
  error: string | null
  seedPolicy: TorrentSeedPolicy
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
}

export interface TorrentApi {
  runtime(): Promise<{ available: boolean; origin: 'bundled' | 'auto-installed' | 'unavailable'; detail: string | null }>
  list(nodeId?: string): Promise<TorrentTaskState[]>
  inspect(input: { sourceKind: TorrentSourceKind; sourceRef: string }): Promise<TorrentTaskState>
  add(input: TorrentAddInput): Promise<TorrentTaskState>
  chooseFiles(taskId: string, selectedPaths: string[]): Promise<TorrentTaskState | null>
  setDestination(taskId: string, destination: string): Promise<TorrentTaskState | null>
  preflight(taskId: string): Promise<TorrentDestinationPreflight>
  start(taskId: string): Promise<TorrentTaskState | null>
  pause(taskId: string): Promise<TorrentTaskState | null>
  resume(taskId: string): Promise<TorrentTaskState | null>
  cancel(taskId: string): Promise<TorrentTaskState | null>
  retry(taskId: string): Promise<TorrentTaskState | null>
  remove(taskId: string): Promise<void>
  setSeedPolicy(taskId: string, policy: TorrentSeedPolicy): Promise<TorrentTaskState | null>
  reconcile(): Promise<TorrentTaskState[]>
  onTask(listener: (task: TorrentTaskState) => void): () => void
}

export const TORRENT_DEFAULT_SEED_POLICY: TorrentSeedPolicy = { kind: 'never' }
export const TORRENT_MAX_SEED_MINUTES = 24 * 60
export const TORRENT_MAX_SEED_RATIO = 10
export const TORRENT_MAX_SOURCE_BYTES = 32 * 1024 * 1024
export const TORRENT_MAX_FILES = 10_000

/** Entry consumed by the unified Node Catalog when that coordinator is present. Keeping the
 * capability facts beside the API prevents a menu row from promising a surface this lane does not
 * actually provide. */
export const TORRENT_NODE_CATALOG_ENTRY = {
  kind: 'torrent' as const,
  label: 'Torrent downloader',
  category: 'media' as const,
  description: 'Local WebTorrent downloads with safe destinations, progress, recovery, and bounded seeding.',
  createCommand: 'new-torrent',
  machineLocalState: true
}

export function normalizeSeedPolicy(value: unknown): TorrentSeedPolicy {
  if (typeof value !== 'object' || value === null) return TORRENT_DEFAULT_SEED_POLICY
  const raw = value as Record<string, unknown>
  if (raw.kind === 'ratio' && typeof raw.ratio === 'number' && Number.isFinite(raw.ratio)) {
    return { kind: 'ratio', ratio: Math.min(TORRENT_MAX_SEED_RATIO, Math.max(0, raw.ratio)) }
  }
  if (raw.kind === 'minutes' && typeof raw.minutes === 'number' && Number.isFinite(raw.minutes)) {
    return { kind: 'minutes', minutes: Math.min(TORRENT_MAX_SEED_MINUTES, Math.max(0, Math.round(raw.minutes))) }
  }
  return TORRENT_DEFAULT_SEED_POLICY
}

export function isMagnetUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 16_384 && /^magnet:\?xt=urn:btih:[a-z0-9]{32,40}(?:&|$)/i.test(value.trim())
}

/** Keep torrent entry paths inside the chosen destination, even when metadata is hostile. */
export function safeTorrentRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) return false
  if (value.includes('\0')) return false
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '')
  const parts = normalized.split('/')
  return parts.length > 0 && parts.every((part) => part !== '' && part !== '.' && part !== '..')
}
