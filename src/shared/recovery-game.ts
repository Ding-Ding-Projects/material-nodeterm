export const RECOVERY_BOARD_WIDTH = 9
export const RECOVERY_BOARD_HEIGHT = 7

export const RECOVERY_ENERGY_KEYS = ['northwest', 'northeast', 'southeast'] as const
export type RecoveryEnergyKey = (typeof RECOVERY_ENERGY_KEYS)[number]

export interface RecoveryPoint {
  x: number
  y: number
}

export interface RecoveryGameSnapshot {
  player: RecoveryPoint
  energizedKeys: RecoveryEnergyKey[]
  coreActivated: boolean
  hazardHits: number
}

export type RecoveryMove = 'up' | 'down' | 'left' | 'right'
export type RecoveryCellKind = 'floor' | 'start' | 'energy-key' | 'hazard' | 'core'

export interface RecoveryTransition {
  snapshot: RecoveryGameSnapshot
  event: 'moved' | 'blocked' | 'key-energized' | 'hazard-hit' | 'core-ready' | 'core-activated'
  energyKey?: RecoveryEnergyKey
}

export const RECOVERY_START: RecoveryPoint = { x: 1, y: 5 }
export const RECOVERY_CORE: RecoveryPoint = { x: 4, y: 3 }

export const RECOVERY_KEY_POSITIONS: Readonly<Record<RecoveryEnergyKey, RecoveryPoint>> = {
  northwest: { x: 1, y: 1 },
  northeast: { x: 7, y: 1 },
  southeast: { x: 7, y: 5 }
}

export const RECOVERY_HAZARDS: readonly RecoveryPoint[] = [
  { x: 3, y: 1 },
  { x: 5, y: 1 },
  { x: 2, y: 3 },
  { x: 6, y: 3 },
  { x: 3, y: 5 },
  { x: 5, y: 5 }
]

function samePoint(a: RecoveryPoint, b: RecoveryPoint): boolean {
  return a.x === b.x && a.y === b.y
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function createRecoveryGameSnapshot(): RecoveryGameSnapshot {
  return {
    player: { ...RECOVERY_START },
    energizedKeys: [],
    coreActivated: false,
    hazardHits: 0
  }
}

export function normalizeRecoveryGameSnapshot(value: unknown): RecoveryGameSnapshot {
  if (!value || typeof value !== 'object') return createRecoveryGameSnapshot()
  const candidate = value as Partial<RecoveryGameSnapshot>
  const player = candidate.player && typeof candidate.player === 'object'
    ? candidate.player as Partial<RecoveryPoint>
    : {}
  const energizedKeys = Array.isArray(candidate.energizedKeys)
    ? RECOVERY_ENERGY_KEYS.filter((key) => candidate.energizedKeys?.includes(key))
    : []
  const coreActivated = candidate.coreActivated === true && energizedKeys.length === RECOVERY_ENERGY_KEYS.length
  return {
    player: {
      x: boundedInteger(player.x, 0, RECOVERY_BOARD_WIDTH - 1, RECOVERY_START.x),
      y: boundedInteger(player.y, 0, RECOVERY_BOARD_HEIGHT - 1, RECOVERY_START.y)
    },
    energizedKeys,
    coreActivated,
    hazardHits: boundedInteger(candidate.hazardHits, 0, 999_999, 0)
  }
}

export function recoveryCellKind(point: RecoveryPoint): RecoveryCellKind {
  if (samePoint(point, RECOVERY_CORE)) return 'core'
  if (samePoint(point, RECOVERY_START)) return 'start'
  if (RECOVERY_HAZARDS.some((hazard) => samePoint(point, hazard))) return 'hazard'
  if (RECOVERY_ENERGY_KEYS.some((key) => samePoint(point, RECOVERY_KEY_POSITIONS[key]))) return 'energy-key'
  return 'floor'
}

export function recoveryKeyAt(point: RecoveryPoint): RecoveryEnergyKey | undefined {
  return RECOVERY_ENERGY_KEYS.find((key) => samePoint(point, RECOVERY_KEY_POSITIONS[key]))
}

export function canRecoveryStep(from: RecoveryPoint, to: RecoveryPoint): boolean {
  if (to.x < 0 || to.x >= RECOVERY_BOARD_WIDTH || to.y < 0 || to.y >= RECOVERY_BOARD_HEIGHT) return false
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1
}

export function moveRecoveryGame(
  input: RecoveryGameSnapshot,
  move: RecoveryMove
): RecoveryTransition {
  const snapshot = normalizeRecoveryGameSnapshot(input)
  if (snapshot.coreActivated) return { snapshot, event: 'blocked' }
  const delta: Record<RecoveryMove, RecoveryPoint> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  }
  const next = { x: snapshot.player.x + delta[move].x, y: snapshot.player.y + delta[move].y }
  if (!canRecoveryStep(snapshot.player, next)) return { snapshot, event: 'blocked' }
  if (RECOVERY_HAZARDS.some((hazard) => samePoint(next, hazard))) {
    return {
      snapshot: { ...snapshot, player: { ...RECOVERY_START }, hazardHits: snapshot.hazardHits + 1 },
      event: 'hazard-hit'
    }
  }
  const key = recoveryKeyAt(next)
  const energizedKeys = key && !snapshot.energizedKeys.includes(key)
    ? [...snapshot.energizedKeys, key]
    : snapshot.energizedKeys
  const moved = { ...snapshot, player: next, energizedKeys }
  if (key && energizedKeys.length !== snapshot.energizedKeys.length) {
    return { snapshot: moved, event: 'key-energized', energyKey: key }
  }
  if (samePoint(next, RECOVERY_CORE) && energizedKeys.length === RECOVERY_ENERGY_KEYS.length) {
    return { snapshot: moved, event: 'core-ready' }
  }
  return { snapshot: moved, event: 'moved' }
}

export function activateRecoveryCore(input: RecoveryGameSnapshot): RecoveryTransition {
  const snapshot = normalizeRecoveryGameSnapshot(input)
  const ready = samePoint(snapshot.player, RECOVERY_CORE) && snapshot.energizedKeys.length === RECOVERY_ENERGY_KEYS.length
  if (!ready || snapshot.coreActivated) return { snapshot, event: 'blocked' }
  return { snapshot: { ...snapshot, coreActivated: true }, event: 'core-activated' }
}

export function recoveryCoreDisabledReason(snapshot: RecoveryGameSnapshot): string | null {
  const normalized = normalizeRecoveryGameSnapshot(snapshot)
  if (normalized.coreActivated) return 'The activation core is already online.'
  const missing = RECOVERY_ENERGY_KEYS.length - normalized.energizedKeys.length
  if (missing > 0) return `Energize ${missing} more energy ${missing === 1 ? 'key' : 'keys'} before activating the core.`
  if (!samePoint(normalized.player, RECOVERY_CORE)) return 'Move onto the activation core before activating it.'
  return null
}
