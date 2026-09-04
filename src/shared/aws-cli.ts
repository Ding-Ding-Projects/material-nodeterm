// AWS CLI v2 model and documentation index contracts. This module is platform-free so the
// renderer, the desktop shell, and Server Edition can share one bounded parser and one honest
// completeness vocabulary. It never executes an AWS operation. The core loader reads installed
// model files, while the renderer presents the resulting index and official documentation links.

export const AWS_CLI_INDEX_KIND = 'aws-cli-index' as const
export const AWS_CLI_INDEX_VERSION = 1 as const
export const AWS_CLI_DOCS_BASE_URL = 'https://docs.aws.amazon.com/cli/latest/reference'

/** Limits are deliberately finite. A corrupt or unexpectedly huge model file must not turn a
 * refresh into an unbounded JSON parse or a renderer-sized payload. */
export const AWS_CLI_LIMITS = {
  maxFileBytes: 32 * 1024 * 1024,
  maxFiles: 4096,
  maxServices: 2048,
  maxCommands: 100_000,
  maxOptionsPerCommand: 256,
  maxShapesPerService: 100_000,
  maxMembersPerShape: 2048,
  maxEnumsPerShape: 4096,
  maxDepth: 32,
  maxStringLength: 32_768,
  maxDocumentationLength: 256 * 1024
} as const

export type AwsCliModelFileKind = 'service' | 'paginator' | 'waiter' | 'cli'

export interface AwsCliModelFileInput {
  path: string
  kind: AwsCliModelFileKind
  /** UTF-8 JSON text. The loader enforces the byte bound before this reaches the parser. */
  text: string
  modifiedAt?: number
}

export interface AwsCliShapeMember {
  name: string
  shape: string | null
  location?: string
  locationName?: string
  documentation?: string
  required: boolean
}

export interface AwsCliShape {
  name: string
  type: string
  documentation: string | null
  required: boolean
  members: AwsCliShapeMember[]
  enumValues: string[]
  min: number | null
  max: number | null
  pattern: string | null
  valueShape: string | null
  memberShape: string | null
}

export type AwsCliOptionValueKind = 'flag' | 'string' | 'number' | 'enum' | 'path' | 'json'

export interface AwsCliOption {
  name: string
  aliases: string[]
  valueKind: AwsCliOptionValueKind
  choices: string[]
  required: boolean
  documentation: string | null
  source: 'cli-model' | 'aws-cli-v2'
}

export interface AwsCliPaginator {
  inputToken: string | string[] | null
  outputToken: string | string[] | null
  resultKey: string | string[] | null
  limitKey: string | null
  pageSize: number | null
  moreResults: string | null
}

export interface AwsCliWaiterAcceptor {
  state: string
  matcher: string
  argument: string | null
  expected: string | number | boolean | null
}

export interface AwsCliWaiter {
  name: string
  operation: string
  delaySeconds: number | null
  maxAttempts: number | null
  acceptors: AwsCliWaiterAcceptor[]
  documentationUrl: string
}

export interface AwsCliSkeletonSupport {
  supported: boolean
  modes: readonly ['input', 'output', 'yaml-input', 'yaml-output']
  note: string
}

export interface AwsCliCommand {
  name: string
  cliPath: string
  documentationUrl: string
  documentation: string | null
  inputShape: string | null
  outputShape: string | null
  options: AwsCliOption[]
  paginator: AwsCliPaginator | null
  waiters: AwsCliWaiter[]
  skeleton: AwsCliSkeletonSupport
}

export interface AwsCliService {
  /** The command namespace used by `aws <service> <operation>`. */
  cliName: string
  id: string
  name: string
  apiVersion: string | null
  protocol: string | null
  endpointPrefix: string | null
  documentationUrl: string
  commands: AwsCliCommand[]
  shapes: AwsCliShape[]
}

