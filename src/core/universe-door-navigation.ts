/**
 * Platform-free navigation policy for portable universe doors.
 *
 * A universe canvas is reachable only through its recorded entry door. The paired return door is
 * the only route back to the containing canvas. Tabs, direct canvas selection, palette actions,
 * and history shortcuts are refused here so every shell shares one policy.
 */

import { validatePortableDoorConstruction, type PortableDoorConstructionV3 } from '../shared/door-construction'

export type UniverseDoorRole = 'entry' | 'return'
export type UniverseNavigationSource = 'door' | 'tab' | 'palette' | 'history' | 'direct'

export interface PortableUniverseDoorV3 {
  id: string
  canvasId: string
  targetCanvasId: string
  pairedDoorId: string
  role: UniverseDoorRole
  label: string
  access: 'door-only'
  /** Optional complete construction payload. Older paired-door records remain readable. */
  construction?: PortableDoorConstructionV3
}

export interface UniverseDoorNavigationRequest {
  source: UniverseNavigationSource
  fromCanvasId: string
  targetCanvasId: string
  doorId?: string
}

export type UniverseDoorNavigationDecision =
  | {
      allowed: true
      doorId: string
      fromCanvasId: string
      targetCanvasId: string
      matchingExitDoorId: string
    }
  | {
      allowed: false
      code: 'door-required' | 'door-missing' | 'wrong-side' | 'wrong-target' | 'pair-missing'
      reason: string
      nextAction: string
    }

const ID_LIMIT = 256
const LABEL_LIMIT = 512
const DOOR_KEYS = new Set(['id', 'canvasId', 'targetCanvasId', 'pairedDoorId', 'role', 'label', 'access', 'construction'])

function exactDoorKeys(value: object): void {
  for (const key of Object.keys(value)) if (!DOOR_KEYS.has(key)) throw new Error(`Portable door contains an unsupported field: ${key}.`)
}

function boundedText(value: unknown, label: string, limit = ID_LIMIT): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > limit) {
    throw new Error(`${label} must be non-empty bounded text.`)
  }
  return value
}

/** Validate and copy safe schema 3 intent. No local paths, sessions, credentials, or runtime state exist here. */
export function validatePortableUniverseDoors(
  input: readonly PortableUniverseDoorV3[],
  canvasIds: ReadonlySet<string>
): PortableUniverseDoorV3[] {
  const byId = new Map<string, PortableUniverseDoorV3>()
  const folded = new Set<string>()
  for (const candidate of input) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Portable door must be an object.')
    exactDoorKeys(candidate)
    const door: PortableUniverseDoorV3 = {
      id: boundedText(candidate.id, 'Door id'),
      canvasId: boundedText(candidate.canvasId, 'Door canvas id'),
      targetCanvasId: boundedText(candidate.targetCanvasId, 'Door target canvas id'),
      pairedDoorId: boundedText(candidate.pairedDoorId, 'Paired door id'),
      role: candidate.role,
      label: boundedText(candidate.label, 'Door label', LABEL_LIMIT),
      access: candidate.access,
      ...(candidate.construction !== undefined
        ? { construction: validatePortableDoorConstruction(candidate.construction) }
        : {})
    }
    const foldedId = door.id.toLocaleLowerCase('en-US')
    if (byId.has(door.id) || folded.has(foldedId)) throw new Error(`Duplicate or case-colliding door id: ${door.id}`)
    if (!canvasIds.has(door.canvasId) || !canvasIds.has(door.targetCanvasId)) throw new Error('Portable door references an unknown canvas.')
    if (door.canvasId === door.targetCanvasId) throw new Error('Portable door cannot target its own canvas.')
    if (door.role !== 'entry' && door.role !== 'return') throw new Error('Portable door role is invalid.')
    if (door.access !== 'door-only') throw new Error('Portable universe access must be door-only.')
    if (door.construction && (
      door.construction.doorId !== door.id ||
      door.construction.canvasId !== door.canvasId ||
      door.construction.targetCanvasId !== door.targetCanvasId ||
      door.construction.pairedDoorId !== door.pairedDoorId
    )) throw new Error(`Portable door ${door.id} construction identity does not match its door record.`)
    byId.set(door.id, door)
    folded.add(foldedId)
  }

  for (const door of byId.values()) {
    const pair = byId.get(door.pairedDoorId)
    if (!pair) throw new Error(`Portable door ${door.id} has no matching return door.`)
    if (pair.pairedDoorId !== door.id || pair.role === door.role) throw new Error(`Portable door ${door.id} has an invalid reciprocal pair.`)
    if (pair.canvasId !== door.targetCanvasId || pair.targetCanvasId !== door.canvasId) {
      throw new Error(`Portable door ${door.id} and its pair do not connect the same canvases.`)
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

/** Decide navigation without mutating canvas, history, or runtime state. */
export function decideUniverseDoorNavigation(
  doors: readonly PortableUniverseDoorV3[],
  request: UniverseDoorNavigationRequest
): UniverseDoorNavigationDecision {
  if (request.source !== 'door') {
    return {
      allowed: false,
      code: 'door-required',
      reason: 'Universe canvases can only be entered or exited through their visible paired doors.',
      nextAction: 'Activate the matching door on the current canvas.'
    }
  }
  const door = doors.find((candidate) => candidate.id === request.doorId)
  if (!door) return { allowed: false, code: 'door-missing', reason: 'The selected door is not part of this portable project.', nextAction: 'Choose a visible door on the current canvas.' }
  if (door.canvasId !== request.fromCanvasId) return { allowed: false, code: 'wrong-side', reason: 'That door is not on the current canvas.', nextAction: 'Choose a door shown on the current canvas.' }
  if (door.targetCanvasId !== request.targetCanvasId) return { allowed: false, code: 'wrong-target', reason: 'That door does not lead to the requested canvas.', nextAction: 'Use the destination shown on the door.' }
  const pair = doors.find((candidate) => candidate.id === door.pairedDoorId)
  if (!pair || pair.canvasId !== door.targetCanvasId || pair.targetCanvasId !== door.canvasId) {
    return { allowed: false, code: 'pair-missing', reason: 'The matching return door is unavailable, so entry was refused.', nextAction: 'Repair or restore the paired doors before entering.' }
  }
  return {
    allowed: true,
    doorId: door.id,
    fromCanvasId: door.canvasId,
    targetCanvasId: door.targetCanvasId,
    matchingExitDoorId: pair.id
  }
}

export function createPortableUniverseDoorPair(input: {
  entryDoorId: string
  returnDoorId: string
  parentCanvasId: string
  childCanvasId: string
  entryLabel: string
  returnLabel: string
  entryConstruction?: PortableDoorConstructionV3
  returnConstruction?: PortableDoorConstructionV3
}): [PortableUniverseDoorV3, PortableUniverseDoorV3] {
  return [
    { id: input.entryDoorId, canvasId: input.parentCanvasId, targetCanvasId: input.childCanvasId, pairedDoorId: input.returnDoorId, role: 'entry', label: input.entryLabel, access: 'door-only', ...(input.entryConstruction ? { construction: input.entryConstruction } : {}) },
    { id: input.returnDoorId, canvasId: input.childCanvasId, targetCanvasId: input.parentCanvasId, pairedDoorId: input.entryDoorId, role: 'return', label: input.returnLabel, access: 'door-only', ...(input.returnConstruction ? { construction: input.returnConstruction } : {}) }
  ]
}
import { validatePortableDoorConstruction, type PortableDoorConstructionV3 } from '../shared/door-construction'
