import { load as loadYaml } from 'js-yaml'
import { toYamlDocument } from './export/yaml-block'

const MAX_SHAPES = 20_000
const MAX_MEMBERS = 2_000
const MAX_DEPTH = 16
const MAX_COLLECTION_ITEMS = 2_000
const MAX_TEXT = 32_768
const MAX_ADVANCED_BYTES = 2 * 1024 * 1024
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

type JsonRecord = Record<string, unknown>

export type AwsWizardFieldKind =
  | 'text'
  | 'enum'
  | 'boolean'
  | 'number'
  | 'date'
  | 'time'
  | 'date-time'
  | 'file'
  | 'document'
  | 'union'
  | 'structure'
  | 'list'
  | 'map'
  | 'unsupported'

export interface AwsWizardSourceMember {
  name?: string
  shape: string
  required?: boolean
  documentation?: string
  enumValues?: readonly string[]
  min?: number | null
  max?: number | null
}

/** Structural subset of the official model-documentation lane. Keeping this structural lets the
 * two independently releasable lanes compose without either one importing the other's module. */
export interface AwsWizardSourceShape {
  name: string
  type: string
  documentation?: string
  enumValues?: readonly string[]
  min?: number | null
  max?: number | null
  members?: readonly AwsWizardSourceMember[] | Readonly<Record<string, Omit<AwsWizardSourceMember, 'name'>>>
  memberShape?: string | { shape?: string } | null
  keyShape?: string | { shape?: string } | null
  valueShape?: string | { shape?: string } | null
  /** Optional UI hint supplied by a model adapter. AWS timestamps default to date-time. */
  format?: 'date' | 'time' | 'date-time'
}

export interface AwsWizardModelSource {
  serviceId: string
  commandName: string
  inputShape: string | null
  shapes: readonly AwsWizardSourceShape[] | Readonly<Record<string, Omit<AwsWizardSourceShape, 'name'>>>
  /** Whether the installed model declares a paginator for this operation. */
  pagination?: boolean
}

export interface AwsWizardServiceOption {
  id: string
  label: string
  versions: readonly string[]
  commandCount: number
}

export interface AwsWizardCommandOption {
  name: string
  documentation: string
}

export interface AwsWizardModelsApi {
  catalog(): Promise<readonly AwsWizardServiceOption[]>
  commands(serviceId: string): Promise<readonly AwsWizardCommandOption[]>
  source(serviceId: string, commandName: string): Promise<AwsWizardModelSource | null>
}

export interface AwsWizardFieldDefinition {
  id: string
  name: string
  path: readonly string[]
  kind: AwsWizardFieldKind
  required: boolean
  documentation: string
  enumValues: readonly string[]
  min: number | null
  max: number | null
  integer: boolean
  children: readonly AwsWizardFieldDefinition[]
  item: AwsWizardFieldDefinition | null
  mapKey: AwsWizardFieldDefinition | null
  mapValue: AwsWizardFieldDefinition | null
  disabledReason: string | null
}

export interface AwsWizardDefinition {
  schemaVersion: 1
  serviceId: string
  commandName: string
  root: AwsWizardFieldDefinition
}

export interface AwsWizardValidationIssue {
  path: string
  message: string
}

export interface AwsWizardValidationResult {
  ok: boolean
  value: unknown
  issues: AwsWizardValidationIssue[]
}

export interface AwsWizardPortableProjection {
  schemaVersion: 1
  serviceId: string
  commandName: string
  safeIntent: JsonRecord
  omissions: string[]
}

export class AwsWizardError extends Error {
  readonly code: 'invalid-model' | 'bounds' | 'invalid-value' | 'invalid-advanced'