export interface AwsCliCompleteness {
  state: 'complete' | 'partial' | 'unknown'
  serviceFiles: number
  paginatorFiles: number
  waiterFiles: number
  cliFiles: number
  services: number
  commands: number
  commandsWithOptions: number
  commandsWithPaginator: number
  commandsWithWaiters: number
  reasons: string[]
}

export interface AwsCliRevision {
  value: string | null
  /** exact means derived from every accepted model file's bytes, not from a timestamp or name. */
  kind: 'exact' | 'unknown'
  observedAt: number | null
  files: number
}

export interface AwsCliIndexSnapshot {
  kind: typeof AWS_CLI_INDEX_KIND
  version: typeof AWS_CLI_INDEX_VERSION
  source: 'installed' | 'cache' | 'mixed' | 'none'
  state: 'empty' | 'partial' | 'complete' | 'stale' | 'error'
  cache: {
    state: 'missing' | 'loaded' | 'written' | 'unreadable' | 'invalid'
    path: string | null
    error: string | null
  }
  revision: AwsCliRevision
  installedRoot: string | null
  generatedAt: number | null
  docsBaseUrl: typeof AWS_CLI_DOCS_BASE_URL
  completeness: AwsCliCompleteness
  services: AwsCliService[]
  error: string | null
}

const GLOBAL_OPTIONS: readonly AwsCliOption[] = [
  option('--debug', 'flag', 'Turn on debug logging.'),
  option('--endpoint-url', 'string', 'Override the AWS service endpoint URL.'),
  option('--no-verify-ssl', 'flag', 'Do not verify SSL certificates.'),
  option('--no-paginate', 'flag', 'Disable automatic pagination.'),
  option('--output', 'enum', 'Output format.', ['json', 'text', 'table', 'yaml', 'yaml-stream']),
  option('--query', 'string', 'JMESPath query applied to output.'),
  option('--profile', 'string', 'Use the named AWS CLI profile.'),
  option('--region', 'string', 'Use the specified AWS Region.'),
  option('--version', 'flag', 'Display the AWS CLI version.'),
  option('--color', 'enum', 'Color output.', ['on', 'off', 'auto']),
  option('--no-sign-request', 'flag', 'Do not sign requests.'),
  option('--ca-bundle', 'path', 'The CA certificate bundle to use.'),
  option('--cli-read-timeout', 'number', 'Socket read timeout in seconds.'),
  option('--cli-connect-timeout', 'number', 'Connection timeout in seconds.'),
  option('--cli-binary-format', 'enum', 'Binary input format.', ['base64', 'raw-in-base64-out']),
  option('--no-cli-pager', 'flag', 'Disable the pager.'),
  option('--cli-auto-prompt', 'flag', 'Use the guided AWS CLI auto-prompt.'),
  option('--no-cli-auto-prompt', 'flag', 'Disable the guided AWS CLI auto-prompt.'),
  option('--generate-cli-skeleton', 'enum', 'Generate or validate a command skeleton.', [
    'input',
    'output',
    'yaml-input',
    'yaml-output'
  ])
]

function option(
  name: string,
  valueKind: AwsCliOptionValueKind,
  documentation: string,
  choices: string[] = []
): AwsCliOption {
  return {
    name,
    aliases: [],
    valueKind,
    choices,
    required: false,
    documentation,
    source: 'aws-cli-v2'
  }
}

function stringValue(value: unknown, max = AWS_CLI_LIMITS.maxStringLength): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, max) : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedDocumentation(value: unknown): string | null {
  return stringValue(value, AWS_CLI_LIMITS.maxDocumentationLength)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function listStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = stringValue(item)
    if (text) out.push(text)
    if (out.length >= limit) break
  }
  return out
}

function safeServiceId(metadata: Record<string, unknown>, fallback: string): string {
  return (
    stringValue(metadata.serviceId) ??
    stringValue(metadata.serviceFullName) ??
    stringValue(metadata.endpointPrefix) ??
    fallback
  )
}

