import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access } from 'node:fs/promises'
import { accessSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isAwsProfileName,
  isAwsRegion,
  isCloudControlTypeName,
  type AwsCliRuntimeStatus,
  type AwsManagerBinding,
  type AwsManagerOperation,
  type AwsManagerProgress,
  type AwsManagerRequest,
  type AwsManagerResult,
  type AwsOperationPreview,
  type AwsOperationRisk,
  type AwsProfileChoice
} from '../shared/aws-resource'
import { AtomicJsonArrayStore } from './atomic-json-store'
import type { CorePlatform } from './platform'
import { validateCloudFormationPreviewInput } from '../shared/cloudformation'
import { buildAwsWizardDefinition, validateAwsWizardValue, type AwsWizardFieldDefinition } from '../shared/aws-wizard'
import type { AwsWizardModelService } from './aws-wizard/service'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 128 * 1024
const COMMAND_TIMEOUT_MS = 90_000
const CLOUDFORMATION_PREVIEW_TIMEOUT_MS = 12 * 60_000
const MAX_RESULTS = 100

interface CommandSpec {
  service: AwsOperationPreview['service']
  operation: string
  args: string[]
  risk: AwsOperationRisk
  pagination: AwsOperationPreview['pagination']
}

interface CommandOutput {
  stdout: string
  stderr: string
}

export type AwsCliResolver = () => Promise<{ path: string | null; reason: string | null }>

function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || trimmed.includes('\0')) throw new Error(`${label} is invalid.`)
  return trimmed
}

function optionalText(value: unknown, label: string, max = 4096): string | null {
  if (value === undefined || value === null || value === '') return null
  return text(value, label, max)
}

function jsonDocument(value: unknown, label: string, expected: 'object' | 'array'): string {
  const source = text(value, label, MAX_TEXT_BYTES)
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
  const valid = expected === 'array'
    ? Array.isArray(parsed)
    : typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  if (!valid) throw new Error(`${label} must be a JSON ${expected}.`)
  return JSON.stringify(parsed)
}

function endpoint(value: string | null | undefined): string | null {
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('The endpoint must be a valid URL.')
  }
  if (parsed.username || parsed.password) throw new Error('Endpoint URLs cannot contain credentials.')
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('The endpoint must use HTTPS, except for an explicit loopback endpoint.')
  }
  if (value.length > 2048) throw new Error('The endpoint URL is too long.')
  return parsed.toString()
}

function maxResults(value: unknown): number {
  if (value === undefined) return MAX_RESULTS
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`Maximum results must be between 1 and ${MAX_RESULTS}.`)
  }
  return value
}

function coreInput(request: AwsManagerRequest): Record<string, unknown> {
  const value = (request as AwsManagerRequest & { input?: unknown }).input
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function coreInputText(request: AwsManagerRequest, key: string, label: string, max = 2048): string {
  return text(coreInput(request)[key], label, max)
}

function genericRisk(commandName: string): AwsOperationRisk {
  const name = commandName.toLowerCase()
  if (/(delete|deregister|destroy|terminate|revoke|remove|purge|decommission|cancel)/.test(name)) return 'destructive'
  if (/(create|put|post|update|modify|start|stop|run|attach|detach|register|enable|disable|set|associate|disassociate)/.test(name)) return 'write'
  return 'read-only'
}

function kebab(value: string): string {
  return value.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1-$2').replace(/([a-z0-9])([A-Z])/gu, '$1-$2').replace(/[_\s]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '').toLowerCase()
}

function genericFieldArgs(field: AwsWizardFieldDefinition, value: unknown, args: string[]): void {
  if (value === undefined || value === null || value === '') return
  const option = `--${kebab(field.name)}`
  if (field.kind === 'boolean') {
    args.push(value === true ? option : `--no-${kebab(field.name)}`)
    return
  }
  if (field.kind === 'file') {
    const file = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const selected = typeof file.path === 'string' ? file.path : ''
    if (!selected || !isAbsolute(selected)) throw new Error(`${field.name} must be selected through the local file picker.`)
    args.push(option, `fileb://${selected}`)
    return
  }
  args.push(option, typeof value === 'object' ? JSON.stringify(value) : String(value))
}

function localTemplate(value: unknown): string {
  const file = text(value, 'Template path', 4096)
  if (!isAbsolute(file)) throw new Error('Choose a local CloudFormation template with the Browse control.')
  try {
    accessSync(file)
    if (!statSync(file).isFile()) throw new Error('Choose a local CloudFormation template file, not a folder.')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Choose a local')) throw error
    throw new Error('The selected CloudFormation template could not be read. Choose it again with Browse.')
  }
  return file
}

function coreIds(request: AwsManagerRequest): string {
  const raw = coreInputText(request, 'instanceIds', 'Instance IDs')
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (!ids.length || ids.length > 100 || ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Instance IDs must be a comma-separated list of safe identifiers.')
  return ids.join(',')
}

function safeBinding(value: unknown): AwsManagerBinding | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.nodeId !== 'string' || raw.nodeId.length < 1 || raw.nodeId.length > 256) return null
  if (!isAwsProfileName(raw.profileName) || !isAwsRegion(raw.region)) return null
  let endpointUrl: string | null
  try {
    endpointUrl = endpoint(typeof raw.endpointUrl === 'string' ? raw.endpointUrl : null)
  } catch {
    return null
  }
  return {
    nodeId: raw.nodeId,
    profileName: raw.profileName.trim(),
    region: raw.region.trim(),
    endpointUrl,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  }
}

