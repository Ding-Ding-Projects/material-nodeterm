import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import {
  AWS_REGIONS,
  type AwsIdentityDiscovery,
  type AwsProfileSummary
} from '../shared/aws-identity'

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_PROFILES = 512
const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/
const SAFE_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/

interface ProfileFacts {
  name: string
  inConfig: boolean
  inCredentials: boolean
  region: string | null
  roleConfigured: boolean
  mfaConfigured: boolean
  identityCenterConfigured: boolean
}
export interface AwsIdentityServiceOptions {
  configPath?: string
  credentialsPath?: string
  readText?: (path: string) => Promise<string | null>
  now?: () => number
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
    mfaConfigured: false,
    identityCenterConfigured: false
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
      if (key === 'role_arn' && value.trim().length > 0) current.roleConfigured = true
      if (key === 'mfa_serial' && value.trim().length > 0) current.mfaConfigured = true
      if (['sso_session', 'sso_start_url', 'sso_account_id', 'sso_role_name'].includes(key ?? '') && value.trim().length > 0) {
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
      mfaConfigured: profile.mfaConfigured,
      identityCenterConfigured: profile.identityCenterConfigured
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

  constructor(options: AwsIdentityServiceOptions = {}) {
    this.configPath = options.configPath ?? defaultConfigPath()
    this.credentialsPath = options.credentialsPath ?? defaultCredentialsPath()
    this.readText = options.readText ?? boundedRead
    this.now = options.now ?? Date.now
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
}

export function registerAwsIdentityIpc(
  platform: CorePlatform,
  options: AwsIdentityServiceOptions = {}
): AwsIdentityService {
  const service = new AwsIdentityService(options)
  platform.handle(IPC.awsIdentityDiscover, () => service.discover())
  return service
}
