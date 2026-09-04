import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import {
  changeSetHasDestructiveChanges,
  isValidCloudFormationRegion,
  isValidCloudFormationStackName,
  normalizeCloudFormationParameters,
  normalizeCloudFormationTags,
  type CloudFormationApi,
  type CloudFormationCapability,
  type CloudFormationChange,
  type CloudFormationChangeSet,
  type CloudFormationChangeSetInput,
  type CloudFormationCliStatus,
  type CloudFormationProfile,
  type CloudFormationStackEvent,
  type CloudFormationStackSummary,
  type CloudFormationTemplateInfo,
  type CloudFormationWaitResult
} from '../../shared/cloudformation'

const execFileAsync = promisify(execFile)
const MAX_TEMPLATE_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 30_000
const WAIT_TIMEOUT_MS = 30 * 60_000

interface CliDeps {
  executable?: string
  run?: (args: string[], timeoutMs?: number) => Promise<unknown>
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function textError(error: unknown): string {
  const e = error as { stderr?: unknown; message?: unknown }
  const stderr = safeString(e.stderr)
  if (stderr) return stderr.slice(0, 1000)
  return typeof e.message === 'string' ? e.message.slice(0, 1000) : String(error)
}

function ensureProfileRegion(profile: string, region: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$/.test(profile.trim())) throw new Error('The selected AWS profile is invalid.')
  if (!isValidCloudFormationRegion(region)) throw new Error('The selected AWS region is invalid.')
}

function parseJson(raw: unknown): Record<string, unknown> {
  const text = typeof raw === 'string' ? raw : (raw as { stdout?: unknown })?.stdout
  if (typeof text !== 'string') throw new Error('AWS returned no JSON response.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('AWS returned malformed JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AWS returned an invalid response shape.')
  return value as Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 100) : []
}

function stackSummary(raw: unknown): CloudFormationStackSummary {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    stackName: safeString(v.StackName) ?? 'Unnamed stack',
    stackId: safeString(v.StackId) ?? '',
    status: safeString(v.StackStatus) ?? 'UNKNOWN',
    statusReason: safeString(v.StackStatusReason),
    creationTime: safeString(v.CreationTime),
    lastUpdatedTime: safeString(v.LastUpdatedTime),
    description: safeString(v.Description),
    terminationProtection: typeof v.EnableTerminationProtection === 'boolean' ? v.EnableTerminationProtection : null
  }
}

function event(raw: unknown): CloudFormationStackEvent {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    eventId: safeString(v.EventId) ?? '',
    stackName: safeString(v.StackName) ?? '',
    logicalResourceId: safeString(v.LogicalResourceId),
    physicalResourceId: safeString(v.PhysicalResourceId),
    resourceType: safeString(v.ResourceType),
    status: safeString(v.ResourceStatus) ?? 'UNKNOWN',
    statusReason: safeString(v.ResourceStatusReason),
    timestamp: safeString(v.Timestamp) ?? ''
  }
}

function change(raw: unknown): CloudFormationChange {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const resourceChange = (v.ResourceChange && typeof v.ResourceChange === 'object' ? v.ResourceChange : {}) as Record<string, unknown>
  const details = Array.isArray(resourceChange.Details)
    ? resourceChange.Details.map((d) => {
        const detail = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
        return [safeString(detail.ChangeSource), safeString(detail.CausingEntity), safeString(detail.Evaluation)].filter(Boolean).join(': ')
      }).filter(Boolean)
    : []
  return {
    action: (safeString(resourceChange.Action) as CloudFormationChange['action']) ?? 'Dynamic',
    logicalResourceId: safeString(resourceChange.LogicalResourceId) ?? '',
    physicalResourceId: safeString(resourceChange.PhysicalResourceId),
    resourceType: safeString(resourceChange.ResourceType) ?? 'Unknown',
    replacement: (safeString(resourceChange.Replacement) as CloudFormationChange['replacement']) ?? null,
    details
  }
}

