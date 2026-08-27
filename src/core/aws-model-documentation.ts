/**
 * Deterministic AWS CLI documentation index derived from official service models.
 *
 * This module is platform-free and performs no file, process, network, credential, or provider
 * operation. The bundled AWS CLI inventory lane supplies decoded official model documents. This
 * lane validates and projects those documents into bounded picker rows for the renderer and the
 * later typed-wizard generator.
 */

const MAX_SERVICES = 1_000
const MAX_OPERATIONS_PER_SERVICE = 5_000
const MAX_SHAPES_PER_SERVICE = 20_000
const MAX_MEMBERS_PER_SHAPE = 2_000
const MAX_WAITERS_PER_SERVICE = 2_000
const MAX_TEXT = 32_768
const MAX_IDENTIFIER = 256
const MAX_QUERY = 1_024
const MAX_SKELETON_DEPTH = 12

type JsonRecord = Record<string, unknown>

export type AwsModelDocumentationSection =
  | 'overview'
  | 'options'
  | 'paginator'
  | 'waiters'
  | 'input'
  | 'output'
  | 'skeleton'

export interface AwsOfficialModelSource {
  /** Stable service identifier from the bundled inventory, for example `Amazon S3`. */
  serviceId: string
  /** AWS CLI service token, for example `s3api`. */
  cliName: string
  modelVersion: string
  serviceModel: unknown
  paginatorModel?: unknown
  waiterModel?: unknown
  /** Optional official API reference root. Only docs.aws.amazon.com HTTPS URLs are accepted. */
  apiReferenceUrl?: string
}

export interface AwsShapeMemberDocumentation {
  name: string
  cliOption: string
  required: boolean
  shape: string
  type: string
  documentation: string
  enumValues: string[]
  min: number | null
  max: number | null
}

export interface AwsShapeDocumentation {
  name: string
  type: string
  documentation: string
  enumValues: string[]
  min: number | null
  max: number | null
  members: AwsShapeMemberDocumentation[]
  memberShape: string | null
  keyShape: string | null
  valueShape: string | null
}

export interface AwsOptionDocumentation extends AwsShapeMemberDocumentation {
  skeletonValue: unknown
}

export interface AwsPaginatorDocumentation {
  inputTokens: string[]
  outputTokens: string[]
  limitKey: string | null
  resultKeys: string[]
  moreResults: string | null
  nonAggregateKeys: string[]
}

export interface AwsWaiterAcceptorDocumentation {
  state: string
  matcher: string
  expected: string | number | boolean | null
  argument: string | null
}

export interface AwsWaiterDocumentation {
  name: string
  commandName: string
  delaySeconds: number
  maxAttempts: number
  acceptors: AwsWaiterAcceptorDocumentation[]
}

export interface AwsCommandDocumentation {
  apiName: string
  name: string
  documentation: string
  documentationUrl: string
  inputShape: string | null
  outputShape: string | null
  options: AwsOptionDocumentation[]
  paginator: AwsPaginatorDocumentation | null
  waiters: AwsWaiterDocumentation[]
  input: AwsShapeDocumentation | null
  output: AwsShapeDocumentation | null
  inputSkeleton: unknown
}

export interface AwsServiceDocumentation {
  id: string
  cliName: string
  modelVersion: string
  displayName: string
  documentation: string
  documentationUrl: string
  apiReferenceUrl: string | null
  commands: AwsCommandDocumentation[]
  shapes: AwsShapeDocumentation[]
}

export type AwsModelDocumentationRowKind =
  | 'service'
  | 'command'
  | 'option'
  | 'paginator'
  | 'waiter'
  | 'input'
  | 'output'
  | 'skeleton'

export interface AwsModelDocumentationRow {
  id: string
  kind: AwsModelDocumentationRowKind
  serviceId: string
  serviceName: string
  commandName: string | null
  optionName: string | null
  title: string
  summary: string
  documentationUrl: string
  keywords: string[]
}

export interface AwsModelDocumentationIndex {
  source: 'official-aws-cli-models'
  services: AwsServiceDocumentation[]
  rows: AwsModelDocumentationRow[]
}

export interface AwsModelDocumentationSearchOptions {
  mode?: 'text' | 'regex'
  flags?: string
  kinds?: readonly AwsModelDocumentationRowKind[]
  serviceId?: string
  commandName?: string
}

