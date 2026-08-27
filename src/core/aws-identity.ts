import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import {
  AWS_REGIONS,
  type AwsIdentityDiscovery,
  type AwsProfileSummary,
  planAwsIdentity,
  normalizeAwsIdentityBinding,
  type AwsIdentityAction,
  type AwsIdentityBinding,
  type AwsIdentityOperation,
  type AwsIdentityFact
} from '../shared/aws-identity'

const execFileAsync = promisify(execFile)

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_PROFILES = 512
const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/
const SAFE_REGION = /^[a-z]{2,8}(?:-[a-z0-9]+){1,3}-\d$/
const SAFE_METADATA = /^[^\u0000-\u001f\u007f]{1,2048}$/
const MAX_OPERATIONS = 64

interface ProfileFacts {
  name: string
  inConfig: boolean
  inCredentials: boolean
  region: string | null
  roleConfigured: boolean
  roleArn: string | null
  sourceProfile: string | null
  mfaConfigured: boolean
  mfaSerial: string | null
  identityCenterConfigured: boolean
  ssoStartUrl: string | null
  ssoRegion: string | null
  ssoAccountId: string | null
  ssoRoleName: string | null
}
export interface AwsIdentityServiceOptions {
  configPath?: string
  credentialsPath?: string
  readText?: (path: string) => Promise<string | null>
  now?: () => number
  resolveAwsCli?: () => Promise<{ path: string | null; reason: string | null }>
}

function defaultConfigPath(): string {
  return process.env.AWS_CONFIG_FILE || resolve(homedir(), '.aws', 'config')
}

function defaultCredentialsPath(): string {
  return process.env.AWS_SHARED_CREDENTIALS_FILE || resolve(homedir(), '.aws', 'credentials')
}

