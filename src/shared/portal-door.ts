/**
 * Portal-door entry credentials. This contract is deliberately separate from `ToyLockRecord`:
 * a portal entry value controls navigation into a child canvas, while a toy lock is an optional
 * presentation speed bump. Portal credentials are real vault-backed checks and never participate
 * in the toy-lock unlock ladder.
 */

export type PortalDoorEntryMode = 'numeric-code' | 'passphrase'
export type PortalDoorEntryDuration = 'session' | 'minutes' | 'until-close'

/** Portable, non-secret presence metadata. The secret and every local credential reference stay
 * in the application-data vault keyed by `doorId`; this shape is safe for project.json. */
export interface PortablePortalDoorEntry {
  enabled: boolean
  mode: PortalDoorEntryMode
  duration: PortalDoorEntryDuration
  durationMinutes?: number
  lockedOnLaunch: boolean
}

/** Non-secret local metadata returned to the renderer. */
export interface PortalDoorEntryRecord {
  id: string
  projectId: string
  doorId: string
  label: string
  enabled: boolean
  mode: PortalDoorEntryMode
  duration: PortalDoorEntryDuration
  durationMinutes?: number
  lockedOnLaunch: boolean
  createdAt: number
  updatedAt: number
}

export interface PortalDoorConfigureInput {
  projectId: string
  doorId: string
  label: string
  enabled?: boolean
  mode: PortalDoorEntryMode
  /** The value is accepted only over the local app bridge and is sealed before persistence. */
  secret: string
  duration: PortalDoorEntryDuration
  durationMinutes?: number
  lockedOnLaunch: boolean
}

export interface PortalDoorVerifyInput {
  projectId: string
  doorId: string
  value: string
}

export interface PortalDoorRelockInput {
  projectId: string
  doorId: string
}

export interface PortalDoorStatusInput {
  projectId: string
  doorId: string
}

export interface PortalDoorStatus {
  configured: boolean
  mode?: PortalDoorEntryMode
  unlocked: boolean
  /** Omitted for a session/until-close unlock or a locked door. */
  unlockedUntil?: number
}

export interface PortalDoorVerifyResult {
  ok: boolean
  /** The service refuses to inspect the value while this wait is active. */
  retryAfterMs?: number
  /** Never reveals which part of a secret was wrong. */
  reason?: string
  unlockedUntil?: number
}

export type PortalDoorConfigureResult =
  | { ok: true; record: PortalDoorEntryRecord }
  | { ok: false; error: string }

export type PortalDoorRemoveResult =
  | { ok: true }
  | { ok: false; error: 'not-found' | 'unsupported' }

export interface PortalDoorApi {
  list(projectId: string): Promise<PortalDoorEntryRecord[]>
  configure(input: PortalDoorConfigureInput): Promise<PortalDoorConfigureResult>
  remove(input: PortalDoorRelockInput): Promise<PortalDoorRemoveResult>
  status(input: PortalDoorStatusInput): Promise<PortalDoorStatus>
  verify(input: PortalDoorVerifyInput): Promise<PortalDoorVerifyResult>
  relock(input: PortalDoorRelockInput): Promise<void>
}

export const PORTAL_DOOR_ENTRY_LABELS: Record<PortalDoorEntryMode, string> = {
  'numeric-code': 'Numeric code',
  passphrase: 'Passphrase'
}

export const PORTAL_DOOR_DURATION_LABELS: Record<PortalDoorEntryDuration, string> = {
  session: 'While this portal is open',
  minutes: 'For a number of minutes',
  'until-close': 'Until the app closes'
}
