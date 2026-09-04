import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { platform } from '../platform'
import type {
  AwsApi as AwsLegacyIdentityManagerApi,
  AwsAssumeRoleInput,
  AwsAssumeRoleResult,
  AwsCallerIdentity,
  AwsPermissionResult,
  AwsProfile,
  AwsProfileDraft,
  AwsRegionEndpoint,
  AwsSsoLoginResult
} from '../../shared/aws'

const MAX_CONFIG_BYTES = 2 * 1024 * 1024
const MAX_MANAGED_PROFILES = 128
const MAX_NAME = 128
const AWS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const AWS_REGION = /^[a-z0-9-]{2,32}$/
const ACTION_NAME = /^[a-z0-9*:_-]{1,160}$/i
const ENDPOINT = /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?(?:\/[^\s]*)?$/i
const SAFE_CREDENTIAL_PROCESS = /^[A-Za-z0-9._-]+(?:\.exe)?$/i
const AWS_REGIONS = [
  'af-south-1', 'ap-east-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-south-1', 'ap-south-2', 'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3',
  'ap-southeast-4', 'ca-central-1', 'ca-west-1', 'eu-central-1', 'eu-central-2',
  'eu-north-1', 'eu-south-1', 'eu-south-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'il-central-1', 'me-central-1', 'me-south-1', 'mx-central-1', 'sa-east-1',
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'
]

type Ini = Map<string, Map<string, string>>
interface ManagedProfile extends AwsProfileDraft {
  credentialProcessTrusted?: boolean
}
interface CacheFile {
  version: 1
  profiles: ManagedProfile[]
  endpoints: Record<string, string>
}

function parseIni(input: string): Ini {
  const out: Ini = new Map()
  let section = 'default'
  out.set(section, new Map())
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = header[1].trim()
      out.set(section, out.get(section) ?? new Map())
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    out.get(section)!.set(key, value)
  }
  return out
}

function profileName(section: string): string | null {
  if (section === 'default') return 'default'
  if (section.startsWith('sso-session ')) return null
  if (section.startsWith('profile ')) return section.slice(8).trim() || null
  return AWS_NAME.test(section) ? section : null
}

function safeName(name: unknown): string {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!AWS_NAME.test(value)) throw new Error('Profile names use letters, numbers, dots, underscores, and hyphens.')
  return value
}

function safeRegion(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !AWS_REGION.test(value)) throw new Error('Enter a valid AWS region such as us-east-1.')
  return value
}

function safeUrl(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 512 || !ENDPOINT.test(value)) {
    throw new Error('Endpoint overrides must use an https URL.')
  }
  return value
}

function processInfo(raw: string | undefined, trusted: boolean): AwsProfile['credentialProcess'] {
  if (!raw) return { configured: false, executableName: null, trusted: false, reason: null }
  const first = raw.trim().split(/\s+/)[0] ?? ''
  const executableName = basename(first).slice(0, 160) || null
  const safe = SAFE_CREDENTIAL_PROCESS.test(executableName ?? '') && !/[&|;<>$`]/.test(raw)
  return {
    configured: true,
    executableName,
    trusted: safe && trusted,
    reason: safe
      ? trusted
        ? null
        : 'This credential process is visible but not trusted. Review it before enabling use.'
      : 'Only a plain executable name without shell operators can be trusted.'
  }
}

function partitionFor(region: string): string {
  if (region.startsWith('cn-')) return 'aws-cn'
  if (region.startsWith('us-gov-')) return 'aws-us-gov'
  return 'aws'
}

function defaultEndpoint(region: string): string {
  return partitionFor(region) === 'aws-cn'
    ? `https://service.${region}.amazonaws.com.cn`
    : partitionFor(region) === 'aws-us-gov'
      ? `https://service.${region}.amazonaws.com`
      : `https://service.${region}.amazonaws.com`
}

function readJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function awsCandidates(): string[] {
  const candidates: string[] = []
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
    if (root) candidates.push(join(root, 'Amazon', 'AWSCLIV2', 'aws.exe'))
  }
  candidates.push('aws.exe', 'aws')
  return [...new Set(candidates)]
}

function awsEnvironment(): NodeJS.ProcessEnv {
  // Profile files are the intended source. Do not inherit arbitrary credential-bearing environment
  // variables into a child process, and never echo the environment through stderr/stdout.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    AWS_CONFIG_FILE: process.env.AWS_CONFIG_FILE,
    AWS_SHARED_CREDENTIALS_FILE: process.env.AWS_SHARED_CREDENTIALS_FILE,
    AWS_CA_BUNDLE: process.env.AWS_CA_BUNDLE,
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_EC2_METADATA_DISABLED: 'true'
  }
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
}