  constructor(code: AwsWizardError['code'], message: string) {
    super(message)
    this.name = 'AwsWizardError'
    this.code = code
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AwsWizardError('invalid-value', `${label} must be an object.`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new AwsWizardError('invalid-value', `${label} must be a plain object.`)
  return value as JsonRecord
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new AwsWizardError('invalid-model', `${label} must be text.`)
  const result = value.trim()
  if (!result || result.length > 256 || [...result].some((character) => character < ' ' || character === '\u007f')) {
    throw new AwsWizardError('invalid-model', `${label} must be a bounded visible identifier.`)
  }
  return result
}

function boundedText(value: unknown, label: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new AwsWizardError('bounds', `${label} exceeds the text limit.`)
  return value
}

function bound(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new AwsWizardError('invalid-model', `${label} must be finite.`)
  return value
}

function boundedPair(min: number | null, max: number | null, label: string): { min: number | null; max: number | null } {
  if (min !== null && max !== null && min > max) throw new AwsWizardError('invalid-model', `${label}.min must not exceed ${label}.max.`)
  return { min, max }
}

function shapeReference(value: string | { shape?: string } | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null
  return identifier(typeof value === 'string' ? value : value.shape, label)
}

function normalizeMembers(
  members: AwsWizardSourceShape['members'],
  label: string
): AwsWizardSourceMember[] {
  if (members === undefined || members === null) return []
  const entries = Array.isArray(members)
    ? members.map((member, index) => [member.name ?? '', member, index] as const)
    : Object.entries(members).map(([name, member], index) => [name, member, index] as const)
  if (entries.length > MAX_MEMBERS) throw new AwsWizardError('bounds', `${label} exceeds ${MAX_MEMBERS} members.`)
  const seen = new Set<string>()
  return entries.map(([rawName, member, index]) => {
    const name = identifier(rawName, `${label}[${index}].name`)
    if (FORBIDDEN_KEYS.has(name)) throw new AwsWizardError('invalid-model', `${label} contains an unsafe member name.`)
    if (seen.has(name)) throw new AwsWizardError('invalid-model', `${label} contains duplicate member ${name}.`)
    seen.add(name)
    if (!member || typeof member !== 'object') throw new AwsWizardError('invalid-model', `${label}.${name} must be a member object.`)
    return {
      ...member,
      name,
      shape: identifier(member.shape, `${label}.${name}.shape`),
      documentation: boundedText(member.documentation, `${label}.${name}.documentation`),
      enumValues: enumValues(member.enumValues, `${label}.${name}.enumValues`),
      min: bound(member.min, `${label}.${name}.min`),
      max: bound(member.max, `${label}.${name}.max`)
    }
  })
}

function enumValues(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_MEMBERS) throw new AwsWizardError('bounds', `${label} exceeds ${MAX_MEMBERS} values.`)
  const seen = new Set<string>()
  return value.map((item, index) => {
    const normalized = identifier(item, `${label}[${index}]`)
    const key = normalized.toLocaleLowerCase()
    if (seen.has(key)) throw new AwsWizardError('invalid-model', `${label} contains a duplicate value.`)
    seen.add(key)
    return normalized
  })
}

function fieldKind(shape: AwsWizardSourceShape): Pick<AwsWizardFieldDefinition, 'kind' | 'integer' | 'disabledReason'> {
  if (shape.enumValues?.length) return { kind: 'enum', integer: false, disabledReason: null }
  if (shape.format && (shape.type === 'string' || shape.type === 'timestamp')) {
    return { kind: shape.format, integer: false, disabledReason: null }
  }
  switch (shape.type) {
    case 'string': return { kind: 'text', integer: false, disabledReason: null }
    case 'boolean': return { kind: 'boolean', integer: false, disabledReason: null }
    case 'byte':
    case 'short':
    case 'integer':
    case 'long':
    case 'bigInteger': return { kind: 'number', integer: true, disabledReason: null }
    case 'float':
    case 'double':
    case 'bigDecimal': return { kind: 'number', integer: false, disabledReason: null }
    case 'timestamp': return { kind: 'date-time', integer: false, disabledReason: null }
    case 'blob': return { kind: 'file', integer: false, disabledReason: null }
    case 'document':
    case 'json': return { kind: 'document', integer: false, disabledReason: null }
    case 'union': return { kind: 'union', integer: false, disabledReason: null }
    case 'structure': return { kind: 'structure', integer: false, disabledReason: null }
    case 'list': return { kind: 'list', integer: false, disabledReason: null }
    case 'set': return { kind: 'list', integer: false, disabledReason: null }
    case 'map': return { kind: 'map', integer: false, disabledReason: null }
    default: return { kind: 'unsupported', integer: false, disabledReason: `The installed model uses unsupported shape type ${shape.type}.` }
  }
}

export function buildAwsWizardDefinition(source: AwsWizardModelSource): AwsWizardDefinition {
  const serviceId = identifier(source.serviceId, 'serviceId')
  const commandName = identifier(source.commandName, 'commandName')
  const shapeEntries = Array.isArray(source.shapes)
    ? source.shapes.map((shape, index) => [shape.name, shape, index] as const)
    : Object.entries(source.shapes).map(([name, shape], index) => [name, { ...shape, name }, index] as const)
  if (shapeEntries.length > MAX_SHAPES) throw new AwsWizardError('bounds', `Model inventory exceeds ${MAX_SHAPES} shapes.`)
  const shapes = new Map<string, AwsWizardSourceShape>()
  for (const [rawName, raw, index] of shapeEntries) {
    if (!raw || typeof raw !== 'object') throw new AwsWizardError('invalid-model', `shapes[${index}] must be an object.`)
    const name = identifier(raw.name ?? rawName, `shapes[${index}].name`)
    if (shapes.has(name)) throw new AwsWizardError('invalid-model', `Model inventory contains duplicate shape ${name}.`)
    const members = normalizeMembers(raw.members, `Shape ${name}.members`)
    const limits = boundedPair(bound(raw.min, `shape ${name}.min`), bound(raw.max, `shape ${name}.max`), `shape ${name}`)
    shapes.set(name, {
      ...raw,
      name,
      type: identifier(raw.type, `shape ${name}.type`),
      documentation: boundedText(raw.documentation, `shape ${name}.documentation`),
      enumValues: enumValues(raw.enumValues, `shape ${name}.enumValues`),
      min: limits.min,
      max: limits.max,
      members,
      memberShape: shapeReference(raw.memberShape, `shape ${name}.memberShape`),
      keyShape: shapeReference(raw.keyShape, `shape ${name}.keyShape`),
      valueShape: shapeReference(raw.valueShape, `shape ${name}.valueShape`)
    })
  }

  const build = (shapeName: string, name: string, path: readonly string[], required: boolean, stack: ReadonlySet<string>, overrides?: AwsWizardSourceMember): AwsWizardFieldDefinition => {
    if (path.length > MAX_DEPTH) throw new AwsWizardError('bounds', `Shape nesting exceeds ${MAX_DEPTH} levels.`)
    const shape = shapes.get(shapeName)
    if (!shape) return {
      id: path.join('.') || 'input', name, path, kind: 'unsupported', required,
      documentation: overrides?.documentation ?? '', enumValues: [], min: null, max: null,
      integer: false, children: [], item: null, mapKey: null, mapValue: null,
      disabledReason: `The installed model references missing shape ${shapeName}.`
    }
    if (stack.has(shapeName)) return {
      id: path.join('.') || 'input', name, path, kind: 'unsupported', required,
      documentation: overrides?.documentation ?? shape.documentation ?? '', enumValues: [], min: null, max: null,
      integer: false, children: [], item: null, mapKey: null, mapValue: null,
      disabledReason: `Recursive shape ${shapeName} cannot be expanded safely in this wizard.`
    }
    const nextStack = new Set(stack).add(shapeName)
    const merged: AwsWizardSourceShape = {
      ...shape,
      documentation: overrides?.documentation || shape.documentation,
      enumValues: overrides?.enumValues?.length ? overrides.enumValues : shape.enumValues,
      min: overrides?.min ?? shape.min,
      max: overrides?.max ?? shape.max
    }
    const kind = fieldKind(merged)
    const members = Array.isArray(shape.members) ? shape.members : []
    const children = (kind.kind === 'structure' || kind.kind === 'union')
      ? members.map((member) => build(member.shape, member.name ?? 'member', [...path, member.name ?? 'member'], Boolean(member.required), nextStack, member))
      : []
    const itemShape = shapeReference(shape.memberShape, `${shapeName}.memberShape`)
    const item = kind.kind === 'list' && itemShape
      ? build(itemShape, `${name} item`, [...path, '$item'], false, nextStack)
      : null
    const keyShape = shapeReference(shape.keyShape, `${shapeName}.keyShape`)
    const mapKey = kind.kind === 'map' && keyShape
      ? build(keyShape, `${name} key`, [...path, '$key'], true, nextStack)
      : null
    const valueShape = shapeReference(shape.valueShape, `${shapeName}.valueShape`)
    const mapValue = kind.kind === 'map' && valueShape
      ? build(valueShape, `${name} value`, [...path, '$value'], false, nextStack)
      : null
    const missingChild = kind.kind === 'list' && !item
      ? 'The installed list model does not identify its item shape.'
      : kind.kind === 'map' && !mapValue
        ? 'The installed map model does not identify its value shape.'
        : kind.disabledReason
    return {
      id: path.join('.') || 'input', name, path, kind: missingChild ? 'unsupported' : kind.kind,
      required, documentation: boundedText(merged.documentation, `${shapeName}.documentation`),
      enumValues: enumValues(merged.enumValues, `${shapeName}.enumValues`),
      min: bound(merged.min, `${shapeName}.min`), max: bound(merged.max, `${shapeName}.max`),
      integer: kind.integer, children, item, mapKey, mapValue, disabledReason: missingChild
    }
  }

  const root = source.inputShape
    ? build(identifier(source.inputShape, 'inputShape'), 'Input', [], true, new Set())
    : {
        id: 'input', name: 'Input', path: [], kind: 'structure' as const, required: true,
        documentation: 'This operation accepts no modeled input.', enumValues: [], min: null, max: null,
        integer: false, children: [], item: null, mapKey: null, mapValue: null, disabledReason: null
      }
  return { schemaVersion: 1, serviceId, commandName, root }
}

function issue(issues: AwsWizardValidationIssue[], path: string, message: string): void {
  issues.push({ path: path || 'input', message })
}

function validateDocument(raw: unknown, issues: AwsWizardValidationIssue[], path: string, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    issue(issues, path, `Document nesting exceeds ${MAX_DEPTH} levels.`)
    return undefined
  }
  if (raw === null || typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) issue(issues, path, 'Document numbers must be finite.')
    return raw
  }
  if (typeof raw === 'string') {
    if (raw.length > MAX_TEXT) issue(issues, path, `Document text exceeds ${MAX_TEXT} characters.`)
    return raw
  }
  if (Array.isArray(raw)) {
    if (raw.length > MAX_COLLECTION_ITEMS) issue(issues, path, `Document lists contain more than ${MAX_COLLECTION_ITEMS} items.`)
    return raw.slice(0, MAX_COLLECTION_ITEMS).map((item, index) => validateDocument(item, issues, `${path}[${index}]`, depth + 1))
  }
  let value: JsonRecord
  try { value = record(raw, 'document') } catch { issue(issues, path, 'Document values must be JSON-compatible.'); return undefined }
  const keys = Object.keys(value)
  if (keys.length > MAX_COLLECTION_ITEMS) issue(issues, path, `Document objects contain more than ${MAX_COLLECTION_ITEMS} fields.`)
  const normalized: JsonRecord = Object.create(null)
  for (const key of keys.slice(0, MAX_COLLECTION_ITEMS)) {
    if (!key || key.length > 256 || FORBIDDEN_KEYS.has(key)) {
      issue(issues, path ? `${path}.${key}` : key, 'Document keys must be bounded safe text.')
      continue
    }
    const next = validateDocument(value[key], issues, path ? `${path}.${key}` : key, depth + 1)
    if (next !== undefined) normalized[key] = next
  }
  return normalized
}

