/**
 * AWS identity selection for the AWS Universe.
 *
 * The renderer receives profile names and non-secret configuration facts only. Access keys,
 * secret keys, session tokens, cached SSO tokens, MFA codes, credential-process output, config
 * paths, and command results never cross this boundary. The eventual AWS command runner consumes
 * the fixed argument plans here and lets the AWS CLI read its own protected local stores.
 */

export type AwsIdentityMode = 'profile' | 'identity-center' | 'assume-role'

export interface AwsProfileSummary {
  name: string
  source: 'config' | 'credentials' | 'both'
  mode: AwsIdentityMode
  region: string | null
  roleConfigured: boolean
  mfaConfigured: boolean
  identityCenterConfigured: boolean
}
export interface AwsIdentityDiscovery {
  state: 'ready' | 'empty' | 'unavailable'
  profiles: AwsProfileSummary[]
  regions: string[]
  reason: string | null
  scannedAt: number
}

/** Safe project intent. Provider identity and machine bindings are deliberately absent. */
export interface AwsIdentityIntent {
  schemaVersion: 1
  mode: AwsIdentityMode
  preferredRegion: string | null
  requireMfa: boolean
  requireRole: boolean
  endpointServices: string[]
}

/**
 * Machine-local selection. This is kept in IndexEntryV3.localExec and stripped from the shared
 * project document and peer mutations. It still contains no credential material.
 */
export interface AwsIdentityBinding {
  schemaVersion: 1
  profileName: string
  region: string | null
  endpoints: AwsEndpointOverride[]
  verifiedAt: number | null
}

export interface AwsEndpointOverride {
  service: string
  url: string
}

export interface AwsIdentityPlan {
  state: 'ready' | 'unbound' | 'profile-missing' | 'invalid'
  reason: string | null
  profile: AwsProfileSummary | null
  /** Fixed argv for `aws sts get-caller-identity`; never a shell command. */
  callerIdentityArgs: string[]
  /** Fixed argv for `aws sso login`, present only for an Identity Center profile. */
  signInArgs: string[] | null
  region: string | null
  endpointServices: string[]
}

export interface AwsIdentityApi {
  /** Reads only local AWS config metadata and credential section names. Never returns secrets. */
  discover(): Promise<AwsIdentityDiscovery>
}

export const AWS_REGIONS = [
  'af-south-1',
  'ap-east-1',
  'ap-east-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-southeast-5',
  'ap-southeast-7',
  'ca-central-1',
  'ca-west-1',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'il-central-1',
  'me-central-1',
  'me-south-1',
  'mx-central-1',
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-gov-east-1',
  'us-gov-west-1',
  'us-west-1',
  'us-west-2'
] as const

export const AWS_ENDPOINT_SERVICES = [
  'cloudformation',
  'cloudwatch',
  'dynamodb',
  'ec2',
  'ecr',
  'ecs',
  'eks',
  'iam',
  'lambda',
  'logs',
  'rds',
  'route53',
  's3',
  'sns',
  'sqs',
  'ssm',
  'sts'
] as const

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/
const SAFE_SERVICE = /^[a-z][a-z0-9-]{0,63}$/
const SAFE_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/

function ownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function safeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const loopback = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !loopback) return null
  if (parsed.username || parsed.password || parsed.hash) return null
  return parsed.href
}

export function normalizeAwsIdentityIntent(value: unknown): AwsIdentityIntent | null {
  const input = ownRecord(value)
  if (!input || input.schemaVersion !== 1) return null
  if (!['profile', 'identity-center', 'assume-role'].includes(String(input.mode))) return null
  const preferredRegion = input.preferredRegion === null
    ? null
    : typeof input.preferredRegion === 'string' && SAFE_REGION.test(input.preferredRegion)
      ? input.preferredRegion
      : null
  if (input.preferredRegion !== null && preferredRegion === null) return null
  if (typeof input.requireMfa !== 'boolean' || typeof input.requireRole !== 'boolean') return null
  if (!Array.isArray(input.endpointServices) || input.endpointServices.length > 32) return null
  const endpointServices = [...new Set(input.endpointServices)]
  if (endpointServices.some((item) => typeof item !== 'string' || !SAFE_SERVICE.test(item))) return null
  return {
    schemaVersion: 1,
    mode: input.mode as AwsIdentityMode,
    preferredRegion,
    requireMfa: input.requireMfa,
    requireRole: input.requireRole,
    endpointServices: endpointServices as string[]
  }
}

