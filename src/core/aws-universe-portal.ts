/**
 * AWS Universe portal contract.
 *
 * This module is deliberately platform-free. It models the portable intent of an AWS Universe,
 * the two doors that enter and leave it, and the machine-local context that must never cross a
 * project-file or archive boundary. It does not call AWS, launch a process, read credentials, or
 * perform an external mutation. Those operations belong to later AWS Shop and service lanes.
 */

export const AWS_UNIVERSE_SCOPE = 'aws-only' as const
export const AWS_UNIVERSE_CANVAS_SCOPE = 'aws-universe' as const
export const AWS_UNIVERSE_SCHEMA_VERSION = 1 as const

export type AwsUniversePortalAction =
  | 'configure'
  | 'rebind'
  | 'adopt'
  | 'deploy'
  | 'locate-asset'
  | 'leave-unbound'

export type AwsUniverseDoorSide = 'entry' | 'return'

export interface AwsUniverseDoor {
  id: string
  pairId: string
  universeId: string
  side: AwsUniverseDoorSide
}

/** Safe project-owned metadata. No credential, provider session, path, process, or host id. */
export interface AwsUniversePortableMetadata {
  schemaVersion: typeof AWS_UNIVERSE_SCHEMA_VERSION
  universeId: string
  displayName: string
  scope: typeof AWS_UNIVERSE_SCOPE
  regionIntent?: string
  serviceIntent: string[]
  entryDoor: AwsUniverseDoor
  returnDoor: AwsUniverseDoor
}

/** Machine-local state. Keep this beside app data, never in a Project or portable archive. */
export interface AwsUniverseMachineContext {
  universeId: string
  contextVersion: 1
  credentialKey?: string
  profileRef?: string
  accountRef?: string
  roleRef?: string
  lastVerifiedAt?: number
}

export interface AwsUniverseInstance extends AwsUniversePortableMetadata {
  /** Runtime-only context, intentionally not returned by portableAwsUniverseMetadata. */
  localContext?: AwsUniverseMachineContext
}

export interface AwsUniverseCatalogEntry {
  id: string
  label: string
  category: 'aws-universe' | 'aws-shop' | 'aws-service' | 'aws-operation'
  available: boolean
  disabledReason?: string
}

export interface AwsUniverseImportPlan {
  metadata: AwsUniversePortableMetadata
  action: Extract<AwsUniversePortalAction, 'configure' | 'rebind' | 'adopt' | 'leave-unbound'>
  externalSideEffects: false
  reason: string
}

export interface AwsUniverseNavigation {
  universeId: string
  enteredThroughDoorId: string
  scope: typeof AWS_UNIVERSE_SCOPE
  tabBypassAllowed: false
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_LABEL_BYTES = 512
const MAX_SERVICE_INTENT = 256
const AWS_CATALOG_CATEGORIES = new Set<AwsUniverseCatalogEntry['category']>([
  'aws-universe',
  'aws-shop',
  'aws-service',
  'aws-operation'
])
const PORTABLE_KEYS = new Set(['schemaVersion', 'universeId', 'displayName', 'scope', 'regionIntent', 'serviceIntent', 'entryDoor', 'returnDoor'])

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || new TextEncoder().encode(value).byteLength > SAFE_LABEL_BYTES) {
    throw new Error(`${label} must be non-empty and bounded.`)
  }
  return value.trim()
}

function id(value: unknown, label: string): string {
  const candidate = text(value, label)
  if (!SAFE_ID.test(candidate)) throw new Error(`${label} contains unsupported characters.`)
  return candidate
}

function cloneDoor(door: AwsUniverseDoor): AwsUniverseDoor {
  return { id: door.id, pairId: door.pairId, universeId: door.universeId, side: door.side }
}

function validateDoor(door: unknown, expectedUniverseId: string, expectedSide: AwsUniverseDoorSide): AwsUniverseDoor {
  if (!door || typeof door !== 'object' || Array.isArray(door)) throw new Error('AWS Universe door is invalid.')
  const candidate = door as Record<string, unknown>
  const actual = {
    id: id(candidate.id, 'door id'),
    pairId: id(candidate.pairId, 'door pair id'),
    universeId: id(candidate.universeId, 'door universe id'),
    side: candidate.side
  }
  if (actual.universeId !== expectedUniverseId || actual.side !== expectedSide) throw new Error('AWS Universe door does not match its declared side.')
  return actual as AwsUniverseDoor
}

