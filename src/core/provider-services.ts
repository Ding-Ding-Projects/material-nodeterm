import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { IPC } from '../shared/ipc'
import type {
  ProviderAccountSummary,
  ProviderDescriptor,
  ProviderOAuthCallbackResult,
  ProviderOAuthStartResult,
  ProviderResourceSummary
} from '../shared/provider-services'
import { SecureStore, type SealedEntry } from './secure-store'
import type { CorePlatform } from './platform'
import {
  LocalNodeBindingStore,
  bindingActionStates,
  validateLocalNodeBinding
} from './portable-bindings'

const OAUTH_TTL_MS = 10 * 60_000
const MAX_PENDING_OAUTH = 64
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,79}$/
const OPAQUE_ID = /^[a-zA-Z0-9._:-]{1,240}$/

export interface ProviderOAuthExchange {
  externalAccountId: string
  displayName: string
  credential: unknown
}

export interface ProviderAdapter {
  descriptor: Omit<ProviderDescriptor, 'availability' | 'reason'>
  beginOAuth?(input: {
    state: string
    codeChallenge: string
    redirectUri: string
  }): Promise<{ authorizationUrl: string }>
  completeOAuth?(input: {
    callbackUrl: URL
    codeVerifier: string
    redirectUri: string
  }): Promise<ProviderOAuthExchange>
  resources?(account: ProviderAccountSummary, capability?: string): Promise<ProviderResourceSummary[]>
}

interface ProviderAccountMeta extends ProviderAccountSummary {
  /** Stable opaque name for local bindings. It never contains credential bytes. */
  credentialRef: string
}

interface PendingOAuth {
  providerId: string
  codeVerifier: string
  redirectUri: string
  expiresAt: number
}

const BUILTIN_PROVIDER_CATALOG: ReadonlyArray<Omit<ProviderDescriptor, 'availability' | 'reason'>> = [
  { id: 'google', label: 'Google', authKind: 'oauth-pkce', capabilities: ['calendar'] },
  { id: 'microsoft365', label: 'Microsoft 365', authKind: 'oauth-pkce', capabilities: ['calendar'] },
  { id: 'github', label: 'GitHub', authKind: 'oauth-pkce', capabilities: ['source-control'] },
  { id: 'aws', label: 'Amazon Web Services', authKind: 'credential', capabilities: ['cloud-resources'] },
  { id: 'caldav', label: 'CalDAV', authKind: 'credential', capabilities: ['calendar'] }
]

