/**
 * Deterministic, bounded state for the Multiverse portal recovery mini-game.
 *
 * This is deliberately a pure reducer. It never knows about accounts, passwords, sessions, or
 * authentication state. Completing the game only produces portable progress metadata; a caller
 * must still use its ordinary credential flow to enter a destination.
 */

export const PORTAL_RECOVERY_SCHEMA_VERSION = 1 as const
export const PORTAL_RECOVERY_BOARD = {
  columns: 12,
  rows: 8,
  start: { x: 1, y: 6 },
  keys: [
    { x: 10, y: 1 },
    { x: 1, y: 1 },
    { x: 10, y: 6 }
  ],
  core: { x: 6, y: 3 },
  hazards: [
    { x: 4, y: 6 },
    { x: 4, y: 2 },
    { x: 8, y: 3 },
    { x: 7, y: 6 },
    { x: 6, y: 1 }
  ]
} as const

export type PortalRecoveryStatus = 'ready' | 'playing' | 'failed' | 'completed'
export type PortalRecoveryDirection = 'up' | 'down' | 'left' | 'right'
export interface PortalPoint {
  x: number
  y: number
}

export interface PortalRecoveryProgress {
  schemaVersion: typeof PORTAL_RECOVERY_SCHEMA_VERSION
  completed: boolean
  bestMoves: number | null
  attempts: number
}

export interface PortalRecoveryState {
  position: PortalPoint
  collected: [boolean, boolean, boolean]
  energy: number
  moves: number
  status: PortalRecoveryStatus
}

export type PortalRecoveryAction =
  | { type: 'start' }
  | { type: 'move'; direction: PortalRecoveryDirection }
  | { type: 'reset' }

export function defaultPortalRecoveryProgress(): PortalRecoveryProgress {
  return { schemaVersion: PORTAL_RECOVERY_SCHEMA_VERSION, completed: false, bestMoves: null, attempts: 0 }
}

export function sanitizePortalRecoveryProgress(value: unknown): PortalRecoveryProgress {
  if (!value || typeof value !== 'object') return defaultPortalRecoveryProgress()
  const raw = value as Record<string, unknown>
  const best = typeof raw.bestMoves === 'number' && Number.isInteger(raw.bestMoves) && raw.bestMoves > 0
    ? Math.min(9999, raw.bestMoves)
    : null
  const attempts = typeof raw.attempts === 'number' && Number.isInteger(raw.attempts)
    ? Math.max(0, Math.min(9999, raw.attempts))
    : 0
  return {
    schemaVersion: PORTAL_RECOVERY_SCHEMA_VERSION,
    completed: raw.schemaVersion === PORTAL_RECOVERY_SCHEMA_VERSION && raw.completed === true,
    bestMoves: best,
    attempts
  }
}

export function createPortalRecoveryState(): PortalRecoveryState {
  return {
    position: { ...PORTAL_RECOVERY_BOARD.start },
    collected: [false, false, false],
    energy: 3,
    moves: 0,
    status: 'ready'
  }
}

function samePoint(a: PortalPoint, b: PortalPoint): boolean {
  return a.x === b.x && a.y === b.y
}

function allKeysCollected(collected: readonly boolean[]): boolean {
  return collected.length === 3 && collected.every(Boolean)
}

export function portalRecoveryReducer(
  state: PortalRecoveryState,
  action: PortalRecoveryAction
): PortalRecoveryState {
  if (action.type === 'reset') return createPortalRecoveryState()
  if (action.type === 'start') {
    if (state.status === 'completed') return state
    return state.status === 'ready' || state.status === 'failed'
      ? { ...createPortalRecoveryState(), status: 'playing' }
      : state
  }
  if (state.status === 'completed') return state

  const delta: Record<PortalRecoveryDirection, PortalPoint> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  }
  const next = delta[action.direction]
  const position = {
    x: Math.max(0, Math.min(PORTAL_RECOVERY_BOARD.columns - 1, state.position.x + next.x)),
    y: Math.max(0, Math.min(PORTAL_RECOVERY_BOARD.rows - 1, state.position.y + next.y))
  }
  const moves = state.moves + 1
  const hitHazard = PORTAL_RECOVERY_BOARD.hazards.some((hazard) => samePoint(hazard, position))
  const energy = hitHazard ? state.energy - 1 : state.energy
  if (energy <= 0) {
    return { ...state, position: { ...PORTAL_RECOVERY_BOARD.start }, energy: 0, moves, status: 'failed' }
  }

  const collected: [boolean, boolean, boolean] = [...state.collected] as [boolean, boolean, boolean]
  PORTAL_RECOVERY_BOARD.keys.forEach((key, index) => {
    if (samePoint(key, position)) collected[index] = true
  })
  const completed = allKeysCollected(collected) && samePoint(PORTAL_RECOVERY_BOARD.core, position)
  return {
    position,
    collected,
    energy,
    moves,
    status: completed ? 'completed' : 'playing'
  }
}

export function portalRecoveryProgressAfterCompletion(
  progress: PortalRecoveryProgress,
  state: PortalRecoveryState
): PortalRecoveryProgress {
  if (state.status !== 'completed') return progress
  return {
    schemaVersion: PORTAL_RECOVERY_SCHEMA_VERSION,
    completed: true,
    bestMoves: progress.bestMoves === null ? state.moves : Math.min(progress.bestMoves, state.moves),
    attempts: Math.min(9999, progress.attempts + 1)
  }
}
