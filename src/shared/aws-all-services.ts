/**
 * Generic, model-driven AWS service intent.
 *
 * This module deliberately knows no AWS service names. The installed CLI model inventory is the
 * authority, so a service or command added by a later CLI release appears without adding another
 * source-code form. The renderer consumes these records, while the trusted shell owns discovery
 * and execution.
 */

export const AWS_ALL_SERVICES_SCHEMA_VERSION = 1 as const
export const AWS_MAX_SERVICES = 2_000
export const AWS_MAX_COMMANDS_PER_SERVICE = 2_000
export const AWS_MAX_FIELDS_PER_COMMAND = 2_000
export const AWS_MAX_CHOICES_PER_FIELD = 10_000
export const AWS_MAX_VALUE_DEPTH = 12
export const AWS_MAX_TEXT_LENGTH = 64 * 1024

export type AwsFieldKind =
  | 'string'
  | 'enum'
  | 'boolean'
  | 'number'
  | 'date-time'
  | 'file'
  | 'list'
  | 'map'
  | 'structure'

export type AwsOperationRisk = 'read' | 'write' | 'destructive'
export type AwsOutputMode = 'json' | 'yaml' | 'text' | 'table'
export type AwsRetryMode = 'standard' | 'adaptive' | 'legacy'
export type AwsPrimitive = string | number | boolean | null
export type AwsValue = AwsPrimitive | AwsValue[] | { [key: string]: AwsValue }

export interface AwsFieldChoice {
  value: string
  label: string
  description?: string
}

export interface AwsFieldModel {
  /** Stable modeled member id, never display copy. */
  id: string
  /** CLI option name, including the leading `--`. */
  cliName: string
  label: string
  description: string
  kind: AwsFieldKind
  required: boolean
  sensitive?: boolean
  portable?: boolean
  placeholder?: string
  defaultValue?: AwsValue
  choices?: readonly AwsFieldChoice[]
  minimum?: number
  maximum?: number
  pattern?: string
  falseCliName?: string
  item?: AwsFieldModel
  members?: readonly AwsFieldModel[]
}

export interface AwsCommandModel {
  id: string
  name: string
  label: string
  description: string
  documentationUrl?: string
  risk: AwsOperationRisk
  fields: readonly AwsFieldModel[]
  pagination?: { supported: boolean; pageSizeFieldId?: string; startingTokenFieldId?: string }
  waiters?: readonly { id: string; label: string; description: string }[]
  streaming?: boolean
}

export interface AwsServiceModel {
  id: string
  name: string
  label: string
  description: string
  documentationUrl?: string
  commands: readonly AwsCommandModel[]
}

export interface AwsAllServicesCatalog {
  schemaVersion: typeof AWS_ALL_SERVICES_SCHEMA_VERSION
  cliVersion: string
  generatedAt: string
  services: readonly AwsServiceModel[]
}

export interface AwsPaginationIntent {
  enabled: boolean
  pageSize?: number
  maximumItems?: number
}

/** Safe intent written to the schema 3 project projection. */
export interface AwsPortableServiceIntent {
  schemaVersion: typeof AWS_ALL_SERVICES_SCHEMA_VERSION
  serviceId: string | null
  commandId: string | null
  region: string | null
  values: Record<string, AwsValue>
  pagination: AwsPaginationIntent
  waiterId: string | null
  retryMode: AwsRetryMode
  streaming: boolean
  outputMode: AwsOutputMode
}

/** Machine-local selection. These values never belong in a portable project file. */
export interface AwsLocalExecutionBinding {
  profileId?: string
  accountId?: string
  roleId?: string
  endpoint?: string
  localFiles?: Record<string, string>
}

export interface AwsPortableOmission {
  fieldId: string
  reason: 'credential-or-session' | 'machine-path' | 'runtime-only' | 'model-marked-sensitive'
  explanation: string
}

export interface AwsFieldValidation {
  valid: boolean
  error?: string
}

export interface AwsExecutionPreview {
  serviceId: string
  commandId: string
  profileId?: string
  accountId?: string
  roleId?: string
  region?: string
  endpoint?: string
  argv: readonly string[]
  pagination: AwsPaginationIntent
  waiterId?: string
  retryMode: AwsRetryMode
  streaming: boolean
  outputMode: AwsOutputMode
  risk: AwsOperationRisk
  omissions: readonly AwsPortableOmission[]
}

export interface AwsExecutionRequest {
  preview: AwsExecutionPreview
  /** Runtime file choices are held separately so project serialization cannot include them. */
  localFiles: Readonly<Record<string, string>>
}