export interface AwsModelDocumentationSearchResult {
  rows: AwsModelDocumentationRow[]
  error: string | null
}

export interface AwsDocumentationPortableSelection {
  serviceId: string | null
  commandName: string | null
  section: AwsModelDocumentationSection
}

export interface AwsDocumentationPortableProjection {
  selection: AwsDocumentationPortableSelection
  omissions: readonly string[]
}

export interface AwsDocumentationPickerOption {
  id: string
  label: string
  description: string
  disabled: boolean
  disabledReason: string | null
}

export interface AwsDocumentationPickerModel {
  services: AwsDocumentationPickerOption[]
  commands: AwsDocumentationPickerOption[]
  sections: AwsDocumentationPickerOption[]
  selectedService: AwsServiceDocumentation | null
  selectedCommand: AwsCommandDocumentation | null
  disabledReason: string | null
}

export class AwsModelDocumentationError extends Error {
  readonly code: 'invalid-model' | 'bounds' | 'duplicate' | 'unsafe-url' | 'invalid-selection'

  constructor(code: AwsModelDocumentationError['code'], message: string) {
    super(message)
    this.name = 'AwsModelDocumentationError'
    this.code = code
  }
}

export const AWS_DOCUMENTATION_PORTABLE_OMISSIONS = [
  'Installed AWS CLI paths and executable details remain machine-local.',
  'Decoded service-model caches and generated runtime indexes are rebuilt from the local bundled AWS CLI.',
  'AWS profiles, credentials, provider sessions, account identities, roles, regions, and endpoints are not exported.',
  'Pagination cursors, waiter progress, command results, process state, and generated runtime data are not exported.'
] as const