function docsUrl(service: string, command?: string): string {
  const safe = (value: string): string => encodeURIComponent(value.trim().toLowerCase())
  return command
    ? `${AWS_CLI_DOCS_BASE_URL}/${safe(service)}/${safe(command)}.html`
    : `${AWS_CLI_DOCS_BASE_URL}/${safe(service)}.html`
}

function parseShape(name: string, raw: unknown, required: ReadonlySet<string>): AwsCliShape {
  const value = record(raw) ?? {}
  const membersRaw = record(value.members)
  const members: AwsCliShapeMember[] = []
  if (membersRaw) {
    for (const [memberName, memberRaw] of Object.entries(membersRaw).slice(0, AWS_CLI_LIMITS.maxMembersPerShape)) {
      const member = record(memberRaw) ?? {}
      members.push({
        name: memberName,
        shape: stringValue(member.shape),
        location: stringValue(member.location) ?? undefined,
        locationName: stringValue(member.locationName) ?? undefined,
        documentation: boundedDocumentation(member.documentation) ?? undefined,
        required: required.has(memberName)
      })
    }
  }
  const member = record(value.member)
  return {
    name,
    type: stringValue(value.type) ?? 'unknown',
    documentation: boundedDocumentation(value.documentation),
    required: false,
    members,
    enumValues: listStrings(value.enum, AWS_CLI_LIMITS.maxEnumsPerShape),
    min: finiteNumber(value.min),
    max: finiteNumber(value.max),
    pattern: stringValue(value.pattern),
    valueShape: stringValue(value.value),
    memberShape: stringValue(member?.shape)
  }
}

function parsePaginator(raw: unknown): AwsCliPaginator | null {
  const value = record(raw)
  if (!value) return null
  const token = (candidate: unknown): string | string[] | null => {
    const values = listStrings(candidate, 8)
    if (values.length > 0) return values.length === 1 ? values[0] : values
    return stringValue(candidate)
  }
  return {
    inputToken: token(value.input_token),
    outputToken: token(value.output_token),
    resultKey: token(value.result_key),
    limitKey: stringValue(value.limit_key),
    pageSize: finiteNumber(value.page_size),
    moreResults: stringValue(value.more_results)
  }
}

function parseWaiter(service: string, name: string, raw: unknown): AwsCliWaiter | null {
  const value = record(raw)
  const operation = stringValue(value?.operation)
  if (!value || !operation) return null
  const acceptors: AwsCliWaiterAcceptor[] = []
  if (Array.isArray(value.acceptors)) {
    for (const rawAcceptor of value.acceptors.slice(0, 128)) {
      const acceptor = record(rawAcceptor)
      if (!acceptor) continue
      const expected = acceptor.expected
      const safeExpected =
        typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean'
          ? expected
          : null
      acceptors.push({
        state: stringValue(acceptor.state) ?? 'unknown',
        matcher: stringValue(acceptor.matcher) ?? 'unknown',
        argument: stringValue(acceptor.argument),
        expected: safeExpected
      })
    }
  }
  return {
    name,
    operation,
    delaySeconds: finiteNumber(value.delay),
    maxAttempts: finiteNumber(value.maxAttempts ?? value.max_attempts),
    acceptors,
    documentationUrl: docsUrl(service, operation)
  }
}

function parseCliOption(raw: unknown): AwsCliOption | null {
  const value = record(raw)
  if (!value) return null
  const names = listStrings(value.names ?? value.name ?? value.option, 8)
  const name = names.find((candidate) => candidate.startsWith('-'))
  if (!name) return null
  const aliases = names.filter((candidate) => candidate !== name)
  const type = stringValue(value.type ?? value.valueType ?? value.kind)?.toLowerCase()
  const valueKind: AwsCliOptionValueKind =
    value.action === 'store_true' || value.isFlag === true || type === 'boolean'
      ? 'flag'
      : type === 'integer' || type === 'float' || type === 'number'
        ? 'number'
        : type === 'path' || type === 'file'
          ? 'path'
          : type === 'json' || type === 'structure'
            ? 'json'
            : Array.isArray(value.choices) || Array.isArray(value.choicesList)
              ? 'enum'
              : 'string'
  return {
    name,
    aliases,
    valueKind,
    choices: listStrings(value.choices ?? value.choicesList, 128),
    required: value.required === true,
    documentation: boundedDocumentation(value.help ?? value.documentation ?? value.description),
    source: 'cli-model'
  }
}