export function emptyAwsPortableServiceIntent(): AwsPortableServiceIntent {
  return {
    schemaVersion: AWS_ALL_SERVICES_SCHEMA_VERSION,
    serviceId: null,
    commandId: null,
    region: null,
    values: {},
    pagination: { enabled: false },
    waiterId: null,
    retryMode: 'standard',
    streaming: false,
    outputMode: 'json'
  }
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  if (trimmed.length > AWS_MAX_TEXT_LENGTH) throw new Error(`${label} is too long.`)
  return trimmed
}

function safeId(value: unknown, label: string): string {
  const id = boundedText(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(id)) throw new Error(`${label} is invalid.`)
  return id
}

function safeCliName(value: unknown): string {
  const cliName = boundedText(value, 'AWS option name')
  if (!/^--[a-z0-9][a-z0-9-]*$/.test(cliName)) throw new Error(`AWS option ${cliName} is invalid.`)
  return cliName
}

function cloneValue(value: AwsValue, depth = 0): AwsValue {
  if (depth > AWS_MAX_VALUE_DEPTH) throw new Error('AWS input nesting is too deep.')
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    if (value.length > AWS_MAX_TEXT_LENGTH) throw new Error('AWS input text is too long.')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => cloneValue(item, depth + 1))
  const copy: Record<string, AwsValue> = {}
  for (const [key, item] of Object.entries(value)) {
    safeId(key, 'AWS input key')
    copy[key] = cloneValue(item, depth + 1)
  }
  return copy
}

function normalizeChoice(raw: AwsFieldChoice): AwsFieldChoice {
  return {
    value: boundedText(raw.value, 'AWS choice value'),
    label: boundedText(raw.label, 'AWS choice label'),
    ...(raw.description ? { description: boundedText(raw.description, 'AWS choice description') } : {})
  }
}

function normalizeField(raw: AwsFieldModel, depth = 0): AwsFieldModel {
  if (depth > AWS_MAX_VALUE_DEPTH) throw new Error('AWS field model nesting is too deep.')
  const choices = raw.choices?.map(normalizeChoice)
  if (choices && choices.length > AWS_MAX_CHOICES_PER_FIELD) throw new Error('AWS field choice count is too large.')
  const members = raw.members?.map((member) => normalizeField(member, depth + 1))
  if (members && members.length > AWS_MAX_FIELDS_PER_COMMAND) throw new Error('AWS structure member count is too large.')
  const model: AwsFieldModel = {
    id: safeId(raw.id, 'AWS field id'),
    cliName: safeCliName(raw.cliName),
    label: boundedText(raw.label, 'AWS field label'),
    description: boundedText(raw.description, 'AWS field description'),
    kind: raw.kind,
    required: !!raw.required,
    ...(raw.sensitive ? { sensitive: true } : {}),
    ...(raw.portable === false ? { portable: false } : { portable: true }),
    ...(raw.placeholder ? { placeholder: boundedText(raw.placeholder, 'AWS field placeholder') } : {}),
    ...(choices ? { choices } : {}),
    ...(raw.minimum !== undefined ? { minimum: raw.minimum } : {}),
    ...(raw.maximum !== undefined ? { maximum: raw.maximum } : {}),
    ...(raw.pattern ? { pattern: raw.pattern } : {}),
    ...(raw.falseCliName ? { falseCliName: safeCliName(raw.falseCliName) } : {}),
    ...(raw.item ? { item: normalizeField(raw.item, depth + 1) } : {}),
    ...(members ? { members } : {}),
    ...(raw.defaultValue !== undefined ? { defaultValue: cloneValue(raw.defaultValue) } : {})
  }
  if (!['string', 'enum', 'boolean', 'number', 'date-time', 'file', 'list', 'map', 'structure'].includes(model.kind)) {
    throw new Error(`AWS field ${model.id} has an unsupported control kind.`)
  }
  if (model.kind === 'enum' && !model.choices?.length) throw new Error(`AWS enum field ${model.id} has no choices.`)
  if (model.kind === 'list' && !model.item) throw new Error(`AWS list field ${model.id} has no item model.`)
  if (model.kind === 'structure' && !model.members) throw new Error(`AWS structure field ${model.id} has no members.`)
  if (model.minimum !== undefined && model.maximum !== undefined && model.minimum > model.maximum) {
    throw new Error(`AWS field ${model.id} has an invalid numeric range.`)
  }
  return model
}