const SECTION_LABELS: Readonly<Record<AwsModelDocumentationSection, string>> = {
  overview: 'Overview',
  options: 'Options',
  paginator: 'Paginator',
  waiters: 'Waiters',
  input: 'Input',
  output: 'Output',
  skeleton: 'Input skeleton'
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AwsModelDocumentationError('invalid-model', `${label} must be an object.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AwsModelDocumentationError('invalid-model', `${label} must be a plain object.`)
  }
  return value as JsonRecord
}

function optionalRecord(value: unknown, label: string): JsonRecord {
  return value === undefined || value === null ? {} : record(value, label)
}

function entries(value: unknown, label: string, limit: number): Array<[string, JsonRecord]> {
  const source = optionalRecord(value, label)
  const rows = Object.entries(source)
  if (rows.length > limit) throw new AwsModelDocumentationError('bounds', `${label} exceeds ${limit} entries.`)
  return rows.map(([key, item]) => [identifier(key, `${label} key`), record(item, `${label}.${key}`)])
}

function text(value: unknown, label: string, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new AwsModelDocumentationError('invalid-model', `${label} must be text.`)
  if (value.length > MAX_TEXT) throw new AwsModelDocumentationError('bounds', `${label} exceeds ${MAX_TEXT} characters.`)
  return value
}

function identifier(value: unknown, label: string): string {
  const out = text(value, label).trim()
  if (!out || out.length > MAX_IDENTIFIER || [...out].some((character) => character < ' ' || character === '\u007f')) {
    throw new AwsModelDocumentationError('invalid-model', `${label} must be a bounded visible identifier.`)
  }
  return out
}

function cliToken(value: unknown, label: string): string {
  const out = identifier(value, label).toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(out)) {
    throw new AwsModelDocumentationError('invalid-model', `${label} must contain only lowercase letters, digits, and hyphens.`)
  }
  return out
}

function numberOrNull(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AwsModelDocumentationError('invalid-model', `${label} must be a finite number.`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AwsModelDocumentationError('invalid-model', `${label} must be a non-negative integer.`)
  }
  return value
}

function stringList(value: unknown, label: string, limit = MAX_MEMBERS_PER_SHAPE): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > limit) {
    throw new AwsModelDocumentationError('bounds', `${label} must be an array with at most ${limit} entries.`)
  }
  return value.map((item, index) => identifier(item, `${label}[${index}]`))
}

function documentation(value: unknown, label: string): string {
  return text(value, label)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function officialDocsUrl(value: string | undefined, label: string): string | null {
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AwsModelDocumentationError('unsafe-url', `${label} must be an absolute URL.`)
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.aws.amazon.com' || parsed.username || parsed.password) {
    throw new AwsModelDocumentationError('unsafe-url', `${label} must use anonymous HTTPS on docs.aws.amazon.com.`)
  }
  parsed.hash = ''
  return parsed.href
}

function kebab(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function shapeName(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return identifier(record(value, label).shape, `${label}.shape`)
}

function shapeType(shape: JsonRecord): string {
  return text(shape.type, 'shape.type', 'structure').trim() || 'structure'
}

function shapeReference(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return identifier(record(value, label).shape, `${label}.shape`)
}

function buildShapeDocumentation(name: string, shape: JsonRecord): AwsShapeDocumentation {
  const requiredNames = uniqueBy(
    stringList(shape.required, `shape ${name}.required`),
    (memberName) => memberName,
    `shape ${name}.required`
  )
  const required = new Set(requiredNames)
  const members = entries(shape.members, `shape ${name}.members`, MAX_MEMBERS_PER_SHAPE).map(([memberName, member]) => {
    const memberShape = identifier(member.shape, `shape ${name}.members.${memberName}.shape`)
    return {
      name: memberName,
      cliOption: `--${kebab(memberName)}`,
      required: required.has(memberName),
      shape: memberShape,
      type: text(member.type, `shape ${name}.members.${memberName}.type`, 'shape-reference'),
      documentation: documentation(member.documentation, `shape ${name}.members.${memberName}.documentation`),
      enumValues: stringList(member.enum, `shape ${name}.members.${memberName}.enum`),
      min: numberOrNull(member.min, `shape ${name}.members.${memberName}.min`),
      max: numberOrNull(member.max, `shape ${name}.members.${memberName}.max`)
    }
  })
  const memberNames = new Set(members.map((member) => member.name))
  const missingRequired = requiredNames.filter((memberName) => !memberNames.has(memberName))
  if (missingRequired.length > 0) {
    throw new AwsModelDocumentationError(
      'invalid-model',
      `shape ${name}.required references missing member(s): ${missingRequired.join(', ')}.`
    )
  }
  return {
    name,
    type: shapeType(shape),
    documentation: documentation(shape.documentation, `shape ${name}.documentation`),
    enumValues: stringList(shape.enum, `shape ${name}.enum`),
    min: numberOrNull(shape.min, `shape ${name}.min`),
    max: numberOrNull(shape.max, `shape ${name}.max`),
    members,
    memberShape: shapeReference(shape.member, `shape ${name}.member`),
    keyShape: shapeReference(shape.key, `shape ${name}.key`),
    valueShape: shapeReference(shape.value, `shape ${name}.value`)
  }
}

function skeletonForShape(
  name: string | null,
  shapes: ReadonlyMap<string, JsonRecord>,
  depth = 0,
  path = new Set<string>()
): unknown {
  if (!name) return null
  if (depth >= MAX_SKELETON_DEPTH || path.has(name)) return `<${name}>`
  const shape = shapes.get(name)
  if (!shape) return `<${name}>`
  const nextPath = new Set(path).add(name)
  const type = shapeType(shape)
  if (type === 'structure') {
    return Object.fromEntries(
      entries(shape.members, `shape ${name}.members`, MAX_MEMBERS_PER_SHAPE).map(([memberName, member]) => [
        memberName,
        skeletonForShape(identifier(member.shape, `shape ${name}.members.${memberName}.shape`), shapes, depth + 1, nextPath)
      ])
    )
  }
  if (type === 'list') return [skeletonForShape(shapeReference(shape.member, `shape ${name}.member`), shapes, depth + 1, nextPath)]
  if (type === 'map') return { key: skeletonForShape(shapeReference(shape.value, `shape ${name}.value`), shapes, depth + 1, nextPath) }
  if (type === 'boolean') return false
  if (['byte', 'short', 'integer', 'long', 'float', 'double', 'bigInteger', 'bigDecimal'].includes(type)) {
    return numberOrNull(shape.min, `shape ${name}.min`) ?? 0
  }
  if (type === 'blob') return '<base64>'
  if (type === 'timestamp') return '1970-01-01T00:00:00Z'
  const values = stringList(shape.enum, `shape ${name}.enum`)
  if (['string', 'char'].includes(type)) return values[0] ?? ''
  // Keep an unfamiliar future shape visible instead of pretending it is a string. Official
  // models can grow new shape kinds, and a visible marker is safer than a plausible-looking value.
  return `<${type}>`
}

function paginatorFor(operationName: string, model: JsonRecord): AwsPaginatorDocumentation | null {
  const pagination = optionalRecord(model.pagination, 'paginatorModel.pagination')
  const raw = pagination[operationName]
  if (raw === undefined) return null
  const value = record(raw, `paginatorModel.pagination.${operationName}`)
  const asList = (item: unknown, label: string): string[] =>
    typeof item === 'string' ? [identifier(item, label)] : stringList(item, label)
  return {
    inputTokens: asList(value.input_token, `${operationName}.input_token`),
    outputTokens: asList(value.output_token, `${operationName}.output_token`),
    limitKey: value.limit_key === undefined ? null : identifier(value.limit_key, `${operationName}.limit_key`),
    resultKeys: asList(value.result_key, `${operationName}.result_key`),
    moreResults: value.more_results === undefined ? null : identifier(value.more_results, `${operationName}.more_results`),
    nonAggregateKeys: asList(value.non_aggregate_keys, `${operationName}.non_aggregate_keys`)
  }
}

function waitersFor(operationName: string, model: JsonRecord): AwsWaiterDocumentation[] {
  return entries(model.waiters, 'waiterModel.waiters', MAX_WAITERS_PER_SERVICE)
    .map(([name, raw]) => {
      const operation = identifier(raw.operation, `waiter ${name}.operation`)
      if (operation !== operationName) return null
      const acceptorsRaw = raw.acceptors
      if (!Array.isArray(acceptorsRaw) || acceptorsRaw.length > MAX_MEMBERS_PER_SHAPE) {
        throw new AwsModelDocumentationError('bounds', `waiter ${name}.acceptors exceeds bounds.`)
      }
      const acceptors = acceptorsRaw.map((item, index) => {
        const acceptor = record(item, `waiter ${name}.acceptors[${index}]`)
        const expected = acceptor.expected
        if (expected !== undefined && expected !== null && !['string', 'number', 'boolean'].includes(typeof expected)) {
          throw new AwsModelDocumentationError('invalid-model', `waiter ${name}.acceptors[${index}].expected has an unsupported type.`)
        }
        return {
          state: identifier(acceptor.state, `waiter ${name}.acceptors[${index}].state`),
          matcher: identifier(acceptor.matcher, `waiter ${name}.acceptors[${index}].matcher`),
          expected: (expected ?? null) as string | number | boolean | null,
          argument: acceptor.argument === undefined ? null : identifier(acceptor.argument, `waiter ${name}.acceptors[${index}].argument`)
        }
      })
      return {
        name,
        commandName: kebab(name),
        delaySeconds: nonNegativeInteger(raw.delay, `waiter ${name}.delay`, 0),
        maxAttempts: nonNegativeInteger(raw.maxAttempts, `waiter ${name}.maxAttempts`, 0),
        acceptors
      }
    })
    .filter((item): item is AwsWaiterDocumentation => item !== null)
}

function optionForMember(member: AwsShapeMemberDocumentation, shapes: ReadonlyMap<string, JsonRecord>): AwsOptionDocumentation {
  const target = shapes.get(member.shape)
  return {
    ...member,
    type: target ? shapeType(target) : member.type,
    documentation: member.documentation || (target ? documentation(target.documentation, `shape ${member.shape}.documentation`) : ''),
    enumValues: member.enumValues.length ? member.enumValues : target ? stringList(target.enum, `shape ${member.shape}.enum`) : [],
    min: member.min ?? (target ? numberOrNull(target.min, `shape ${member.shape}.min`) : null),
    max: member.max ?? (target ? numberOrNull(target.max, `shape ${member.shape}.max`) : null),
    skeletonValue: skeletonForShape(member.shape, shapes)
  }
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string, label: string): T[] {
  const seen = new Set<string>()
  return items.map((item) => {
    const value = key(item).toLowerCase()
    if (seen.has(value)) throw new AwsModelDocumentationError('duplicate', `${label} contains duplicate ${key(item)}.`)
    seen.add(value)
    return item
  })
}

function serviceRows(service: AwsServiceDocumentation): AwsModelDocumentationRow[] {
  const rows: AwsModelDocumentationRow[] = [{
    id: `service:${service.id}`,
    kind: 'service',
    serviceId: service.id,
    serviceName: service.displayName,
    commandName: null,
    optionName: null,
    title: service.displayName,
    summary: service.documentation,
    documentationUrl: service.documentationUrl,
    keywords: [service.id, service.cliName, service.displayName, service.modelVersion]
  }]
  for (const command of service.commands) {
    const base = `command:${service.id}:${command.name}`
    rows.push({
      id: base,
      kind: 'command',
      serviceId: service.id,
      serviceName: service.displayName,
      commandName: command.name,
      optionName: null,
      title: `${service.cliName} ${command.name}`,
      summary: command.documentation,
      documentationUrl: command.documentationUrl,
      keywords: [command.apiName, command.name, service.cliName]
    })
    for (const option of command.options) rows.push({
      id: `${base}:option:${option.name}`,
      kind: 'option',
      serviceId: service.id,
      serviceName: service.displayName,
      commandName: command.name,
      optionName: option.name,
      title: option.cliOption,
      summary: option.documentation,
      documentationUrl: command.documentationUrl,
      keywords: [option.name, option.cliOption, option.shape, option.type, ...option.enumValues]
    })
    if (command.paginator) rows.push({
      id: `${base}:paginator`, kind: 'paginator', serviceId: service.id, serviceName: service.displayName,
      commandName: command.name, optionName: null, title: `${command.name} paginator`,
      summary: `Input tokens: ${command.paginator.inputTokens.join(', ') || 'none'}. Output tokens: ${command.paginator.outputTokens.join(', ') || 'none'}.`,
      documentationUrl: command.documentationUrl, keywords: ['paginator', ...command.paginator.inputTokens, ...command.paginator.outputTokens]
    })
    for (const waiter of command.waiters) rows.push({
      id: `${base}:waiter:${waiter.name}`, kind: 'waiter', serviceId: service.id, serviceName: service.displayName,
      commandName: command.name, optionName: null, title: waiter.commandName,
      summary: `${waiter.maxAttempts} attempts with ${waiter.delaySeconds} seconds between attempts.`,
      documentationUrl: command.documentationUrl, keywords: ['waiter', waiter.name, waiter.commandName]
    })
    if (command.input) rows.push({
      id: `${base}:input`, kind: 'input', serviceId: service.id, serviceName: service.displayName,
      commandName: command.name, optionName: null, title: `${command.name} input`, summary: command.input.documentation,
      documentationUrl: command.documentationUrl, keywords: ['input', command.input.name, command.input.type]
    })
    if (command.output) rows.push({
      id: `${base}:output`, kind: 'output', serviceId: service.id, serviceName: service.displayName,
      commandName: command.name, optionName: null, title: `${command.name} output`, summary: command.output.documentation,
      documentationUrl: command.documentationUrl, keywords: ['output', command.output.name, command.output.type]
    })
    rows.push({
      id: `${base}:skeleton`, kind: 'skeleton', serviceId: service.id, serviceName: service.displayName,
      commandName: command.name, optionName: null, title: `${command.name} input skeleton`,
      summary: 'Deterministic input skeleton generated from the official input shape.',
      documentationUrl: command.documentationUrl, keywords: ['skeleton', 'input', 'json', 'yaml']
    })
  }
  return rows
}

export function buildAwsModelDocumentationIndex(sources: readonly AwsOfficialModelSource[]): AwsModelDocumentationIndex {
  if (!Array.isArray(sources) || sources.length > MAX_SERVICES) {
    throw new AwsModelDocumentationError('bounds', `AWS model inventory exceeds ${MAX_SERVICES} services.`)
  }
  const services = uniqueBy(sources.map((source, sourceIndex) => {
    const sourceRecord = record(source, `sources[${sourceIndex}]`)
    const serviceId = identifier(sourceRecord.serviceId, `sources[${sourceIndex}].serviceId`)
    const cliName = cliToken(sourceRecord.cliName, `sources[${sourceIndex}].cliName`)
    const modelVersion = identifier(sourceRecord.modelVersion, `sources[${sourceIndex}].modelVersion`)
    const serviceModel = record(sourceRecord.serviceModel, `sources[${sourceIndex}].serviceModel`)
    const metadata = optionalRecord(serviceModel.metadata, `service ${serviceId}.metadata`)
    const operationRows = entries(serviceModel.operations, `service ${serviceId}.operations`, MAX_OPERATIONS_PER_SERVICE)
    const shapeRows = entries(serviceModel.shapes, `service ${serviceId}.shapes`, MAX_SHAPES_PER_SERVICE)
    const shapes = new Map(shapeRows)
    const shapeDocs = shapeRows.map(([name, shape]) => buildShapeDocumentation(name, shape))
    const shapeDocsByName = new Map(shapeDocs.map((shape) => [shape.name, shape]))
    const paginatorModel = optionalRecord(sourceRecord.paginatorModel, `service ${serviceId}.paginatorModel`)
    const waiterModel = optionalRecord(sourceRecord.waiterModel, `service ${serviceId}.waiterModel`)
    const documentationUrl = `https://docs.aws.amazon.com/cli/latest/reference/${encodeURIComponent(cliName)}/index.html`
    const commands = uniqueBy(operationRows.map(([apiName, operation]) => {
      const name = kebab(apiName)
      if (!name) throw new AwsModelDocumentationError('invalid-model', `Operation ${apiName} has no CLI command name.`)
      const inputShape = shapeName(operation.input, `operation ${apiName}.input`)
      const outputShape = shapeName(operation.output, `operation ${apiName}.output`)
      const input = inputShape ? shapeDocsByName.get(inputShape) ?? null : null
      const output = outputShape ? shapeDocsByName.get(outputShape) ?? null : null
      const options = input ? input.members.map((member) => optionForMember(member, shapes)) : []
      return {
        apiName,
        name,
        documentation: documentation(operation.documentation, `operation ${apiName}.documentation`),
        documentationUrl: `https://docs.aws.amazon.com/cli/latest/reference/${encodeURIComponent(cliName)}/${encodeURIComponent(name)}.html`,
        inputShape,
        outputShape,
        options,
        paginator: paginatorFor(apiName, paginatorModel),
        waiters: waitersFor(apiName, waiterModel),
        input,
        output,
        inputSkeleton: skeletonForShape(inputShape, shapes)
      }
    }), (command) => command.name, `service ${serviceId} commands`)
    return {
      id: serviceId,
      cliName,
      modelVersion,
      displayName: identifier(metadata.serviceFullName ?? serviceId, `service ${serviceId}.metadata.serviceFullName`),
      documentation: documentation(serviceModel.documentation, `service ${serviceId}.documentation`),
      documentationUrl,
      apiReferenceUrl: officialDocsUrl(source.apiReferenceUrl, `service ${serviceId}.apiReferenceUrl`),
      commands,
      shapes: shapeDocs
    }
  }), (service) => service.id, 'AWS service inventory')
  const servicesByCliName = uniqueBy(services, (service) => service.cliName, 'AWS CLI service inventory')
  servicesByCliName.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id))
  for (const service of servicesByCliName) service.commands.sort((left, right) => left.name.localeCompare(right.name))
  const rows = servicesByCliName.flatMap(serviceRows)
  uniqueBy(rows, (row) => row.id, 'AWS documentation rows')
  return { source: 'official-aws-cli-models', services: servicesByCliName, rows }
}