function changeSet(raw: Record<string, unknown>, fallback: Partial<CloudFormationChangeSet> = {}): CloudFormationChangeSet {
  const changes = Array.isArray(raw.Changes) ? raw.Changes.map(change) : []
  const status = safeString(raw.Status) ?? fallback.status ?? 'UNKNOWN'
  const result: CloudFormationChangeSet = {
    id: safeString(raw.Id) ?? fallback.id ?? '',
    arn: safeString(raw.StackId) ?? fallback.arn ?? null,
    name: safeString(raw.ChangeSetName) ?? fallback.name ?? '',
    stackName: safeString(raw.StackName) ?? fallback.stackName ?? '',
    status,
    statusReason: safeString(raw.StatusReason) ?? fallback.statusReason ?? null,
    executionStatus: safeString(raw.ExecutionStatus) ?? fallback.executionStatus ?? 'UNAVAILABLE',
    changes,
    iamWarnings: strings(raw.CapabilitiesReason).concat(
      changes.some((c) => c.resourceType === 'AWS::IAM::Role' || c.resourceType === 'AWS::IAM::Policy')
        ? ['IAM resources are present. Review permissions and CAPABILITY_IAM or CAPABILITY_NAMED_IAM before execution.']
        : []
    ),
    destructive: changeSetHasDestructiveChanges(changes),
    fetchedAt: Date.now()
  }
  return result
}

