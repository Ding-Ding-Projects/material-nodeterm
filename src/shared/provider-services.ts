/**
 * Shared provider-account contracts.
 *
 * Everything in this file is safe to hand to the renderer. Credential payloads, OAuth PKCE
 * verifiers, callback state, provider sessions, and host resources stay behind the core service.
 */

export type ProviderAuthKind = 'oauth-pkce' | 'credential'
export type ProviderAvailability = 'available' | 'requires-adapter' | 'unavailable'

export interface ProviderDescriptor {
  id: string
  label: string
  authKind: ProviderAuthKind
  capabilities: string[]
  availability: ProviderAvailability
  reason: string | null
}

export interface ProviderAccountSummary {
  id: string
  providerId: string
  providerLabel: string
  displayName: string
  externalAccountId: string
  state: 'connected' | 'needs-consent' | 'offline' | 'unavailable'
  reason: string | null
  createdAt: number
  updatedAt: number
}

export interface ProviderResourceSummary {
  id: string
  accountId: string
  label: string
  kind: string
  available: boolean
  reason: string | null
}

export interface ProviderOAuthStartResult {
  status: 'ready' | 'unsupported'
  providerId: string
  authorizationUrl: string | null
  redirectUri: string | null
  expiresAt: number | null
  reason: string | null
}

export interface ProviderOAuthCallbackResult {
  status: 'connected' | 'rejected' | 'expired'
  account: ProviderAccountSummary | null
  reason: string | null
}

export interface ProviderServicesApi {
  catalog(): Promise<ProviderDescriptor[]>
  accounts(providerId?: string): Promise<ProviderAccountSummary[]>
  resources(accountId: string, capability?: string): Promise<ProviderResourceSummary[]>
  beginOAuth(providerId: string): Promise<ProviderOAuthStartResult>
  /** Callback URLs are delivered by the trusted shell callback route, never typed by a user. */
  completeOAuth(callbackUrl: string): Promise<ProviderOAuthCallbackResult>
  removeAccount(accountId: string): Promise<{ ok: true } | { ok: false; error: string }>
}

