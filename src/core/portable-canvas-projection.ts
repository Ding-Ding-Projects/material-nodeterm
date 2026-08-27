/**
 * Platform-free projection of a live project into the schema 3 project.json payload.
 *
 * This is deliberately a projection, not a hydration or deployment mechanism.  It keeps
 * canvas presentation and user-authored intent while excluding machine, process, credential,
 * provider, and network state.  Archive writers and importers can use the bytes without this
 * module acquiring filesystem or host capabilities.
 */

import type { BridgeLink, CanvasNodeState, Project, Viewport, NodeKind } from '../shared/types'
import { PortableProjectV3Error, PORTABLE_PROJECT_SCHEMA, PORTABLE_PROJECT_SCHEMA_VERSION } from './portable-project-v3'
import { sanitizeProjectIcon } from '../shared/project-icon'
import type { PortableMediaManifest } from './portable-media-assets'
import { validatePortableMediaManifest } from './portable-media-assets'
import { repairUniverseShops } from './universe-shop'
import {
  plannerDefinitionsToPortable,
  validatePortablePlannerDefinitions,
  type PortablePlannerDefinitions
} from './portable-planner'
import type { PlannerSchedule } from '../shared/planner-occurrences'

export type PortableCanvasScope = 'root' | 'multiverse' | 'aws-universe'

export interface PortableCanvasV3 {
  id: string
  scope: PortableCanvasScope
  parentCanvasId?: string
  /** Persisted depth from the root, with root = 0. AWS depth is bounded by canvas count only. */
  depth?: number
  title: string
  order: number
  viewport?: Viewport
  nodeIds: string[]
}

export interface PortableCanvasNodeV3 {
  id: string
  kind: string
  creationEventId?: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  title: string
  color: string
  group: string | null
  /** Safe ownership metadata for a node inside a special-universe child canvas. */
  universeCanvasId?: string
  universeScope?: 'multiverse' | 'aws-universe'
  universeDepth?: number
  nonDeletable?: boolean
  shopSelection?: string
  collapsed?: boolean
  parentId?: string
  tags?: string[]
  text?: string
  url?: string
  browserTabs?: Array<{ id: string; url?: string; title: string }>
  serviceLabel?: string
  alarmSchedule?: { recurrence: string; date?: string; time: string; weekdays?: number[]; monthDay?: number }
  alarmTimeZone?: string
  alarmEnabled?: boolean
  alarmSnoozeMinutes?: number
  alarmSoundEnabled?: boolean
  alarmNarratorEnabled?: boolean
  alarmHistory?: Array<{ id: string; alarmId: string; scheduledAt: number; status: string; createdAt: number; resolvedAt?: number; snoozedUntil?: number; timeZone: string }>
}

export interface PortableRelationshipV3 {
  id: string
  kind: 'bridge' | 'rope'
  source: string
  target: string
  order: number
}

export interface PortableProjectDisplayV3 {
  name: string
  color: string
  icon?: { type: string; name: string }
}

export interface PortableCanvasProjectionV3 {
  format: typeof PORTABLE_PROJECT_SCHEMA
  schemaVersion: typeof PORTABLE_PROJECT_SCHEMA_VERSION
  project: PortableProjectDisplayV3
  rootCanvasId: string
  canvases: PortableCanvasV3[]
  nodes: PortableCanvasNodeV3[]
  relationships: PortableRelationshipV3[]
  appearance?: Record<string, unknown>
  media?: PortableMediaManifest
  /** Safe schedule intent only. Occurrences and host state stay machine-local. */
  planner?: PortablePlannerDefinitions
}

export interface PortableCanvasProjectionInput {
  /** Future child canvases may be supplied without changing the root Project type. */
  canvases?: Array<Omit<PortableCanvasV3, 'nodeIds'> & { nodeIds?: string[] }>
  appearance?: Record<string, unknown>
  /** Project-owned media manifest. Source paths and machine bindings are intentionally absent. */
  media?: PortableMediaManifest
  /** User-authored planner definitions to carry in the portable projection. */
  planner?: readonly PlannerSchedule[]
}