function runAwsJson(
  args: string[],
  stdin?: string
): Promise<{ code: number; json: Record<string, unknown> | null }> {
  const candidates = awsCandidates()
  return new Promise((resolve) => {
    const attempt = (index: number): void => {
      const executable = candidates[index]
      if (!executable) {
        resolve({ code: -1, json: null })
        return
      }
      const child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        env: awsEnvironment(),
        stdio: ['pipe', 'pipe', 'ignore']
      })
      let output = ''
      let bytes = 0
      child.stdout.on('data', (chunk: Buffer | string) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes <= 2 * 1024 * 1024) output += chunk.toString()
        else child.kill()
      })
      child.on('error', () => attempt(index + 1))
      child.on('close', (code) => {
        if (code === -1 && !output && index + 1 < candidates.length) attempt(index + 1)
        else resolve({ code: code ?? -1, json: readJson<Record<string, unknown>>(output) })
      })
      if (stdin) child.stdin.write(stdin)
      child.stdin.end()
    }
    // The resolver is intentionally a fixed candidate list, never a user supplied command line.
    attempt(0)
  })
}

export class AwsProfileManager implements AwsLegacyIdentityManagerApi {
  private readonly file: string
  private cached: CacheFile | null = null

  constructor(private readonly root = platform().userDataDir) {
    this.file = join(root, 'aws-manager', 'state.json')
  }