function validateField(field: AwsWizardFieldDefinition, raw: unknown, issues: AwsWizardValidationIssue[], path: string, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    issue(issues, path, `Nesting exceeds ${MAX_DEPTH} levels.`)
    return undefined
  }
  if (raw === undefined || raw === null || raw === '') {
    if (field.required) issue(issues, path, `${field.name} is required.`)
    return raw === '' ? undefined : raw
  }
  switch (field.kind) {
    case 'text':
    case 'enum': {
      if (typeof raw !== 'string') { issue(issues, path, `${field.name} must be text.`); return undefined }
      if (raw.length > MAX_TEXT) issue(issues, path, `${field.name} exceeds ${MAX_TEXT} characters.`)
      if (field.enumValues.length && !field.enumValues.includes(raw)) issue(issues, path, `${field.name} must use one of the modeled choices.`)
      if (field.min !== null && raw.length < field.min) issue(issues, path, `${field.name} must contain at least ${field.min} characters.`)
      if (field.max !== null && raw.length > field.max) issue(issues, path, `${field.name} must contain at most ${field.max} characters.`)
      return raw
    }
    case 'boolean':
      if (typeof raw !== 'boolean') { issue(issues, path, `${field.name} must be on or off.`); return undefined }
      return raw
    case 'number': {
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
      if (!Number.isFinite(value) || (field.integer && !Number.isSafeInteger(value))) { issue(issues, path, `${field.name} must be a valid ${field.integer ? 'whole ' : ''}number.`); return undefined }
      if (field.min !== null && value < field.min) issue(issues, path, `${field.name} must be at least ${field.min}.`)
      if (field.max !== null && value > field.max) issue(issues, path, `${field.name} must be at most ${field.max}.`)
      return value
    }
    case 'date':
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) issue(issues, path, `${field.name} must be a valid date.`)
      return raw
    case 'time':
      if (typeof raw !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw)) issue(issues, path, `${field.name} must be a valid time.`)
      return raw
    case 'date-time':
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) issue(issues, path, `${field.name} must be a valid date and time.`)
      return raw
    case 'file': {
      let value: JsonRecord
      try { value = record(raw, field.name) } catch { issue(issues, path, `${field.name} must be selected through the local file picker.`); return undefined }
      if (value.kind !== 'local-file' || typeof value.path !== 'string' || !value.path) issue(issues, path, `${field.name} must be selected through the local file picker.`)
      return { kind: 'local-file', path: value.path, name: typeof value.name === 'string' ? value.name : '' }
    }
    case 'document':
      return validateDocument(raw, issues, path, depth)
    case 'structure': {
      let value: JsonRecord
      try { value = record(raw, field.name) } catch { issue(issues, path, `${field.name} must be an object.`); return {} }
      const allowed = new Map(field.children.map((child) => [child.name, child]))
      for (const key of Object.keys(value)) if (!allowed.has(key) || FORBIDDEN_KEYS.has(key)) issue(issues, path ? `${path}.${key}` : key, `Unknown field ${key} is not accepted by the installed model.`)
      const normalized: JsonRecord = {}
      for (const child of field.children) {
        const childPath = path ? `${path}.${child.name}` : child.name
        const next = validateField(child, value[child.name], issues, childPath, depth + 1)
        if (next !== undefined) normalized[child.name] = next
      }
      return normalized
    }
    case 'union': {
      let value: JsonRecord
      try { value = record(raw, field.name) } catch { issue(issues, path, `${field.name} must be an object with exactly one choice.`); return {} }
      const allowed = new Map(field.children.map((child) => [child.name, child]))
      const keys = Object.keys(value)
      for (const key of keys) if (!allowed.has(key) || FORBIDDEN_KEYS.has(key)) issue(issues, path ? `${path}.${key}` : key, `Unknown union choice ${key} is not accepted by the installed model.`)
      const selected = keys.filter((key) => allowed.has(key) && !FORBIDDEN_KEYS.has(key) && value[key] !== undefined && value[key] !== null && value[key] !== '')
      if (selected.length !== 1) {
        issue(issues, path, `${field.name} requires exactly one choice.`)
        return {}
      }
      const child = allowed.get(selected[0])!
      const childPath = path ? `${path}.${child.name}` : child.name
      const next = validateField(child, value[child.name], issues, childPath, depth + 1)
      return next === undefined ? {} : { [child.name]: next }
    }
    case 'list': {
      if (!Array.isArray(raw)) { issue(issues, path, `${field.name} must be a list.`); return [] }
      const limit = Math.min(MAX_COLLECTION_ITEMS, field.max ?? MAX_COLLECTION_ITEMS)
      if (raw.length > limit) issue(issues, path, `${field.name} contains more than ${limit} items.`)
      if (field.min !== null && raw.length < field.min) issue(issues, path, `${field.name} needs at least ${field.min} items.`)
      return field.item ? raw.slice(0, limit).map((item, index) => validateField(field.item!, item, issues, `${path}[${index}]`, depth + 1)) : []
    }
    case 'map': {
      let value: JsonRecord
      try { value = record(raw, field.name) } catch { issue(issues, path, `${field.name} must be a map.`); return {} }
      const entries = Object.entries(value)
      const limit = Math.min(MAX_COLLECTION_ITEMS, field.max ?? MAX_COLLECTION_ITEMS)
      if (entries.length > limit) issue(issues, path, `${field.name} contains more than ${limit} entries.`)
      const normalized: JsonRecord = {}
      for (const [key, item] of entries.slice(0, limit)) {
        if (!key || key.length > 256 || FORBIDDEN_KEYS.has(key)) { issue(issues, `${path}.${key}`, 'Map keys must be bounded safe text.'); continue }
        if (field.mapKey) validateField(field.mapKey, key, issues, `${path}.${key} (key)`, depth + 1)
        normalized[key] = field.mapValue ? validateField(field.mapValue, item, issues, `${path}.${key}`, depth + 1) : undefined
      }
      return normalized
    }
    case 'unsupported':
      issue(issues, path, field.disabledReason ?? `${field.name} is not supported.`)
      return undefined
  }
}