function operationSpec(request: AwsManagerRequest): CommandSpec {
  const token = optionalText(request.nextToken, 'Pagination token', 16_384)
  switch (request.operation) {
    case 'resource-list-views':
      return {
        service: 'resource-explorer-2',
        operation: 'list-views',
        args: ['resource-explorer-2', 'list-views', '--max-results', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])],
        risk: 'read-only',
        pagination: 'manual-next-token'
      }
    case 'resource-search': {
      const query = text(request.query, 'Resource query', 1024)
      const viewArn = optionalText(request.viewArn, 'View ARN', 2048)
      return {
        service: 'resource-explorer-2',
        operation: 'search',
        args: ['resource-explorer-2', 'search', '--query-string', query, '--max-results', String(maxResults(request.maxResults)), ...(viewArn ? ['--view-arn', viewArn] : []), ...(token ? ['--next-token', token] : [])],
        risk: 'read-only',
        pagination: 'manual-next-token'
      }
    }
    case 'cloud-list-types':
      return {
        service: 'cloudformation',
        operation: 'list-types',
        args: ['cloudformation', 'list-types', '--visibility', 'PUBLIC', '--deprecated-status', 'LIVE', '--max-results', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])],
        risk: 'read-only',
        pagination: 'manual-next-token'
      }
    case 'cloud-list-resources': {
      const typeName = text(request.typeName, 'Resource type', 256)
      if (!isCloudControlTypeName(typeName)) throw new Error('Resource type must use the AWS::Service::Type form.')
      return {
        service: 'cloudcontrol',
        operation: 'list-resources',
        args: ['cloudcontrol', 'list-resources', '--type-name', typeName, '--max-results', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])],
        risk: 'read-only',
        pagination: 'manual-next-token'
      }
    }
    case 'cloud-get-resource': {
      const typeName = text(request.typeName, 'Resource type', 256)
      if (!isCloudControlTypeName(typeName)) throw new Error('Resource type must use the AWS::Service::Type form.')
      return {
        service: 'cloudcontrol',
        operation: 'get-resource',
        args: ['cloudcontrol', 'get-resource', '--type-name', typeName, '--identifier', text(request.identifier, 'Resource identifier', 2048)],
        risk: 'read-only',
        pagination: 'none'
      }
    }
    case 'cloud-create-resource': {
      const typeName = text(request.typeName, 'Resource type', 256)
      if (!isCloudControlTypeName(typeName)) throw new Error('Resource type must use the AWS::Service::Type form.')
      return {
        service: 'cloudcontrol',
        operation: 'create-resource',
        args: ['cloudcontrol', 'create-resource', '--type-name', typeName, '--desired-state', jsonDocument(request.desiredState, 'Desired state', 'object')],
        risk: 'write',
        pagination: 'none'
      }
    }
    case 'cloud-update-resource': {
      const typeName = text(request.typeName, 'Resource type', 256)
      if (!isCloudControlTypeName(typeName)) throw new Error('Resource type must use the AWS::Service::Type form.')
      return {
        service: 'cloudcontrol',
        operation: 'update-resource',
        args: ['cloudcontrol', 'update-resource', '--type-name', typeName, '--identifier', text(request.identifier, 'Resource identifier', 2048), '--patch-document', jsonDocument(request.patchDocument, 'Patch document', 'array')],
        risk: 'write',
        pagination: 'none'
      }
    }
    case 'cloud-delete-resource': {
      const typeName = text(request.typeName, 'Resource type', 256)
      if (!isCloudControlTypeName(typeName)) throw new Error('Resource type must use the AWS::Service::Type form.')
      return {
        service: 'cloudcontrol',
        operation: 'delete-resource',
        args: ['cloudcontrol', 'delete-resource', '--type-name', typeName, '--identifier', text(request.identifier, 'Resource identifier', 2048)],
        risk: 'destructive',
        pagination: 'none'
      }
    }
    case 'cloud-request-status':
      return {
        service: 'cloudcontrol',
        operation: 'get-resource-request-status',
        args: ['cloudcontrol', 'get-resource-request-status', '--request-token', text(request.requestToken, 'Request token', 4096)],
        risk: 'read-only',
        pagination: 'none'
      }
    case 'cloudformation-validate-template': {
      const templatePath = localTemplate(request.templatePath)
      return { service: 'cloudformation', operation: 'validate-template', args: ['cloudformation', 'validate-template', '--template-body', pathToFileURL(templatePath).href], risk: 'read-only', pagination: 'none' }
    }
    case 'cloudformation-list-stacks':
      return { service: 'cloudformation', operation: 'list-stacks', args: ['cloudformation', 'list-stacks', '--max-items', String(maxResults(request.maxResults)), ...(token ? ['--starting-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'cloudformation-create-change-set': {
      const templatePath = localTemplate(request.templatePath)
      const preview = validateCloudFormationPreviewInput({
        requestId: 'preview',
        profile: 'placeholder',
        region: 'us-east-1',
        templatePath,
        stackName: text(request.stackName, 'Stack name', 128),
        changeSetName: text(request.changeSetName, 'Change-set name', 128),
        changeSetType: request.changeSetType === 'UPDATE' ? 'UPDATE' : 'CREATE',
        parameters: Array.isArray(request.parameters) ? request.parameters : [],
        capabilities: Array.isArray(request.capabilities) ? request.capabilities : []
      })
      const parameters = preview.parameters.flatMap((item) => ['--parameters', item.usePreviousValue ? `ParameterKey=${item.key},UsePreviousValue=true` : `ParameterKey=${item.key},ParameterValue=${item.value ?? ''}`])
      return { service: 'cloudformation', operation: 'create-change-set', args: ['cloudformation', 'create-change-set', '--stack-name', preview.stackName, '--change-set-name', preview.changeSetName, '--change-set-type', preview.changeSetType, '--template-body', pathToFileURL(preview.templatePath).href, ...parameters, ...(preview.capabilities.length ? ['--capabilities', ...preview.capabilities] : [])], risk: 'write', pagination: 'none' }
    }
    case 'cloudformation-describe-change-set':
      return { service: 'cloudformation', operation: 'describe-change-set', args: ['cloudformation', 'describe-change-set', '--change-set-name', text(request.changeSetName, 'Change-set name', 128)], risk: 'read-only', pagination: 'none' }
    case 'cloudformation-execute-change-set':
      return { service: 'cloudformation', operation: 'execute-change-set', args: ['cloudformation', 'execute-change-set', '--stack-name', text(request.stackName, 'Stack name', 128), '--change-set-name', text(request.changeSetName, 'Change-set name', 128)], risk: 'write', pagination: 'none' }
    case 'cloudformation-delete-change-set':
      return { service: 'cloudformation', operation: 'delete-change-set', args: ['cloudformation', 'delete-change-set', '--stack-name', text(request.stackName, 'Stack name', 128), '--change-set-name', text(request.changeSetName, 'Change-set name', 128)], risk: 'destructive', pagination: 'none' }
    case 's3-list-buckets': return { service: 's3', operation: request.operation, args: ['s3api', 'list-buckets'], risk: 'read-only', pagination: 'none' }
    case 's3-list-objects': return { service: 's3', operation: request.operation, args: ['s3api', 'list-objects-v2', '--bucket', coreInputText(request, 'bucket', 'Bucket name'), '--max-keys', String(maxResults(request.maxResults)), ...(token ? ['--continuation-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 's3-create-bucket': return { service: 's3', operation: request.operation, args: ['s3api', 'create-bucket', '--bucket', coreInputText(request, 'bucket', 'Bucket name', 63)], risk: 'write', pagination: 'none' }
    case 's3-delete-bucket': return { service: 's3', operation: request.operation, args: ['s3api', 'delete-bucket', '--bucket', coreInputText(request, 'bucket', 'Bucket name', 63)], risk: 'destructive', pagination: 'none' }
    case 'ec2-describe-instances': return { service: 'ec2', operation: request.operation, args: ['ec2', 'describe-instances', '--max-results', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'ec2-describe-security-groups': return { service: 'ec2', operation: request.operation, args: ['ec2', 'describe-security-groups'], risk: 'read-only', pagination: 'none' }
    case 'ec2-start-instances': return { service: 'ec2', operation: request.operation, args: ['ec2', 'start-instances', '--instance-ids', coreIds(request)], risk: 'write', pagination: 'none' }
    case 'ec2-stop-instances': return { service: 'ec2', operation: request.operation, args: ['ec2', 'stop-instances', '--instance-ids', coreIds(request)], risk: 'write', pagination: 'none' }
    case 'ec2-terminate-instances': return { service: 'ec2', operation: request.operation, args: ['ec2', 'terminate-instances', '--instance-ids', coreIds(request)], risk: 'destructive', pagination: 'none' }
    case 'iam-list-users': return { service: 'iam', operation: request.operation, args: ['iam', 'list-users', '--max-items', String(maxResults(request.maxResults)), ...(token ? ['--starting-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'iam-list-roles': return { service: 'iam', operation: request.operation, args: ['iam', 'list-roles', '--max-items', String(maxResults(request.maxResults)), ...(token ? ['--starting-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'iam-get-user': return { service: 'iam', operation: request.operation, args: ['iam', 'get-user', '--user-name', coreInputText(request, 'userName', 'User name')], risk: 'read-only', pagination: 'none' }
    case 'iam-get-role': return { service: 'iam', operation: request.operation, args: ['iam', 'get-role', '--role-name', coreInputText(request, 'roleName', 'Role name')], risk: 'read-only', pagination: 'none' }
    case 'iam-create-user': return { service: 'iam', operation: request.operation, args: ['iam', 'create-user', '--user-name', coreInputText(request, 'userName', 'User name')], risk: 'write', pagination: 'none' }
    case 'iam-delete-user': return { service: 'iam', operation: request.operation, args: ['iam', 'delete-user', '--user-name', coreInputText(request, 'userName', 'User name')], risk: 'destructive', pagination: 'none' }
    case 'sts-get-caller-identity': return { service: 'sts', operation: request.operation, args: ['sts', 'get-caller-identity'], risk: 'read-only', pagination: 'none' }
    case 'lambda-list-functions': return { service: 'lambda', operation: request.operation, args: ['lambda', 'list-functions', '--max-items', String(maxResults(request.maxResults)), ...(token ? ['--starting-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'lambda-get-function': return { service: 'lambda', operation: request.operation, args: ['lambda', 'get-function', '--function-name', coreInputText(request, 'functionName', 'Function name')], risk: 'read-only', pagination: 'none' }
    case 'lambda-delete-function': return { service: 'lambda', operation: request.operation, args: ['lambda', 'delete-function', '--function-name', coreInputText(request, 'functionName', 'Function name')], risk: 'destructive', pagination: 'none' }
    case 'cloudwatch-list-metrics': {
      const namespace = coreInput(request).namespace
      if (namespace !== undefined && (typeof namespace !== 'string' || namespace.trim().length > 255)) throw new Error('Namespace is invalid.')
      return { service: 'cloudwatch', operation: request.operation, args: ['cloudwatch', 'list-metrics', ...(typeof namespace === 'string' && namespace.trim() ? ['--namespace', namespace.trim()] : [])], risk: 'read-only', pagination: 'none' }
    }
    case 'cloudwatch-get-metric-data': return { service: 'cloudwatch', operation: request.operation, args: ['cloudwatch', 'get-metric-data', '--metric-data-queries', coreInputText(request, 'metricDataQueries', 'Metric data queries', 128_000), '--start-time', coreInputText(request, 'startTime', 'Start time'), '--end-time', coreInputText(request, 'endTime', 'End time')], risk: 'read-only', pagination: 'none' }
    case 'logs-describe-log-groups': return { service: 'logs', operation: request.operation, args: ['logs', 'describe-log-groups', '--limit', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'logs-describe-log-streams': return { service: 'logs', operation: request.operation, args: ['logs', 'describe-log-streams', '--log-group-name', coreInputText(request, 'logGroupName', 'Log group name')], risk: 'read-only', pagination: 'none' }
    case 'logs-get-log-events': return { service: 'logs', operation: request.operation, args: ['logs', 'get-log-events', '--log-group-name', coreInputText(request, 'logGroupName', 'Log group name'), '--log-stream-name', coreInputText(request, 'logStreamName', 'Log stream name'), '--limit', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    case 'logs-filter-log-events': return { service: 'logs', operation: request.operation, args: ['logs', 'filter-log-events', '--log-group-name', coreInputText(request, 'logGroupName', 'Log group name'), '--filter-pattern', coreInputText(request, 'filterPattern', 'Filter pattern'), '--limit', String(maxResults(request.maxResults)), ...(token ? ['--next-token', token] : [])], risk: 'read-only', pagination: 'manual-next-token' }
    default:
      throw new Error('The AWS manager operation is not supported.')
  }
}

function rowsFor(operation: AwsManagerOperation, payload: Record<string, unknown>): Array<Record<string, unknown>> {
  if (operation === 'sts-get-caller-identity') {
    const { ResponseMetadata: _metadata, ...identity } = payload
    return [identity]
  }
  const keys: Record<AwsManagerOperation, string> = {
    generic: '',
    'resource-list-views': 'Views',
    'resource-search': 'Resources',
    'cloud-list-types': 'TypeSummaries',
    'cloud-list-resources': 'ResourceDescriptions',
    'cloud-get-resource': 'ResourceDescription',
    'cloud-create-resource': 'ProgressEvent',
    'cloud-update-resource': 'ProgressEvent',
    'cloud-delete-resource': 'ProgressEvent',
    'cloud-request-status': 'ProgressEvent',
    'cloudformation-validate-template': 'Parameters',
    'cloudformation-list-stacks': 'StackSummaries',
    'cloudformation-create-change-set': 'Changes',
    'cloudformation-describe-change-set': 'Changes',
    'cloudformation-execute-change-set': 'ResponseMetadata',
    'cloudformation-delete-change-set': 'ResponseMetadata',
    's3-list-buckets': 'Buckets', 's3-list-objects': 'Contents', 's3-create-bucket': 'Location', 's3-delete-bucket': 'ResponseMetadata',
    'ec2-describe-instances': 'Reservations', 'ec2-describe-security-groups': 'SecurityGroups', 'ec2-start-instances': 'StartingInstances', 'ec2-stop-instances': 'StoppingInstances', 'ec2-terminate-instances': 'TerminatingInstances',
    'iam-list-users': 'Users', 'iam-list-roles': 'Roles', 'iam-get-user': 'User', 'iam-get-role': 'Role', 'iam-create-user': 'User', 'iam-delete-user': 'ResponseMetadata',
    'sts-get-caller-identity': 'ResponseMetadata',
    'lambda-list-functions': 'Functions', 'lambda-get-function': 'Configuration', 'lambda-delete-function': 'ResponseMetadata',
    'cloudwatch-list-metrics': 'Metrics', 'cloudwatch-get-metric-data': 'MetricDataResults',
    'logs-describe-log-groups': 'logGroups', 'logs-describe-log-streams': 'logStreams', 'logs-get-log-events': 'events', 'logs-filter-log-events': 'events'
  }
  const value = payload[keys[operation]]
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
  if (value && typeof value === 'object' && !Array.isArray(value)) return [value as Record<string, unknown>]
  return []
}

/** Remove credential-bearing values before any core-service result crosses into the renderer. */
function redactCorePayload(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactCorePayload(item, depth + 1))
  const blocked = new Set(['AccessKeyId', 'SecretAccessKey', 'SessionToken', 'Credentials', 'PresignedUrl', 'Code'])
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!blocked.has(key)) output[key] = redactCorePayload(item, depth + 1)
  }
  return output
}

function requestTokenFor(payload: Record<string, unknown>): string | null {
  const event = payload.ProgressEvent
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    const token = (event as Record<string, unknown>).RequestToken
    if (typeof token === 'string' && token.length <= 4096) return token
  }
  return null
}

export class AwsResourceManagerService {
  private readonly bindings: AtomicJsonArrayStore<AwsManagerBinding>
  private readonly running = new Map<string, ChildProcessWithoutNullStreams>()
  private runtimeCache: { executable: string; status: AwsCliRuntimeStatus } | null = null

  constructor(
    private readonly platform: CorePlatform,
    private readonly resolveAwsCli?: AwsCliResolver,
    private readonly wizardModels?: AwsWizardModelService
  ) {
    this.bindings = new AtomicJsonArrayStore(join(platform.userDataDir, 'aws', 'resource-manager-bindings.json'))
  }

  async runtime(): Promise<AwsCliRuntimeStatus> {
    return (await this.resolveRuntime()).status
  }

  async profiles(): Promise<AwsProfileChoice[]> {
    const runtime = await this.resolveRuntime()
    if (!runtime.status.available) return []
    const listed = await this.run(runtime.executable, ['configure', 'list-profiles'], undefined)
    const names = listed.stdout.split(/\r?\n/).map((value) => value.trim()).filter(isAwsProfileName).slice(0, 64)
    const unique = [...new Set(names)]
    const profiles: AwsProfileChoice[] = []
    for (const name of unique) {
      const region = await this.run(runtime.executable, ['configure', 'get', 'region', '--profile', name], undefined, true)
      profiles.push({ name, configuredRegion: isAwsRegion(region.stdout.trim()) ? region.stdout.trim() : null })
    }
    return profiles
  }

  async binding(nodeId: string): Promise<AwsManagerBinding | null> {
    const id = text(nodeId, 'Node id', 256)
    return (await this.loadBindings()).find((item) => item.nodeId === id) ?? null
  }

  async bind(input: { nodeId: string; profileName: string; region: string; endpointUrl?: string | null }): Promise<AwsManagerBinding> {
    const nodeId = text(input.nodeId, 'Node id', 256)
    if (!isAwsProfileName(input.profileName)) throw new Error('Choose a valid local AWS profile.')
    if (!isAwsRegion(input.region)) throw new Error('Choose a valid AWS region.')
    const binding: AwsManagerBinding = {
      nodeId,
      profileName: input.profileName.trim(),
      region: input.region.trim(),
      endpointUrl: endpoint(input.endpointUrl),
      updatedAt: Date.now()
    }
    const current = await this.loadBindings()
    await this.bindings.save([...current.filter((item) => item.nodeId !== nodeId), binding])
    return binding
  }

  async unbind(nodeId: string): Promise<boolean> {
    const id = text(nodeId, 'Node id', 256)
    const current = await this.loadBindings()
    const next = current.filter((item) => item.nodeId !== id)
    if (next.length === current.length) return false
    await this.bindings.save(next)
    return true
  }

  private async genericSpec(request: AwsManagerRequest): Promise<CommandSpec> {
    if (!this.wizardModels || !request.generic) throw new Error('The generic AWS model manager is unavailable in this build.')
    const serviceId = text(request.generic.serviceId, 'AWS service', 128)
    const commandName = text(request.generic.commandName, 'AWS command', 256)
    const source = await this.wizardModels.source(serviceId, commandName)
    if (!source) throw new Error('The selected AWS operation is not present in the current model inventory. Refresh and choose it again.')
    const definition = buildAwsWizardDefinition(source)
    const validation = validateAwsWizardValue(definition, request.generic.input)
    if (!validation.ok) throw new Error(validation.issues[0]?.message ?? 'The modeled AWS input is invalid.')
    const root = validation.value && typeof validation.value === 'object' && !Array.isArray(validation.value)
      ? validation.value as Record<string, unknown>
      : {}
    const args = [serviceId, commandName]
    for (const field of definition.root.children) genericFieldArgs(field, root[field.name], args)
    if (source.pagination && request.maxResults !== undefined) args.push('--max-items', String(maxResults(request.maxResults)))
    return {
      service: serviceId,
      operation: commandName,
      args,
      risk: genericRisk(commandName),
      pagination: source.pagination && request.maxResults !== undefined ? 'manual-next-token' : 'none'
    }
  }

  async preview(nodeId: string, request: AwsManagerRequest): Promise<AwsOperationPreview> {
    const binding = await this.binding(nodeId)
    if (!binding) throw new Error('Configure a local AWS profile and region before running this operation.')
    const spec = request.operation === 'generic' ? await this.genericSpec(request) : operationSpec(request)
    const argv = [
      ...spec.args,
      '--profile', binding.profileName,
      '--region', binding.region,
      ...(binding.endpointUrl ? ['--endpoint-url', binding.endpointUrl] : []),
      '--output', 'json',
      '--no-cli-pager'
    ]
    return {
      service: spec.service,
      operation: spec.operation,
      profileName: binding.profileName,
      region: binding.region,
      endpointUrl: binding.endpointUrl,
      argv,
      pagination: spec.pagination,
      retry: 'manual',
      risk: spec.risk,
      destructive: spec.risk === 'destructive'
    }
  }

  async execute(nodeId: string, operationId: string, request: AwsManagerRequest): Promise<AwsManagerResult> {
    const id = text(operationId, 'Operation id', 128)
    if (this.running.has(id)) throw new Error('This AWS operation is already running.')
    const runtime = await this.resolveRuntime()
    if (!runtime.status.available) throw new Error(runtime.status.disabledReason ?? 'AWS CLI v2 is unavailable.')
    const preview = await this.preview(nodeId, request)
    if (preview.destructive && request.confirmed !== true) throw new Error('Destructive AWS operations require explicit confirmation.')
    this.progress({ operationId: id, nodeId, phase: 'started', message: `${preview.service} ${preview.operation} started.` })
    try {
      const output = await this.run(runtime.executable, preview.argv, id)
      let parsed: unknown
      try {
        parsed = JSON.parse(output.stdout || '{}')
      } catch {
        throw new Error('AWS CLI returned output that was not valid JSON.')
      }
      if (!parsed || typeof parsed !== 'object') throw new Error('AWS CLI returned an unexpected JSON shape.')
      if (request.operation === 'cloudformation-create-change-set') {
        const changeSetId = typeof (parsed as Record<string, unknown>).Id === 'string'
          ? (parsed as Record<string, unknown>).Id as string
          : ''
        if (!changeSetId) throw new Error('CloudFormation did not return a change-set identifier.')
        const deadline = Date.now() + CLOUDFORMATION_PREVIEW_TIMEOUT_MS
        let complete: Record<string, unknown> | null = null
        while (Date.now() < deadline) {
          const describe = operationSpec({ ...request, operation: 'cloudformation-describe-change-set', changeSetName: changeSetId })
          const describeArgs = [
            ...describe.args,
            '--profile', preview.profileName,
            '--region', preview.region,
            ...(preview.endpointUrl ? ['--endpoint-url', preview.endpointUrl] : []),
            '--output', 'json',
            '--no-cli-pager'
          ]
          const described = await this.run(runtime.executable, describeArgs, id)
          let describedPayload: unknown
          try { describedPayload = JSON.parse(described.stdout || '{}') } catch { throw new Error('AWS CLI returned an invalid change-set preview.') }
          if (!describedPayload || typeof describedPayload !== 'object' || Array.isArray(describedPayload)) throw new Error('AWS CLI returned an unexpected change-set preview shape.')
          const status = typeof (describedPayload as Record<string, unknown>).Status === 'string' ? (describedPayload as Record<string, unknown>).Status : ''
          if (status === 'CREATE_COMPLETE') {
            complete = describedPayload as Record<string, unknown>
            break
          }
          if (status === 'FAILED') {
            const reason = typeof (describedPayload as Record<string, unknown>).StatusReason === 'string' ? (describedPayload as Record<string, unknown>).StatusReason : ''
            throw new Error(reason || 'CloudFormation could not create the change-set preview.')
          }
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        if (!complete) throw new Error('CloudFormation did not finish the change-set preview before the bounded wait expired.')
        parsed = complete
      }
      const payload = request.operation === 'generic' || request.operation.startsWith('s3-') || request.operation.startsWith('ec2-') || request.operation.startsWith('iam-') || request.operation.startsWith('sts-') || request.operation.startsWith('lambda-') || request.operation.startsWith('cloudwatch-') || request.operation.startsWith('logs-')
        ? redactCorePayload(parsed) as Record<string, unknown>
        : parsed as Record<string, unknown>
      const rows = request.operation === 'generic'
        ? (Array.isArray(payload)
            ? payload.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
            : [payload])
        : rowsFor(request.operation, payload)
      const nextToken = typeof payload.NextToken === 'string' && payload.NextToken.length <= 16_384 ? payload.NextToken : null
      const result: AwsManagerResult = {
        operationId: id,
        operation: request.operation,
        rows,
        nextToken,
        requestToken: requestTokenFor(payload),
        summary: `${rows.length} result${rows.length === 1 ? '' : 's'} returned by ${preview.service} ${preview.operation}.`,
        completedAt: Date.now()
      }
      this.progress({ operationId: id, nodeId, phase: 'completed', message: result.summary })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.progress({ operationId: id, nodeId, phase: /cancel/i.test(message) ? 'cancelled' : 'failed', message })
      throw error
    }
  }

  cancel(operationId: string): boolean {
    const child = this.running.get(operationId)
    if (!child) return false
    child.kill('SIGTERM')
    return true
  }

  private progress(progress: AwsManagerProgress): void {
    this.platform.broadcast('aws-resource:progress', progress)
  }

  private async loadBindings(): Promise<AwsManagerBinding[]> {
    return (await this.bindings.load()).map(safeBinding).filter((item): item is AwsManagerBinding => item !== null)
  }

  private async resolveRuntime(): Promise<{ executable: string; status: AwsCliRuntimeStatus }> {
    if (this.runtimeCache) return this.runtimeCache
    const executableName = process.platform === 'win32' ? 'aws.exe' : 'aws'
    if (this.resolveAwsCli) {
      try {
        const resolved = await this.resolveAwsCli()
        if (resolved.path) {
          const version = await this.run(resolved.path, ['--version'], undefined, true)
          const status: AwsCliRuntimeStatus = { available: true, origin: 'bundled', version: (version.stdout || version.stderr).trim() || null, disabledReason: null }
          return (this.runtimeCache = { executable: resolved.path, status })
        }
        return {
          executable: '',
          status: {
            available: false,
            origin: 'unavailable',
            version: null,
            disabledReason: resolved.reason ?? 'The verified AWS CLI dependency is unavailable. Install or repair it before using this manager.'
          }
        }
      } catch (error) {
        return {
          executable: '',
          status: {
            available: false,
            origin: 'unavailable',
            version: null,
            disabledReason: error instanceof Error ? error.message : 'The verified AWS CLI dependency could not be resolved.'
          }
        }
      }
    }
    const candidates = this.platform.resourcesPath
      ? [
          join(this.platform.resourcesPath, 'aws-cli', executableName),
          join(this.platform.resourcesPath, 'AWSCLIV2', executableName),
          join(this.platform.resourcesPath, 'aws', 'dist', executableName)
        ]
      : []
    for (const candidate of candidates) {
      try {
        await access(candidate)
        const version = await this.run(candidate, ['--version'], undefined, true)
        const status: AwsCliRuntimeStatus = { available: true, origin: 'bundled', version: (version.stdout || version.stderr).trim() || null, disabledReason: null }
        return (this.runtimeCache = { executable: candidate, status })
      } catch {
        // Continue to the next declared packaged location.
      }
    }
    try {
      const locator = process.platform === 'win32' ? 'where.exe' : 'which'
      const located = await this.run(locator, [process.platform === 'win32' ? 'aws.exe' : 'aws'], undefined, true)
      const executable = located.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean)
      if (executable) {
        const version = await this.run(executable, ['--version'], undefined, true)
        const status: AwsCliRuntimeStatus = { available: true, origin: 'system', version: (version.stdout || version.stderr).trim() || null, disabledReason: null }
        return (this.runtimeCache = { executable, status })
      }
    } catch {
      // Return one honest unavailable state below.
    }
    return {
      executable: '',
      status: {
        available: false,
        origin: 'unavailable',
        version: null,
        disabledReason: 'AWS CLI v2 is not bundled or available on this computer. Install or repair the verified AWS CLI dependency, then retry.'
      }
    }
  }

  private run(
    executable: string,
    args: readonly string[],
    operationId?: string,
    allowNonZero = false
  ): Promise<CommandOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      if (operationId) this.running.set(operationId, child)
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (operationId) this.running.delete(operationId)
        if (error) reject(error)
        else resolve({ stdout, stderr })
      }
      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString('utf8')
        if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
          child.kill('SIGTERM')
          throw new Error('AWS CLI output exceeded the bounded response size.')
        }
        return next
      }
      child.stdout.on('data', (chunk: Buffer) => {
        try { stdout = append(stdout, chunk) } catch (error) { finish(error as Error) }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        try { stderr = append(stderr, chunk) } catch (error) { finish(error as Error) }
      })
      child.on('error', (error) => finish(error))
      child.on('close', (code, signal) => {
        if (settled) return
        if (signal && operationId) return finish(new Error('AWS operation was cancelled.'))
        if (code !== 0 && !allowNonZero) {
          return finish(new Error((stderr || stdout || `AWS CLI exited with code ${code}.`).trim().slice(0, 8192)))
        }
        finish()
      })
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish(new Error('AWS CLI did not finish within 90 seconds. Retry the operation or inspect the local AWS configuration.'))
      }, COMMAND_TIMEOUT_MS)
    })
  }
}
