/**
 * Schema-driven AWS request wizard data model.
 *
 * This module deliberately knows nothing about AWS credentials, profiles, SDK clients, or
 * process execution. It describes a bounded request shape and validates values locally, so a
 * project can carry safe intent while machine-local file selections remain outside the portable
 * projection. The renderer uses the same schema for typed controls and advanced JSON/YAML views.
 */

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

const MAX_DEPTH = 12
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

function validateField(field: AwsWizardField, value: unknown, path: string, errors: AwsWizardValidationError[], depth: number): void {
  if (depth > MAX_DEPTH) {
    pushError(errors, path, `Nested value exceeds the ${MAX_DEPTH}-level limit.`)
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
      for (const [key, child] of Object.entries(field.properties)) validateField(child, value[key], path ? `${path}.${key}` : key, errors, depth + 1)
      return
    case 'array':
      if (!Array.isArray(value)) return pushError(errors, path, 'Add a list value.')
      if (value.length > MAX_ITEMS || (field.maxItems !== undefined && value.length > field.maxItems)) pushError(errors, path, `Use at most ${Math.min(MAX_ITEMS, field.maxItems ?? MAX_ITEMS)} items.`)
      if (field.minItems !== undefined && value.length < field.minItems) pushError(errors, path, `Add at least ${field.minItems} items.`)
      value.forEach((item, index) => validateField(field.items, item, `${path}[${index}]`, errors, depth + 1))
      return
    case 'map':
      if (!isRecord(value)) return pushError(errors, path, 'Add a map of key/value entries.')
      if (Object.keys(value).length > Math.min(MAX_ITEMS, field.maxEntries ?? MAX_ITEMS)) pushError(errors, path, `Use at most ${Math.min(MAX_ITEMS, field.maxEntries ?? MAX_ITEMS)} entries.`)
      for (const [key, child] of Object.entries(value)) {
        if (!SAFE_KEY.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') pushError(errors, `${path}.${key}`, 'Use a safe key with letters, numbers, dots, colons, hyphens, or underscores.')
        validateField(field.values, child, `${path}.${key}`, errors, depth + 1)
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
  validateField(schema.input, values, '', errors, 0)
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
