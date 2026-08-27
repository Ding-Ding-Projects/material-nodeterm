import type { Endpoint, Link, LinkKind } from './types'

/** Version for the typed link payload accepted by the shared project model. */
export const LINK_MODEL_VERSION = 1 as const

/** Resource bounds for project-shared link data. */
export const MAX_PROJECT_LINKS = 2048
export const MAX_LINK_ID_LENGTH = 128
export const MAX_ENDPOINT_COMPONENT_LENGTH = 512
export const MAX_LINK_METADATA_KEYS = 32
export const MAX_LINK_METADATA_DEPTH = 3
export const MAX_LINK_METADATA_BYTES = 8192

const LINK_KINDS: readonly LinkKind[] = ['context', 'lineage', 'dependency']
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/u
const RESERVED_METADATA_KEY = /^(?:token|secret|password|credential|credentials|cwd|path|host|hostname|session|sessionId|process|pid|cache|runtime|executable|command|environment|env)$/iu

export interface LinkValidationContext {
  /** The project whose persisted link list is being checked. */
  ownerProjectId: string
  /** Node ids currently owned by that project. */
  nodeIds: ReadonlySet<string>
}

export type LinkValidationReason =
  | 'invalid-link'
  | 'invalid-endpoint'
  | 'invalid-metadata'
  | 'invalid-kind'
  | 'source-not-owned'
  | 'foreign-source'
  | 'target-not-owned'
  | 'foreign-target-is-local'
  | 'branch-target-requires-dependency'
  | 'self-link'
  | 'duplicate-id'
  | 'too-many-links'

export type LinkValidationResult =
  | { ok: true; link: Link }
  | { ok: false; reason: LinkValidationReason }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined
  if (value.trim() !== value || CONTROL_CHARACTERS.test(value)) return undefined
  return value
}

function safeIdentifier(value: unknown, maxLength: number): string | undefined {
  const text = safeText(value, maxLength)
  if (!text || text.includes('/') || text.includes('\\') || text.includes(':')) return undefined
  return text
}

function portableRepoPath(value: unknown): string | undefined {
  const text = safeText(value, MAX_ENDPOINT_COMPONENT_LENGTH)
  if (!text || text === '/' || text.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(text)) return undefined
  if (text.includes('\\') || text.includes(':')) return undefined
  const parts = text.split('/')
  if (parts.some((part) => part.length === 0 || part === '..')) return undefined
  return text
}

function portableBranch(value: unknown): string | undefined {
  const text = safeText(value, MAX_ENDPOINT_COMPONENT_LENGTH)
  if (!text || text.includes('..') || text.includes('@{') || text.endsWith('/') || text.endsWith('.')) return undefined
  if (/[~^:?*\[\]]/u.test(text)) return undefined
  return text
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return safeText(value, MAX_ENDPOINT_COMPONENT_LENGTH * 2)
  if (depth >= MAX_LINK_METADATA_DEPTH || (!record(value) && !Array.isArray(value))) return undefined
  if (Array.isArray(value)) {
    if (value.length > MAX_LINK_METADATA_KEYS) return undefined
    const out: unknown[] = []
    for (const item of value) {
      const sanitized = sanitizeMetadataValue(item, depth + 1)
      if (sanitized === undefined) return undefined
      out.push(sanitized)
    }
    return out
  }
  const out: Record<string, unknown> = {}
  const keys = Object.keys(value)
  if (keys.length > MAX_LINK_METADATA_KEYS) return undefined
  for (const key of keys) {
    if (!safeText(key, 64) || key === '__proto__' || key === 'constructor' || key === 'prototype' || RESERVED_METADATA_KEY.test(key)) return undefined
    const sanitized = sanitizeMetadataValue(value[key], depth + 1)
    if (sanitized === undefined) return undefined
    out[key] = sanitized
  }
  return out
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!record(value) || Object.keys(value).length > MAX_LINK_METADATA_KEYS) return undefined
  const out = sanitizeMetadataValue(value, 0)
  if (!record(out)) return undefined
  try {
    if (new TextEncoder().encode(JSON.stringify(out)).byteLength > MAX_LINK_METADATA_BYTES) return undefined
  } catch {
    return undefined
  }
  return out
}

