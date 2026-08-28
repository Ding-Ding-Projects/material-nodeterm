/** Host-local VeraCrypt file-container management contract.
 *
 * This surface deliberately contains no password, PIM, keyfile, or hidden-volume credential
 * fields. VeraCrypt owns that prompt. Only an existing regular file container may be selected.
 */

export type VeraCryptAvailabilityState = 'available' | 'not-installed' | 'unsupported' | 'error'

export interface VeraCryptAvailability {
  platform: NodeJS.Platform
  state: VeraCryptAvailabilityState
  executablePath: string | null
  version: string | null
  reason: string | null
  checkedAt: number
}

export interface VeraCryptFavorite {
  id: string
  containerPath: string
  preferredDriveLetter: string | null
  readOnly: boolean
  removable: boolean
  preserveTimestamp: boolean
  exploreAfterMount: boolean
}

export interface VeraCryptMountOptions {
  containerPath: string
  driveLetter: string
  readOnly?: boolean
  removable?: boolean
  preserveTimestamp?: boolean
  exploreAfterMount?: boolean
}

export interface VeraCryptMountPreflight {
  ok: boolean
  containerPath: string
  driveLetter: string
  availableDriveLetters: string[]
  reason: string | null
}

export interface VeraCryptMountedVolume {
  driveLetter: string
  containerPath: string | null
  observedAt: number
  managerCreated: boolean
}

export interface VeraCryptMountInventory {
  state: 'verified' | 'unavailable' | 'unsupported'
  volumes: VeraCryptMountedVolume[]
  reason: string | null
  checkedAt: number
}

export type VeraCryptOperationKind = 'mount' | 'unmount' | 'explore' | 'wipe-cache' | 'refresh'
export type VeraCryptOperationState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface VeraCryptOperation {
  id: string
  kind: VeraCryptOperationKind
  state: VeraCryptOperationState
  progress: number | null
  driveLetter: string | null
  message: string
  startedAt: number
  finishedAt: number | null
}

export interface VeraCryptApi {
  availability(): Promise<VeraCryptAvailability>
  favorites(): Promise<VeraCryptFavorite[]>
  saveFavorite(favorite: VeraCryptFavorite): Promise<VeraCryptFavorite[]>
  removeFavorite(id: string): Promise<VeraCryptFavorite[]>
  preflight(options: VeraCryptMountOptions): Promise<VeraCryptMountPreflight>
  mount(options: VeraCryptMountOptions): Promise<VeraCryptOperation>
  refresh(): Promise<VeraCryptMountInventory>
  explore(driveLetter: string): Promise<VeraCryptOperation>
  unmount(driveLetter: string, force?: boolean): Promise<VeraCryptOperation>
  wipeCache(): Promise<VeraCryptOperation>
  cancel(operationId: string): Promise<boolean>
  onOperation(listener: (operation: VeraCryptOperation) => void): () => void
}

export const VERACRYPT_DEFAULTS = {
  maxPathLength: 4096,
  maxFavorites: 100,
  maxOperations: 100,
  operationTimeoutMs: 120_000,
  executableName: 'VeraCrypt.exe'
} as const

export function normalizeDriveLetter(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase().replace(/:$/u, '')
  return /^[A-Z]$/u.test(normalized) ? normalized : null
}

export function isSafeContainerPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= VERACRYPT_DEFAULTS.maxPathLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
}

export function favoriteFrom(value: unknown): VeraCryptFavorite | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' && raw.id.length <= 128 ? raw.id : null
  const containerPath = isSafeContainerPath(raw.containerPath) ? raw.containerPath : null
  if (!id || !containerPath) return null
  const preferredDriveLetter = raw.preferredDriveLetter === null || raw.preferredDriveLetter === undefined
    ? null
    : normalizeDriveLetter(raw.preferredDriveLetter)
  if (raw.preferredDriveLetter !== null && raw.preferredDriveLetter !== undefined && !preferredDriveLetter) return null
  return {
    id,
    containerPath,
    preferredDriveLetter,
    readOnly: raw.readOnly === true,
    removable: raw.removable === true,
    preserveTimestamp: raw.preserveTimestamp === true,
    exploreAfterMount: raw.exploreAfterMount === true
  }
}

export function mountOptionsFrom(value: unknown): VeraCryptMountOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const containerPath = isSafeContainerPath(raw.containerPath) ? raw.containerPath : null
  const driveLetter = normalizeDriveLetter(raw.driveLetter)
  if (!containerPath || !driveLetter) return null
  return {
    containerPath,
    driveLetter,
    readOnly: raw.readOnly === true,
    removable: raw.removable === true,
    preserveTimestamp: raw.preserveTimestamp === true,
    exploreAfterMount: raw.exploreAfterMount === true
  }
}