/** Build a deterministic entry/return pair. A pair is scoped to one Universe instance. */
export function createAwsUniverseDoorPair(universeId: string): { entryDoor: AwsUniverseDoor; returnDoor: AwsUniverseDoor } {
  const universe = id(universeId, 'universe id')
  const pairId = `${universe}:door-pair`
  return {
    entryDoor: { id: `${pairId}:entry`, pairId, universeId: universe, side: 'entry' },
    returnDoor: { id: `${pairId}:return`, pairId, universeId: universe, side: 'return' }
  }
}

/** Create safe portable metadata for one AWS Universe. There is no instance-count ceiling. */
export function createAwsUniverseInstance(input: {
  universeId: string
  displayName: string
  regionIntent?: string
  serviceIntent?: readonly string[]
  localContext?: AwsUniverseMachineContext
}): AwsUniverseInstance {
  const universeId = id(input.universeId, 'universe id')
  const displayName = text(input.displayName, 'display name')
  const serviceIntent = [...(input.serviceIntent ?? [])].map((value) => text(value, 'service intent'))
  if (serviceIntent.length > MAX_SERVICE_INTENT) throw new Error('AWS service intent exceeds its bound.')
  const uniqueServiceIntent = [...new Set(serviceIntent)].sort((a, b) => a.localeCompare(b))
  if (input.localContext && input.localContext.universeId !== universeId) throw new Error('Machine-local context belongs to another Universe.')
  const doors = createAwsUniverseDoorPair(universeId)
  return {
    schemaVersion: AWS_UNIVERSE_SCHEMA_VERSION,
    universeId,
    displayName,
    scope: AWS_UNIVERSE_SCOPE,
    ...(input.regionIntent ? { regionIntent: text(input.regionIntent, 'region intent') } : {}),
    serviceIntent: uniqueServiceIntent,
    entryDoor: doors.entryDoor,
    returnDoor: doors.returnDoor,
    ...(input.localContext ? { localContext: { ...input.localContext } } : {})
  }
}

/** Append without a global maximum. Duplicate ids are refused, while any number of instances is valid. */
export function appendAwsUniverseInstance(instances: readonly AwsUniverseInstance[], instance: AwsUniverseInstance): AwsUniverseInstance[] {
  if (instances.some((candidate) => candidate.universeId === instance.universeId)) throw new Error(`AWS Universe already exists: ${instance.universeId}`)
  return [...instances, instance]
}

/** A project-local collection with no arbitrary instance ceiling. The caller owns persistence. */
export interface AwsUniverseRegistry {
  readonly instances: readonly AwsUniverseInstance[]
  add(instance: AwsUniverseInstance): AwsUniverseRegistry
  find(universeId: string): AwsUniverseInstance | undefined
}

export function createAwsUniverseRegistry(initial: readonly AwsUniverseInstance[] = []): AwsUniverseRegistry {
  let instances = [...initial]
  if (new Set(instances.map((instance) => instance.universeId)).size !== instances.length) throw new Error('AWS Universe registry contains duplicate ids.')
  const registry: AwsUniverseRegistry = {
    get instances() { return instances },
    add(instance) {
      instances = appendAwsUniverseInstance(instances, instance)
      return registry
    },
    find(universeId) { return instances.find((instance) => instance.universeId === universeId) }
  }
  return registry
}

/** Validate a portable record and return a local-context-free copy. */
export function validateAwsUniversePortableMetadata(value: unknown): AwsUniversePortableMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AWS Universe metadata is invalid.')
  const candidate = value as Record<string, unknown>
  for (const key of Object.keys(candidate)) if (!PORTABLE_KEYS.has(key)) throw new Error(`AWS Universe portable metadata contains a local or unknown field: ${key}`)
  if (candidate.schemaVersion !== AWS_UNIVERSE_SCHEMA_VERSION || candidate.scope !== AWS_UNIVERSE_SCOPE) throw new Error('AWS Universe metadata schema or scope is invalid.')
  const universeId = id(candidate.universeId, 'universe id')
  const displayName = text(candidate.displayName, 'display name')
  if (!Array.isArray(candidate.serviceIntent) || candidate.serviceIntent.length > MAX_SERVICE_INTENT) throw new Error('AWS service intent is invalid.')
  const serviceIntent = [...new Set(candidate.serviceIntent.map((entry) => text(entry, 'service intent'))) ].sort((a, b) => a.localeCompare(b))
  const entryDoor = validateDoor(candidate.entryDoor, universeId, 'entry')
  const returnDoor = validateDoor(candidate.returnDoor, universeId, 'return')
  if (entryDoor.pairId !== returnDoor.pairId || entryDoor.pairId !== `${universeId}:door-pair`) throw new Error('AWS Universe doors do not form the matching pair.')
  if (candidate.regionIntent !== undefined && typeof candidate.regionIntent !== 'string') throw new Error('AWS region intent is invalid.')
  return {
    schemaVersion: AWS_UNIVERSE_SCHEMA_VERSION,
    universeId,
    displayName,
    scope: AWS_UNIVERSE_SCOPE,
    ...(candidate.regionIntent ? { regionIntent: text(candidate.regionIntent, 'region intent') } : {}),
    serviceIntent,
    entryDoor: cloneDoor(entryDoor),
    returnDoor: cloneDoor(returnDoor)
  }
}