function boundedText(value: unknown, label: string, max = 240): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function safeUrl(value: string, label: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${label} is invalid.`) }
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
  if (url.protocol !== 'https:' && !loopback) throw new Error(`${label} must use HTTPS or loopback HTTP.`)
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`)
  return url
}

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export class ProviderServices {
  private readonly accounts = new SecureStore<ProviderAccountMeta>('provider-accounts.json')
  private readonly adapters = new Map<string, ProviderAdapter>()
  private readonly pending = new Map<string, PendingOAuth>()

  constructor(
    adapters: ProviderAdapter[] = [],
    private readonly redirectUri = 'http://127.0.0.1:37461/provider-oauth/callback'
  ) {
    for (const adapter of adapters) {
      if (!PROVIDER_ID.test(adapter.descriptor.id) || this.adapters.has(adapter.descriptor.id)) {
        throw new Error('Provider adapter id is invalid or duplicated.')
      }
      this.adapters.set(adapter.descriptor.id, adapter)
    }
    safeUrl(redirectUri, 'OAuth redirect URI')
  }

  catalog(): ProviderDescriptor[] {
    const declared = new Map(BUILTIN_PROVIDER_CATALOG.map((provider) => [provider.id, provider]))
    for (const adapter of this.adapters.values()) declared.set(adapter.descriptor.id, adapter.descriptor)
    return [...declared.values()].map((provider) => {
      const adapter = this.adapters.get(provider.id)
      const available = provider.authKind === 'oauth-pkce'
        ? Boolean(adapter?.beginOAuth && adapter.completeOAuth)
        : Boolean(adapter)
      return {
        ...provider,
        availability: available ? 'available' as const : 'requires-adapter' as const,
        reason: available ? null : `The ${provider.label} adapter is not installed on this computer.`
      }
    })
  }

  async listAccounts(providerId?: string): Promise<ProviderAccountSummary[]> {
    if (providerId !== undefined && !PROVIDER_ID.test(providerId)) throw new Error('Provider id is invalid.')
    const entries = await this.accounts.load()
    return entries
      .map(({ meta }) => this.publicAccount(meta))
      .filter((account) => providerId === undefined || account.providerId === providerId)
      .sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.displayName.localeCompare(b.displayName))
  }

  async account(accountId: string): Promise<ProviderAccountSummary | null> {
    if (!OPAQUE_ID.test(accountId)) return null
    const entry = (await this.accounts.load()).find(({ meta }) => meta.id === accountId)
    return entry ? this.publicAccount(entry.meta) : null
  }

  /** Core-only credential read for a trusted adapter. This method is never registered over IPC. */
  async credential<T>(accountId: string): Promise<T | null> {
    if (!OPAQUE_ID.test(accountId)) return null
    const entry = (await this.accounts.load()).find((candidate) => candidate.meta.id === accountId)
    return entry ? this.accounts.unseal<T>(entry.secretEnc) : null
  }

  /** Core-only registration route for adapters that use a guided non-OAuth credential flow. */
  async saveCredentialAccount(providerId: string, exchange: ProviderOAuthExchange): Promise<ProviderAccountSummary> {
    const adapter = this.adapters.get(providerId)
    if (!adapter) throw new Error('The provider adapter is not installed on this computer.')
    const now = Date.now()
    const id = randomUUID()
    const meta: ProviderAccountMeta = {
      id,
      providerId,
      providerLabel: adapter.descriptor.label,
      displayName: boundedText(exchange.displayName, 'Provider account display name', 512),
      externalAccountId: boundedText(exchange.externalAccountId, 'Provider account id'),
      state: 'connected', reason: null, createdAt: now, updatedAt: now,
      credentialRef: `provider-account:${id}`
    }
    return this.accounts.mutate((entries) => {
      const duplicate = entries.findIndex((entry) => entry.meta.providerId === providerId && entry.meta.externalAccountId === meta.externalAccountId)
      const storedMeta = duplicate >= 0 ? { ...meta, id: entries[duplicate].meta.id, credentialRef: entries[duplicate].meta.credentialRef, createdAt: entries[duplicate].meta.createdAt } : meta
      const sealed: SealedEntry<ProviderAccountMeta> = { meta: storedMeta, secretEnc: this.accounts.seal(exchange.credential) }
      if (duplicate >= 0) entries[duplicate] = sealed
      else entries.push(sealed)
      return { changed: true, result: this.publicAccount(storedMeta) }
    })
  }

  async resources(accountId: string, capability?: string): Promise<ProviderResourceSummary[]> {
    const account = await this.account(accountId)
    if (!account) throw new Error('Provider account was not found on this computer.')
    const adapter = this.adapters.get(account.providerId)
    if (!adapter?.resources) return []
    const resources = await adapter.resources(account, capability)
    return resources.map((resource) => ({
      id: boundedText(resource.id, 'Provider resource id'),
      accountId,
      label: boundedText(resource.label, 'Provider resource label', 512),
      kind: boundedText(resource.kind, 'Provider resource kind', 128),
      available: resource.available === true,
      reason: resource.available === true ? null : boundedText(resource.reason, 'Provider resource unavailable reason', 512)
    }))
  }

  async beginOAuth(providerId: string): Promise<ProviderOAuthStartResult> {
    if (!PROVIDER_ID.test(providerId)) throw new Error('Provider id is invalid.')
    const adapter = this.adapters.get(providerId)
    const descriptor = this.catalog().find((provider) => provider.id === providerId)
    if (!descriptor) throw new Error('Provider is not in the local catalog.')
    if (!adapter?.beginOAuth || !adapter.completeOAuth) {
      return { status: 'unsupported', providerId, authorizationUrl: null, redirectUri: null, expiresAt: null, reason: descriptor.reason }
    }
    this.sweepPending()
    if (this.pending.size >= MAX_PENDING_OAUTH) {
      return { status: 'unsupported', providerId, authorizationUrl: null, redirectUri: null, expiresAt: null, reason: 'Too many provider sign-ins are already waiting for a callback.' }
    }
    const state = randomBytes(24).toString('base64url')
    const codeVerifier = randomBytes(48).toString('base64url')
    const expiresAt = Date.now() + OAUTH_TTL_MS
    const started = await adapter.beginOAuth({ state, codeChallenge: challenge(codeVerifier), redirectUri: this.redirectUri })
    const authorizationUrl = safeUrl(started.authorizationUrl, 'Provider authorization URL')
    if (authorizationUrl.searchParams.get('state') !== state) throw new Error('Provider authorization URL did not preserve the one-time state value.')
    this.pending.set(state, { providerId, codeVerifier, redirectUri: this.redirectUri, expiresAt })
    return { status: 'ready', providerId, authorizationUrl: authorizationUrl.href, redirectUri: this.redirectUri, expiresAt, reason: null }
  }

  async completeOAuth(callbackUrl: string): Promise<ProviderOAuthCallbackResult> {
    const callback = safeUrl(callbackUrl, 'OAuth callback URL')
    const expected = safeUrl(this.redirectUri, 'OAuth redirect URI')
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
      return { status: 'rejected', account: null, reason: 'The callback did not target this application.' }
    }
    const state = callback.searchParams.get('state') ?? ''
    const pending = this.pending.get(state)
    if (pending) this.pending.delete(state)
    if (!pending) return { status: 'rejected', account: null, reason: 'The callback state is missing, unknown, or already used.' }
    if (pending.expiresAt < Date.now()) return { status: 'expired', account: null, reason: 'The provider sign-in callback expired. Start sign-in again.' }
    if (callback.searchParams.has('error')) return { status: 'rejected', account: null, reason: 'The provider refused or cancelled consent.' }
    const adapter = this.adapters.get(pending.providerId)
    if (!adapter?.completeOAuth) return { status: 'rejected', account: null, reason: 'The provider adapter is no longer available.' }
    const exchange = await adapter.completeOAuth({ callbackUrl: callback, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri })
    const now = Date.now()
    const id = randomUUID()
    const descriptor = adapter.descriptor
    const meta: ProviderAccountMeta = {
      id,
      providerId: descriptor.id,
      providerLabel: descriptor.label,
      displayName: boundedText(exchange.displayName, 'Provider account display name', 512),
      externalAccountId: boundedText(exchange.externalAccountId, 'Provider account id'),
      state: 'connected',
      reason: null,
      createdAt: now,
      updatedAt: now,
      credentialRef: `provider-account:${id}`
    }
    await this.accounts.mutate((entries) => {
      const duplicate = entries.findIndex((entry) => entry.meta.providerId === meta.providerId && entry.meta.externalAccountId === meta.externalAccountId)
      const sealed: SealedEntry<ProviderAccountMeta> = { meta: duplicate >= 0 ? { ...meta, id: entries[duplicate].meta.id, credentialRef: entries[duplicate].meta.credentialRef, createdAt: entries[duplicate].meta.createdAt } : meta, secretEnc: this.accounts.seal(exchange.credential) }
      if (duplicate >= 0) entries[duplicate] = sealed
      else entries.push(sealed)
      return { changed: true, result: this.publicAccount(sealed.meta) }
    })
    const account = await this.account(meta.id) ?? (await this.listAccounts(meta.providerId)).find((candidate) => candidate.externalAccountId === meta.externalAccountId) ?? null
    return { status: 'connected', account, reason: null }
  }

  async removeAccount(accountId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!OPAQUE_ID.test(accountId)) return { ok: false, error: 'Provider account id is invalid.' }
    return this.accounts.mutate((entries) => {
      const index = entries.findIndex((entry) => entry.meta.id === accountId)
      if (index < 0) return { changed: false, result: { ok: false as const, error: 'Provider account was not found.' } }
      entries.splice(index, 1)
      return { changed: true, result: { ok: true as const } }
    })
  }

  credentialRef(accountId: string): Promise<string | null> {
    return this.accounts.load().then((entries) => entries.find((entry) => entry.meta.id === accountId)?.meta.credentialRef ?? null)
  }

  private publicAccount(meta: ProviderAccountMeta): ProviderAccountSummary {
    const { credentialRef: _credentialRef, ...safe } = meta
    return safe
  }

  private sweepPending(): void {
    const now = Date.now()
    for (const [state, pending] of this.pending) if (pending.expiresAt < now) this.pending.delete(state)
  }
}

