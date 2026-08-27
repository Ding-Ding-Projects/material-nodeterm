import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IpcMain } from 'electron'
import { findExecutableSync } from '../../core/exec-path'
import { IPC } from '../../shared/ipc'
import {
  CLOUDFORMATION_CAPABILITIES,
  CLOUDFORMATION_REGIONS,
  validateCloudFormationPreviewInput,
  validateCloudFormationScope,
  type CloudFormationCapability,
  type CloudFormationChange,
  type CloudFormationChangeSetPreview,
  type CloudFormationPreviewInput,
  type CloudFormationScopeInput,
  type CloudFormationStackSummary,
  type CloudFormationStatus,
  type CloudFormationTemplateInput,
  type CloudFormationTemplateInspection
} from '../../shared/cloudformation'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const COMMAND_TIMEOUT_MS = 15 * 60_000
const PREVIEW_TIMEOUT_MS = 12 * 60_000

interface CommandResult {
  stdout: string
  stderr: string
}

function parseJson(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${label} returned malformed JSON.`)
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeChange(value: unknown): CloudFormationChange {
  const resourceChange = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).ResourceChange
    : null
  const row = resourceChange && typeof resourceChange === 'object' && !Array.isArray(resourceChange)
    ? resourceChange as Record<string, unknown>
    : {}
  const action = asText(row.Action)
  const replacement = asText(row.Replacement)
  const details = Array.isArray(row.Details)
    ? row.Details.slice(0, 200).map((detail) => {
        const record = detail && typeof detail === 'object' ? detail as Record<string, unknown> : {}
        const target = record.Target && typeof record.Target === 'object' ? record.Target as Record<string, unknown> : {}
        return [asText(record.ChangeSource), asText(target.Attribute), asText(target.Name)].filter(Boolean).join(' · ')
      }).filter(Boolean)
    : []
  return {
    action: ['Add', 'Modify', 'Remove', 'Import', 'Dynamic'].includes(action) ? action as CloudFormationChange['action'] : 'Unknown',
    logicalResourceId: asText(row.LogicalResourceId) || 'Unknown resource',
    resourceType: asText(row.ResourceType) || 'Unknown type',
    replacement: ['True', 'False', 'Conditional'].includes(replacement) ? replacement as CloudFormationChange['replacement'] : 'Unknown',
    scope: Array.isArray(row.Scope) ? row.Scope.filter((item): item is string => typeof item === 'string').slice(0, 32) : [],
    details
  }
}

export class CloudFormationManager {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly awsPath: string | null
  private readonly awsOrigin: 'bundled' | 'path' | null

  constructor(resourcesPath: string, userDataPath: string) {
    const executable = process.platform === 'win32' ? 'aws.exe' : 'aws'
    const bundledCandidates = [
      join(resourcesPath, 'aws-cli', executable),
      join(userDataPath, 'tools', 'aws-cli', 'current', executable)
    ]
    this.awsPath = findExecutableSync('aws', bundledCandidates)
    this.awsOrigin = this.awsPath && bundledCandidates.includes(this.awsPath) ? 'bundled' : this.awsPath ? 'path' : null
  }

  private async run(args: string[], requestId?: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
    if (!this.awsPath) throw new Error('AWS CLI is unavailable. Install or repair the bundled AWS CLI from the AWS tools manager, then retry.')
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(this.awsPath as string, [...args, '--no-cli-pager', '--output', 'json'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      if (requestId) this.active.set(requestId, child)
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (requestId && this.active.get(requestId) === child) this.active.delete(requestId)
        if (error) reject(error)
        else resolve({ stdout, stderr })
      }
      const append = (current: string, chunk: Buffer): string => {
        bytes += chunk.byteLength
        if (bytes > MAX_OUTPUT_BYTES) {
          child.kill()
          finish(new Error('AWS CLI output exceeded the bounded preview limit. Narrow the stack or template and retry.'))
          return current
        }
        return current + chunk.toString('utf8')
      }
      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
      child.once('error', (error) => finish(error))
      child.once('close', (code, signal) => {
        if (code === 0) finish()
        else finish(new Error(signal ? `AWS CLI preview was cancelled (${signal}).` : (stderr.trim() || `AWS CLI exited with code ${code}.`)))
      })
      const timer = setTimeout(() => {
        child.kill()
        finish(new Error('AWS CLI did not finish before the bounded operation timeout. Retry after checking network and account access.'))
      }, timeoutMs)
    })
  }

  async status(): Promise<CloudFormationStatus> {
    if (!this.awsPath) return {
      available: false,
      version: null,
      origin: null,
      profiles: [],
      regions: [...CLOUDFORMATION_REGIONS],
      unavailableReason: 'AWS CLI is unavailable. Install or repair the bundled AWS CLI from the AWS tools manager.'
    }
    try {
      const version = await this.run(['--version'])
      const profileResult = await this.run(['configure', 'list-profiles'])
      return {
        available: true,
        version: (version.stdout || version.stderr).trim() || null,
        origin: this.awsOrigin,
        profiles: [...new Set(profileResult.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))].sort(),
        regions: [...CLOUDFORMATION_REGIONS],
        unavailableReason: null
      }
    } catch (error) {
      return {
        available: false,
        version: null,
        origin: null,
        profiles: [],
        regions: [...CLOUDFORMATION_REGIONS],
        unavailableReason: error instanceof Error ? error.message : 'AWS CLI status could not be read.'
      }
    }
  }

  async listStacks(input: CloudFormationScopeInput): Promise<CloudFormationStackSummary[]> {
    const scope = validateCloudFormationScope(input)
    const rows: unknown[] = []
    let nextToken = ''
    for (let page = 0; page < 20; page++) {
      const args = ['cloudformation', 'list-stacks', '--profile', scope.profile, '--region', scope.region]
      if (nextToken) args.push('--next-token', nextToken)
      const result = await this.run(args)
      const body = parseJson(result.stdout, 'CloudFormation list-stacks')
      if (Array.isArray(body.StackSummaries)) rows.push(...body.StackSummaries)
      const token = asText(body.NextToken)
      if (!token || token === nextToken) break
      nextToken = token
    }
    return rows.slice(0, 500).map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      return {
        stackId: asText(row.StackId),
        stackName: asText(row.StackName),
        status: asText(row.StackStatus),
        ...(asText(row.StackStatusReason) ? { statusReason: asText(row.StackStatusReason) } : {}),
        ...(asText(row.LastUpdatedTime || row.CreationTime) ? { updatedAt: asText(row.LastUpdatedTime || row.CreationTime) } : {})
      }
    }).filter((item) => item.stackId && item.stackName)
  }

  async inspectTemplate(input: CloudFormationTemplateInput): Promise<CloudFormationTemplateInspection> {
    const scope = validateCloudFormationScope(input)
    if (!isAbsolute(input.templatePath)) throw new Error('Choose a local CloudFormation template file with the Browse control.')
    await access(input.templatePath)
    if (!(await stat(input.templatePath)).isFile()) throw new Error('Choose a local CloudFormation template file, not a folder.')
    const result = await this.run([
      'cloudformation', 'validate-template',
      '--template-body', pathToFileURL(input.templatePath).href,
      '--profile', scope.profile,
      '--region', scope.region
    ])
    const body = parseJson(result.stdout, 'CloudFormation validate-template')
    return {
      ...(asText(body.Description) ? { description: asText(body.Description) } : {}),
      parameters: (Array.isArray(body.Parameters) ? body.Parameters : []).slice(0, 200).map((item) => {
        const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return {
          key: asText(row.ParameterKey),
          ...(asText(row.Description) ? { description: asText(row.Description) } : {}),
          ...(asText(row.DefaultValue) ? { defaultValue: asText(row.DefaultValue) } : {}),
          noEcho: row.NoEcho === true
        }
      }).filter((item) => item.key),
      capabilities: (Array.isArray(body.Capabilities) ? body.Capabilities : []).filter((item): item is CloudFormationCapability =>
        typeof item === 'string' && (CLOUDFORMATION_CAPABILITIES as readonly string[]).includes(item)
      ),
      ...(asText(body.CapabilitiesReason) ? { capabilityReason: asText(body.CapabilitiesReason) } : {})
    }
  }

  async preview(input: CloudFormationPreviewInput): Promise<CloudFormationChangeSetPreview> {
    const value = validateCloudFormationPreviewInput(input)
    this.cancelled.delete(value.requestId)
    if (!isAbsolute(value.templatePath)) throw new Error('Choose a local CloudFormation template file with the Browse control.')
    await access(value.templatePath)
    if (!(await stat(value.templatePath)).isFile()) throw new Error('Choose a local CloudFormation template file, not a folder.')
    const parameters = value.parameters.flatMap((item) => [
      '--parameters',
      item.usePreviousValue ? `ParameterKey=${item.key},UsePreviousValue=true` : `ParameterKey=${item.key},ParameterValue=${item.value ?? ''}`
    ])
    const capabilities = value.capabilities.length ? ['--capabilities', ...value.capabilities] : []
    const created = await this.run([
      'cloudformation', 'create-change-set',
      '--stack-name', value.stackName,
      '--change-set-name', value.changeSetName,
      '--change-set-type', value.changeSetType,
      '--template-body', pathToFileURL(value.templatePath).href,
      ...parameters,
      ...capabilities,
      '--profile', value.profile,
      '--region', value.region
    ], value.requestId)
    const createdBody = parseJson(created.stdout, 'CloudFormation create-change-set')
    const changeSetId = asText(createdBody.Id)
    if (!changeSetId) throw new Error('CloudFormation did not return a change-set identifier.')
    const deadline = Date.now() + PREVIEW_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.cancelled.has(value.requestId)) throw new Error('CloudFormation preview was cancelled.')
      const described = await this.run([
        'cloudformation', 'describe-change-set',
        '--change-set-name', changeSetId,
        '--profile', value.profile,
        '--region', value.region
      ], value.requestId)
      const body = parseJson(described.stdout, 'CloudFormation describe-change-set')
      const status = asText(body.Status)
      if (status === 'CREATE_COMPLETE' || status === 'FAILED') {
        if (status === 'FAILED') throw new Error(asText(body.StatusReason) || 'CloudFormation could not create the change-set preview.')
        return {
          changeSetId,
          changeSetName: asText(body.ChangeSetName) || value.changeSetName,
          stackId: asText(body.StackId),
          stackName: asText(body.StackName) || value.stackName,
          status,
          executionStatus: asText(body.ExecutionStatus),
          ...(asText(body.StatusReason) ? { statusReason: asText(body.StatusReason) } : {}),
          ...(asText(body.CreationTime) ? { createdAt: asText(body.CreationTime) } : {}),
          changes: (Array.isArray(body.Changes) ? body.Changes : []).slice(0, 2000).map(normalizeChange)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error('CloudFormation did not finish the change-set preview before the bounded wait expired.')
  }

  private readonly cancelled = new Set<string>()

  cancel(requestId: string): boolean {
    const child = this.active.get(requestId)
    this.cancelled.add(requestId)
    if (!child) return true
    child.kill()
    return true
  }
}

export function registerCloudFormationHandlers(ipcMain: IpcMain, resourcesPath: string, userDataPath: string): void {
  const manager = new CloudFormationManager(resourcesPath, userDataPath)
  ipcMain.handle(IPC.cloudFormationStatus, () => manager.status())
  ipcMain.handle(IPC.cloudFormationListStacks, (_event, input: CloudFormationScopeInput) => manager.listStacks(input))
  ipcMain.handle(IPC.cloudFormationInspectTemplate, (_event, input: CloudFormationTemplateInput) => manager.inspectTemplate(input))
  ipcMain.handle(IPC.cloudFormationPreview, (_event, input: CloudFormationPreviewInput) => manager.preview(input))
  ipcMain.handle(IPC.cloudFormationCancelPreview, (_event, requestId: string) => manager.cancel(String(requestId ?? '').slice(0, 160)))
}