interface MutableCommand {
  name: string
  documentation: string | null
  inputShape: string | null
  outputShape: string | null
  cliOptions: AwsCliOption[]
  paginator: AwsCliPaginator | null
  waiters: AwsCliWaiter[]
}

interface MutableService {
  cliName: string
  id: string
  name: string
  apiVersion: string | null
  protocol: string | null
  endpointPrefix: string | null
  commands: Map<string, MutableCommand>
  shapes: AwsCliShape[]
  serviceFiles: number
  paginatorFiles: number
  waiterFiles: number
  cliFiles: number
}

function ensureCommand(service: MutableService, name: string): MutableCommand {
  const existing = service.commands.get(name)
  if (existing) return existing
  const created: MutableCommand = {
    name,
    documentation: null,
    inputShape: null,
    outputShape: null,
    cliOptions: [],
    paginator: null,
    waiters: []
  }
  service.commands.set(name, created)
  return created
}

function serviceFromPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const dataIndex = normalized.indexOf('/data/')
  if (dataIndex >= 0) {
    const tail = normalized.slice(dataIndex + 6).split('/')
    if (tail[0]) return tail[0]
  }
  const parts = normalized.split('/')
  const fileIndex = parts.findIndex((part) => part === 'service-2.json' || part === 'paginators-1.json' || part === 'waiters-2.json')
  return fileIndex > 0 ? parts[fileIndex - 1] : 'unknown-service'
}

function mergeCliOptions(service: MutableService, raw: unknown): void {
  const structural = new Set(['services', 'commands', 'subcommands', 'options', 'arguments', 'parameters', 'metadata', 'documentation'])
  const visit = (value: unknown, contextService: string | undefined, contextOperation: string | undefined, depth: number): void => {
    if (depth > AWS_CLI_LIMITS.maxDepth) return
    if (Array.isArray(value)) {
      for (const child of value.slice(0, AWS_CLI_LIMITS.maxCommands)) visit(child, contextService, contextOperation, depth + 1)
      return
    }
    const object = record(value)
    if (!object) return
    const nextService = stringValue(object.service) ?? stringValue(object.serviceName) ?? contextService
    const nextOperation = stringValue(object.operation) ?? stringValue(object.operationName) ?? contextOperation
    if (nextService && nextOperation && (nextService === service.cliName || nextService === service.id)) {
      const command = ensureCommand(service, nextOperation)
      const optionValues = object.options ?? object.arguments ?? object.parameters
      if (Array.isArray(optionValues)) {
        for (const rawOption of optionValues.slice(0, AWS_CLI_LIMITS.maxOptionsPerCommand)) {
          const parsed = parseCliOption(rawOption)
          if (parsed && !command.cliOptions.some((existing) => existing.name === parsed.name)) command.cliOptions.push(parsed)
        }
      }
    }
    for (const [key, child] of Object.entries(object).slice(0, AWS_CLI_LIMITS.maxCommands)) {
      const childRecord = record(child)
      const hasOptionList = Array.isArray(childRecord?.options ?? childRecord?.arguments ?? childRecord?.parameters)
      const childService = nextService ?? (key === service.cliName || key === service.id ? key : undefined)
      const childOperation = nextOperation ?? (!structural.has(key) && (hasOptionList || childRecord?.name !== undefined) ? key : undefined)
      visit(child, childService, childOperation, depth + 1)
    }
  }
  visit(raw, undefined, undefined, 0)
}

