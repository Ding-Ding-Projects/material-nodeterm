/**
 * Shared provider-account contracts.
 *
 * A blueprint is safe to carry with a project. A binding is a machine-local pointer to a
 * blueprint, and a credential is represented only by an opaque vault reference. No token,
 * cookie, password, authorization code, or vault bytes are part of these wire shapes.
 */

export const PROVIDER_ACCOUNT_SCHEMA_VERSION = 1 as const

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'moonshot'
  | 'minimax'
  | 'opencode'
  | 'custom'

export type ProviderProfileStatus = 'ready' | 'needs-auth' | 'expired' | 'revoked' | 'error'

export type OAuthCallbackStatus = 'pending' | 'completed' | 'expired' | 'cancelled' | 'rejected'

/** Portable provider intent. It contains display and capability metadata only. */
export interface ProviderBlueprint {
  version: typeof PROVIDER_ACCOUNT_SCHEMA_VERSION
  id: string
  provider: ProviderId
  label: string
  /** Provider account or tenant label, never an access credential. */
  accountLabel?: string
  scopes?: string[]
  authKind: 'oauth' | 'api-key' | 'cookie' | 'external'
  endpoint?: string
}

/** A reference to a sealed entry in the local operating-system credential store. */
export interface CredentialReference {
  id: string
  vault: 'os'
  provider: ProviderId
  createdAt: number
  updatedAt: number
  expiresAt?: number
  permissions: string[]
}

/** Host-local link between a project/node and a portable provider blueprint. */
export interface ProviderBinding {
  id: string
  projectId: string
  blueprintId: string
  profileId?: string
  nodeId?: string
  credentialRefId?: string
  selected: boolean
  createdAt: number
  updatedAt: number
}

export interface ProviderProfile {
  id: string
  provider: ProviderId
  label: string
  authKind: ProviderBlueprint['authKind']
  accountLabel?: string
  endpoint?: string
  status: ProviderProfileStatus
  scopes: string[]
  credential: CredentialReference | null
  expiresAt?: number
  permissions: string[]
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

export interface ProviderAccountsSnapshot {
  profiles: ProviderProfile[]
  bindings: ProviderBinding[]
  blueprints: ProviderBlueprint[]
  selectedProfileId: string | null
  revision: number
}

export interface ProviderProfileInput {
  provider: ProviderId
  label: string
  accountLabel?: string
  authKind: ProviderBlueprint['authKind']
  scopes?: string[]
  endpoint?: string
}

export interface ProviderCredentialInput {
  profileId: string
  value: string
  expiresAt?: number
  permissions?: string[]
}

export interface ProviderBindingInput {
  projectId: string
  blueprintId: string
  profileId?: string
  nodeId?: string
  credentialRefId?: string
  selected?: boolean
}

export interface OAuthStartInput {
  provider: ProviderId
  profileId?: string
  label: string
  accountLabel?: string
  scopes?: string[]
  endpoint?: string
  authUrl: string
  redirectUri: string
}

export interface OAuthCallbackHandle {
  id: string
  provider: ProviderId
  profileId: string
  state: string
  redirectUri: string
  status: OAuthCallbackStatus
  expiresAt: number
}

export interface OAuthCompleteInput {
  callbackId: string
  state: string
  value: string
  expiresAt?: number
  permissions?: string[]
  accountLabel?: string
}

export interface ProviderAccountsApi {
  snapshot(): Promise<ProviderAccountsSnapshot>
  createProfile(input: ProviderProfileInput): Promise<ProviderProfile>
  updateProfile(id: string, input: Partial<ProviderProfileInput>): Promise<ProviderProfile | null>
  removeProfile(id: string): Promise<boolean>
  setCredential(input: ProviderCredentialInput): Promise<ProviderProfile | null>
  clearCredential(profileId: string): Promise<boolean>
  selectProfile(profileId: string | null): Promise<ProviderAccountsSnapshot>
  bind(input: ProviderBindingInput): Promise<ProviderBinding>
  unbind(bindingId: string): Promise<boolean>
  startOAuth(input: OAuthStartInput): Promise<{ handle: OAuthCallbackHandle; authUrl: string }>
  completeOAuth(input: OAuthCompleteInput): Promise<ProviderProfile | null>
  cancelOAuth(callbackId: string): Promise<boolean>
  onChanged(listener: (snapshot: ProviderAccountsSnapshot) => void): () => void
}

export function isProviderId(value: unknown): value is ProviderId {
  return ['anthropic', 'openai', 'google', 'xai', 'moonshot', 'minimax', 'opencode', 'custom'].includes(String(value))
}

export function normalizeProviderScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return []
  return [...new Set(scopes.filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0 && scope.length <= 128))].slice(0, 64)
}

function isSafeProviderEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) && !url.username && !url.password
  } catch {
    return false
  }
}

export function validateProviderBlueprint(value: unknown): value is ProviderBlueprint {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ProviderBlueprint>
  const allowed = new Set(['version', 'id', 'provider', 'label', 'accountLabel', 'scopes', 'authKind', 'endpoint'])
  if (Object.keys(item).some((key) => !allowed.has(key))) return false
  return item.version === PROVIDER_ACCOUNT_SCHEMA_VERSION &&
    typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 &&
    isProviderId(item.provider) && typeof item.label === 'string' && item.label.trim().length > 0 &&
    item.label.length <= 256 && ['oauth', 'api-key', 'cookie', 'external'].includes(String(item.authKind)) &&
    (item.accountLabel === undefined || (typeof item.accountLabel === 'string' && item.accountLabel.length <= 256)) &&
    (item.endpoint === undefined || isSafeProviderEndpoint(item.endpoint)) &&
    (item.scopes === undefined || normalizeProviderScopes(item.scopes).length === item.scopes.length)
}

export function sanitizeProviderBlueprint(value: ProviderBlueprint): ProviderBlueprint {
  return {
    version: PROVIDER_ACCOUNT_SCHEMA_VERSION,
    id: value.id.trim(),
    provider: value.provider,
    label: value.label.trim(),
    ...(value.accountLabel?.trim() ? { accountLabel: value.accountLabel.trim() } : {}),
    authKind: value.authKind,
    ...(value.endpoint?.trim() ? { endpoint: value.endpoint.trim() } : {}),
    ...(normalizeProviderScopes(value.scopes).length ? { scopes: normalizeProviderScopes(value.scopes) } : {})
  }
}