function regex(query: string, flags: string): RegExp {
  if (query.length > MAX_QUERY) throw new AwsModelDocumentationError('bounds', `Search query exceeds ${MAX_QUERY} characters.`)
  const requested = flags || 'i'
  if (!/^[imsu]*$/.test(requested) || new Set(requested).size !== requested.length) {
    throw new AwsModelDocumentationError('invalid-selection', 'Regex flags may contain i, m, s, and u once each.')
  }
  try {
    return new RegExp(query, requested)
  } catch (error) {
    throw new AwsModelDocumentationError('invalid-selection', error instanceof Error ? error.message : 'Regex pattern is invalid.')
  }
}

export function searchAwsModelDocumentation(
  index: AwsModelDocumentationIndex,
  query: string,
  options: AwsModelDocumentationSearchOptions = {}
): AwsModelDocumentationSearchResult {
  if (typeof query !== 'string' || query.length > MAX_QUERY) {
    return { rows: [], error: `Search query must contain at most ${MAX_QUERY} characters.` }
  }
  const allowedKinds = options.kinds ? new Set(options.kinds) : null
  const scoped = index.rows.filter((row) =>
    (!allowedKinds || allowedKinds.has(row.kind)) &&
    (!options.serviceId || row.serviceId === options.serviceId) &&
    (!options.commandName || row.commandName === options.commandName)
  )
  if (!query) return { rows: scoped, error: null }
  const haystack = (row: AwsModelDocumentationRow): string =>
    [row.title, row.summary, row.serviceId, row.serviceName, row.commandName ?? '', row.optionName ?? '', ...row.keywords].join('\n')
  if (options.mode !== 'regex') {
    const needle = query.toLocaleLowerCase()
    return { rows: scoped.filter((row) => haystack(row).toLocaleLowerCase().includes(needle)), error: null }
  }
  try {
    const pattern = regex(query, options.flags ?? 'i')
    return { rows: scoped.filter((row) => pattern.test(haystack(row))), error: null }
  } catch (error) {
    return { rows: scoped, error: error instanceof Error ? error.message : 'Regex pattern is invalid.' }
  }
}