export function validateAwsWizardValue(definition: AwsWizardDefinition, raw: unknown): AwsWizardValidationResult {
  const issues: AwsWizardValidationIssue[] = []
  const value = validateField(definition.root, raw, issues, '', 0)
  return { ok: issues.length === 0, value, issues }
}

export function parseAwsWizardAdvanced(definition: AwsWizardDefinition, source: string, format: 'json' | 'yaml'): AwsWizardValidationResult {
  if (new TextEncoder().encode(source).byteLength > MAX_ADVANCED_BYTES) throw new AwsWizardError('bounds', `Advanced input exceeds ${MAX_ADVANCED_BYTES} bytes.`)
  let decoded: unknown
  try {
    decoded = format === 'json' ? JSON.parse(source) : loadYaml(source, { json: true })
  } catch (error) {
    throw new AwsWizardError('invalid-advanced', error instanceof Error ? error.message : `Invalid ${format.toUpperCase()} input.`)
  }
  return validateAwsWizardValue(definition, decoded)
}

export function serializeAwsWizardValue(value: unknown, format: 'json' | 'yaml'): string {
  const root = record(value, 'wizard value')
  return format === 'json' ? `${JSON.stringify(root, null, 2)}\n` : toYamlDocument(root)
}

function portableField(field: AwsWizardFieldDefinition, raw: unknown, path: string, omissions: string[]): unknown {
  if (raw === undefined) return undefined
  if (field.kind === 'file') {
    omissions.push(`${path || field.name}: local file paths and file handles are omitted; choose the file again on the destination computer.`)
    return undefined
  }
  if (field.kind === 'structure' || field.kind === 'union') {
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as JsonRecord : {}
    const out: JsonRecord = {}
    const children = field.kind === 'union' ? field.children.filter((child) => Object.prototype.hasOwnProperty.call(input, child.name)) : field.children
    for (const child of children) {
      const childPath = path ? `${path}.${child.name}` : child.name
      const next = portableField(child, input[child.name], childPath, omissions)
      if (next !== undefined) out[child.name] = next
    }
    return out
  }
  if (field.kind === 'list' && Array.isArray(raw) && field.item) return raw.map((item, index) => portableField(field.item!, item, `${path}[${index}]`, omissions)).filter((item) => item !== undefined)
  if (field.kind === 'map' && raw && typeof raw === 'object' && !Array.isArray(raw) && field.mapValue) {
    return Object.fromEntries(Object.entries(raw as JsonRecord).flatMap(([key, item]) => {
      const next = portableField(field.mapValue!, item, path ? `${path}.${key}` : key, omissions)
      return next === undefined ? [] : [[key, next]]
    }))
  }
  return raw
}

