/**
 * Provider-neutral state for a hosted tunnel.
 *
 * This module deliberately models observations rather than performing them. A connector may
 * implement the interfaces at the bottom of the file, but the state machine remains safe to use
 * when no provider is connected. In particular, token material, provider sessions, process ids,
 * machine paths, and host-specific identifiers never belong in this record.
 */

export const TUNNEL_STATE_SCHEMA_VERSION = 1 as const

export const TUNNEL_PHASES = [
  'api-created',
  'token-sealed',
  'process-running',
  'connector-healthy',
  'dns-routed',
  'access-protected',
  'origin-reachable',
  'external-reachable'
] as const

export type TunnelPhase = (typeof TUNNEL_PHASES)[number]

export const TUNNEL_PHASE_LABELS: Record<TunnelPhase, string> = {
  'api-created': 'API-created',
  'token-sealed': 'Token sealed',
  'process-running': 'Process running',
  'connector-healthy': 'Connector healthy',
  'dns-routed': 'DNS routed',
  'access-protected': 'Access protected',
  'origin-reachable': 'Origin reachable',
  'external-reachable': 'External reachable'
}

export type TunnelObservationState = 'unknown' | 'pending' | 'healthy' | 'failed'

export interface TunnelPhaseObservation {
  state: TunnelObservationState
  checkedAt: number | null
  detail?: string
  error?: string
}

export interface TunnelStateError {
  code: string
  message: string
  phase?: TunnelPhase
  generation: number
  at: number
}

export type TunnelLifecycle = 'idle' | 'reconciling' | 'ready' | 'partial' | 'error' | 'stale'

export interface TunnelStateHistoryEntry {
  id: string
  action: TunnelStateActionType
  generation: number
  at: number
  summary: string
  phase?: TunnelPhase
}

export type TunnelStateActionType =
  | 'set-identity'
  | 'begin-reconciliation'
  | 'observe-phase'
  | 'complete-reconciliation'
  | 'reset'

export interface TunnelStateSnapshot {
  schemaVersion: typeof TUNNEL_STATE_SCHEMA_VERSION
  tunnelId: string
  displayName: string
  hostname: string
  originUrl: string
  generation: number
  lifecycle: TunnelLifecycle
  stale: boolean
  partial: boolean
  observedAt: number | null
  updatedAt: number
  phases: Record<TunnelPhase, TunnelPhaseObservation>
  errors: TunnelStateError[]
  history: TunnelStateHistoryEntry[]
}

export type TunnelStateAction =
  | {
      type: 'set-identity'
      tunnelId: string
      displayName: string
      hostname: string
      originUrl: string
    }
  | { type: 'begin-reconciliation'; generation?: number }
  | {
      type: 'observe-phase'
      generation: number
      phase: TunnelPhase
      observation: TunnelPhaseObservation
    }
  | { type: 'complete-reconciliation'; generation: number }
  | { type: 'reset' }

export interface TunnelStateActionResult {
  state: TunnelStateSnapshot
  applied: boolean
  stale: boolean
}

const MAX_HISTORY = 200
const MAX_ERRORS = 50

function now(): number {
  return Date.now()
}

function emptyPhases(): Record<TunnelPhase, TunnelPhaseObservation> {
  return Object.fromEntries(
    TUNNEL_PHASES.map((phase) => [phase, { state: 'unknown', checkedAt: null }])
  ) as Record<TunnelPhase, TunnelPhaseObservation>
}

function nextHistory(
  history: TunnelStateHistoryEntry[],
  entry: Omit<TunnelStateHistoryEntry, 'id'>
): TunnelStateHistoryEntry[] {
  const item = { ...entry, id: `tunnel-history-${entry.at}-${history.length + 1}` }
  return [item, ...history].slice(0, MAX_HISTORY)
}

function nextErrors(errors: TunnelStateError[], error: TunnelStateError): TunnelStateError[] {
  return [error, ...errors].slice(0, MAX_ERRORS)
}

function deriveLifecycle(
  phases: Record<TunnelPhase, TunnelPhaseObservation>,
  errors: TunnelStateError[],
  reconciling: boolean,
  stale: boolean
): { lifecycle: TunnelLifecycle; partial: boolean } {
  if (stale) return { lifecycle: 'stale', partial: true }
  if (errors.length > 0 || TUNNEL_PHASES.some((phase) => phases[phase].state === 'failed')) {
    return { lifecycle: 'error', partial: TUNNEL_PHASES.some((phase) => phases[phase].state !== 'healthy') }
  }
  if (reconciling) return { lifecycle: 'reconciling', partial: true }
  const healthy = TUNNEL_PHASES.filter((phase) => phases[phase].state === 'healthy').length
  if (healthy === TUNNEL_PHASES.length) return { lifecycle: 'ready', partial: false }
  if (healthy > 0) return { lifecycle: 'partial', partial: true }
  return { lifecycle: 'idle', partial: false }
}

export function createInitialTunnelState(input: Partial<Pick<
  TunnelStateSnapshot,
  'tunnelId' | 'displayName' | 'hostname' | 'originUrl'
>> = {}): TunnelStateSnapshot {
  const timestamp = now()
  return {
    schemaVersion: TUNNEL_STATE_SCHEMA_VERSION,
    tunnelId: input.tunnelId ?? '',
    displayName: input.displayName ?? '',
    hostname: input.hostname ?? '',
    originUrl: input.originUrl ?? '',
    generation: 0,
    lifecycle: 'idle',
    stale: false,
    partial: false,
    observedAt: null,
    updatedAt: timestamp,
    phases: emptyPhases(),
    errors: [],
    history: []
  }
}

