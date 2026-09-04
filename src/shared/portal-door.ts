/** Durable, portable construction state for a Multiverse portal door.
 *
 * This module is deliberately only the typed seam. It does not open a child canvas, authenticate,
 * recover an account, or navigate. A door is useful before those later lanes exist: the user can
 * author its physical parts, save the intent, and return to it after a restart.
 */
export const PORTAL_DOOR_PARTS = ['frame', 'hinges', 'panel', 'handle', 'activation-core'] as const
export type PortalDoorPart = (typeof PORTAL_DOOR_PARTS)[number]

export type PortalDoorStage = 'frame' | 'hinges' | 'panel' | 'handle' | 'activation-core' | 'complete'

export interface PortalDoorConstruction {
  stage: PortalDoorStage
  completed: PortalDoorPart[]
  metadata: {
    schemaVersion: 1
    targetCanvasId: string
    doorId: string
  }
}

export const PORTAL_DOOR_SCHEMA_VERSION = 1 as const
export const PORTAL_DOOR_METADATA_MAX_BYTES = 256
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).byteLength <= PORTAL_DOOR_METADATA_MAX_BYTES
}

export function createPortalDoorConstruction(id: string): PortalDoorConstruction {
  return {
    stage: 'frame',
    completed: [],
    metadata: { schemaVersion: PORTAL_DOOR_SCHEMA_VERSION, targetCanvasId: 'pending', doorId: id }
  }
}

export function advancePortalDoorConstruction(
  current: PortalDoorConstruction,
  part: PortalDoorPart
): PortalDoorConstruction {
  const index = PORTAL_DOOR_PARTS.indexOf(part)
  if (index < 0 || current.completed.includes(part)) return current
  const expected = PORTAL_DOOR_PARTS[current.completed.length]
  if (part !== expected) return current
  const completed = [...current.completed, part]
  const stage: PortalDoorStage = completed.length === PORTAL_DOOR_PARTS.length ? 'complete' : PORTAL_DOOR_PARTS[completed.length]!
  return { ...current, completed, stage }
}

export function validatePortalDoorConstruction(value: unknown): PortalDoorConstruction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Partial<PortalDoorConstruction>
  if (!candidate.metadata || typeof candidate.metadata !== 'object') return undefined
  const metadata = candidate.metadata as Partial<PortalDoorConstruction['metadata']> & Record<string, unknown>
  if (Object.keys(candidate).some((key) => UNSAFE_KEYS.has(key) || !['stage', 'completed', 'metadata'].includes(key))) return undefined
  if (Object.keys(metadata).some((key) => UNSAFE_KEYS.has(key) || !['schemaVersion', 'targetCanvasId', 'doorId'].includes(key))) return undefined
  if (metadata.schemaVersion !== PORTAL_DOOR_SCHEMA_VERSION || !boundedText(metadata.targetCanvasId) || !boundedText(metadata.doorId)) return undefined
  if (!Array.isArray(candidate.completed) || candidate.completed.length > PORTAL_DOOR_PARTS.length || candidate.completed.some((part) => !PORTAL_DOOR_PARTS.includes(part as PortalDoorPart))) return undefined
  const completed = candidate.completed as PortalDoorPart[]
  if (completed.some((part, index) => PORTAL_DOOR_PARTS[index] !== part)) return undefined
  const stage: PortalDoorStage = completed.length === PORTAL_DOOR_PARTS.length ? 'complete' : PORTAL_DOOR_PARTS[completed.length]!
  if (candidate.stage !== stage) return undefined
  return { stage, completed: [...completed], metadata: { schemaVersion: 1, targetCanvasId: metadata.targetCanvasId, doorId: metadata.doorId } }
}

// ---------------------------------------------------------------------------------------
// Portal-door ENTRY credentials, recovered verbatim from 47aca7a5a.
//
// Two independent features were authored against this one filename and a merge kept only the
// construction half while every consumer of the entry half survived. The two sets share no
// exported name, so this is a union rather than a choice between them.
//
// The contract is deliberately separate from ToyLockRecord: a portal entry value controls
// navigation into a child canvas and is a real vault-backed check, while a toy lock is an
// optional presentation speed bump that participates in the unlock ladder.
// ---------------------------------------------------------------------------------------
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