function normalizeCommand(raw: AwsCommandModel): AwsCommandModel {
  if (raw.fields.length > AWS_MAX_FIELDS_PER_COMMAND) throw new Error('AWS command field count is too large.')
  const ids = new Set<string>()
  const cliNames = new Set<string>()
  const fields = raw.fields.map((field) => {
    const normalized = normalizeField(field)
    if (ids.has(normalized.id)) throw new Error(`AWS command has duplicate field id ${normalized.id}.`)
    if (cliNames.has(normalized.cliName)) throw new Error(`AWS command has duplicate option ${normalized.cliName}.`)
    ids.add(normalized.id)
    cliNames.add(normalized.cliName)
    return normalized
  })
  return {
    id: safeId(raw.id, 'AWS command id'),
    name: safeId(raw.name, 'AWS command name'),
    label: boundedText(raw.label, 'AWS command label'),
    description: boundedText(raw.description, 'AWS command description'),
    ...(raw.documentationUrl ? { documentationUrl: boundedText(raw.documentationUrl, 'AWS command documentation URL') } : {}),
    risk: raw.risk,
    fields,
    ...(raw.pagination ? { pagination: { ...raw.pagination } } : {}),
    ...(raw.waiters ? { waiters: raw.waiters.map((waiter) => ({
      id: safeId(waiter.id, 'AWS waiter id'),
      label: boundedText(waiter.label, 'AWS waiter label'),
      description: boundedText(waiter.description, 'AWS waiter description')
    })) } : {}),
    ...(raw.streaming ? { streaming: true } : {})
  }
}

export function normalizeAwsAllServicesCatalog(raw: AwsAllServicesCatalog): AwsAllServicesCatalog {
  if (raw.schemaVersion !== AWS_ALL_SERVICES_SCHEMA_VERSION) throw new Error('AWS model catalog version is unsupported.')
  if (!Array.isArray(raw.services) || raw.services.length > AWS_MAX_SERVICES) throw new Error('AWS service count is invalid.')
  const serviceIds = new Set<string>()
  const services = raw.services.map((service) => {
    if (!Array.isArray(service.commands) || service.commands.length > AWS_MAX_COMMANDS_PER_SERVICE) {
      throw new Error(`AWS service ${String(service.id)} has too many commands.`)
    }
    const id = safeId(service.id, 'AWS service id')
    if (serviceIds.has(id)) throw new Error(`AWS model catalog has duplicate service ${id}.`)
    serviceIds.add(id)
    const commandIds = new Set<string>()
    const commands = service.commands.map((command) => {
      const normalized = normalizeCommand(command)
      if (commandIds.has(normalized.id)) throw new Error(`AWS service ${id} has duplicate command ${normalized.id}.`)
      commandIds.add(normalized.id)
      return normalized
    })
    return {
      id,
      name: safeId(service.name, 'AWS service name'),
      label: boundedText(service.label, 'AWS service label'),
      description: boundedText(service.description, 'AWS service description'),
      ...(service.documentationUrl ? { documentationUrl: boundedText(service.documentationUrl, 'AWS service documentation URL') } : {}),
      commands
    }
  })
  return {
    schemaVersion: AWS_ALL_SERVICES_SCHEMA_VERSION,
    cliVersion: boundedText(raw.cliVersion, 'AWS CLI version'),
    generatedAt: boundedText(raw.generatedAt, 'AWS catalog generation time'),
    services
  }
}

export function findAwsService(catalog: AwsAllServicesCatalog, serviceId: string | null): AwsServiceModel | null {
  return serviceId ? catalog.services.find((service) => service.id === serviceId) ?? null : null
}

export function findAwsCommand(service: AwsServiceModel | null, commandId: string | null): AwsCommandModel | null {
  return service && commandId ? service.commands.find((command) => command.id === commandId) ?? null : null
}

export function validateAwsFieldValue(field: AwsFieldModel, value: AwsValue | undefined): AwsFieldValidation {
  if (value === undefined || value === null || value === '') {
    return field.required ? { valid: false, error: `${field.label} is required.` } : { valid: true }
  }
  if (field.sensitive) return { valid: false, error: `${field.label} must come from protected local credential storage.` }
  if (field.kind === 'boolean') return typeof value === 'boolean' ? { valid: true } : { valid: false, error: `${field.label} must be on or off.` }
  if (field.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { valid: false, error: `${field.label} must be a number.` }
    if (field.minimum !== undefined && value < field.minimum) return { valid: false, error: `${field.label} must be at least ${field.minimum}.` }
    if (field.maximum !== undefined && value > field.maximum) return { valid: false, error: `${field.label} must be at most ${field.maximum}.` }
    return { valid: true }
  }
  if (field.kind === 'enum') {
    return typeof value === 'string' && !!field.choices?.some((choice) => choice.value === value)
      ? { valid: true }
      : { valid: false, error: `Choose a listed value for ${field.label}.` }
  }
  if (field.kind === 'list') {
    if (!Array.isArray(value)) return { valid: false, error: `${field.label} must be a list.` }
    const invalid = value.findIndex((item) => !validateAwsFieldValue({ ...field.item!, required: true }, item).valid)
    return invalid < 0 ? { valid: true } : { valid: false, error: `${field.label} item ${invalid + 1} is invalid.` }
  }
  if (field.kind === 'map' || field.kind === 'structure') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { valid: true }
      : { valid: false, error: `${field.label} must be a structured value.` }
  }
  if (typeof value !== 'string') return { valid: false, error: `${field.label} must be text.` }
  if (value.length > AWS_MAX_TEXT_LENGTH) return { valid: false, error: `${field.label} is too long.` }
  if (field.kind === 'date-time' && Number.isNaN(Date.parse(value))) return { valid: false, error: `${field.label} must be a valid date and time.` }
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern, 'u').test(value)) return { valid: false, error: `${field.label} does not match the required format.` }
    } catch {
      return { valid: false, error: `${field.label} has an invalid model pattern.` }
    }
  }
  return { valid: true }
}

