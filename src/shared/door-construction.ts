/**
 * Safe, portable intent for constructing a Multiverse door.
 *
 * This module deliberately contains no credentials, paths, process state, provider sessions, or
 * host identifiers. A constructed door is project content. The activation result is an in-memory
 * decision used by the renderer and does not grant navigation authority by itself.
 */

export const DOOR_CONSTRUCTION_SCHEMA_VERSION = 3 as const
export const DOOR_PART_IDS = ['frame', 'hinges', 'panel', 'handle', 'activation-core'] as const
export type DoorPartId = (typeof DOOR_PART_IDS)[number]
export type DoorMaterial = 'wood' | 'metal' | 'glass' | 'stone'

export interface DoorGeometryV3 {
  x: number
  y: number
  width: number
  height: number
}

export interface PortableDoorPartV3 {
  id: DoorPartId
  label: string
  material: DoorMaterial
  geometry: DoorGeometryV3
  enabled: boolean
}

export interface PortableDoorActivationCoreV3 {
  id: 'activation-core'
  label: string
  mode: 'door-only'
  armed: boolean
}

/** A complete schema 3 door construction, safe to include in a portable project projection. */
export interface PortableDoorConstructionV3 {
  schemaVersion: typeof DOOR_CONSTRUCTION_SCHEMA_VERSION
  doorId: string
  canvasId: string
  targetCanvasId: string
  pairedDoorId: string
  label: string
  access: 'door-only'
  frame: PortableDoorPartV3
  hinges: PortableDoorPartV3
  panel: PortableDoorPartV3
  handle: PortableDoorPartV3
  activationCore: PortableDoorActivationCoreV3
}

export interface DoorConstructionInput {
  doorId: string
  canvasId: string
  targetCanvasId: string
  pairedDoorId: string
  label: string
  frame?: Partial<PortableDoorPartV3>
  hinges?: Partial<PortableDoorPartV3>
  panel?: Partial<PortableDoorPartV3>
  handle?: Partial<PortableDoorPartV3>
  activationCore?: Partial<PortableDoorActivationCoreV3>
}

export type DoorConstructionReadiness =
  | { ready: true; missing: readonly [] }
  | { ready: false; missing: readonly DoorPartId[] }

export type DoorActivationResult =
  | { activated: true; construction: PortableDoorConstructionV3 }
  | { activated: false; reason: string; nextAction: string }

const ID_LIMIT = 256
const LABEL_LIMIT = 512
const MIN_DIMENSION = 24
const MAX_DIMENSION = 4096
const ALLOWED_MATERIALS: readonly DoorMaterial[] = ['wood', 'metal', 'glass', 'stone']
const CONSTRUCTION_KEYS = new Set(['schemaVersion', 'doorId', 'canvasId', 'targetCanvasId', 'pairedDoorId', 'label', 'access', 'frame', 'hinges', 'panel', 'handle', 'activationCore'])
const PART_KEYS = new Set(['id', 'label', 'material', 'geometry', 'enabled'])
const GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height'])
const CORE_KEYS = new Set(['id', 'label', 'mode', 'armed'])

function exactKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains an unsupported field: ${key}.`)
}

function boundedText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > limit || [...value].some((char) => char < ' ' || char === '\u007f')) {
    throw new Error(`${label} must be non-empty bounded text.`)
  }
  return value.trim()
}

function finiteDimension(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_DIMENSION || value > MAX_DIMENSION) {
    throw new Error(`${label} must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}.`)
  }
  return Math.round(value)
}

function finiteCoordinate(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_DIMENSION * 4) {
    throw new Error(`${label} must be a bounded number.`)
  }
  return Math.round(value)
}

function validatePart(value: unknown, expectedId: DoorPartId): PortableDoorPartV3 {
  if (!value || typeof value !== 'object') throw new Error(`Door ${expectedId} is missing.`)
  const part = value as Partial<PortableDoorPartV3>
  exactKeys(part, PART_KEYS, `Door ${expectedId}`)
  if (part.id !== expectedId) throw new Error(`Door part ${expectedId} has an invalid identifier.`)
  if (!ALLOWED_MATERIALS.includes(part.material as DoorMaterial)) throw new Error(`Door ${expectedId} has an unsupported material.`)
  if (typeof part.enabled !== 'boolean') throw new Error(`Door ${expectedId} enabled state is invalid.`)
  if (!part.geometry || typeof part.geometry !== 'object') throw new Error(`Door ${expectedId} geometry is missing.`)
  const geometry = part.geometry as Partial<DoorGeometryV3>
  exactKeys(geometry, GEOMETRY_KEYS, `Door ${expectedId} geometry`)
  return {
    id: expectedId,
    label: boundedText(part.label, `Door ${expectedId} label`, LABEL_LIMIT),
    material: part.material as DoorMaterial,
    enabled: part.enabled,
    geometry: {
      x: finiteCoordinate(geometry.x, `Door ${expectedId} x`),
      y: finiteCoordinate(geometry.y, `Door ${expectedId} y`),
      width: finiteDimension(geometry.width, `Door ${expectedId} width`),
      height: finiteDimension(geometry.height, `Door ${expectedId} height`)
    }
  }
}

function validateActivationCore(value: unknown): PortableDoorActivationCoreV3 {
  if (!value || typeof value !== 'object') throw new Error('Door activation core is missing.')
  const core = value as Partial<PortableDoorActivationCoreV3>
  exactKeys(core, CORE_KEYS, 'Door activation core')
  if (core.id !== 'activation-core' || core.mode !== 'door-only' || typeof core.armed !== 'boolean') {
    throw new Error('Door activation core has an invalid configuration.')
  }
  return {
    id: 'activation-core',
    label: boundedText(core.label, 'Door activation core label', LABEL_LIMIT),
    mode: 'door-only',
    armed: core.armed
  }
}

/** Validate and copy one complete construction. Unknown local/runtime values never enter it. */
export function validatePortableDoorConstruction(value: unknown): PortableDoorConstructionV3 {
  if (!value || typeof value !== 'object') throw new Error('Portable door construction must be an object.')
  const candidate = value as Partial<PortableDoorConstructionV3>
  exactKeys(candidate, CONSTRUCTION_KEYS, 'Portable door construction')
  if (candidate.schemaVersion !== DOOR_CONSTRUCTION_SCHEMA_VERSION) throw new Error('Portable door construction schema version is unsupported.')
  if (candidate.access !== 'door-only') throw new Error('Portable door construction access must be door-only.')
  const doorId = boundedText(candidate.doorId, 'Door id', ID_LIMIT)
  const canvasId = boundedText(candidate.canvasId, 'Door canvas id', ID_LIMIT)
  const targetCanvasId = boundedText(candidate.targetCanvasId, 'Door target canvas id', ID_LIMIT)
  const pairedDoorId = boundedText(candidate.pairedDoorId, 'Paired door id', ID_LIMIT)
  if (canvasId === targetCanvasId) throw new Error('Door cannot target its own canvas.')
  if (doorId === pairedDoorId) throw new Error('Door cannot pair with itself.')
  return {
    schemaVersion: DOOR_CONSTRUCTION_SCHEMA_VERSION,
    doorId,
    canvasId,
    targetCanvasId,
    pairedDoorId,
    label: boundedText(candidate.label, 'Door label', LABEL_LIMIT),
    access: 'door-only',
    frame: validatePart(candidate.frame, 'frame'),
    hinges: validatePart(candidate.hinges, 'hinges'),
    panel: validatePart(candidate.panel, 'panel'),
    handle: validatePart(candidate.handle, 'handle'),
    activationCore: validateActivationCore(candidate.activationCore)
  }
}

function part(id: DoorPartId, label: string, material: DoorMaterial, geometry: DoorGeometryV3): PortableDoorPartV3 {
  return { id, label, material, geometry, enabled: true }
}

/** Build a guided construction with safe defaults. Callers still validate before persistence. */
export function createPortableDoorConstruction(input: DoorConstructionInput): PortableDoorConstructionV3 {
  return validatePortableDoorConstruction({
    schemaVersion: DOOR_CONSTRUCTION_SCHEMA_VERSION,
    doorId: input.doorId,
    canvasId: input.canvasId,
    targetCanvasId: input.targetCanvasId,
    pairedDoorId: input.pairedDoorId,
    label: input.label,
    access: 'door-only',
    frame: { ...part('frame', 'Door frame', 'stone', { x: 0, y: 0, width: 360, height: 520 }), ...input.frame, id: 'frame' },
    hinges: { ...part('hinges', 'Hinges', 'metal', { x: 20, y: 80, width: 48, height: 360 }), ...input.hinges, id: 'hinges' },
    panel: { ...part('panel', 'Door panel', 'wood', { x: 56, y: 16, width: 280, height: 488 }), ...input.panel, id: 'panel' },
    handle: { ...part('handle', 'Handle', 'metal', { x: 280, y: 244, width: 48, height: 48 }), ...input.handle, id: 'handle' },
    activationCore: { id: 'activation-core', label: 'Activation core', mode: 'door-only', armed: false, ...input.activationCore }
  })
}

/** Missing parts stay explicit so a disabled Activate control can name the exact next action. */
export function doorConstructionReadiness(value: PortableDoorConstructionV3): DoorConstructionReadiness {
  const missing = DOOR_PART_IDS.filter((id) => id === 'activation-core'
    ? !value.activationCore.armed
    : !value[id].enabled) as DoorPartId[]
  return missing.length === 0 ? { ready: true, missing: [] } : { ready: false, missing }
}

/** Arm the local activation core only after all five construction parts are configured. */
export function activatePortableDoor(value: PortableDoorConstructionV3): DoorActivationResult {
  const construction = validatePortableDoorConstruction(value)
  const readiness = doorConstructionReadiness(construction)
  if (!readiness.ready) {
    const missing = readiness.missing.join(', ')
    return {
      activated: false,
      reason: `Door activation is unavailable until these parts are configured: ${missing}.`,
      nextAction: 'Configure each listed door part, then arm the activation core.'
    }
  }
  return { activated: true, construction }
}