function parseModelJson(file: AwsCliModelFileInput): unknown {
  const bytes = new TextEncoder().encode(file.text).byteLength
  if (bytes > AWS_CLI_LIMITS.maxFileBytes) throw new Error(`${file.path} exceeds ${AWS_CLI_LIMITS.maxFileBytes} bytes`)
  try {
    return JSON.parse(file.text)
  } catch (error) {
    throw new Error(`${file.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Parse installed AWS CLI v2 and botocore model files into one deterministic index. */
export function parseAwsCliModelFiles(files: readonly AwsCliModelFileInput[], now = Date.now()): AwsCliIndexSnapshot {
  const boundedFiles = files.slice(0, AWS_CLI_LIMITS.maxFiles)
  const services = new Map<string, MutableService>()
  const cliPayloads: unknown[] = []
  let fileCount = 0
  let rejectedFiles = 0
  for (const file of boundedFiles) {
    let raw: unknown
    try {
      raw = parseModelJson(file)
    } catch {
      rejectedFiles++
      continue
    }
    if (file.kind === 'cli') {
      cliPayloads.push(raw)
      fileCount++
      continue
    }
    const serviceName = serviceFromPath(file.path)
    const root = record(raw) ?? {}
    const metadata = record(root.metadata) ?? {}
    let service = services.get(serviceName)
    if (!service) {
      service = {
        cliName: serviceName,
        id: safeServiceId(metadata, serviceName),
        name: stringValue(metadata.serviceFullName) ?? serviceName,
        apiVersion: stringValue(metadata.apiVersion),
        protocol: stringValue(metadata.protocol),
        endpointPrefix: stringValue(metadata.endpointPrefix),
        commands: new Map(),
        shapes: [],
        serviceFiles: 0,
        paginatorFiles: 0,
        waiterFiles: 0,
        cliFiles: 0
      }
      services.set(serviceName, service)
    }
    fileCount++
    if (file.kind === 'service') {
      service.serviceFiles++
      const operations = record(root.operations)
      const shapes = record(root.shapes)
      for (const [name, rawOperation] of Object.entries(operations ?? {}).slice(0, AWS_CLI_LIMITS.maxCommands)) {
        const operation = record(rawOperation) ?? {}
        const command = ensureCommand(service, name)
        command.documentation = boundedDocumentation(operation.documentation)
        const input = record(operation.input)
        const output = record(operation.output)
        command.inputShape = stringValue(input?.shape)
        command.outputShape = stringValue(output?.shape)
      }
      const requiredByShape = new Map<string, ReadonlySet<string>>()
      for (const [name, rawShape] of Object.entries(shapes ?? {}).slice(0, AWS_CLI_LIMITS.maxShapesPerService)) {
        const shape = record(rawShape) ?? {}
        requiredByShape.set(name, new Set(listStrings(shape.required, AWS_CLI_LIMITS.maxMembersPerShape)))
      }
      for (const [name, rawShape] of Object.entries(shapes ?? {}).slice(0, AWS_CLI_LIMITS.maxShapesPerService)) {
        service.shapes.push(parseShape(name, rawShape, requiredByShape.get(name) ?? new Set()))
      }
    } else if (file.kind === 'paginator') {
      service.paginatorFiles++
      const pagination = record(root.pagination)
      for (const [name, rawPaginator] of Object.entries(pagination ?? {}).slice(0, AWS_CLI_LIMITS.maxCommands)) {
        ensureCommand(service, name).paginator = parsePaginator(rawPaginator)
      }
    } else if (file.kind === 'waiter') {
      service.waiterFiles++
      const waiters = record(root.waiters)
      for (const [name, rawWaiter] of Object.entries(waiters ?? {}).slice(0, AWS_CLI_LIMITS.maxCommands)) {
        const parsed = parseWaiter(serviceName, name, rawWaiter)
        if (parsed) ensureCommand(service, parsed.operation).waiters.push(parsed)
      }
    }
  }

  // `cli.json` is one shared command tree, not a service named "cli". Apply it after all service
  // model paths have been discovered, so filesystem enumeration order cannot create a phantom
  // service or make options disappear simply because the CLI file was visited first.
  for (const payload of cliPayloads) {
    for (const service of services.values()) {
      service.cliFiles++
      mergeCliOptions(service, payload)
    }
  }

  const outputServices: AwsCliService[] = [...services.values()].slice(0, AWS_CLI_LIMITS.maxServices).map((service) => {
    const commands = [...service.commands.values()].slice(0, AWS_CLI_LIMITS.maxCommands).map((command) => {
      const options = [...GLOBAL_OPTIONS, ...command.cliOptions]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.name === item.name) === index)
        .slice(0, AWS_CLI_LIMITS.maxOptionsPerCommand)
      return {
        name: command.name,
        cliPath: `aws ${serviceNameForCli(service)} ${command.name}`,
        documentationUrl: docsUrl(serviceNameForCli(service), command.name),
        documentation: command.documentation,
        inputShape: command.inputShape,
        outputShape: command.outputShape,
        options,
        paginator: command.paginator,
        waiters: command.waiters,
        skeleton: {
          supported: true,
          modes: ['input', 'output', 'yaml-input', 'yaml-output'] as const,
          note: 'AWS CLI v2 can generate input skeletons and output skeletons for this operation. Generated skeletons are version-specific.'
        }
      }
    })
    return {
      cliName: service.cliName,
      id: service.id,
      name: service.name,
      apiVersion: service.apiVersion,
      protocol: service.protocol,
      endpointPrefix: service.endpointPrefix,
      documentationUrl: docsUrl(serviceNameForCli(service)),
      commands,
      shapes: service.shapes.slice(0, AWS_CLI_LIMITS.maxShapesPerService)
    }
  })
  const reasons: string[] = []
  if (boundedFiles.length === 0) reasons.push('No installed AWS CLI model files were found.')
  const serviceFileCount = [...services.values()].reduce((total, item) => total + item.serviceFiles, 0)
  if (serviceFileCount === 0 && boundedFiles.length > 0) reasons.push('No service-2.json model was available, so service and command coverage is unknown.')
  if (boundedFiles.length >= AWS_CLI_LIMITS.maxFiles) reasons.push(`The model file limit of ${AWS_CLI_LIMITS.maxFiles} was reached.`)
  if (rejectedFiles > 0) reasons.push(`${rejectedFiles} model file${rejectedFiles === 1 ? '' : 's'} could not be parsed.`)
  const completenessState: AwsCliCompleteness['state'] =
    outputServices.length === 0 || rejectedFiles > 0 || serviceFileCount === 0
      ? (outputServices.length === 0 || serviceFileCount === 0 ? 'unknown' : 'partial')
      : 'complete'
  const commands = outputServices.flatMap((service) => service.commands)
  const completeness: AwsCliCompleteness = {
    state: completenessState,
    serviceFiles: [...services.values()].reduce((total, item) => total + item.serviceFiles, 0),
    paginatorFiles: [...services.values()].reduce((total, item) => total + item.paginatorFiles, 0),
    waiterFiles: [...services.values()].reduce((total, item) => total + item.waiterFiles, 0),
    cliFiles: cliPayloads.length,
    services: outputServices.length,
    commands: commands.length,
    commandsWithOptions: commands.filter((command) => command.options.length > 0).length,
    commandsWithPaginator: commands.filter((command) => command.paginator !== null).length,
    commandsWithWaiters: commands.filter((command) => command.waiters.length > 0).length,
    reasons
  }
  return {
    kind: AWS_CLI_INDEX_KIND,
    version: AWS_CLI_INDEX_VERSION,
    source: outputServices.length > 0 ? 'installed' : 'none',
    state: outputServices.length === 0 ? 'empty' : completenessState === 'complete' ? 'complete' : 'partial',
    cache: { state: 'missing', path: null, error: null },
    revision: { value: null, kind: 'unknown', observedAt: now, files: fileCount },
    installedRoot: boundedFiles[0]?.path ?? null,
    generatedAt: now,
    docsBaseUrl: AWS_CLI_DOCS_BASE_URL,
    completeness,
    services: outputServices,
    error: null
  }
}

function serviceNameForCli(service: MutableService | AwsCliService): string {
  const value = ('cliName' in service ? service.cliName : service.endpointPrefix) ?? service.id ?? service.name
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

export interface AwsCliSearchRequest {
  query: string
  mode: 'text' | 'regex'
  flags?: string
  maxResults?: number
}

export interface AwsCliSearchResult {
  service: AwsCliService
  command: AwsCliCommand | null
  matchedIn: 'service' | 'command' | 'option' | 'waiter' | 'shape'
}

/** Search services, commands, options, waiters, and shape names without loading a second index. */
export function searchAwsCliIndex(index: AwsCliIndexSnapshot, request: AwsCliSearchRequest): AwsCliSearchResult[] {
  const query = request.query.trim()
  if (!query) return []
  const limit = Math.max(1, Math.min(10_000, Math.floor(request.maxResults ?? 500)))
  let matcher: (value: string) => boolean
  if (request.mode === 'regex') {
    if (query.length > AWS_CLI_LIMITS.maxStringLength) return []
    try {
      const regex = new RegExp(query, request.flags ?? 'i')
      matcher = (value) => {
        regex.lastIndex = 0
        return regex.test(value)
      }
    } catch {
      return []
    }
  } else {
    const lower = query.toLocaleLowerCase()
    matcher = (value) => value.toLocaleLowerCase().includes(lower)
  }
  const results: AwsCliSearchResult[] = []
  const add = (service: AwsCliService, command: AwsCliCommand | null, matchedIn: AwsCliSearchResult['matchedIn']) => {
    if (results.length < limit) results.push({ service, command, matchedIn })
  }
  for (const service of index.services) {
    if (matcher(`${service.id} ${service.name}`)) add(service, null, 'service')
    for (const command of service.commands) {
      if (matcher(`${command.name} ${command.documentation ?? ''}`)) add(service, command, 'command')
      else if (command.options.some((option) => matcher(`${option.name} ${option.documentation ?? ''}`))) add(service, command, 'option')
      else if (command.waiters.some((waiter) => matcher(`${waiter.name} ${waiter.operation}`))) add(service, command, 'waiter')
      else if (service.shapes.some((shape) => matcher(`${shape.name} ${shape.documentation ?? ''}`))) add(service, command, 'shape')
      if (results.length >= limit) return results
    }
    if (results.length >= limit) return results
  }
  return results
}

/** Help fallback is represented as an argv vector, never as a shell string. The core may execute
 * this only after the caller opts into the documented help route; it can never become an arbitrary
 * operation command or an editable shell field. */
export function awsCliHelpArgv(service?: string, command?: string): string[] {
  const valid = (value: string): boolean => /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value)
  const args = ['aws']
  if (service && valid(service)) args.push(service)
  if (command && valid(command)) args.push(command)
  args.push('help')
  return args
}

/** Build a blank but truthful snapshot for missing, offline, or malformed model sources. */
export function emptyAwsCliIndex(error: string | null = null, cache: AwsCliIndexSnapshot['cache'] = { state: 'missing', path: null, error: null }): AwsCliIndexSnapshot {
  return {
    kind: AWS_CLI_INDEX_KIND,
    version: AWS_CLI_INDEX_VERSION,
    source: 'none',
    state: error ? 'error' : 'empty',
    cache,
    revision: { value: null, kind: 'unknown', observedAt: null, files: 0 },
    installedRoot: null,
    generatedAt: null,
    docsBaseUrl: AWS_CLI_DOCS_BASE_URL,
    completeness: {
      state: 'unknown',
      serviceFiles: 0,
      paginatorFiles: 0,
      waiterFiles: 0,
      cliFiles: 0,
      services: 0,
      commands: 0,
      commandsWithOptions: 0,
      commandsWithPaginator: 0,
      commandsWithWaiters: 0,
      reasons: [error ?? 'No installed AWS CLI model source is available. This is not an empty AWS catalog.']
    },
    services: [],
    error
  }
}
