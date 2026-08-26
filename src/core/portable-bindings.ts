/**
 * Portable node blueprints and destination-machine bindings.
 *
 * A blueprint is safe project content.  A binding is private destination state.  This module
 * keeps the two shapes separate and never accepts a credential value, executable path, process
 * identifier, or provider response as a portable value.  Import can therefore prepare a project
 * without configuring, adopting, deploying, locating, or starting anything on the destination.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from './fs-atomic'

export const PORTABLE_BLUEPRINT_VERSION = 1 as const
export const LOCAL_BINDING_VERSION = 1 as const
const MAX_BINDING_FILE_BYTES = 4 * 1024 * 1024

export type PortableBindingAction =
  | 'configure'
  | 'rebind'
  | 'adopt'
  | 'deploy'
  | 'locate-asset'
  | 'leave-unbound'

export interface PortableNodeBlueprint {
  schemaVersion: typeof PORTABLE_BLUEPRINT_VERSION
  featureId: string
  displayLabel: string
  requestedCapabilities: string[]
  safeSettings: Record<string, unknown>
  relationships: Array<{ id: string; kind: 'bridge' | 'rope'; source: string; target: string }>
  assets?: Array<{ id: string; label: string; sha256?: string; optional?: boolean }>
}

export interface LocalNodeBinding {
  nodeId: string
  bindingVersion: typeof LOCAL_BINDING_VERSION
  providerOrHostIdentity: string
  localResourceReferences: Record<string, string | number | boolean>
  credentialKeys: string[]
  lastVerifiedAt?: number
}

export interface PortableBindingContext {
  hasBinding: boolean
  hasMatchingResource: boolean
  canConfigure: boolean
  canDeploy: boolean
  hasMissingAssets: boolean
}

export interface PortableBindingActionState {
  action: PortableBindingAction
  enabled: boolean
  reason?: string
}

export interface PortableBindingWizardState {
  phase: 'idle' | 'preflight' | 'staging' | 'ready' | 'applying' | 'completed' | 'cancelled' | 'failed'
  action?: PortableBindingAction
  progress: number
  message: string
  cancellable: boolean
  error?: string
}

const ACTION_LABELS: Record<PortableBindingAction, string> = {
  configure: 'Configure this node',
  rebind: 'Rebind to a local resource',
  adopt: 'Adopt an existing resource',
  deploy: 'Deploy a new resource',
  'locate-asset': 'Locate an asset',
  'leave-unbound': 'Leave unbound'
}

const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/
const SHA256 = /^[0-9a-f]{64}$/
const FORBIDDEN_SETTING = /credential|password|passkey|secret|token|vault|path|directory|hostname|session|process|executable|command|environment|cookie/i

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeText(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || [...value].some((c) => c < ' ' || c === '\u007f')) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function safeRecord(value: unknown, label: string): Record<string, string | number | boolean> {
  if (!record(value)) throw new Error(`${label} must be an object.`)
  const out: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_KEY.test(key) || item === null || !['string', 'number', 'boolean'].includes(typeof item)) {
      throw new Error(`${label} contains an invalid value.`)
    }
    if (typeof item === 'string') safeText(item, `${label}.${key}`)
    if (typeof item === 'number' && !Number.isSafeInteger(item)) throw new Error(`${label}.${key} is invalid.`)
    out[key] = item
  }
  return out
}

function safeSettings(value: unknown, depth = 0, seen = { count: 0 }): Record<string, unknown> {
  if (!record(value) || depth > 8) throw new Error('Portable blueprint safe settings are invalid.')
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (++seen.count > 4096 || !SAFE_KEY.test(key) || FORBIDDEN_SETTING.test(key)) throw new Error('Portable blueprint safe settings contain a forbidden or excessive field.')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') {
      if (typeof item === 'string') safeText(item, `Portable setting ${key}`, 4096)
      out[key] = item
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item) || Math.abs(item) > 1e9) throw new Error(`Portable setting ${key} is invalid.`)
      out[key] = item
    } else if (Array.isArray(item)) {
      if (item.length > 1024) throw new Error(`Portable setting ${key} is excessive.`)
      out[key] = item.map((child) => safeSettings({ value: child }, depth + 1, seen).value)
    } else {
      out[key] = safeSettings(item, depth + 1, seen)
    }
  }
  return out
}

/** Validate the safe project-side blueprint. Unknown fields are refused rather than carried. */
export function validatePortableNodeBlueprint(value: unknown): PortableNodeBlueprint {
  if (!record(value) || value.schemaVersion !== PORTABLE_BLUEPRINT_VERSION) throw new Error('Portable node blueprint version is unsupported.')
  const allowed = new Set(['schemaVersion', 'featureId', 'displayLabel', 'requestedCapabilities', 'safeSettings', 'relationships', 'assets'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Portable blueprint contains an unknown field: ${key}`)
  const featureId = safeText(value.featureId, 'Portable blueprint feature id', 128)
  const displayLabel = safeText(value.displayLabel, 'Portable blueprint display label')
  if (!Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length > 256) throw new Error('Portable blueprint capabilities are invalid.')
  const requestedCapabilities = value.requestedCapabilities.map((item) => safeText(item, 'Portable capability', 128))
  const cleanSettings = safeSettings(value.safeSettings)
  if (!Array.isArray(value.relationships) || value.relationships.length > 4096) throw new Error('Portable blueprint relationships are invalid.')
  const relationships = value.relationships.map((entry) => {
    if (!record(entry) || !['id', 'kind', 'source', 'target'].every((key) => key in entry) || (entry.kind !== 'bridge' && entry.kind !== 'rope')) throw new Error('Portable blueprint relationship is invalid.')
    return { id: safeText(entry.id, 'Portable relationship id', 128), kind: entry.kind, source: safeText(entry.source, 'Portable relationship source', 128), target: safeText(entry.target, 'Portable relationship target', 128) }
  })
  let assets: PortableNodeBlueprint['assets']
  if (value.assets !== undefined) {
    if (!Array.isArray(value.assets) || value.assets.length > 4096) throw new Error('Portable blueprint assets are invalid.')
    assets = value.assets.map((entry) => {
      if (!record(entry)) throw new Error('Portable asset is invalid.')
      const keys = new Set(['id', 'label', 'sha256', 'optional'])
      for (const key of Object.keys(entry)) if (!keys.has(key)) throw new Error(`Portable asset contains an unknown field: ${key}`)
      if (entry.sha256 !== undefined && (typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256))) throw new Error('Portable asset hash is invalid.')
      if (entry.optional !== undefined && typeof entry.optional !== 'boolean') throw new Error('Portable asset optional flag is invalid.')
      return { id: safeText(entry.id, 'Portable asset id', 128), label: safeText(entry.label, 'Portable asset label'), ...(entry.sha256 ? { sha256: entry.sha256 } : {}), ...(entry.optional !== undefined ? { optional: entry.optional } : {}) }
    })
  }
  return { schemaVersion: 1, featureId, displayLabel, requestedCapabilities, safeSettings: cleanSettings, relationships, ...(assets ? { assets } : {}) }
}

/** Validate the private destination binding. Credential values never fit this shape. */
export function validateLocalNodeBinding(value: unknown): LocalNodeBinding {
  if (!record(value) || value.bindingVersion !== LOCAL_BINDING_VERSION) throw new Error('Local binding version is unsupported.')
  const allowed = new Set(['nodeId', 'bindingVersion', 'providerOrHostIdentity', 'localResourceReferences', 'credentialKeys', 'lastVerifiedAt'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Local binding contains an unknown field: ${key}`)
  if (!Array.isArray(value.credentialKeys) || value.credentialKeys.length > 64) throw new Error('Local binding credential keys are invalid.')
  const credentialKeys = value.credentialKeys.map((key) => safeText(key, 'Credential key', 256))
  const result: LocalNodeBinding = {
    nodeId: safeText(value.nodeId, 'Local binding node id', 128),
    bindingVersion: 1,
    providerOrHostIdentity: safeText(value.providerOrHostIdentity, 'Local binding identity', 512),
    localResourceReferences: safeRecord(value.localResourceReferences, 'Local resource references'),
    credentialKeys
  }
  if (value.lastVerifiedAt !== undefined) {
    if (typeof value.lastVerifiedAt !== 'number' || !Number.isSafeInteger(value.lastVerifiedAt) || value.lastVerifiedAt < 0) throw new Error('Local binding verification time is invalid.')
    result.lastVerifiedAt = value.lastVerifiedAt
  }
  return result
}

/** Return every route with an explicit disabled reason instead of hiding unavailable choices. */
export function bindingActionStates(
  blueprint: PortableNodeBlueprint,
  context: PortableBindingContext
): PortableBindingActionState[] {
  validatePortableNodeBlueprint(blueprint)
  return [
    { action: 'configure', enabled: context.canConfigure, reason: context.canConfigure ? undefined : 'Configuration is unavailable on this surface.' },
    { action: 'rebind', enabled: context.hasBinding && context.hasMatchingResource, reason: context.hasBinding ? (context.hasMatchingResource ? undefined : 'No matching local resource was verified.') : 'This node has no local binding yet.' },
    { action: 'adopt', enabled: !context.hasBinding && context.hasMatchingResource, reason: context.hasMatchingResource ? (context.hasBinding ? 'A local binding already owns this node.' : undefined) : 'No matching resource was verified for adoption.' },
    { action: 'deploy', enabled: context.canDeploy, reason: context.canDeploy ? undefined : 'Deployment is unavailable until a local provider is configured.' },
    { action: 'locate-asset', enabled: context.hasMissingAssets, reason: context.hasMissingAssets ? undefined : 'This node has no unresolved portable assets.' },
    { action: 'leave-unbound', enabled: true }
  ]
}

export function bindingActionLabel(action: PortableBindingAction): string {
  return ACTION_LABELS[action]
}

export interface BindingProgressEvent {
  phase: PortableBindingWizardState['phase']
  progress: number
  message: string
}

export interface BindingActionRunnerOptions {
  signal?: AbortSignal
  onProgress?: (event: BindingProgressEvent) => void
  apply?: (action: PortableBindingAction, signal: AbortSignal) => Promise<void>
}

/** Run one explicit binding action with cancellation and truthful progress. Import never calls it. */
export async function runPortableBindingAction(action: PortableBindingAction, options: BindingActionRunnerOptions = {}): Promise<PortableBindingWizardState> {
  const controller = new AbortController()
  const signal = options.signal ?? controller.signal
  const emit = (phase: PortableBindingWizardState['phase'], progress: number, message: string): void => options.onProgress?.({ phase, progress, message })
  try {
    emit('preflight', 0.05, `Checking ${bindingActionLabel(action)}.`)
    if (signal.aborted) return { phase: 'cancelled', action, progress: 0, message: 'The binding action was cancelled before it changed anything.', cancellable: false }
    emit('staging', 0.25, 'Preparing a private local binding record; no provider or process has been changed.')
    if (signal.aborted) return { phase: 'cancelled', action, progress: 0.25, message: 'The binding action was cancelled before publication.', cancellable: false }
    if (action !== 'leave-unbound' && options.apply) await options.apply(action, signal)
    if (signal.aborted) return { phase: 'cancelled', action, progress: 0.5, message: 'The binding action was cancelled; the prior binding remains active.', cancellable: false }
    emit('completed', 1, action === 'leave-unbound' ? 'The project remains unbound on this machine.' : `${bindingActionLabel(action)} is ready.`)
    return { phase: 'completed', action, progress: 1, message: action === 'leave-unbound' ? 'The project remains unbound on this machine.' : `${bindingActionLabel(action)} is ready.`, cancellable: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit('failed', 0, message)
    return { phase: 'failed', action, progress: 0, message, cancellable: false, error: message }
  }
}

/**
 * A private binding store. It stores only opaque local references and credential key names. The
 * JSON file is written atomically and can be replaced as one unit during rollback.
 */
export class LocalNodeBindingStore {
  private readonly file: string
  constructor(private readonly userDataDir: string) {
    this.file = path.join(userDataDir, 'portable-node-bindings.json')
  }

  async load(): Promise<Record<string, LocalNodeBinding>> {
    let parsed: unknown
    try {
      const bytes = await fs.readFile(this.file)
      if (bytes.length > MAX_BINDING_FILE_BYTES) throw new Error('The local binding record exceeds its byte limit.')
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return {}
      if (error instanceof Error && error.message.includes('byte limit')) throw error
      throw new Error('The local binding record is unreadable; no binding was applied.')
    }
    if (!record(parsed)) throw new Error('The local binding record is invalid; no binding was applied.')
    const out: Record<string, LocalNodeBinding> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!SAFE_KEY.test(key)) throw new Error('The local binding record contains an unsafe key.')
      out[key] = validateLocalNodeBinding(value)
    }
    return out
  }

  async replace(bindings: Record<string, LocalNodeBinding>): Promise<void> {
    const clean: Record<string, LocalNodeBinding> = {}
    for (const [key, value] of Object.entries(bindings)) {
      if (!SAFE_KEY.test(key)) throw new Error('The local binding key is invalid.')
      clean[key] = validateLocalNodeBinding(value)
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(clean, null, 2) + '\n')
  }

  async apply(nodeId: string, binding: LocalNodeBinding): Promise<void> {
    const before = await this.load()
    const next = { ...before, [nodeId]: validateLocalNodeBinding({ ...binding, nodeId }) }
    await this.replace(next)
  }

  async remove(nodeId: string): Promise<void> {
    const before = await this.load()
    if (!(nodeId in before)) return
    const next = { ...before }
    delete next[nodeId]
    await this.replace(next)
  }

  /** Snapshot and restore make a failed explicit action recoverable without touching a provider. */
  async snapshot(): Promise<{ id: string; bindings: Record<string, LocalNodeBinding> }> {
    return { id: randomUUID(), bindings: await this.load() }
  }

  async restore(snapshot: { bindings: Record<string, LocalNodeBinding> }): Promise<void> {
    await this.replace(snapshot.bindings)
  }
}