export function normalizeAwsIdentityBinding(value: unknown): AwsIdentityBinding | null {
  const input = ownRecord(value)
  if (!input || input.schemaVersion !== 1 || typeof input.profileName !== 'string' || !SAFE_NAME.test(input.profileName)) return null
  const region = input.region === null
    ? null
    : typeof input.region === 'string' && SAFE_REGION.test(input.region)
      ? input.region
      : null
  if (input.region !== null && region === null) return null
  if (!Array.isArray(input.endpoints) || input.endpoints.length > 32) return null
  const endpoints: AwsEndpointOverride[] = []
  const services = new Set<string>()
  for (const candidate of input.endpoints) {
    const endpoint = ownRecord(candidate)
    if (!endpoint || typeof endpoint.service !== 'string' || !SAFE_SERVICE.test(endpoint.service)) return null
    const url = safeEndpoint(endpoint.url)
    if (!url || services.has(endpoint.service)) return null
    services.add(endpoint.service)
    endpoints.push({ service: endpoint.service, url })
  }
  const verifiedAt = input.verifiedAt === null
    ? null
    : typeof input.verifiedAt === 'number' && Number.isSafeInteger(input.verifiedAt) && input.verifiedAt >= 0
      ? input.verifiedAt
      : null
  if (input.verifiedAt !== null && verifiedAt === null) return null
  return { schemaVersion: 1, profileName: input.profileName, region, endpoints, verifiedAt }
}

export function awsIdentityIntentFor(
  profile: AwsProfileSummary,
  binding: AwsIdentityBinding
): AwsIdentityIntent {
  return {
    schemaVersion: 1,
    mode: profile.mode,
    preferredRegion: binding.region ?? profile.region,
    requireMfa: profile.mfaConfigured,
    requireRole: profile.roleConfigured,
    endpointServices: binding.endpoints.map((endpoint) => endpoint.service).sort()
  }
}

export function planAwsIdentity(
  discovery: AwsIdentityDiscovery,
  bindingInput: unknown
): AwsIdentityPlan {
  const binding = normalizeAwsIdentityBinding(bindingInput)
  if (!binding) {
    return {
      state: bindingInput == null ? 'unbound' : 'invalid',
      reason: bindingInput == null
        ? 'Choose a local AWS profile before using AWS operations on this computer.'
        : 'The local AWS identity binding is invalid. Choose a profile again.',
      profile: null,
      callerIdentityArgs: [],
      signInArgs: null,
      region: null,
      endpointServices: []
    }
  }
  const profile = discovery.profiles.find((candidate) => candidate.name === binding.profileName) ?? null
  if (!profile) {
    return {
      state: 'profile-missing',
      reason: `The profile “${binding.profileName}” is not configured on this computer. Rebind this AWS identity.`,
      profile: null,
      callerIdentityArgs: [],
      signInArgs: null,
      region: binding.region,
      endpointServices: binding.endpoints.map((endpoint) => endpoint.service)
    }
  }
  const region = binding.region ?? profile.region
  const callerIdentityArgs = ['sts', 'get-caller-identity', '--profile', profile.name]
  if (region) callerIdentityArgs.push('--region', region)
  const stsEndpoint = binding.endpoints.find((endpoint) => endpoint.service === 'sts')
  if (stsEndpoint) callerIdentityArgs.push('--endpoint-url', stsEndpoint.url)
  return {
    state: 'ready',
    reason: null,
    profile,
    callerIdentityArgs,
    signInArgs: profile.identityCenterConfigured ? ['sso', 'login', '--profile', profile.name] : null,
    region,
    endpointServices: binding.endpoints.map((endpoint) => endpoint.service)
  }
}