/** Parse and bound one endpoint without applying project ownership rules. */
export function sanitizeEndpoint(value: unknown): Endpoint | undefined {
  if (!record(value) || typeof value.ref !== 'string') return undefined
  switch (value.ref) {
    case 'node': {
      if (!hasOnlyKeys(value, ['ref', 'nodeId'])) return undefined
      const nodeId = safeIdentifier(value.nodeId, MAX_ENDPOINT_COMPONENT_LENGTH)
      return nodeId ? { ref: 'node', nodeId } : undefined
    }
    case 'xnode': {
      if (!hasOnlyKeys(value, ['ref', 'projectId', 'nodeId'])) return undefined
      const projectId = safeIdentifier(value.projectId, MAX_ENDPOINT_COMPONENT_LENGTH)
      const nodeId = safeIdentifier(value.nodeId, MAX_ENDPOINT_COMPONENT_LENGTH)
      return projectId && nodeId ? { ref: 'xnode', projectId, nodeId } : undefined
    }
    case 'branch': {
      if (!hasOnlyKeys(value, ['ref', 'repoPath', 'branch'])) return undefined
      const repoPath = portableRepoPath(value.repoPath)
      const branch = portableBranch(value.branch)
      return repoPath && branch ? { ref: 'branch', repoPath, branch } : undefined
    }
    default:
      return undefined
  }
}

/** Parse and bound one typed link, without assuming which project owns it. */
export function sanitizeLink(value: unknown): Link | undefined {
  if (!record(value) || !hasOnlyKeys(value, ['id', 'kind', 'source', 'target', 'meta'])) return undefined
  const id = safeIdentifier(value.id, MAX_LINK_ID_LENGTH)
  const kind = LINK_KINDS.includes(value.kind as LinkKind) ? value.kind as LinkKind : undefined
  const source = sanitizeEndpoint(value.source)
  const target = sanitizeEndpoint(value.target)
  const meta = sanitizeMetadata(value.meta)
  if (!id || !kind || !source || !target || (value.meta !== undefined && !meta)) return undefined
  return { id, kind, source, target, ...(meta ? { meta } : {}) }
}

/**
 * Validate ownership and portability before a link can be persisted in one project's file.
 * The source must be a node owned by that project. Foreign nodes are references only and may
 * appear as targets; they can never become mutation sources. Branch endpoints are portable
 * repository-relative names and are accepted only for dependency links.
 */
export function validateLinkForProject(value: unknown, context: LinkValidationContext): LinkValidationResult {
  const link = sanitizeLink(value)
  if (!link) return { ok: false, reason: 'invalid-link' }
  if (link.source.ref === 'xnode' || link.source.ref === 'branch') return { ok: false, reason: 'foreign-source' }
  if (link.source.ref !== 'node' || !context.nodeIds.has(link.source.nodeId)) return { ok: false, reason: 'source-not-owned' }
  if (link.target.ref === 'node' && !context.nodeIds.has(link.target.nodeId)) return { ok: false, reason: 'target-not-owned' }
  if (link.target.ref === 'xnode' && link.target.projectId === context.ownerProjectId) return { ok: false, reason: 'foreign-target-is-local' }
  if (link.target.ref === 'branch' && link.kind !== 'dependency') return { ok: false, reason: 'branch-target-requires-dependency' }
  if (link.target.ref === 'node' && link.target.nodeId === link.source.nodeId) return { ok: false, reason: 'self-link' }
  return { ok: true, link }
}

/** Validate an entire project-owned link list without partially accepting invalid entries. */
export function validateProjectLinks(value: unknown, context: LinkValidationContext): Link[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_PROJECT_LINKS) return undefined
  const seen = new Set<string>()
  const links: Link[] = []
  for (const candidate of value) {
    const sanitized = sanitizeLink(candidate)
    if (!sanitized || seen.has(sanitized.id)) return undefined
    const result = validateLinkForProject(sanitized, context)
    if (!result.ok) return undefined
    seen.add(sanitized.id)
    links.push(result.link)
  }
  return links
}

/** Read-only ownership predicate for callers that need to refuse foreign mutation. */
export function linkMutationBelongsToProject(link: Link, context: LinkValidationContext): boolean {
  return validateLinkForProject(link, context).ok
}
