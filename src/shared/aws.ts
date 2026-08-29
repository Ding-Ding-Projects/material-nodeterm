/**
 * Renderer-safe AWS identity manager contracts.
 *
 * The renderer receives profile metadata and short-lived status only. Access keys, SSO tokens,
 * MFA values, credential-process output, and role credentials never cross this boundary or enter
 * the project projection. The core owns all AWS CLI interaction and keeps machine-local state in
 * the application data directory.
 */

export type AwsProfileSource = 'config' | 'credentials' | 'managed'

export interface AwsCredentialProcessInfo {
  configured: boolean
  executableName: string | null
  trusted: boolean
  reason: string | null
}

export interface AwsProfile {
  name: string
  source: AwsProfileSource
  region: string | null
  output: 'json' | 'yaml' | 'text' | 'table' | null
  sso: {
    configured: boolean
    startUrl: string | null
    region: string | null
    sessionName: string | null
    authMode: 'pkce' | 'device-code' | null
  }
  role: {
    configured: boolean
    roleArn: string | null
    sourceProfile: string | null
    externalIdConfigured: boolean
    mfaSerialConfigured: boolean
  }
  staticCredentialsConfigured: boolean
  credentialProcess: AwsCredentialProcessInfo
  endpointOverride: string | null
  cache: {
    kind: 'machine-local'
    expiresAt: string | null
    valid: boolean
  }
}

export interface AwsProfileDraft {
  name: string
  region?: string | null
  output?: AwsProfile['output']
  ssoStartUrl?: string | null
  ssoRegion?: string | null
  ssoSessionName?: string | null
  ssoAuthMode?: 'pkce' | 'device-code' | null
  roleArn?: string | null
  sourceProfile?: string | null
  mfaSerial?: string | null
  endpointOverride?: string | null
}

export interface AwsSsoLoginResult {
  profileName: string
  phase: 'ready' | 'unavailable' | 'failed'
  authMode: 'pkce' | 'device-code'
  expiresAt: string | null
  detail: string | null
}

export interface AwsAssumeRoleInput {
  profileName: string
  roleArn: string
  sessionName: string
  durationSeconds?: number
  mfaSerial?: string | null
  /** Supplied once and written only to a trusted child process stdin. Never persisted or echoed. */
  mfaCode?: string | null
}

export interface AwsAssumeRoleResult {
  profileName: string
  roleArn: string
  assumedRoleArn: string | null
  expiresAt: string | null
  phase: 'ready' | 'failed'
  detail: string | null
}

export interface AwsCallerIdentity {
  profileName: string
  account: string | null
  arn: string | null
  userId: string | null
  checkedAt: number
  expiresAt: string | null
  phase: 'ready' | 'unavailable' | 'failed'
  detail: string | null
}

export interface AwsPermissionResult {
  profileName: string
  action: string
  decision: 'allowed' | 'explicitDeny' | 'implicitDeny' | 'unknown'
  checkedAt: number
  detail: string | null
}

export interface AwsRegionEndpoint {
  region: string
  partition: string
  endpoint: string
  configured: boolean
  available: boolean | null
}

export interface AwsApi {
  profiles(): Promise<AwsProfile[]>
  saveProfile(draft: AwsProfileDraft): Promise<AwsProfile[]>
  removeProfile(name: string): Promise<void>
  refresh(): Promise<AwsProfile[]>
  ssoLogin(profileName: string, authMode?: 'pkce' | 'device-code'): Promise<AwsSsoLoginResult>
  assumeRole(input: AwsAssumeRoleInput): Promise<AwsAssumeRoleResult>
  callerIdentity(profileName: string): Promise<AwsCallerIdentity>
  permissions(profileName: string, actions: string[]): Promise<AwsPermissionResult[]>
  regions(profileName?: string): Promise<AwsRegionEndpoint[]>
  setEndpoint(region: string, endpoint: string | null): Promise<AwsRegionEndpoint[]>
  clearMachineCache(): Promise<void>
  trustCredentialProcess(profileName: string): Promise<AwsProfile | null>
}