export function projectAwsWizardPortableIntent(definition: AwsWizardDefinition, raw: unknown): AwsWizardPortableProjection {
  const validation = validateAwsWizardValue(definition, raw)
  const omissions: string[] = [
    'AWS credentials, profiles, account and role sessions, regions, endpoints, provider caches, process state, results, pagination cursors, and waiter progress remain machine-local.'
  ]
  const projected = portableField(definition.root, validation.value, '', omissions)
  return {
    schemaVersion: 1,
    serviceId: definition.serviceId,
    commandName: definition.commandName,
    safeIntent: projected && typeof projected === 'object' && !Array.isArray(projected) ? projected as JsonRecord : {},
    omissions
  }
}


/* ------------------------------------------------------------------------------------------- *
 * Legacy AWS request-wizard schema (canvas "AWS request wizard" node).
 *
 * This second implementation deliberately coexists with the AwsWizardDefinition/
 * buildAwsWizardDefinition API above. The two are DIFFERENT features that happened to share this
 * filename across separate feature commits, and a prior automated merge concatenated their
 * consumers without restoring this half:
 *
 *   - The API above (AwsWizardDefinition, buildAwsWizardDefinition, validateAwsWizardValue,
 *     AwsWizardModelsApi, ...) drives the model-derived AWS *operation* wizard: it turns a real
 *     AWS service/command model (AwsWizardModelSource) into a reviewable request-shape editor.
 *     Consumers: src/core/aws-resource-manager.ts, src/core/aws-wizard/service.ts,
 *     src/renderer/bridge/ws-bridge.ts (AwsWizardModelsApi), and
 *     src/renderer/components/aws/AwsOperationWizard.tsx.
 *
 *   - The API below (AwsWizardSpec, AwsWizardSchema, AwsWizardField, defaultAwsWizardSpec,
 *     validateAwsWizardValues, parseAwsWizardJson/Yaml, ...) backs the canvas node created by
 *     `createAwsWizardNode` ("AWS request wizard", node kind `aws-wizard`) documented at
 *     docs/features/integrations/aws-wizard-generator.md. It ships one offline starter schema
 *     (defaultAwsWizardSchema) rather than deriving the schema from a live AWS model.
 *     Consumers: src/renderer/nodes/AwsWizardNode.tsx, src/renderer/state/workspace.ts
 *     (createAwsWizardNode / CanvasNodeState.awsWizardSpec).
 *
 * Restored verbatim (module-private symbols renamed to avoid collision with the API above) rather
 * than merged into one schema, because the two describe genuinely different request shapes for
 * genuinely different nodes and merging them would be a guess.
 * ------------------------------------------------------------------------------------------- */