function staleResult(state: TunnelStateSnapshot, generation: number, phase?: TunnelPhase): TunnelStateActionResult {
  const timestamp = now()
  const error: TunnelStateError = {
    code: 'stale-reconciliation',
    message: `Ignored observation from reconciliation generation ${generation}; current generation is ${state.generation}.`,
    phase,
    generation,
    at: timestamp
  }
  const next = {
    ...state,
    stale: true,
    partial: true,
    lifecycle: 'stale' as const,
    updatedAt: timestamp,
    errors: nextErrors(state.errors, error),
    history: nextHistory(state.history, {
      action: 'observe-phase',
      generation: state.generation,
      at: timestamp,
      summary: error.message,
      phase
    })
  }
  return { state: next, applied: false, stale: true }
}

export function applyTunnelStateAction(
  state: TunnelStateSnapshot,
  action: TunnelStateAction,
  clock: () => number = now
): TunnelStateActionResult {
  const timestamp = clock()
  if (action.type === 'set-identity') {
    const next = {
      ...state,
      tunnelId: action.tunnelId.trim(),
      displayName: action.displayName.trim(),
      hostname: action.hostname.trim(),
      originUrl: action.originUrl.trim(),
      updatedAt: timestamp,
      history: nextHistory(state.history, {
        action: action.type,
        generation: state.generation,
        at: timestamp,
        summary: 'Updated safe tunnel identity and origin metadata.'
      })
    }
    return { state: next, applied: true, stale: false }
  }

  if (action.type === 'reset') {
    const next = createInitialTunnelState({
      tunnelId: state.tunnelId,
      displayName: state.displayName,
      hostname: state.hostname,
      originUrl: state.originUrl
    })
    next.updatedAt = timestamp
    next.history = nextHistory(state.history, {
      action: action.type,
      generation: state.generation,
      at: timestamp,
      summary: 'Reset tunnel observations while retaining safe identity metadata.'
    })
    return { state: next, applied: true, stale: false }
  }

  if (action.type === 'begin-reconciliation') {
    const generation = Number.isInteger(action.generation) && (action.generation ?? 0) > state.generation
      ? (action.generation as number)
      : state.generation + 1
    const phases = Object.fromEntries(
      TUNNEL_PHASES.map((phase) => [phase, { ...state.phases[phase], state: 'pending' as const, error: undefined }])
    ) as Record<TunnelPhase, TunnelPhaseObservation>
    const next = {
      ...state,
      generation,
      phases,
      lifecycle: 'reconciling' as const,
      stale: false,
      partial: true,
      observedAt: null,
      updatedAt: timestamp,
      errors: [],
      history: nextHistory(state.history, {
        action: action.type,
        generation,
        at: timestamp,
        summary: `Started tunnel reconciliation generation ${generation}.`
      })
    }
    return { state: next, applied: true, stale: false }
  }

  if (action.generation !== state.generation) return staleResult(state, action.generation, action.type === 'observe-phase' ? action.phase : undefined)

  if (action.type === 'observe-phase') {
    const phases = { ...state.phases, [action.phase]: { ...action.observation } }
    const observationError = action.observation.error
      ? {
          code: 'phase-failed',
          message: action.observation.error,
          phase: action.phase,
          generation: action.generation,
          at: timestamp
        }
      : null
    const errors = observationError ? nextErrors(state.errors, observationError) : state.errors
    const derived = deriveLifecycle(phases, errors, true, false)
    const next = {
      ...state,
      phases,
      lifecycle: derived.lifecycle,
      partial: derived.partial,
      stale: false,
      updatedAt: timestamp,
      observedAt: action.observation.checkedAt,
      errors,
      history: nextHistory(state.history, {
        action: action.type,
        generation: action.generation,
        at: timestamp,
        summary: `${TUNNEL_PHASE_LABELS[action.phase]} observed as ${action.observation.state}.`,
        phase: action.phase
      })
    }
    return { state: next, applied: true, stale: false }
  }

  const derived = deriveLifecycle(state.phases, state.errors, false, false)
  const next = {
    ...state,
    lifecycle: derived.lifecycle,
    partial: derived.partial,
    stale: false,
    updatedAt: timestamp,
    observedAt: timestamp,
    history: nextHistory(state.history, {
      action: action.type,
      generation: action.generation,
      at: timestamp,
      summary: derived.lifecycle === 'ready'
        ? `Completed tunnel reconciliation generation ${action.generation}.`
        : `Completed tunnel reconciliation generation ${action.generation} with ${derived.lifecycle} state.`
    })
  }
  return { state: next, applied: true, stale: false }
}

/** Rows intentionally omit token, provider session, process, and machine identity material. */
export function tunnelStateExportRows(state: TunnelStateSnapshot): Array<Record<string, unknown>> {
  return TUNNEL_PHASES.map((phase) => ({
    tunnelId: state.tunnelId,
    displayName: state.displayName,
    hostname: state.hostname,
    originUrl: state.originUrl,
    generation: state.generation,
    lifecycle: state.lifecycle,
    stale: state.stale,
    partial: state.partial,
    phase,
    phaseLabel: TUNNEL_PHASE_LABELS[phase],
    phaseState: state.phases[phase].state,
    checkedAt: state.phases[phase].checkedAt,
    detail: state.phases[phase].detail ?? '',
    error: state.phases[phase].error ?? ''
  }))
}

/** Connector contract only. Implementations belong to provider-specific lanes. */
export interface TunnelConnectorAdapter {
  observeApiCreated(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeTokenSealed(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeProcessRunning(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeConnectorHealthy(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeDnsRouted(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeAccessProtected(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeOriginReachable(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
  observeExternalReachable(input: TunnelConnectorInput): Promise<TunnelPhaseObservation>
}

export interface TunnelConnectorInput {
  tunnelId: string
  hostname: string
  originUrl: string
  generation: number
}