export function validateAwsCommandValues(command: AwsCommandModel, values: Readonly<Record<string, AwsValue>>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of command.fields) {
    const result = validateAwsFieldValue(field, values[field.id])
    if (!result.valid) errors[field.id] = result.error ?? `${field.label} is invalid.`
  }
  return errors
}

function appendFieldArg(argv: string[], field: AwsFieldModel, value: AwsValue | undefined, localFiles: Readonly<Record<string, string>>): void {
  if (value === undefined || value === null || value === '' || field.sensitive) return
  if (field.kind === 'file') {
    const path = localFiles[field.id]
    if (path) argv.push(field.cliName, path)
    return
  }
  if (field.kind === 'boolean') {
    if (value === true) argv.push(field.cliName)
    else if (value === false && field.falseCliName) argv.push(field.falseCliName)
    return
  }
  if (Array.isArray(value)) {
    if (value.length) argv.push(field.cliName, ...value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)))
    return
  }
  argv.push(field.cliName, typeof value === 'object' ? JSON.stringify(value) : String(value))
}

export function portableAwsIntent(
  intent: AwsPortableServiceIntent,
  command: AwsCommandModel | null
): { intent: AwsPortableServiceIntent; omissions: AwsPortableOmission[] } {
  const fields = new Map(command?.fields.map((field) => [field.id, field]) ?? [])
  const values: Record<string, AwsValue> = {}
  const omissions: AwsPortableOmission[] = []
  for (const [fieldId, value] of Object.entries(intent.values)) {
    const field = fields.get(fieldId)
    if (!field) continue
    if (field.sensitive) {
      omissions.push({ fieldId, reason: 'model-marked-sensitive', explanation: 'Protected provider input stays in local credential storage.' })
      continue
    }
    if (field.kind === 'file' || field.portable === false) {
      omissions.push({ fieldId, reason: 'machine-path', explanation: 'The selected local file or machine-specific value must be chosen again after import.' })
      continue
    }
    values[fieldId] = cloneValue(value)
  }
  return {
    intent: { ...intent, schemaVersion: AWS_ALL_SERVICES_SCHEMA_VERSION, values },
    omissions
  }
}

export function buildAwsExecutionPreview(input: {
  intent: AwsPortableServiceIntent
  binding: AwsLocalExecutionBinding
  service: AwsServiceModel
  command: AwsCommandModel
}): AwsExecutionRequest {
  const { intent, binding, service, command } = input
  const errors = validateAwsCommandValues(command, intent.values)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  const argv = [service.name, command.name]
  for (const field of command.fields) appendFieldArg(argv, field, intent.values[field.id], binding.localFiles ?? {})
  if (intent.region) argv.push('--region', intent.region)
  if (binding.endpoint) argv.push('--endpoint-url', binding.endpoint)
  if (intent.outputMode) argv.push('--output', intent.outputMode)
  if (intent.pagination.enabled && intent.pagination.pageSize) argv.push('--page-size', String(intent.pagination.pageSize))
  if (intent.pagination.enabled && intent.pagination.maximumItems) argv.push('--max-items', String(intent.pagination.maximumItems))
  const portable = portableAwsIntent(intent, command)
  return {
    preview: {
      serviceId: service.id,
      commandId: command.id,
      ...(binding.profileId ? { profileId: binding.profileId } : {}),
      ...(binding.accountId ? { accountId: binding.accountId } : {}),
      ...(binding.roleId ? { roleId: binding.roleId } : {}),
      ...(intent.region ? { region: intent.region } : {}),
      ...(binding.endpoint ? { endpoint: binding.endpoint } : {}),
      argv,
      pagination: { ...intent.pagination },
      ...(intent.waiterId ? { waiterId: intent.waiterId } : {}),
      retryMode: intent.retryMode,
      streaming: intent.streaming,
      outputMode: intent.outputMode,
      risk: command.risk,
      omissions: portable.omissions
    },
    localFiles: { ...(binding.localFiles ?? {}) }
  }
}