export type AwsWizardScalarKind = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'time' | 'date-time' | 'file'

export interface AwsWizardOption {
  value: string
  label: string
}

interface AwsWizardFieldBase {
  label: string
  description?: string
  required?: boolean
  default?: unknown
}

export interface AwsWizardScalarField extends AwsWizardFieldBase {
  kind: AwsWizardScalarKind
  min?: number
  max?: number
  step?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  accept?: string[]
}

export interface AwsWizardEnumField extends AwsWizardFieldBase {
  kind: 'enum'
  options: AwsWizardOption[]
}

export interface AwsWizardObjectField extends AwsWizardFieldBase {
  kind: 'object'
  properties: Record<string, AwsWizardField>
  /** Required members from the provider model, kept distinct from a field's own required flag. */
  requiredProperties?: string[]
}

export interface AwsWizardArrayField extends AwsWizardFieldBase {
  kind: 'array'
  items: AwsWizardField
  minItems?: number
  maxItems?: number
}

export interface AwsWizardMapField extends AwsWizardFieldBase {
  kind: 'map'
  values: AwsWizardField
  maxEntries?: number
}

export type AwsWizardField =
  | AwsWizardScalarField
  | AwsWizardEnumField
  | AwsWizardObjectField
  | AwsWizardArrayField
  | AwsWizardMapField

export interface AwsWizardSchema {
  schemaVersion: 1
  service: string
  operation: string
  label: string
  description: string
  input: AwsWizardObjectField
}

export interface AwsWizardSpec {
  schema: AwsWizardSchema
  values: Record<string, unknown>
}

export interface AwsWizardValidationError {
  path: string
  message: string
}

const LEGACY_WIZARD_MAX_DEPTH = 12
const MAX_ITEMS = 100
const MAX_STRING = 16_384
const SAFE_KEY = /^[A-Za-z0-9_.:-]{1,128}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function scalarDefault(field: AwsWizardScalarField): unknown {
  if (field.default !== undefined) return clone(field.default)
  if (field.kind === 'boolean') return false
  if (field.kind === 'number' || field.kind === 'integer') return field.min ?? 0
  return ''
}

export function defaultAwsWizardValue(field: AwsWizardField): unknown {
  switch (field.kind) {
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(field.properties)) result[key] = defaultAwsWizardValue(child)
      return result
    }
    case 'array':
      return field.default !== undefined ? clone(field.default) : []
    case 'map':
      return field.default !== undefined ? clone(field.default) : {}
    case 'enum':
      return field.default !== undefined ? clone(field.default) : field.options[0]?.value ?? ''
    default:
      return scalarDefault(field)
  }
}

export function defaultAwsWizardSpec(): AwsWizardSpec {
  return {
    schema: defaultAwsWizardSchema(),
    values: defaultAwsWizardValue(defaultAwsWizardSchema().input) as Record<string, unknown>
  }
}

/** A useful offline starter shape. It demonstrates every supported model shape without making a
 * network request or pretending these values execute an AWS operation. */