export function registerProviderServicesIpc(
  platform: CorePlatform,
  adapters: ProviderAdapter[] = []
): { providers: ProviderServices; bindings: LocalNodeBindingStore } {
  const providers = new ProviderServices(adapters)
  const bindings = new LocalNodeBindingStore(platform.userDataDir)
  platform.handle(IPC.providerCatalog, () => providers.catalog())
  platform.handle(IPC.providerAccounts, (providerId?: string) => providers.listAccounts(providerId))
  platform.handle(IPC.providerResources, (accountId: string, capability?: string) => providers.resources(accountId, capability))
  platform.handle(IPC.providerBeginOAuth, (providerId: string) => providers.beginOAuth(providerId))
  platform.handle(IPC.providerCompleteOAuth, (callbackUrl: string) => providers.completeOAuth(callbackUrl))
  platform.handle(IPC.providerRemoveAccount, (accountId: string) => providers.removeAccount(accountId))

  platform.handle(IPC.portableBindingState, async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return []
    const value = input as Record<string, unknown>
    if (typeof value.nodeId !== 'string' || typeof value.featureId !== 'string' || typeof value.displayLabel !== 'string') return []
    const current = (await bindings.load())[value.nodeId]
    const localAccounts = await providers.listAccounts()
    const availableProvider = providers.catalog().some((provider) => provider.availability === 'available')
    return bindingActionStates(
      { schemaVersion: 1, featureId: value.featureId, displayLabel: value.displayLabel, requestedCapabilities: [], safeSettings: {}, relationships: [] },
      { hasBinding: Boolean(current), hasMatchingResource: Boolean(current), canConfigure: localAccounts.length > 0 || availableProvider, canDeploy: false, hasMissingAssets: value.hasMissingAssets === true }
    ).map((state) => ({ nodeId: value.nodeId, featureId: value.featureId, displayLabel: value.displayLabel, action: state.action, enabled: state.enabled, ...(state.reason ? { reason: state.reason } : {}), bound: Boolean(current) }))
  })

  platform.handle(IPC.portableBindingApply, async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Binding input is invalid.' }
    const value = input as Record<string, unknown>
    if (typeof value.nodeId !== 'string' || typeof value.action !== 'string') return { ok: false, error: 'Binding input is invalid.' }
    if (value.action === 'leave-unbound') { await bindings.remove(value.nodeId); return { ok: true, state: 'unbound' as const } }
    if (value.action === 'locate-asset') {
      if (typeof value.resourceId !== 'string' || value.resourceId.length === 0 || value.resourceId.length > 4096 || /[\u0000-\u001f\u007f]/.test(value.resourceId)) {
        return { ok: false, error: 'Choose a valid local asset with the file picker.' }
      }
      const binding = validateLocalNodeBinding({ nodeId: value.nodeId, bindingVersion: 1, providerOrHostIdentity: 'local-asset', localResourceReferences: { assetPath: value.resourceId }, credentialKeys: [], lastVerifiedAt: Date.now() })
      const snapshot = await bindings.snapshot()
      try { await bindings.apply(value.nodeId, binding) } catch (error) { await bindings.restore(snapshot); throw error }
      return { ok: true, state: 'bound' as const }
    }
    if (!['configure', 'rebind', 'adopt'].includes(value.action)) return { ok: false, error: 'Deploy requires a provider-specific flow and is not performed by import.' }
    if (typeof value.providerAccountId !== 'string' || typeof value.resourceId !== 'string') return { ok: false, error: 'Choose a connected provider account and a verified resource.' }
    const account = await providers.account(value.providerAccountId)
    const credentialRef = await providers.credentialRef(value.providerAccountId)
    if (!account || !credentialRef || account.state !== 'connected') return { ok: false, error: 'The selected provider account is unavailable or needs consent.' }
    const resources = await providers.resources(account.id, typeof value.featureId === 'string' ? value.featureId : undefined)
    const resource = resources.find((candidate) => candidate.id === value.resourceId && candidate.available)
    if (!resource) return { ok: false, error: 'The selected local resource was not verified by its provider adapter.' }
    const binding = validateLocalNodeBinding({ nodeId: value.nodeId, bindingVersion: 1, providerOrHostIdentity: account.id, localResourceReferences: { resource: resource.id }, credentialKeys: [credentialRef], lastVerifiedAt: Date.now() })
    const snapshot = await bindings.snapshot()
    try { await bindings.apply(value.nodeId, binding) } catch (error) { await bindings.restore(snapshot); throw error }
    return { ok: true, state: 'bound' as const }
  })
  return { providers, bindings }
}
