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