export function defaultAwsWizardSchema(): AwsWizardSchema {
  return {
    schemaVersion: 1,
    service: 'ec2',
    operation: 'DescribeInstances',
    label: 'AWS request wizard',
    description: 'Build and review a typed AWS request locally. No service call is made here.',
    input: {
      kind: 'object',
      label: 'Request input',
      properties: {
        region: {
          kind: 'enum',
          label: 'Region',
          description: 'Choose the target region for a later, separately approved operation.',
          options: [
            { value: 'us-east-1', label: 'US East (N. Virginia)' },
            { value: 'us-west-2', label: 'US West (Oregon)' },
            { value: 'ca-central-1', label: 'Canada (Central)' },
            { value: 'eu-west-1', label: 'Europe (Ireland)' }
          ],
          default: 'us-east-1'
        },
        dryRun: { kind: 'boolean', label: 'Dry run', description: 'Keep this request review-only when a future execution lane consumes it.', default: true },
        maxResults: { kind: 'integer', label: 'Maximum results', description: 'Bound the requested page size.', min: 1, max: 1000, step: 1, default: 25 },
        startDate: { kind: 'date', label: 'Start date', description: 'Optional ISO calendar date.' },
        startTime: { kind: 'time', label: 'Start time', description: 'Optional local time.' },
        requestFile: { kind: 'file', label: 'Request attachment', description: 'Select a local JSON or YAML file. The path stays machine-local.', accept: ['.json', '.yaml', '.yml'] },
        filters: {
          kind: 'array',
          label: 'Filters',
          description: 'Add repeatable name/value filters.',
          maxItems: 50,
          items: {
            kind: 'object',
            label: 'Filter',
            properties: {
              name: { kind: 'string', label: 'Name', required: true, maxLength: 128 },
              values: { kind: 'array', label: 'Values', maxItems: 20, items: { kind: 'string', label: 'Value', maxLength: 512 } }
            }
          }
        },
        tags: {
          kind: 'map',
          label: 'Tags',
          description: 'Add bounded key/value metadata without hiding dynamic keys.',
          maxEntries: 50,
          values: { kind: 'string', label: 'Tag value', maxLength: 256 }
        },
        nested: {
          kind: 'object',
          label: 'Nested options',
          properties: {
            enabled: { kind: 'boolean', label: 'Enable nested options' },
            note: { kind: 'string', label: 'Note', maxLength: 500 }
          }
        }
      }
    }
  }
}

function pushError(errors: AwsWizardValidationError[], path: string, message: string): void {
  errors.push({ path: path || '$', message })
}

function validateLegacyWizardField(field: AwsWizardField, value: unknown, path: string, errors: AwsWizardValidationError[], depth: number): void {
  if (depth > LEGACY_WIZARD_MAX_DEPTH) {
    pushError(errors, path, `Nested value exceeds the ${LEGACY_WIZARD_MAX_DEPTH}-level limit.`)
    return
  }
  if (value === undefined || value === null) {
    if (field.required) pushError(errors, path, 'This value is required.')
    return
  }
  switch (field.kind) {
    case 'object':
      if (!isRecord(value)) return pushError(errors, path, 'Choose an object value.')
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(field.properties, key)) pushError(errors, `${path}.${key}`, 'This field is not part of the schema.')
      for (const key of field.requiredProperties ?? []) if (value[key] === undefined || value[key] === null) pushError(errors, path ? `${path}.${key}` : key, 'This value is required.')
      for (const [key, child] of Object.entries(field.properties)) validateLegacyWizardField(child, value[key], path ? `${path}.${key}` : key, errors, depth + 1)
      return
    case 'array':
      if (!Array.isArray(value)) return pushError(errors, path, 'Add a list value.')
      if (value.length > MAX_ITEMS || (field.maxItems !== undefined && value.length > field.maxItems)) pushError(errors, path, `Use at most ${Math.min(MAX_ITEMS, field.maxItems ?? MAX_ITEMS)} items.`)
      if (field.minItems !== undefined && value.length < field.minItems) pushError(errors, path, `Add at least ${field.minItems} items.`)
      value.forEach((item, index) => validateLegacyWizardField(field.items, item, `${path}[${index}]`, errors, depth + 1))
      return
    case 'map':
      if (!isRecord(value)) return pushError(errors, path, 'Add a map of key/value entries.')
      if (Object.keys(value).length > Math.min(MAX_ITEMS, field.maxEntries ?? MAX_ITEMS)) pushError(errors, path, `Use at most ${Math.min(MAX_ITEMS, field.maxEntries ?? MAX_ITEMS)} entries.`)
      for (const [key, child] of Object.entries(value)) {
        if (!SAFE_KEY.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') pushError(errors, `${path}.${key}`, 'Use a safe key with letters, numbers, dots, colons, hyphens, or underscores.')
        validateLegacyWizardField(field.values, child, `${path}.${key}`, errors, depth + 1)
      }
      return
    case 'enum':
      if (typeof value !== 'string' || !field.options.some((option) => option.value === value)) pushError(errors, path, 'Choose one of the listed options.')
      return
    case 'boolean':
      if (typeof value !== 'boolean') pushError(errors, path, 'Use the switch to choose true or false.')
      return
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return pushError(errors, path, 'Enter a finite number.')
      if (field.kind === 'integer' && !Number.isInteger(value)) pushError(errors, path, 'Enter a whole number.')
      if (field.min !== undefined && value < field.min) pushError(errors, path, `Use ${field.min} or higher.`)
      if (field.max !== undefined && value > field.max) pushError(errors, path, `Use ${field.max} or lower.`)
      return
    case 'date':
      if (typeof value !== 'string' || (value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value))) pushError(errors, path, 'Use a calendar date.')
      return
    case 'time':
      if (typeof value !== 'string' || (value !== '' && !/^\d{2}:\d{2}$/.test(value))) pushError(errors, path, 'Use a time such as 09:30.')
      return
    case 'date-time':
      if (typeof value !== 'string' || (value !== '' && Number.isNaN(Date.parse(value)))) pushError(errors, path, 'Use a valid date and time.')
      return
    case 'file':
      if (typeof value !== 'string' || value.length > MAX_STRING) pushError(errors, path, 'Choose a local file or clear this field.')
      return
    case 'string':
      if (typeof value !== 'string') return pushError(errors, path, 'Enter text.')
      if (value.length > MAX_STRING || (field.maxLength !== undefined && value.length > field.maxLength)) pushError(errors, path, `Use no more than ${Math.min(MAX_STRING, field.maxLength ?? MAX_STRING)} characters.`)
      if (field.minLength !== undefined && value.length < field.minLength) pushError(errors, path, `Use at least ${field.minLength} characters.`)
      if (field.pattern) {
        try { if (!new RegExp(field.pattern).test(value)) pushError(errors, path, 'Use the format described for this field.') } catch { pushError(errors, path, 'This schema pattern is invalid.') }
      }
  }
}

