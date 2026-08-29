/**
 * Model-driven AWS CLI contracts shared by the renderer and its host boundary.
 *
 * The installed AWS CLI model is the authority for service and operation metadata. The renderer
 * receives an already validated snapshot and emits an argv array through a typed callback. It
 * never assembles shell text, accepts a command string, or executes a process itself.
 */

export type AwsRisk = 'read' | 'write' | 'destructive'
export type AwsOutputMode = 'json' | 'yaml' | 'yaml-stream' | 'text' | 'table'

export interface AwsEnumValue {
  value: string
  label: string
  documentation?: string
}

export type AwsShape =
  | { kind: 'string' | 'date' | 'timestamp' | 'file'; label?: string; placeholder?: string }
  | { kind: 'boolean'; label?: string }
  | { kind: 'number'; label?: string; min?: number; max?: number; step?: number }
  | { kind: 'enum'; label?: string; values: AwsEnumValue[] }
  | { kind: 'list'; label?: string; item: AwsShape; minItems?: number; maxItems?: number }
  | { kind: 'map'; label?: string; value: AwsShape; maxEntries?: number }
  | { kind: 'structure'; label?: string; fields: AwsField[] }

export interface AwsField {
  name: string
  label: string
  shape: AwsShape
  required?: boolean
  documentation?: string
  sensitive?: boolean
}

export interface AwsOption {
  name: string
  label: string
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'file'
  required?: boolean
  documentation?: string
  values?: AwsEnumValue[]
  min?: number
  max?: number
  step?: number
}

export interface AwsPaginatorModel {
  id: string
  label: string
  inputToken?: string
  outputToken?: string
  pageSizeParam?: string
  maxItems?: number
}

export interface AwsWaiterModel {
  id: string
  label: string
  delaySeconds: number
  maxAttempts: number
  acceptors: string[]
}

export interface AwsOperationModel {
  id: string
  label: string
  documentation?: string
  risk: AwsRisk
  input?: AwsShape
  output?: AwsShape
  paginators: AwsPaginatorModel[]
  waiters: AwsWaiterModel[]
  streaming?: boolean
  supportsSkeleton?: boolean
  skeletonInput?: unknown
  skeletonOutput?: unknown
  jmesPathFields?: string[]
}

export interface AwsServiceModel {
  id: string
  label: string
  apiVersion: string
  source: 'installed-cli-model'
  commands: AwsOperationModel[]
}

export interface AwsModelCatalog {
  revision: string
  cliVersion: string
  loadedAt: number
  services: AwsServiceModel[]
  globalOptions: AwsOption[]
}

export interface AwsInvocationSettings {
  serviceId: string
  operationId: string
  profile?: string
  region?: string
  endpointUrl?: string
  globalOptions: Record<string, unknown>
  input: Record<string, unknown>
  paginatorId?: string
  waiterId?: string
  outputMode: AwsOutputMode
  jmesPath?: string
  skeleton: 'none' | 'input' | 'output'
  retryAttempts: number
}

export interface AwsInvocationRequest {
  argv: string[]
  settings: AwsInvocationSettings
  signal: AbortSignal
}

export interface AwsInvocationResult {
  output: unknown
  rawOutput?: string
  pages: number
  attempts: number
  durationMs: number
  stopped: boolean
}

export interface AwsExecutionPreview {
  argv: string[]
  risk: AwsRisk
  serviceLabel: string
  operationLabel: string
  profile: string | null
  region: string | null
  endpointUrl: string | null
  paginatorLabel: string | null
  waiterLabel: string | null
  outputMode: AwsOutputMode
  streaming: boolean
  retryAttempts: number
}

const SAFE_VALUE = /^[^\u0000-\u001f\u007f]{1,4096}$/
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

function appendValue(argv: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return
  if (typeof value === 'boolean') {
    if (value) argv.push(flag)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${flag}.`)
    argv.push(flag, String(value))
    return
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined || !SAFE_VALUE.test(text)) throw new Error(`Invalid value for ${flag}.`)
  argv.push(flag, text)
}

/** Convert the typed invocation into an argument vector. No shell grammar is involved. */
export function buildAwsArgv(settings: AwsInvocationSettings): string[] {
  if (!SAFE_NAME.test(settings.serviceId) || !SAFE_NAME.test(settings.operationId)) {
    throw new Error('The selected AWS service or operation name is invalid.')
  }
  const argv = ['aws', settings.serviceId, settings.operationId]
  appendValue(argv, '--profile', settings.profile)
  appendValue(argv, '--region', settings.region)
  appendValue(argv, '--endpoint-url', settings.endpointUrl)
  for (const [name, value] of Object.entries(settings.globalOptions)) {
    if (!SAFE_NAME.test(name)) throw new Error('The installed model returned an invalid global option name.')
    appendValue(argv, `--${name}`, value)
  }
  for (const [name, value] of Object.entries(settings.input)) {
    if (!SAFE_NAME.test(name)) throw new Error('The installed model returned an invalid input field name.')
    appendValue(argv, `--${name}`, value)
  }
  // Paginator and waiter ids are model metadata, not AWS CLI flags. The host executor uses the
  // selected ids to drive its bounded page and polling loop; inventing `--paginator` or `--waiter`
  // here would produce an argv vector the real CLI rejects.
  if (settings.outputMode !== 'json') appendValue(argv, '--output', settings.outputMode)
  if (settings.jmesPath) appendValue(argv, '--query', settings.jmesPath)
  if (settings.skeleton !== 'none') appendValue(argv, '--generate-cli-skeleton', settings.skeleton)
  return argv
}

export function validateAwsInvocation(settings: AwsInvocationSettings): string[] {
  const errors: string[] = []
  if (!settings.serviceId) errors.push('Choose a service.')
  if (!settings.operationId) errors.push('Choose an operation.')
  if (settings.profile && !SAFE_VALUE.test(settings.profile)) errors.push('The profile name contains unsupported characters.')
  if (settings.region && !SAFE_VALUE.test(settings.region)) errors.push('The region contains unsupported characters.')
  if (settings.endpointUrl && !/^https:\/\/[^\s]+$/.test(settings.endpointUrl)) errors.push('The endpoint must be an HTTPS URL.')
  if (settings.jmesPath && !SAFE_VALUE.test(settings.jmesPath)) errors.push('The JMESPath expression is too long or contains a control character.')
  if (!Number.isInteger(settings.retryAttempts) || settings.retryAttempts < 0 || settings.retryAttempts > 5) errors.push('Retries must be between 0 and 5.')
  return errors
}

export function redactAwsArgv(argv: string[], sensitiveNames: ReadonlySet<string> = new Set()): string[] {
  const redacted: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    redacted.push(sensitiveNames.has(token.replace(/^--/, '')) ? token : token)
    if (sensitiveNames.has(token.replace(/^--/, '')) && i + 1 < argv.length) {
      redacted.push('••••')
      i += 1
    }
  }
  return redacted
}