  private async loadManaged(): Promise<CacheFile> {
    if (this.cached) return structuredClone(this.cached)
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = readJson<CacheFile>(raw)
      if (parsed?.version === 1 && Array.isArray(parsed.profiles) && parsed.profiles.length <= MAX_MANAGED_PROFILES) {
        this.cached = { version: 1, profiles: parsed.profiles, endpoints: parsed.endpoints ?? {} }
      } else this.cached = { version: 1, profiles: [], endpoints: {} }
    } catch {
      this.cached = { version: 1, profiles: [], endpoints: {} }
    }
    return structuredClone(this.cached)
  }

  private async saveManaged(next: CacheFile): Promise<void> {
    await mkdir(join(this.root, 'aws-manager'), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.file).catch(async (error) => {
      await unlink(temp).catch(() => {})
      throw error
    })
    this.cached = structuredClone(next)
  }

  private async sourceProfiles(): Promise<{ config: Ini; credentials: Ini }> {
    const read = async (name: string): Promise<Ini> => {
      try {
        const text = await readFile(join(homedir(), '.aws', name), 'utf8')
        if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) return new Map()
        return parseIni(text)
      } catch {
        return new Map()
      }
    }
    return { config: await read('config'), credentials: await read('credentials') }
  }

  async profiles(): Promise<AwsProfile[]> {
    const [{ config, credentials }, managed] = await Promise.all([this.sourceProfiles(), this.loadManaged()])
    const names = new Set<string>(['default'])
    for (const section of config.keys()) {
      const name = profileName(section)
      if (name) names.add(name)
    }
    for (const section of credentials.keys()) {
      const name = profileName(section)
      if (name) names.add(name)
    }
    for (const item of managed.profiles) {
      if (AWS_NAME.test(item.name)) names.add(item.name)
    }
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
      const c = config.get(name === 'default' ? 'default' : `profile ${name}`) ?? new Map()
      const creds = credentials.get(name === 'default' ? 'default' : name) ?? new Map()
      const overlay = managed.profiles.find((p) => p.name === name)
      const region = safeRegion(overlay?.region ?? c.get('region'))
      const ssoStartUrl = overlay?.ssoStartUrl ?? c.get('sso_start_url') ?? null
      const ssoRegion = safeRegion(overlay?.ssoRegion ?? c.get('sso_region'))
      const roleArn = overlay?.roleArn ?? c.get('role_arn') ?? null
      const sourceProfile = overlay?.sourceProfile ?? c.get('source_profile') ?? null
      const endpointOverride = managed.endpoints[region ?? ''] ?? overlay?.endpointOverride ?? null
      const credentialProcess = processInfo(c.get('credential_process'), overlay?.credentialProcessTrusted === true)
      const cacheExpires = overlay?.ssoSessionName ? null : null
      return {
        name,
        source: overlay ? 'managed' : config.has(`profile ${name}`) || config.has(name === 'default' ? 'default' : name) ? 'config' : 'credentials',
        region,
        output: (overlay?.output ?? c.get('output') ?? null) as AwsProfile['output'],
        sso: {
          configured: Boolean(ssoStartUrl && ssoRegion),
          startUrl: ssoStartUrl,
          region: ssoRegion,
          sessionName: overlay?.ssoSessionName ?? c.get('sso_session') ?? null,
          authMode: (overlay?.ssoAuthMode ?? (ssoStartUrl && ssoRegion ? 'pkce' : null)) as AwsProfile['sso']['authMode']
        },
        role: {
          configured: Boolean(roleArn),
          roleArn,
          sourceProfile,
          externalIdConfigured: Boolean(c.get('external_id')),
          mfaSerialConfigured: Boolean(c.get('mfa_serial'))
        },
        staticCredentialsConfigured: Boolean(creds.get('aws_access_key_id') || creds.get('aws_secret_access_key')),
        credentialProcess,
        endpointOverride,
        cache: { kind: 'machine-local', expiresAt: cacheExpires, valid: true }
      }
    })
  }

  async saveProfile(draft: AwsProfileDraft): Promise<AwsProfile[]> {
    const name = safeName(draft.name)
    const next: ManagedProfile = {
      name,
      region: safeRegion(draft.region),
      output: draft.output ?? 'json',
      ssoStartUrl: draft.ssoStartUrl ?? null,
      ssoRegion: safeRegion(draft.ssoRegion),
      ssoSessionName: draft.ssoSessionName?.trim().slice(0, MAX_NAME) || null,
      ssoAuthMode: draft.ssoAuthMode ?? null,
      roleArn: draft.roleArn?.trim().slice(0, 512) || null,
      sourceProfile: draft.sourceProfile ? safeName(draft.sourceProfile) : null,
      mfaSerial: draft.mfaSerial?.trim().slice(0, 256) || null,
      endpointOverride: safeUrl(draft.endpointOverride)
    }
    if (next.ssoStartUrl && !/^https:\/\//i.test(next.ssoStartUrl)) throw new Error('AWS SSO start URL must use HTTPS.')
    const managed = await this.loadManaged()
    managed.profiles = [...managed.profiles.filter((p) => p.name !== name), next]
    await this.saveManaged(managed)
    return this.profiles()
  }

  async removeProfile(name: string): Promise<void> {
    const managed = await this.loadManaged()
    managed.profiles = managed.profiles.filter((p) => p.name !== safeName(name))
    await this.saveManaged(managed)
  }

  refresh(): Promise<AwsProfile[]> {
    this.cached = null
    return this.profiles()
  }

  async ssoLogin(profileName: string, authMode: 'pkce' | 'device-code' = 'pkce'): Promise<AwsSsoLoginResult> {
    const profile = (await this.profiles()).find((item) => item.name === safeName(profileName))
    if (!profile?.sso.configured) {
      return { profileName, phase: 'unavailable', authMode, expiresAt: null, detail: 'Configure an HTTPS SSO start URL and SSO region first.' }
    }
    const args = ['sso', 'login', '--profile', profile.name, '--no-cli-pager', '--output', 'json']
    if (authMode === 'device-code') args.push('--use-device-code')
    const result = await runAwsJson(args)
    return result.code === 0
      ? { profileName: profile.name, phase: 'ready', authMode, expiresAt: null, detail: 'AWS SSO login completed. The AWS CLI owns its machine-local cache.' }
      : { profileName: profile.name, phase: 'failed', authMode, expiresAt: null, detail: 'AWS SSO login did not complete. The browser or AWS CLI reported no usable session.' }
  }

  async assumeRole(input: AwsAssumeRoleInput): Promise<AwsAssumeRoleResult> {
    const profileName = safeName(input.profileName)
    if (!input.roleArn.startsWith('arn:aws:iam::') || input.roleArn.length > 512) throw new Error('Enter a valid AWS IAM role ARN.')
    const sessionName = input.sessionName.trim()
    if (!/^[A-Za-z0-9+=,.@_-]{2,64}$/.test(sessionName)) throw new Error('Role session names must use AWS-safe characters.')
    const duration = Math.max(900, Math.min(43200, Math.trunc(input.durationSeconds ?? 3600)))
    const args = ['sts', 'assume-role', '--profile', profileName, '--role-arn', input.roleArn, '--role-session-name', sessionName, '--duration-seconds', String(duration), '--no-cli-pager', '--output', 'json']
    if (input.mfaSerial) args.push('--serial-number', input.mfaSerial)
    // MFA is deliberately written to stdin and is never put in argv, logs, settings, or the
    // result. AWS CLI versions that require an alternate MFA input adapter fail visibly here.
    const result = await runAwsJson(args, input.mfaCode ? `${input.mfaCode.trim()}\n` : undefined)
    const credentials = result.json?.Credentials as { Expiration?: unknown } | undefined
    const assumedRoleArn = typeof result.json?.AssumedRoleUser === 'object' && result.json.AssumedRoleUser
      ? (result.json.AssumedRoleUser as { Arn?: unknown }).Arn
      : null
    const expiresAt = typeof credentials?.Expiration === 'string' ? credentials.Expiration : null
    return {
      profileName,
      roleArn: input.roleArn,
      assumedRoleArn: typeof assumedRoleArn === 'string' ? assumedRoleArn : null,
      expiresAt,
      phase: result.code === 0 ? 'ready' : 'failed',
      detail: result.code === 0 ? 'Role session is available only for this operation and remains machine-local.' : 'Role assumption failed. Check the selected profile, role trust, and MFA code.'
    }
  }

  async callerIdentity(profileName: string): Promise<AwsCallerIdentity> {
    const name = safeName(profileName)
    const result = await runAwsJson(['sts', 'get-caller-identity', '--profile', name, '--no-cli-pager', '--output', 'json'])
    const account = typeof result.json?.Account === 'string' ? result.json.Account : null
    const arn = typeof result.json?.Arn === 'string' ? result.json.Arn : null
    const userId = typeof result.json?.UserId === 'string' ? result.json.UserId : null
    const phase = result.code === 0 && account && arn ? 'ready' : result.code === -1 ? 'unavailable' : 'failed'
    return { profileName: name, account, arn, userId, checkedAt: Date.now(), expiresAt: null, phase, detail: phase === 'ready' ? null : 'AWS CLI or the selected profile could not provide caller identity.' }
  }

  async permissions(profileName: string, actions: string[]): Promise<AwsPermissionResult[]> {
    const name = safeName(profileName)
    const identity = await this.callerIdentity(name)
    if (identity.phase !== 'ready' || !identity.arn) return actions.map((action) => ({ profileName: name, action, decision: 'unknown', checkedAt: Date.now(), detail: identity.detail }))
    const valid = actions.filter((action) => ACTION_NAME.test(action)).slice(0, 100)
    const result = await runAwsJson(['iam', 'simulate-principal-policy', '--profile', name, '--policy-source-arn', identity.arn, '--action-names', ...valid, '--no-cli-pager', '--output', 'json'])
    const evaluations = Array.isArray(result.json?.EvaluationResults) ? result.json.EvaluationResults : []
    const byAction = new Map(evaluations.filter((e): e is { EvalActionName?: string; EvalDecision?: string } => Boolean(e && typeof e === 'object')).map((e) => [e.EvalActionName ?? '', e.EvalDecision ?? '']))
    return actions.map((action) => {
      const decision = byAction.get(action)
      const mapped: AwsPermissionResult['decision'] = decision === 'allowed' ? 'allowed' : decision === 'explicitDeny' ? 'explicitDeny' : decision === 'implicitDeny' ? 'implicitDeny' : 'unknown'
      return { profileName: name, action, decision: mapped, checkedAt: Date.now(), detail: mapped === 'unknown' ? 'Permission could not be established from IAM simulation.' : null }
    })
  }

  async regions(profileName?: string): Promise<AwsRegionEndpoint[]> {
    const managed = await this.loadManaged()
    const result = profileName ? await runAwsJson(['ec2', 'describe-regions', '--profile', safeName(profileName), '--all-regions', '--no-cli-pager', '--output', 'json']) : { code: -1, json: null }
    const rows = Array.isArray(result.json?.Regions) ? result.json.Regions : []
    const names = rows.map((r) => typeof r === 'object' && r && typeof (r as { RegionName?: unknown }).RegionName === 'string' ? (r as { RegionName: string }).RegionName : '').filter((r) => AWS_REGION.test(r))
    const selected = names.length ? names : AWS_REGIONS
    return [...new Set(selected)].map((region) => ({ region, partition: partitionFor(region), endpoint: managed.endpoints[region] ?? defaultEndpoint(region), configured: Boolean(managed.endpoints[region]), available: names.length ? true : null }))
  }

  async setEndpoint(region: string, endpoint: string | null): Promise<AwsRegionEndpoint[]> {
    const validRegion = safeRegion(region)
    if (!validRegion) throw new Error('Choose an AWS region before setting an endpoint.')
    const managed = await this.loadManaged()
    if (endpoint == null || endpoint.trim() === '') delete managed.endpoints[validRegion]
    else managed.endpoints[validRegion] = safeUrl(endpoint) as string
    await this.saveManaged(managed)
    return this.regions()
  }

  async clearMachineCache(): Promise<void> {
    const managed = await this.loadManaged()
    await this.saveManaged({ version: 1, profiles: managed.profiles, endpoints: {} })
  }

  async trustCredentialProcess(profileName: string): Promise<AwsProfile | null> {
    const name = safeName(profileName)
    const profiles = await this.profiles()
    const current = profiles.find((profile) => profile.name === name)
    if (!current || !current.credentialProcess.configured || !current.credentialProcess.executableName || !SAFE_CREDENTIAL_PROCESS.test(current.credentialProcess.executableName)) return null
    const managed = await this.loadManaged()
    const existing = managed.profiles.find((item) => item.name === name)
    const next: ManagedProfile = existing ?? { name }
    next.credentialProcessTrusted = true
    managed.profiles = [...managed.profiles.filter((item) => item.name !== name), next]
    await this.saveManaged(managed)
    return (await this.profiles()).find((profile) => profile.name === name) ?? null
  }
}