function formatCapabilities(capabilities: CloudFormationCapability[]): string[] {
  return [...new Set(capabilities)].filter((c) => ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'].includes(c))
}

export class CloudFormationService implements CloudFormationApi {
  private readonly executable: string
  private readonly runOverride?: CliDeps['run']

  constructor(
    private readonly platform: CorePlatform,
    deps: CliDeps = {}
  ) {
    this.executable = deps.executable ?? 'aws'
    this.runOverride = deps.run
  }

  private async run(args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('Invalid AWS operation arguments.')
    if (this.runOverride) {
      const result = await this.runOverride(args, timeoutMs)
      return typeof result === 'string' ? result : String((result as { stdout?: unknown })?.stdout ?? '')
    }
    const result = await execFileAsync(this.executable, args, {
      cwd: this.platform.userDataDir,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false
    })
    return result.stdout
  }

  private async json(args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<Record<string, unknown>> {
    return parseJson(await this.run([...args, '--output', 'json'], timeoutMs))
  }

  async status(): Promise<CloudFormationCliStatus> {
    try {
      const stdout = await this.run(['--version'])
      return { available: true, executable: this.executable, version: stdout.trim().slice(0, 200), reason: null, checkedAt: Date.now() }
    } catch (error) {
      return { available: false, executable: this.executable, version: null, reason: textError(error), checkedAt: Date.now() }
    }
  }

  async profiles(): Promise<CloudFormationProfile[]> {
    const raw = await this.run(['configure', 'list-profiles'])
    const names = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 100)
    return Promise.all(names.map(async (name) => {
      let accountId: string | null = null
      let arn: string | null = null
      let region: string | null = null
      try {
        const identity = await this.json(['sts', 'get-caller-identity', '--profile', name], COMMAND_TIMEOUT_MS)
        accountId = safeString(identity.Account)
        arn = safeString(identity.Arn)
        const cfg = await this.run(['configure', 'get', 'region', '--profile', name])
        region = cfg.trim() || null
      } catch {
        // An incomplete SSO profile stays visible and is labelled unknown, never dropped.
      }
      return { name, source: name === 'default' ? 'config' : 'unknown', accountId, arn, region }
    }))
  }

  async regions(): Promise<string[]> {
    return ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1']
  }

  async stacks(input: { profile: string; region: string; includeDeleted?: boolean }): Promise<CloudFormationStackSummary[]> {
    ensureProfileRegion(input.profile, input.region)
    const args = ['cloudformation', 'list-stacks', '--profile', input.profile, '--region', input.region]
    if (!input.includeDeleted) args.push('--stack-status-filter', 'CREATE_IN_PROGRESS', 'CREATE_FAILED', 'CREATE_COMPLETE', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE', 'UPDATE_FAILED', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED', 'UPDATE_ROLLBACK_COMPLETE', 'DELETE_FAILED', 'REVIEW_IN_PROGRESS')
    const out = await this.json(args)
    return (Array.isArray(out.StackSummaries) ? out.StackSummaries : []).map(stackSummary)
  }

  async validate(input: { profile: string; region: string; templateBody: string }): Promise<CloudFormationTemplateInfo> {
    ensureProfileRegion(input.profile, input.region)
    if (typeof input.templateBody !== 'string' || Buffer.byteLength(input.templateBody, 'utf8') > MAX_TEMPLATE_BYTES) throw new Error('Template is empty or exceeds the 1 MiB safety limit.')
    const format = /^\s*[<{]/.test(input.templateBody) ? 'json' : /(?:^|\n)\s*\w+\s*:/.test(input.templateBody) ? 'yaml' : 'unknown'
    const dir = await mkdtemp(join(tmpdir(), 'nodeterm-cfn-'))
    const path = join(dir, 'template.txt')
    try {
      await writeFile(path, input.templateBody, { encoding: 'utf8', flag: 'wx' })
      const out = await this.json(['cloudformation', 'validate-template', '--profile', input.profile, '--region', input.region, '--template-body', `file://${path}`])
      const parameters = Array.isArray(out.Parameters) ? out.Parameters.map((p) => {
        const value = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
        return { key: safeString(value.ParameterKey) ?? '', type: safeString(value.ParameterType) ?? 'String', description: safeString(value.Description), defaultValue: safeString(value.DefaultValue), required: value.DefaultValue === undefined }
      }).filter((p) => p.key) : []
      return { valid: true, format, description: safeString(out.Description), parameters, capabilities: [], warnings: strings(out.CapabilitiesReason), error: null }
    } catch (error) {
      return { valid: false, format, description: null, parameters: [], capabilities: [], warnings: [], error: textError(error) }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async createChangeSet(input: CloudFormationChangeSetInput): Promise<CloudFormationChangeSet> {
    ensureProfileRegion(input.profile, input.region)
    if (!isValidCloudFormationStackName(input.stackName) || !isValidCloudFormationStackName(input.changeSetName)) throw new Error('Stack and change-set names must start with a letter and use letters, numbers, and hyphens.')
    if (typeof input.templateBody !== 'string' || Buffer.byteLength(input.templateBody, 'utf8') > MAX_TEMPLATE_BYTES) throw new Error('Template is empty or exceeds the 1 MiB safety limit.')
    const dir = await mkdtemp(join(tmpdir(), 'nodeterm-cfn-'))
    const path = join(dir, 'template.txt')
    try {
      await writeFile(path, input.templateBody, { encoding: 'utf8', flag: 'wx' })
      const args = ['cloudformation', 'create-change-set', '--profile', input.profile, '--region', input.region, '--stack-name', input.stackName, '--change-set-name', input.changeSetName, '--change-set-type', input.changeSetType, '--template-body', `file://${path}`]
      const params = normalizeCloudFormationParameters(input.parameters)
      const paramsPath = join(dir, 'parameters.json')
      if (params.length) {
        // Parameter values can be secrets. Keep them in a mode-restricted, short-lived file rather
        // than putting them in the process argument list, where other local users can inspect them.
        await writeFile(paramsPath, JSON.stringify(params.map((p) => ({
          ParameterKey: p.parameterKey,
          ...(p.usePreviousValue ? { UsePreviousValue: true } : { ParameterValue: p.parameterValue })
        })), null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        args.push('--parameters', `file://${paramsPath}`)
      }
      const capabilities = formatCapabilities(input.capabilities)
      if (capabilities.length) args.push('--capabilities', ...capabilities)
      const tags = normalizeCloudFormationTags(input.tags)
      const tagsPath = join(dir, 'tags.json')
      if (tags.length) {
        await writeFile(tagsPath, JSON.stringify(tags.map((t) => ({ Key: t.key, Value: t.value })), null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        args.push('--tags', `file://${tagsPath}`)
      }
      if (input.description?.trim()) args.push('--description', input.description.trim().slice(0, 1024))
      const out = await this.json(args)
      const initial = changeSet(out, { name: input.changeSetName, stackName: input.stackName })
      return await this.describeChangeSet({ profile: input.profile, region: input.region, stackName: input.stackName, changeSetName: initial.id || input.changeSetName })
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async describeChangeSet(input: { profile: string; region: string; stackName: string; changeSetName: string }): Promise<CloudFormationChangeSet> {
    ensureProfileRegion(input.profile, input.region)
    const out = await this.json(['cloudformation', 'describe-change-set', '--profile', input.profile, '--region', input.region, '--stack-name', input.stackName, '--change-set-name', input.changeSetName])
    return changeSet(out, { name: input.changeSetName, stackName: input.stackName })
  }

  async executeChangeSet(input: { profile: string; region: string; stackName: string; changeSetName: string }): Promise<void> {
    ensureProfileRegion(input.profile, input.region)
    await this.run(['cloudformation', 'execute-change-set', '--profile', input.profile, '--region', input.region, '--stack-name', input.stackName, '--change-set-name', input.changeSetName])
  }

  async events(input: { profile: string; region: string; stackName: string; nextToken?: string }): Promise<{ events: CloudFormationStackEvent[]; nextToken: string | null }> {
    ensureProfileRegion(input.profile, input.region)
    const args = ['cloudformation', 'describe-stack-events', '--profile', input.profile, '--region', input.region, '--stack-name', input.stackName]
    if (input.nextToken) args.push('--next-token', input.nextToken)
    const out = await this.json(args)
    return { events: (Array.isArray(out.StackEvents) ? out.StackEvents : []).map(event), nextToken: safeString(out.NextToken) }
  }

  async wait(input: { profile: string; region: string; stackName: string; waiter: CloudFormationWaitResult['waiter']; timeoutMs?: number }): Promise<CloudFormationWaitResult> {
    ensureProfileRegion(input.profile, input.region)
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? WAIT_TIMEOUT_MS, 10_000), WAIT_TIMEOUT_MS)
    const waiterArgs = ['cloudformation', 'wait', input.waiter, '--profile', input.profile, '--region', input.region, '--stack-name', input.stackName]
    try {
      await this.run(waiterArgs, timeoutMs)
      const stacks = await this.stacks({ profile: input.profile, region: input.region })
      const eventPage = await this.events({ profile: input.profile, region: input.region, stackName: input.stackName }).catch(() => ({ events: [], nextToken: null }))
      return { waiter: input.waiter, status: 'success', stack: stacks.find((s) => s.stackName === input.stackName) ?? null, events: eventPage.events, error: null }
    } catch (error) {
      const eventPage = await this.events({ profile: input.profile, region: input.region, stackName: input.stackName }).catch(() => ({ events: [], nextToken: null }))
      return { waiter: input.waiter, status: /timed? out|timeout/i.test(textError(error)) ? 'timed-out' : 'failed', stack: null, events: eventPage.events, error: textError(error) }
    }
  }
}

export function registerCloudFormationIpc(platform: CorePlatform, deps: CliDeps = {}): CloudFormationService {
  const service = new CloudFormationService(platform, deps)
  platform.handle(IPC.cloudFormationStatus, () => service.status())
  platform.handle(IPC.cloudFormationProfiles, () => service.profiles())
  platform.handle(IPC.cloudFormationRegions, () => service.regions())
  platform.handle(IPC.cloudFormationStacks, (input) => service.stacks(input))
  platform.handle(IPC.cloudFormationValidate, (input) => service.validate(input))
  platform.handle(IPC.cloudFormationCreateChangeSet, (input) => service.createChangeSet(input))
  platform.handle(IPC.cloudFormationDescribeChangeSet, (input) => service.describeChangeSet(input))
  platform.handle(IPC.cloudFormationExecuteChangeSet, (input) => service.executeChangeSet(input))
  platform.handle(IPC.cloudFormationEvents, (input) => service.events(input))
  platform.handle(IPC.cloudFormationWait, (input) => service.wait(input))
  return service
}