export function validateAwsWizardValues(schema: AwsWizardSchema, values: unknown): AwsWizardValidationError[] {
  const errors: AwsWizardValidationError[] = []
  validateLegacyWizardField(schema.input, values, '', errors, 0)
  return errors
}

/** Local JSON parser with a bounded payload and an object-root requirement from the AWS model. */
export function parseAwsWizardJson(text: string): Record<string, unknown> {
  if (text.length > 256 * 1024) throw new Error('Advanced JSON is larger than 256 KiB.')
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error('Advanced JSON must contain an object at the root.')
  return parsed
}

function yamlScalar(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  if (text !== '' && /^[A-Za-z0-9_./:@+-]+$/.test(text) && !/^(true|false|null|yes|no)$/i.test(text)) return text
  return JSON.stringify(text)
}

function dumpYaml(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent)
  if (!isRecord(value) && !Array.isArray(value)) return yamlScalar(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map((item) => {
      if (isRecord(item) || Array.isArray(item)) return `${pad}-\n${dumpYaml(item, indent + 1)}`
      return `${pad}- ${yamlScalar(item)}`
    }).join('\n')
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  return entries.map(([key, child]) => isRecord(child) || Array.isArray(child)
    ? `${pad}${key}:\n${dumpYaml(child, indent + 1)}`
    : `${pad}${key}: ${yamlScalar(child)}`).join('\n')
}

export function serializeAwsWizardJson(values: Record<string, unknown>): string {
  return JSON.stringify(values, null, 2) + '\n'
}

export function serializeAwsWizardYaml(values: Record<string, unknown>): string {
  return dumpYaml(values, 0) + '\n'
}

interface YamlLine { indent: number; text: string }

function yamlScalarParse(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try { return JSON.parse(trimmed.startsWith("'") ? JSON.stringify(trimmed.slice(1, -1).replace(/''/g, "'")) : trimmed) } catch { return trimmed.slice(1, -1) }
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return JSON.parse(trimmed)
  return trimmed
}

export function parseAwsWizardYaml(text: string): Record<string, unknown> {
  if (text.length > 256 * 1024) throw new Error('Advanced YAML is larger than 256 KiB.')
  const lines: YamlLine[] = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }))
  if (!lines.length) return {}
  const parseBlock = (start: number, indent: number): [unknown, number] => {
    const array = lines[start]?.text === '-' || lines[start]?.text.startsWith('- ')
    const result: unknown[] | Record<string, unknown> = array ? [] : {}
    let index = start
    while (index < lines.length && lines[index]!.indent === indent) {
      const line = lines[index]!.text
      if (array) {
        if (!(line === '-' || line.startsWith('- '))) break
        const rest = line === '-' ? '' : line.slice(2).trim()
        if (rest) (result as unknown[]).push(yamlScalarParse(rest))
        else {
          const [child, next] = parseBlock(index + 1, indent + 2)
          ;(result as unknown[]).push(child)
          index = next
          continue
        }
      } else {
        const separator = line.indexOf(':')
        if (separator <= 0) throw new Error(`Invalid YAML mapping line: ${line}`)
        const key = line.slice(0, separator).trim()
        if (!SAFE_KEY.test(key)) throw new Error(`Unsafe YAML key: ${key}`)
        const rest = line.slice(separator + 1).trim()
        if (rest) (result as Record<string, unknown>)[key] = yamlScalarParse(rest)
        else {
          const [child, next] = index + 1 < lines.length && lines[index + 1]!.indent > indent
            ? parseBlock(index + 1, lines[index + 1]!.indent)
            : [null, index + 1]
          ;(result as Record<string, unknown>)[key] = child
          index = next
          continue
        }
      }
      index += 1
    }
    return [result, index]
  }
  const [parsed] = parseBlock(0, lines[0]!.indent)
  if (!isRecord(parsed)) throw new Error('Advanced YAML must contain an object at the root.')
  return parsed
}