export const PORTABLE_CANVAS_LIMITS = {
  maxCanvases: 4096,
  maxNodes: 20_000,
  maxRelationships: 40_000,
  maxDepth: 8,
  maxStringBytes: 256 * 1024,
  maxJsonBytes: 16 * 1024 * 1024
} as const

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const ALLOWED_TOP = new Set(['format', 'schemaVersion', 'project', 'rootCanvasId', 'canvases', 'nodes', 'relationships', 'appearance', 'media', 'planner'])
const ALLOWED_PROJECT = new Set(['name', 'color', 'icon'])
const ALLOWED_ICON = new Set(['type', 'name'])
const ALLOWED_CANVAS = new Set(['id', 'scope', 'parentCanvasId', 'depth', 'title', 'order', 'viewport', 'nodeIds'])
const ALLOWED_VIEWPORT = new Set(['x', 'y', 'zoom'])
const ALLOWED_NODE = new Set(['id', 'kind', 'creationEventId', 'position', 'size', 'title', 'color', 'group', 'universeCanvasId', 'universeScope', 'universeDepth', 'nonDeletable', 'shopSelection', 'collapsed', 'parentId', 'tags', 'text', 'url', 'browserTabs', 'serviceLabel', 'alarmSchedule', 'alarmTimeZone', 'alarmEnabled', 'alarmSnoozeMinutes', 'alarmSoundEnabled', 'alarmNarratorEnabled', 'alarmHistory'])
const ALLOWED_POSITION = new Set(['x', 'y'])
const ALLOWED_SIZE = new Set(['width', 'height'])
const ALLOWED_TAB = new Set(['id', 'url', 'title'])
const ALLOWED_ALARM_SCHEDULE = new Set(['recurrence', 'date', 'time', 'weekdays', 'monthDay'])
const ALLOWED_ALARM_OCCURRENCE = new Set(['id', 'alarmId', 'scheduledAt', 'status', 'createdAt', 'resolvedAt', 'snoozedUntil', 'timeZone'])
const ALLOWED_RELATIONSHIP = new Set(['id', 'kind', 'source', 'target', 'order'])
const ALLOWED_APPEARANCE = new Set(['theme', 'density', 'seedColor', 'fontFamily', 'fontSize', 'fontWeight', 'motion'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) if (UNSAFE_KEYS.has(key) || !allowed.has(key)) throw new PortableProjectV3Error('manifest', `Portable ${label} contains an unknown key: ${key}`)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).byteLength > PORTABLE_CANVAS_LIMITS.maxStringBytes) {
    throw new PortableProjectV3Error('manifest', `Portable ${label} is empty or exceeds its UTF-8 bound.`)
  }
  return value
}

function content(value: unknown, label: string): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > PORTABLE_CANVAS_LIMITS.maxStringBytes) throw new PortableProjectV3Error('manifest', `Portable ${label} exceeds its UTF-8 bound.`)
  return value
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) {
    throw new PortableProjectV3Error('manifest', `Portable ${label} is not a bounded number.`)
  }
  return value
}