/** Strip the local overlay before persistence, export, peer sync, or display in a portable file. */
export function portableAwsUniverseMetadata(instance: AwsUniverseInstance): AwsUniversePortableMetadata {
  return validateAwsUniversePortableMetadata({
    schemaVersion: instance.schemaVersion,
    universeId: instance.universeId,
    displayName: instance.displayName,
    scope: instance.scope,
    ...(instance.regionIntent ? { regionIntent: instance.regionIntent } : {}),
    serviceIntent: instance.serviceIntent,
    entryDoor: instance.entryDoor,
    returnDoor: instance.returnDoor
  })
}

/** Import is a pure plan. It never calls a provider, deploys, downloads, or launches anything. */
export function planAwsUniverseImport(value: unknown, localContext?: AwsUniverseMachineContext): AwsUniverseImportPlan {
  const metadata = validateAwsUniversePortableMetadata(value)
  if (!localContext) return { metadata, action: 'configure', externalSideEffects: false, reason: 'No machine-local AWS context is available on this computer.' }
  if (localContext.universeId !== metadata.universeId) return { metadata, action: 'configure', externalSideEffects: false, reason: 'The available local context belongs to another Universe.' }
  if (localContext.credentialKey || localContext.profileRef || localContext.accountRef || localContext.roleRef) {
    return { metadata, action: 'rebind', externalSideEffects: false, reason: 'A matching local context exists, but rebinding must be explicitly confirmed.' }
  }
  return { metadata, action: 'leave-unbound', externalSideEffects: false, reason: 'The Universe remains portable and unbound until the user chooses a local context.' }
}

/** Relaunch uses the same pure decision as import and never restores a provider session implicitly. */
export function planAwsUniverseRelaunch(instance: AwsUniverseInstance, localContext?: AwsUniverseMachineContext): AwsUniverseImportPlan {
  return planAwsUniverseImport(portableAwsUniverseMetadata(instance), localContext)
}

/** Entry is only reachable through the entry door. There is intentionally no tab-based route. */
export function enterAwsUniverse(instance: AwsUniverseInstance, doorId: string): AwsUniverseNavigation {
  const metadata = portableAwsUniverseMetadata(instance)
  if (doorId !== metadata.entryDoor.id) throw new Error('AWS Universe entry requires its matching entry door.')
  return { universeId: metadata.universeId, enteredThroughDoorId: doorId, scope: AWS_UNIVERSE_SCOPE, tabBypassAllowed: false }
}

/** Return is only reachable through the matching return door for the active instance. */
export function leaveAwsUniverse(instance: AwsUniverseInstance, navigation: AwsUniverseNavigation, doorId: string): boolean {
  const metadata = portableAwsUniverseMetadata(instance)
  return navigation.tabBypassAllowed === false && navigation.universeId === metadata.universeId &&
    navigation.enteredThroughDoorId === metadata.entryDoor.id && doorId === metadata.returnDoor.id
}

export function isAwsUniverseCatalogCategory(value: unknown): value is AwsUniverseCatalogEntry['category'] {
  return typeof value === 'string' && AWS_CATALOG_CATEGORIES.has(value as AwsUniverseCatalogEntry['category'])
}

/** AWS Shop and later service operations are represented as interfaces only in this lane. */
export function awsOnlyCatalog(entries: readonly AwsUniverseCatalogEntry[]): AwsUniverseCatalogEntry[] {
  return entries.filter((entry) => isAwsUniverseCatalogCategory(entry.category)).map((entry) => ({ ...entry }))
}

export function filterAwsUniverseCatalog(entries: readonly AwsUniverseCatalogEntry[], query: string, regex?: RegExp): AwsUniverseCatalogEntry[] {
  const needle = query.trim()
  if (!needle) return awsOnlyCatalog(entries)
  const matcher = regex
    ? new RegExp(regex.source, regex.flags.replace('g', '').replace('y', ''))
    : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  return awsOnlyCatalog(entries).filter((entry) => matcher.test(`${entry.label} ${entry.category} ${entry.id}`))
}