export function projectAwsDocumentationSelection(input: unknown): AwsDocumentationPortableProjection {
  const source = input === undefined || input === null ? {} : record(input, 'AWS documentation selection')
  const allowed = new Set(['serviceId', 'commandName', 'section'])
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new AwsModelDocumentationError('invalid-selection', `AWS documentation selection contains unsupported field ${key}.`)
  }
  const serviceId = source.serviceId === undefined || source.serviceId === null ? null : identifier(source.serviceId, 'selection.serviceId')
  const commandName = source.commandName === undefined || source.commandName === null ? null : cliToken(source.commandName, 'selection.commandName')
  const section = source.section === undefined ? 'overview' : identifier(source.section, 'selection.section')
  if (!Object.hasOwn(SECTION_LABELS, section)) throw new AwsModelDocumentationError('invalid-selection', `Unknown AWS documentation section ${section}.`)
  if (commandName && !serviceId) throw new AwsModelDocumentationError('invalid-selection', 'A command selection requires a service selection.')
  return {
    selection: { serviceId, commandName, section: section as AwsModelDocumentationSection },
    omissions: AWS_DOCUMENTATION_PORTABLE_OMISSIONS
  }
}

export function createAwsDocumentationPickerModel(
  index: AwsModelDocumentationIndex,
  input: unknown = {}
): AwsDocumentationPickerModel {
  const { selection } = projectAwsDocumentationSelection(input)
  const selectedService = selection.serviceId
    ? index.services.find((service) => service.id === selection.serviceId) ?? null
    : null
  const selectedCommand = selectedService && selection.commandName
    ? selectedService.commands.find((command) => command.name === selection.commandName) ?? null
    : null
  const services = index.services.map((service) => ({
    id: service.id,
    label: service.displayName,
    description: `${service.cliName}, model ${service.modelVersion}`,
    disabled: false,
    disabledReason: null
  }))
  const commands = selectedService
    ? selectedService.commands.map((command) => ({
        id: command.name,
        label: command.name,
        description: command.documentation || `Official ${selectedService.cliName} command documentation.`,
        disabled: false,
        disabledReason: null
      }))
    : [{
        id: 'choose-service',
        label: 'Choose a service first',
        description: 'Select an installed AWS CLI service to list its commands.',
        disabled: true,
        disabledReason: 'A service selection is required before commands are available.'
      }]
  const sections = (Object.keys(SECTION_LABELS) as AwsModelDocumentationSection[]).map((section) => {
    const requiresCommand = section !== 'overview'
    const unavailable = requiresCommand && !selectedCommand
    const missingFeature = selectedCommand && (
      (section === 'paginator' && !selectedCommand.paginator) ||
      (section === 'waiters' && selectedCommand.waiters.length === 0) ||
      (section === 'input' && !selectedCommand.input) ||
      (section === 'output' && !selectedCommand.output)
    )
    return {
      id: section,
      label: SECTION_LABELS[section],
      description: missingFeature
        ? `The official model does not define ${SECTION_LABELS[section].toLowerCase()} metadata for this command.`
        : `Show ${SECTION_LABELS[section].toLowerCase()} documentation.`,
      disabled: Boolean(unavailable || missingFeature),
      disabledReason: unavailable
        ? 'Choose a service and command before opening this section.'
        : missingFeature
          ? `The official model does not define ${SECTION_LABELS[section].toLowerCase()} metadata for this command.`
          : null
    }
  })
  return {
    services,
    commands,
    sections,
    selectedService,
    selectedCommand,
    disabledReason: index.services.length
      ? null
      : 'The installed AWS CLI model inventory is unavailable. Repair the bundled AWS CLI before browsing model documentation.'
  }
}