async function boundedRead(path: string): Promise<string | null> {
  try {
    const bytes = await readFile(path)
    if (bytes.byteLength > MAX_CONFIG_BYTES) throw new Error('AWS configuration is larger than the supported 1 MiB limit.')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function sectionName(raw: string): string | null {
  const match = /^\s*\[([^\]\r\n]{1,256})\]\s*$/.exec(raw)
  return match?.[1]?.trim() ?? null
}

function configProfileName(section: string): string | null {
  if (section === 'default') return 'default'
  if (!section.startsWith('profile ')) return null
  const name = section.slice('profile '.length).trim()
  return SAFE_PROFILE.test(name) ? name : null
}

function credentialProfileName(section: string): string | null {
  return SAFE_PROFILE.test(section) ? section : null
}

function ensureProfile(profiles: Map<string, ProfileFacts>, name: string): ProfileFacts | null {
  const existing = profiles.get(name)
  if (existing) return existing
  if (profiles.size >= MAX_PROFILES) return null
  const created: ProfileFacts = {
    name,
    inConfig: false,
    inCredentials: false,
    region: null,
    roleConfigured: false,
    roleArn: null,
    sourceProfile: null,
    mfaConfigured: false,
    mfaSerial: null,
    identityCenterConfigured: false,
    ssoStartUrl: null,
    ssoRegion: null,
    ssoAccountId: null,
    ssoRoleName: null
  }
  profiles.set(name, created)
  return created
}

/**
 * Parse only the non-secret AWS config fields the renderer needs. The credentials document is
 * scanned for section headings only; access-key and secret values are never retained or returned.
 */
export function parseAwsProfileMetadata(
  configText: string | null,
  credentialsText: string | null
): AwsProfileSummary[] {
  const profiles = new Map<string, ProfileFacts>()
  if (configText) {
    let current: ProfileFacts | null = null
    for (const line of configText.split(/\r\n|\n|\r/).slice(0, 20_000)) {
      const section = sectionName(line)
      if (section !== null) {
        const name = configProfileName(section)
        current = name ? ensureProfile(profiles, name) : null
        if (current) current.inConfig = true
        continue
      }
      if (!current || /^\s*[#;]/.test(line)) continue
      const match = /^\s*([A-Za-z0-9_.-]{1,128})\s*=\s*(.*?)\s*$/.exec(line)
      if (!match) continue
      const key = match[1]?.toLowerCase()
      const value = match[2] ?? ''
      if (key === 'region' && SAFE_REGION.test(value)) current.region = value
      const metadata = SAFE_METADATA.test(value.trim()) ? value.trim() : null
      if (key === 'role_arn' && metadata) {
        current.roleConfigured = true
        current.roleArn = metadata
      }
      if (key === 'source_profile' && metadata) current.sourceProfile = metadata
      if (key === 'mfa_serial' && metadata) {
        current.mfaConfigured = true
        current.mfaSerial = metadata
      }
      if (key === 'sso_start_url' && metadata) {
        try {
          const url = new URL(metadata)
          if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) current.ssoStartUrl = url.href
        } catch {
          // Keep the profile visible, but do not retain an invalid SSO URL.
        }
      }
      if (key === 'sso_region' && SAFE_REGION.test(metadata ?? '')) current.ssoRegion = metadata
      if (key === 'sso_account_id' && /^[0-9]{12}$/.test(metadata ?? '')) current.ssoAccountId = metadata
      if (key === 'sso_role_name' && metadata) current.ssoRoleName = metadata
      if (['sso_session', 'sso_start_url', 'sso_region', 'sso_account_id', 'sso_role_name'].includes(key ?? '') && metadata) {
        current.identityCenterConfigured = true
      }
    }
  }
  if (credentialsText) {
    for (const line of credentialsText.split(/\r\n|\n|\r/).slice(0, 20_000)) {
      const section = sectionName(line)
      if (section === null) continue
      const name = credentialProfileName(section)
      const profile = name ? ensureProfile(profiles, name) : null
      if (profile) profile.inCredentials = true
    }
  }
  return [...profiles.values()]
    .map((profile): AwsProfileSummary => ({
      name: profile.name,
      source: profile.inConfig && profile.inCredentials ? 'both' : profile.inConfig ? 'config' : 'credentials',
      mode: profile.identityCenterConfigured ? 'identity-center' : profile.roleConfigured ? 'assume-role' : 'profile',
      region: profile.region,
      roleConfigured: profile.roleConfigured,
      roleArn: profile.roleArn,
      sourceProfile: profile.sourceProfile,
      mfaConfigured: profile.mfaConfigured,
      mfaSerial: profile.mfaSerial,
      identityCenterConfigured: profile.identityCenterConfigured,
      ssoStartUrl: profile.ssoStartUrl,
      ssoRegion: profile.ssoRegion,
      ssoAccountId: profile.ssoAccountId,
      ssoRoleName: profile.ssoRoleName
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function errorMessage(error: unknown, label: string): string {
  const code = (error as NodeJS.ErrnoException)?.code
  if (typeof code === 'string' && code.length > 0) return `${label} could not be read (${code}).`
  return `${label} could not be read.`
}

export class AwsIdentityService {
  private readonly configPath: string
  private readonly credentialsPath: string
  private readonly readText: (path: string) => Promise<string | null>
  private readonly now: () => number
  private readonly resolveAwsCli: () => Promise<{ path: string | null; reason: string | null }>
  private readonly operations = new Map<string, { operation: AwsIdentityOperation; controller: AbortController }>()
  private readonly listeners = new Set<(operation: AwsIdentityOperation) => void>()

  constructor(options: AwsIdentityServiceOptions = {}) {
    this.configPath = options.configPath ?? defaultConfigPath()
    this.credentialsPath = options.credentialsPath ?? defaultCredentialsPath()
    this.readText = options.readText ?? boundedRead
    this.now = options.now ?? Date.now
    this.resolveAwsCli = options.resolveAwsCli ?? (async () => ({ path: null, reason: 'The verified aws-cli-v2 dependency is not connected to this host action.' }))
  }

  async discover(): Promise<AwsIdentityDiscovery> {
    const errors: string[] = []
    let configText: string | null = null
    let credentialsText: string | null = null
    try {
      configText = await this.readText(this.configPath)
    } catch (error) {
      errors.push(errorMessage(error, 'AWS configuration'))
    }
    try {
      credentialsText = await this.readText(this.credentialsPath)
    } catch (error) {
      errors.push(errorMessage(error, 'AWS shared credentials metadata'))
    }
    const profiles = parseAwsProfileMetadata(configText, credentialsText)
    const regions = [...new Set([...AWS_REGIONS, ...profiles.flatMap((profile) => profile.region ? [profile.region] : [])])].sort()
    if (errors.length > 0) {
      return { state: 'unavailable', profiles, regions, reason: errors.join(' '), scannedAt: this.now() }
    }
    if (!configText && !credentialsText) {
      return {
        state: 'empty',
        profiles: [],
        regions,
        reason: 'No local AWS profiles are configured on this computer. Configure a profile, then rescan.',
        scannedAt: this.now()
      }
    }
    return {
      state: profiles.length > 0 ? 'ready' : 'empty',
      profiles,
      regions,
      reason: profiles.length > 0 ? null : 'The local AWS files contain no usable profile sections.',
      scannedAt: this.now()
    }
  }

  onOperation(listener: (operation: AwsIdentityOperation) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(operation: AwsIdentityOperation): void {
    for (const listener of this.listeners) listener(operation)
  }

  private updateOperation(operationId: string, patch: Partial<AwsIdentityOperation>): AwsIdentityOperation | null {
    const record = this.operations.get(operationId)
    if (!record) return null
    record.operation = { ...record.operation, ...patch }
    this.emit(record.operation)
    if (record.operation.state === 'succeeded' || record.operation.state === 'failed' || record.operation.state === 'cancelled') {
      setTimeout(() => this.operations.delete(operationId), 10 * 60_000).unref?.()
    }
    return record.operation
  }

  async start(action: AwsIdentityAction, profileName: string, bindingInput?: AwsIdentityBinding): Promise<AwsIdentityOperation> {
    const operationId = randomUUID()
    if (this.operations.size >= MAX_OPERATIONS) {
      return {
        operationId,
        action,
        state: 'failed',
        message: 'Too many AWS identity operations are already active. Wait for one to finish, then retry.',
        startedAt: null,
        completedAt: this.now(),
        identity: null
      }
    }
    const operation: AwsIdentityOperation = {
      operationId,
      action,
      state: 'queued',
      message: 'AWS identity operation queued.',
      startedAt: null,
      completedAt: null,
      identity: null
    }
    const controller = new AbortController()
    this.operations.set(operationId, { operation, controller })
    this.emit(operation)
    void this.execute(operationId, action, profileName, bindingInput)
    return operation
  }

  async cancel(operationId: string): Promise<boolean> {
    const record = this.operations.get(operationId)
    if (!record || (record.operation.state !== 'queued' && record.operation.state !== 'running')) return false
    record.controller.abort()
    this.updateOperation(operationId, {
      state: 'cancelled',
      message: 'AWS identity operation cancelled.',
      completedAt: this.now()
    })
    return true
  }

  private async execute(
    operationId: string,
    action: AwsIdentityAction,
    profileName: string,
    bindingInput?: AwsIdentityBinding
  ): Promise<void> {
    const record = this.operations.get(operationId)
    if (!record) return
    if (!SAFE_PROFILE.test(profileName)) {
      this.updateOperation(operationId, { state: 'failed', message: 'The selected AWS profile name is invalid.', completedAt: this.now() })
      return
    }
    const discovery = await this.discover()
    const profile = discovery.profiles.find((candidate) => candidate.name === profileName)
    if (!profile) {
      this.updateOperation(operationId, { state: 'failed', message: 'The selected AWS profile is no longer available on this computer.', completedAt: this.now() })
      return
    }
    const binding = normalizeAwsIdentityBinding(bindingInput) ?? {
      schemaVersion: 1 as const,
      profileName,
      region: profile.region,
      endpoints: [],
      verifiedAt: null
    }
    const plan = planAwsIdentity(discovery, binding)
    if (plan.state !== 'ready') {
      this.updateOperation(operationId, { state: 'failed', message: plan.reason ?? 'The AWS identity plan is unavailable.', completedAt: this.now() })
      return
    }
    if (action === 'sso-login' && !plan.signInArgs) {
      this.updateOperation(operationId, { state: 'failed', message: 'The selected AWS profile has no IAM Identity Center sign-in configuration.', completedAt: this.now() })
      return
    }
    if (action === 'assume-role' && !plan.roleArgs) {
      this.updateOperation(operationId, { state: 'failed', message: 'The selected AWS profile has no role assumption configuration.', completedAt: this.now() })
      return
    }
    const resolved = await this.resolveAwsCli()
    if (!resolved.path) {
      this.updateOperation(operationId, { state: 'failed', message: resolved.reason ?? 'The verified AWS CLI is unavailable on this host.', completedAt: this.now() })
      return
    }
    const args = action === 'sso-login'
      ? [...plan.signInArgs!]
      : [...plan.callerIdentityArgs, '--output', 'json']
    this.updateOperation(operationId, { state: 'running', message: action === 'sso-login' ? 'AWS IAM Identity Center sign-in is running.' : 'AWS identity verification is running.', startedAt: this.now() })
    try {
      const result = await execFileAsync(resolved.path, args, {
        signal: record.controller.signal,
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        encoding: 'utf8'
      })
      if (record.controller.signal.aborted) return
      const identity = action === 'sso-login' ? null : parseIdentityFact(String(result.stdout ?? ''))
      if (action !== 'sso-login' && !identity) {
        this.updateOperation(operationId, { state: 'failed', message: 'AWS identity verification returned no usable identity facts.', completedAt: this.now() })
        return
      }
      this.updateOperation(operationId, {
        state: 'succeeded',
        message: action === 'sso-login' ? 'AWS IAM Identity Center sign-in completed without returning session data.' : 'AWS identity verified. Session credentials remain in AWS local storage.',
        identity,
        completedAt: this.now()
      })
    } catch (error) {
      if (record.controller.signal.aborted) return
      const code = (error as NodeJS.ErrnoException).code
      this.updateOperation(operationId, { state: 'failed', message: code === 'ETIMEDOUT' ? 'AWS identity operation timed out.' : 'AWS identity operation did not complete.', completedAt: this.now() })
    }
  }
}

function parseIdentityFact(stdout: string): AwsIdentityFact | null {
  try {
    const value = JSON.parse(stdout) as Record<string, unknown>
    const accountId = typeof value.Account === 'string' && /^[0-9]{12}$/.test(value.Account) ? value.Account : null
    const arn = typeof value.Arn === 'string' && SAFE_METADATA.test(value.Arn) ? value.Arn : null
    const userId = typeof value.UserId === 'string' && SAFE_METADATA.test(value.UserId) ? value.UserId : null
    if (!accountId && !arn && !userId) return null
    return { accountId, arn, userId, expiresAt: null }
  } catch {
    return null
  }
}

export function registerAwsIdentityIpc(
  platform: CorePlatform,
  options: AwsIdentityServiceOptions = {}
): AwsIdentityService {
  const service = new AwsIdentityService(options)
  platform.handle(IPC.awsIdentityDiscover, () => service.discover())
  platform.handle(IPC.awsIdentityStart, (action: AwsIdentityAction, profileName: string, binding?: AwsIdentityBinding) => service.start(action, profileName, binding))
  platform.handle(IPC.awsIdentityCancel, (operationId: string) => service.cancel(operationId))
  service.onOperation((operation) => platform.broadcast(IPC.awsIdentityOperation, operation))
  return service
}