function safeAppearance(value: unknown, depth = 0, seen = { count: 0 }): unknown {
  if (++seen.count > PORTABLE_CANVAS_LIMITS.maxNodes || depth > PORTABLE_CANVAS_LIMITS.maxDepth) {
    throw new PortableProjectV3Error('manifest', 'Portable appearance exceeds its bounds.')
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return finite(value, 'appearance value')
  if (Array.isArray(value)) return value.map((item) => safeAppearance(item, depth + 1, seen))
  if (!record(value)) throw new PortableProjectV3Error('manifest', 'Portable appearance contains an unsafe value.')
  const out: Record<string, unknown> = {}
  exactKeys(value, ALLOWED_APPEARANCE, 'appearance')
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (['theme', 'density', 'fontFamily', 'motion'].includes(key) && typeof item !== 'string') throw new PortableProjectV3Error('manifest', `Portable appearance ${key} must be text.`)
    if (['seedColor'].includes(key) && (typeof item !== 'string' || !/^#[0-9a-f]{6,8}$/i.test(item))) throw new PortableProjectV3Error('manifest', 'Portable appearance seedColor is invalid.')
    if (['fontSize', 'fontWeight'].includes(key) && (typeof item !== 'number' || !Number.isFinite(item))) throw new PortableProjectV3Error('manifest', `Portable appearance ${key} must be numeric.`)
    out[text(key, 'appearance key')] = safeAppearance(item, depth + 1, seen)
  }
  return out
}

function projectNode(node: CanvasNodeState, strict = false): PortableCanvasNodeV3 {
  if (!record(node)) throw new PortableProjectV3Error('manifest', 'Portable node is not an object.')
  if (strict) exactKeys(node, ALLOWED_NODE, 'node')
  if (!record(node.position)) throw new PortableProjectV3Error('manifest', 'Portable node position is invalid.')
  exactKeys(node.position, ALLOWED_POSITION, 'node position')
  if (!record(node.size)) throw new PortableProjectV3Error('manifest', 'Portable node size is invalid.')
  exactKeys(node.size, ALLOWED_SIZE, 'node size')
  const out: PortableCanvasNodeV3 = {
    id: text(node.id, 'node id'), kind: text(node.kind, 'node kind'),
    position: { x: finite(node.position.x, 'node x'), y: finite(node.position.y, 'node y') },
    size: { width: finite(node.size.width, 'node width'), height: finite(node.size.height, 'node height') },
    title: text(node.title, 'node title'), color: text(node.color, 'node color'), group: node.group === null ? null : text(node.group, 'node group')
  }
  if (node.creationEventId !== undefined) out.creationEventId = text(node.creationEventId, 'creation event id')
  if (strict && node.creationEventId !== undefined && (typeof node.creationEventId !== 'string' || node.creationEventId.length > 256)) throw new PortableProjectV3Error('manifest', 'Portable creation event id is invalid.')
  if (node.creationEventId !== undefined) out.creationEventId = text(node.creationEventId, 'creation event id')
  if (strict && node.universeCanvasId !== undefined && typeof node.universeCanvasId !== 'string') throw new PortableProjectV3Error('manifest', 'Portable universe canvas id is invalid.')
  if (strict && node.universeScope !== undefined && !['multiverse', 'aws-universe'].includes(String(node.universeScope))) throw new PortableProjectV3Error('manifest', 'Portable universe scope is invalid.')
  if (strict && node.universeDepth !== undefined && (typeof node.universeDepth !== 'number' || !Number.isInteger(node.universeDepth) || node.universeDepth < 0 || node.universeDepth > PORTABLE_CANVAS_LIMITS.maxCanvases)) throw new PortableProjectV3Error('manifest', 'Portable universe depth is invalid.')
  if (strict && node.nonDeletable !== undefined && typeof node.nonDeletable !== 'boolean') throw new PortableProjectV3Error('manifest', 'Portable non-deletable marker is invalid.')
  if (strict && node.shopSelection !== undefined && typeof node.shopSelection !== 'string') throw new PortableProjectV3Error('manifest', 'Portable Shop selection is invalid.')
  if (strict && typeof node.collapsed !== 'undefined' && typeof node.collapsed !== 'boolean') throw new PortableProjectV3Error('manifest', 'Portable node collapsed state is invalid.')
  if (strict && node.group !== null && typeof node.group !== 'string') throw new PortableProjectV3Error('manifest', 'Portable node group is invalid.')
  if (strict && node.tags !== undefined && !Array.isArray(node.tags)) throw new PortableProjectV3Error('manifest', 'Portable node tags must be an array.')
  if (strict && node.parentId !== undefined && typeof node.parentId !== 'string') throw new PortableProjectV3Error('manifest', 'Portable node parent is invalid.')
  if (strict && node.text !== undefined && typeof node.text !== 'string') throw new PortableProjectV3Error('manifest', 'Portable node text is invalid.')
  if (strict && node.serviceLabel !== undefined && typeof node.serviceLabel !== 'string') throw new PortableProjectV3Error('manifest', 'Portable service label is invalid.')
  if (strict && node.browserTabs !== undefined && !Array.isArray(node.browserTabs)) throw new PortableProjectV3Error('manifest', 'Portable browser tabs must be an array.')
  if (node.collapsed !== undefined) out.collapsed = node.collapsed
  if (node.universeCanvasId !== undefined) out.universeCanvasId = text(node.universeCanvasId, 'universe canvas id')
  if (node.universeScope !== undefined) out.universeScope = node.universeScope
  if (node.universeDepth !== undefined) out.universeDepth = finite(node.universeDepth, 'universe depth')
  if (node.nonDeletable !== undefined) out.nonDeletable = node.nonDeletable
  if (node.shopSelection !== undefined) out.shopSelection = content(node.shopSelection, 'Shop selection')
  if (node.parentId !== undefined) out.parentId = text(node.parentId, 'parent id')
  if (node.tags !== undefined) { if (node.tags.length > 1024) throw new PortableProjectV3Error('entry-limit', 'Portable tag count exceeds its bound.'); out.tags = node.tags.map((tag) => text(tag, 'node tag')).sort() }
  if (node.text !== undefined) out.text = content(node.text, 'node text')
  if (node.url !== undefined) { const url = safeUrl(node.url, 'node URL'); if (url) out.url = url }
  if (node.serviceLabel !== undefined) out.serviceLabel = text(node.serviceLabel, 'service label')
  if (node.alarmSchedule !== undefined) {
    if (!record(node.alarmSchedule)) throw new PortableProjectV3Error('manifest', 'Portable alarm schedule is invalid.')
    exactKeys(node.alarmSchedule, ALLOWED_ALARM_SCHEDULE, 'alarm schedule')
    if (!['once', 'daily', 'weekdays', 'weekly', 'monthly'].includes(node.alarmSchedule.recurrence as string) || typeof node.alarmSchedule.time !== 'string') throw new PortableProjectV3Error('manifest', 'Portable alarm schedule recurrence or time is invalid.')
    const schedule = { recurrence: text(node.alarmSchedule.recurrence, 'alarm recurrence'), time: text(node.alarmSchedule.time, 'alarm time'), ...(node.alarmSchedule.date === undefined ? {} : { date: text(node.alarmSchedule.date, 'alarm date') }), ...(node.alarmSchedule.weekdays === undefined ? {} : { weekdays: node.alarmSchedule.weekdays.map((day) => finite(day, 'alarm weekday')) }), ...(node.alarmSchedule.monthDay === undefined ? {} : { monthDay: finite(node.alarmSchedule.monthDay, 'alarm month day') }) }
    out.alarmSchedule = schedule
  }
  if (node.alarmTimeZone !== undefined) out.alarmTimeZone = text(node.alarmTimeZone, 'alarm timezone')
  for (const key of ['alarmEnabled', 'alarmSoundEnabled', 'alarmNarratorEnabled'] as const) {
    if (node[key] !== undefined && typeof node[key] !== 'boolean') throw new PortableProjectV3Error('manifest', `Portable ${key} must be boolean.`)
    if (node[key] !== undefined) out[key] = node[key]
  }
  if (node.alarmSnoozeMinutes !== undefined) out.alarmSnoozeMinutes = finite(node.alarmSnoozeMinutes, 'alarm snooze minutes')
  if (node.alarmHistory !== undefined) {
    if (!Array.isArray(node.alarmHistory) || node.alarmHistory.length > 1000) throw new PortableProjectV3Error('entry-limit', 'Portable alarm history exceeds its bound.')
    out.alarmHistory = node.alarmHistory.map((occurrence) => {
      if (!record(occurrence)) throw new PortableProjectV3Error('manifest', 'Portable alarm occurrence is invalid.')
      exactKeys(occurrence, ALLOWED_ALARM_OCCURRENCE, 'alarm occurrence')
      const value = { id: text(occurrence.id, 'alarm occurrence id'), alarmId: text(occurrence.alarmId, 'alarm id'), scheduledAt: finite(occurrence.scheduledAt, 'alarm scheduled time'), status: text(occurrence.status, 'alarm occurrence status'), createdAt: finite(occurrence.createdAt, 'alarm occurrence creation time'), timeZone: text(occurrence.timeZone, 'alarm occurrence timezone'), ...(occurrence.resolvedAt === undefined ? {} : { resolvedAt: finite(occurrence.resolvedAt, 'alarm resolved time') }), ...(occurrence.snoozedUntil === undefined ? {} : { snoozedUntil: finite(occurrence.snoozedUntil, 'alarm snooze time') }) }
      return value
    })
  }
  if (node.browserTabs !== undefined) {
    if (node.browserTabs.length > 1024) throw new PortableProjectV3Error('entry-limit', 'Portable browser tab count exceeds its bound.')
    out.browserTabs = node.browserTabs.map((tab) => { if (!record(tab)) throw new PortableProjectV3Error('manifest', 'Portable browser tab is invalid.'); exactKeys(tab, ALLOWED_TAB, 'browser tab'); const url = safeUrl(tab.url, 'browser tab URL'); return { id: text(tab.id, 'browser tab id'), ...(url ? { url } : {}), title: content(tab.title, 'browser tab title') } })
  }
  return out
}

function safeUrl(value: unknown, label: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if ([...value].some((char) => char < ' ' || char === '\u007f')) throw new PortableProjectV3Error('manifest', `Portable ${label} contains control characters.`)
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new PortableProjectV3Error('manifest', `Portable ${label} is not an absolute HTTP URL.`) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new PortableProjectV3Error('manifest', `Portable ${label} must use HTTP(S) without credentials.`)
  return parsed.href
}

function relationships(project: Project): PortableRelationshipV3[] {
  const all: PortableRelationshipV3[] = []
  const append = (kind: 'bridge' | 'rope', links: BridgeLink[] | undefined) => links?.forEach((link, order) => all.push({ id: text(link.id, 'relationship id'), kind, source: text(link.source, 'relationship source'), target: text(link.target, 'relationship target'), order }))
  append('bridge', project.bridges)
  append('rope', project.ropes)
  return all.sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order || a.id.localeCompare(b.id)).map((link, order) => ({ ...link, order }))
}

/** Project only the portable presentation and safe intent fields. Forbidden live fields are never read. */
export function projectToPortableCanvasV3(project: Project, input: PortableCanvasProjectionInput = {}): PortableCanvasProjectionV3 {
  const nodes = project.nodes.map(projectNode).sort((a, b) => a.id.localeCompare(b.id))
  if (nodes.length > PORTABLE_CANVAS_LIMITS.maxNodes) throw new PortableProjectV3Error('entry-limit', 'Portable node count exceeds its bound.')
  const root: PortableCanvasV3 = { id: 'root', scope: 'root', title: text(project.name, 'project name'), order: 0, viewport: project.viewport, nodeIds: nodes.map((node) => node.id) }
  const children = (input.canvases ?? []).map((canvas) => ({ id: text(canvas.id, 'canvas id'), scope: canvas.scope, ...(canvas.parentCanvasId ? { parentCanvasId: text(canvas.parentCanvasId, 'parent canvas id') } : {}), ...(canvas.depth !== undefined ? { depth: finite(canvas.depth, 'canvas depth') } : {}), title: text(canvas.title, 'canvas title'), order: finite(canvas.order, 'canvas order'), ...(canvas.viewport ? { viewport: { x: finite(canvas.viewport.x, 'viewport x'), y: finite(canvas.viewport.y, 'viewport y'), zoom: finite(canvas.viewport.zoom, 'viewport zoom') } } : {}), nodeIds: [...(canvas.nodeIds ?? [])].map((id) => text(id, 'canvas node id')).sort() }))
  if (children.length + 1 > PORTABLE_CANVAS_LIMITS.maxCanvases) throw new PortableProjectV3Error('entry-limit', 'Portable canvas count exceeds its bound.')
  const canvases = [root, ...children].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const icon = project.icon && sanitizeProjectIcon(project.icon)
  const portableIcon = icon?.type === 'emoji' ? { type: icon.type, name: icon.emoji } : icon ? { type: icon.type, name: icon.name } : undefined
  const media = input.media === undefined ? undefined : validatePortableMediaManifest(input.media)
  const planner = input.planner === undefined ? undefined : plannerDefinitionsToPortable(input.planner)
  const result: PortableCanvasProjectionV3 = { format: PORTABLE_PROJECT_SCHEMA, schemaVersion: PORTABLE_PROJECT_SCHEMA_VERSION, project: { name: text(project.name, 'project name'), color: text(project.color, 'project color'), ...(portableIcon ? { icon: portableIcon } : {}) }, rootCanvasId: 'root', canvases, nodes, relationships: relationships(project), ...(input.appearance ? { appearance: safeAppearance(input.appearance) as Record<string, unknown> } : {}), ...(media ? { media } : {}), ...(planner ? { planner } : {}) }
  if (result.relationships.length > PORTABLE_CANVAS_LIMITS.maxRelationships) throw new PortableProjectV3Error('entry-limit', 'Portable relationship count exceeds its bound.')
  return repairUniverseShops(validatePortableCanvasProjectionV3(result)).projection
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!record(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

export function serializePortableCanvasProjectionV3(value: PortableCanvasProjectionV3): Uint8Array {
  const validated = validatePortableCanvasProjectionV3(value)
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(validated)))
  if (bytes.byteLength > PORTABLE_CANVAS_LIMITS.maxJsonBytes) throw new PortableProjectV3Error('raw-limit', 'Portable project.json exceeds its byte bound.')
  return bytes
}

export function validatePortableCanvasProjectionV3(value: unknown): PortableCanvasProjectionV3 {
  if (!record(value) || value.format !== PORTABLE_PROJECT_SCHEMA || value.schemaVersion !== 3 || !record(value.project) || !Array.isArray(value.canvases) || !Array.isArray(value.nodes) || !Array.isArray(value.relationships)) throw new PortableProjectV3Error('manifest', 'Portable canvas projection has an invalid schema 3 shape.')
  exactKeys(value, ALLOWED_TOP, 'projection')
  exactKeys(value.project, ALLOWED_PROJECT, 'project')
  text(value.project.name, 'project name'); text(value.project.color, 'project color')
  if (!/^#[0-9a-f]{6,8}$/i.test(value.project.color)) throw new PortableProjectV3Error('manifest', 'Portable project color is invalid.')
  let icon: PortableProjectDisplayV3['icon']
  if (value.project.icon !== undefined) {
    if (!record(value.project.icon)) throw new PortableProjectV3Error('manifest', 'Portable icon is invalid.')
    exactKeys(value.project.icon, ALLOWED_ICON, 'icon')
    text(value.project.icon.type, 'icon type'); text(value.project.icon.name, 'icon name')
    const candidate = value.project.icon.type === 'emoji' ? { type: 'emoji' as const, emoji: value.project.icon.name } : value.project.icon.type === 'material-symbol' ? { type: 'material-symbol' as const, name: value.project.icon.name } : undefined
    if (!candidate || !sanitizeProjectIcon(candidate)) throw new PortableProjectV3Error('manifest', 'Portable icon is not an allowed icon.')
    icon = { type: candidate.type, name: candidate.type === 'emoji' ? candidate.emoji : candidate.name }
  }
  text(value.rootCanvasId, 'root canvas id')
  if (value.canvases.length > PORTABLE_CANVAS_LIMITS.maxCanvases || value.nodes.length > PORTABLE_CANVAS_LIMITS.maxNodes || value.relationships.length > PORTABLE_CANVAS_LIMITS.maxRelationships) throw new PortableProjectV3Error('entry-limit', 'Portable canvas projection exceeds its bounds.')
  const ids = new Set<string>()
  const normalizedNodes: PortableCanvasNodeV3[] = []
  for (const node of value.nodes) {
    if (!record(node)) throw new PortableProjectV3Error('manifest', 'Portable node is not an object.')
    const id = text(node.id, 'node id')
    if (ids.has(id)) throw new PortableProjectV3Error('manifest', `Duplicate portable node: ${id}`)
    ids.add(id)
    normalizedNodes.push(projectNode(node as CanvasNodeState, true))
  }
  for (const node of value.nodes) if (node.parentId !== undefined && (!ids.has(node.parentId) || node.parentId === node.id)) throw new PortableProjectV3Error('manifest', 'Portable node parent is missing or self-referential.')
  const canvasIds = new Set<string>(); const normalizedCanvases: PortableCanvasV3[] = []
  for (const canvas of value.canvases) {
    if (!record(canvas)) throw new PortableProjectV3Error('manifest', 'Portable canvas is not an object.')
    exactKeys(canvas, ALLOWED_CANVAS, 'canvas')
    const id = text(canvas.id, 'canvas id')
    if (canvasIds.has(id)) throw new PortableProjectV3Error('manifest', `Duplicate portable canvas: ${id}`)
    canvasIds.add(id)
    if (!['root', 'multiverse', 'aws-universe'].includes(String(canvas.scope))) throw new PortableProjectV3Error('manifest', 'Portable canvas scope is invalid.')
    if (!Array.isArray(canvas.nodeIds)) throw new PortableProjectV3Error('manifest', 'Portable canvas nodeIds must be an array.')
    canvas.nodeIds.forEach((nodeId) => text(nodeId, 'canvas node id'))
    const members = new Set<string>()
    canvas.nodeIds.forEach((nodeId) => { if (members.has(nodeId)) throw new PortableProjectV3Error('manifest', `Duplicate node in canvas: ${nodeId}`); members.add(nodeId); if (!ids.has(nodeId)) throw new PortableProjectV3Error('manifest', `Canvas references an unknown node: ${nodeId}`) })
    if (canvas.parentCanvasId !== undefined) text(canvas.parentCanvasId, 'parent canvas id')
    if (canvas.viewport !== undefined) { if (!record(canvas.viewport)) throw new PortableProjectV3Error('manifest', 'Portable viewport is invalid.'); exactKeys(canvas.viewport, ALLOWED_VIEWPORT, 'viewport'); finite(canvas.viewport.x, 'viewport x'); finite(canvas.viewport.y, 'viewport y'); finite(canvas.viewport.zoom, 'viewport zoom') }
    if (typeof canvas.title !== 'string') throw new PortableProjectV3Error('manifest', 'Portable canvas title is invalid.')
    text(canvas.title, 'canvas title'); finite(canvas.order, 'canvas order')
    if (canvas.depth !== undefined && (typeof canvas.depth !== 'number' || !Number.isInteger(canvas.depth) || canvas.depth < 0 || canvas.depth > PORTABLE_CANVAS_LIMITS.maxCanvases)) throw new PortableProjectV3Error('manifest', 'Portable canvas depth is invalid.')
    normalizedCanvases.push({ id, scope: canvas.scope as PortableCanvasScope, ...(canvas.parentCanvasId !== undefined ? { parentCanvasId: text(canvas.parentCanvasId, 'parent canvas id') } : {}), ...(canvas.depth !== undefined ? { depth: canvas.depth } : {}), title: canvas.title, order: canvas.order, ...(canvas.viewport ? { viewport: { x: canvas.viewport.x, y: canvas.viewport.y, zoom: canvas.viewport.zoom } } : {}), nodeIds: [...canvas.nodeIds] })
  }
  const roots = value.canvases.filter((canvas) => canvas.scope === 'root')
  if (roots.length !== 1 || roots[0].id !== value.rootCanvasId || roots[0].parentCanvasId !== undefined) throw new PortableProjectV3Error('manifest', 'Portable projection must contain exactly one parentless root canvas.')
  const canvasById = new Map(value.canvases.map((canvas) => [canvas.id, canvas]))
  for (const canvas of value.canvases) {
    if (canvas.scope !== 'root' && canvas.parentCanvasId === undefined) throw new PortableProjectV3Error('manifest', 'Child canvases require a parent canvas.')
    if (canvas.parentCanvasId !== undefined && (!canvasById.has(canvas.parentCanvasId) || canvas.parentCanvasId === canvas.id)) throw new PortableProjectV3Error('manifest', 'Portable canvas parent is missing or self-referential.')
    let current: string | undefined = canvas.id
    const seenParents = new Set<string>()
    let depth = 0
    while (current !== undefined) {
      if (seenParents.has(current)) throw new PortableProjectV3Error('manifest', 'Portable canvas hierarchy contains a cycle.')
      seenParents.add(current)
      const item = canvasById.get(current)
      current = item?.parentCanvasId
      if (current !== undefined && ++depth > PORTABLE_CANVAS_LIMITS.maxDepth) throw new PortableProjectV3Error('manifest', 'Portable canvas hierarchy exceeds its depth bound.')
    }
    const measuredDepth = canvas.scope === 'root' ? 0 : (() => {
      let value = 0
      let parent = canvas.parentCanvasId
      while (parent !== undefined) { value += 1; parent = canvasById.get(parent)?.parentCanvasId }
      return value
    })()
    if (canvas.depth !== undefined && canvas.depth !== measuredDepth) throw new PortableProjectV3Error('manifest', 'Portable canvas depth does not match its containing canvas chain.')
  }
  const membership = new Map<string, number>()
  for (const canvas of value.canvases) for (const nodeId of canvas.nodeIds) membership.set(nodeId, (membership.get(nodeId) ?? 0) + 1)
  for (const node of value.nodes) if (membership.get(node.id) !== 1) throw new PortableProjectV3Error('manifest', `Portable node must belong to exactly one canvas: ${node.id}`)
  for (const link of value.relationships) {
    if (!record(link) || !['bridge', 'rope'].includes(String(link.kind))) throw new PortableProjectV3Error('manifest', 'Portable relationship is invalid.')
    exactKeys(link, ALLOWED_RELATIONSHIP, 'relationship')
    text(link.id, 'relationship id'); text(link.source, 'relationship source'); text(link.target, 'relationship target'); finite(link.order, 'relationship order')
    if (!ids.has(link.source) || !ids.has(link.target)) throw new PortableProjectV3Error('manifest', 'Portable relationship references an unknown node.')
  }
  const relationshipIds = new Set<string>(); const foldedRelationshipIds = new Set<string>()
  for (const link of value.relationships) { const folded = link.id.toLocaleLowerCase('en-US'); if (relationshipIds.has(link.id) || foldedRelationshipIds.has(folded)) throw new PortableProjectV3Error('manifest', `Duplicate or case-colliding relationship: ${link.id}`); relationshipIds.add(link.id); foldedRelationshipIds.add(folded) }
  if (!canvasIds.has(value.rootCanvasId)) throw new PortableProjectV3Error('manifest', 'Portable root canvas is missing.')
  if (value.appearance !== undefined) safeAppearance(value.appearance)
  const normalizedRelationships = value.relationships.map((link) => ({ id: link.id, kind: link.kind as 'bridge' | 'rope', source: link.source, target: link.target, order: link.order }))
  const media = value.media === undefined ? undefined : validatePortableMediaManifest(value.media)
  const planner = value.planner === undefined ? undefined : validatePortablePlannerDefinitions(value.planner)
  return { format: PORTABLE_PROJECT_SCHEMA, schemaVersion: 3, project: { name: value.project.name, color: value.project.color, ...(icon ? { icon } : {}) }, rootCanvasId: value.rootCanvasId, canvases: normalizedCanvases, nodes: normalizedNodes, relationships: normalizedRelationships, ...(value.appearance !== undefined ? { appearance: safeAppearance(value.appearance) as Record<string, unknown> } : {}), ...(media ? { media } : {}), ...(planner ? { planner } : {}) }
}

export function parsePortableCanvasProjectionV3(bytes: Uint8Array): PortableCanvasProjectionV3 {
  if (bytes.byteLength > PORTABLE_CANVAS_LIMITS.maxJsonBytes) throw new PortableProjectV3Error('raw-limit', 'Portable project.json exceeds its byte bound.')
  try {
    const validated = validatePortableCanvasProjectionV3(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    return repairUniverseShops(validated).projection
  } catch (error) { if (error instanceof PortableProjectV3Error) throw error; throw new PortableProjectV3Error('manifest', 'Portable project.json is not valid UTF-8 JSON.') }
}

/**
 * Hydrate a validated projection into a runtime project without granting it any local
 * authority.  The projection deliberately has no cwd, credentials, process state, or provider
 * session, so this function only supplies the caller's fresh runtime id and optional local cwd.
 * Keeping this conversion beside the validator prevents an importer from accidentally reviving
 * fields that the projection never carried.
 */
export function portableCanvasProjectionToProject(
  input: PortableCanvasProjectionV3,
  base: { id: string; cwd?: string } = { id: 'imported-project' }
): Project {
  const value = validatePortableCanvasProjectionV3(input)
  const nodes: CanvasNodeState[] = value.nodes.map((node) => ({
    id: node.id,
    kind: node.kind as NodeKind,
    position: { ...node.position },
    size: { ...node.size },
    title: node.title,
    color: node.color,
    group: node.group,
    ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {}),
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    ...(node.tags ? { tags: [...node.tags] } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.url !== undefined ? { url: node.url } : {}),
    ...(node.browserTabs ? { browserTabs: node.browserTabs.map((tab) => ({ ...tab })) } : {}),
    ...(node.serviceLabel !== undefined ? { serviceLabel: node.serviceLabel } : {})
  }))
  const bridgeLinks = value.relationships
    .filter((link) => link.kind === 'bridge')
    .map((link) => ({ id: link.id, source: link.source, target: link.target }))
  const ropeLinks = value.relationships
    .filter((link) => link.kind === 'rope')
    .map((link) => ({ id: link.id, source: link.source, target: link.target }))
  const icon = value.project.icon
    ? value.project.icon.type === 'emoji'
      ? { type: 'emoji' as const, emoji: value.project.icon.name }
      : { type: 'material-symbol' as const, name: value.project.icon.name }
    : undefined
  return {
    id: base.id,
    name: value.project.name,
    color: value.project.color,
    ...(icon ? { icon } : {}),
    viewport: value.canvases.find((canvas) => canvas.id === value.rootCanvasId)?.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes,
    ...(bridgeLinks.length > 0 ? { bridges: bridgeLinks } : {}),
    ...(ropeLinks.length > 0 ? { ropes: ropeLinks } : {}),
    ...(base.cwd ? { cwd: base.cwd } : {})
  }
}

// Short aliases keep the schema seam convenient for archive callers while the explicit V3 names
// remain available to code that handles more than one portable format.
export const projectToPortableCanvasProjection = projectToPortableCanvasV3
export const serializePortableCanvasProjection = serializePortableCanvasProjectionV3
export const validatePortableCanvasProjection = validatePortableCanvasProjectionV3
export const parsePortableCanvasProjection = parsePortableCanvasProjectionV3
