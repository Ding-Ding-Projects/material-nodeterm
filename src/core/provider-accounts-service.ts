/** Shared provider profiles, sealed credentials, OAuth callback state, and local bindings.
 *
 * This is deliberately core-only. The desktop and Server Edition shells register the same
 * handlers, while the renderer sees metadata and opaque ids only. Provider values are sealed by
 * the shell's operating-system vault hook when available and are never returned by this module.
 */
import { randomBytes, randomUUID } from 'crypto'
import { platform, type CorePlatform } from './platform'
import { SecureStore } from './secure-store'
import { IPC } from '../shared/ipc'
import {
  isProviderId,
  normalizeProviderScopes,
  type CredentialReference,
  type OAuthCallbackHandle,
  type OAuthCompleteInput,
  type OAuthStartInput,
  type ProviderAccountsApi,
  type ProviderAccountsSnapshot,
  type ProviderBinding,
  type ProviderBindingInput,
  type ProviderCredentialInput,
  type ProviderProfile,
  type ProviderProfileInput
} from '../shared/provider-accounts'

type StoredProfile = Omit<ProviderProfile, 'credential'> & { credential: CredentialReference | null }
type StoredBinding = ProviderBinding
interface SelectionMeta { id: string; selectedProfileId: string | null }
type SealedProfileStore = Pick<SecureStore<StoredProfile>, 'load' | 'mutate' | 'seal'>
type SealedBindingStore = Pick<SecureStore<StoredBinding>, 'load' | 'mutate' | 'seal'>
type SealedSelectionStore = Pick<SecureStore<SelectionMeta>, 'load' | 'mutate' | 'seal'>

interface PendingOAuth extends OAuthCallbackHandle {
  authUrl: string
}

const MAX_LABEL = 256
const MAX_ENDPOINT = 2048
const MAX_SECRET = 128 * 1024
const CALLBACK_TTL_MS = 10 * 60 * 1000

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const result = value.trim()
  return result.length > 0 && result.length <= MAX_LABEL ? result : fallback
}

function safeEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_ENDPOINT) return undefined
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname))) return undefined
    if (parsed.username || parsed.password) return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function publicProfile(profile: StoredProfile): ProviderProfile {
  const expired = profile.expiresAt !== undefined && profile.expiresAt <= Date.now()
  return {
    ...profile,
    status: expired && profile.credential ? 'expired' : profile.status,
    permissions: [...profile.permissions],
    scopes: [...profile.scopes],
    credential: profile.credential ? { ...profile.credential, permissions: [...profile.credential.permissions] } : null
  }
}

function publicBinding(binding: StoredBinding): ProviderBinding {
  return { ...binding }
}

function assertStoredProfiles(entries: Array<{ meta: StoredProfile }>): void {
  for (const entry of entries) {
    const profile = entry.meta
    if (!isProviderId(profile.provider) || typeof profile.id !== 'string' || typeof profile.label !== 'string' ||
        !['oauth', 'api-key', 'cookie', 'external'].includes(profile.authKind) ||
        !['ready', 'needs-auth', 'expired', 'revoked', 'error'].includes(profile.status) ||
        !Array.isArray(profile.scopes) || !Array.isArray(profile.permissions) ||
        !Number.isSafeInteger(profile.createdAt) || !Number.isSafeInteger(profile.updatedAt) ||
        (profile.credential !== null && (typeof profile.credential !== 'object' || typeof profile.credential.id !== 'string'))) {
      throw new Error('Provider profile store has an unsupported or malformed entry.')
    }
  }
}

function assertStoredBindings(entries: Array<{ meta: StoredBinding }>): void {
  for (const entry of entries) {
    const binding = entry.meta
    if (typeof binding.id !== 'string' || typeof binding.projectId !== 'string' || typeof binding.blueprintId !== 'string' ||
        (binding.profileId !== undefined && typeof binding.profileId !== 'string') ||
        (binding.credentialRefId !== undefined && typeof binding.credentialRefId !== 'string') ||
        typeof binding.selected !== 'boolean' || !Number.isSafeInteger(binding.createdAt) || !Number.isSafeInteger(binding.updatedAt)) {
      throw new Error('Provider binding store has an unsupported or malformed entry.')
    }
  }
}

function assertStoredSelection(entries: Array<{ meta: SelectionMeta }>): void {
  for (const entry of entries) {
    if (entry.meta.id !== '00000000-0000-4000-8000-000000000000' ||
        (entry.meta.selectedProfileId !== null && typeof entry.meta.selectedProfileId !== 'string')) {
      throw new Error('Provider selection store has an unsupported or malformed entry.')
    }
  }
}

export class ProviderAccountsService implements ProviderAccountsApi {
  private readonly profileStore: SealedProfileStore
  private readonly bindingStore: SealedBindingStore
  private readonly selectionStore: SealedSelectionStore
  private readonly listeners = new Set<(snapshot: ProviderAccountsSnapshot) => void>()
  private readonly callbacks = new Map<string, PendingOAuth>()
  private revision = 0
  private selectedProfileId: string | null = null

  constructor(
    profileStore: SealedProfileStore = new SecureStore<StoredProfile>('provider-profiles.json'),
    bindingStore: SealedBindingStore = new SecureStore<StoredBinding>('provider-bindings.json'),
    selectionStore: SealedSelectionStore = new SecureStore<SelectionMeta>('provider-selection.json')
  ) {
    this.profileStore = profileStore
    this.bindingStore = bindingStore
    this.selectionStore = selectionStore
  }

  async snapshot(): Promise<ProviderAccountsSnapshot> {
    const [profiles, bindings, selections] = await Promise.all([this.profileStore.load(), this.bindingStore.load(), this.selectionStore.load()])
    assertStoredProfiles(profiles)
    assertStoredBindings(bindings)
    assertStoredSelection(selections)
    const storedSelection = selections.find((entry) => entry.meta.id === '00000000-0000-4000-8000-000000000000')?.meta.selectedProfileId ?? null
    if (storedSelection === null || profiles.some((entry) => entry.meta.id === storedSelection)) this.selectedProfileId = storedSelection
    this.expireCallbacks()
    return {
      profiles: profiles.map(publicProfile).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
      bindings: bindings.map(publicBinding),
      // Portable blueprints are sourced from the active project file. This service only owns
      // local references, so the renderer can safely distinguish an absent project blueprint list.
      blueprints: [],
      selectedProfileId: this.selectedProfileId,
      revision: this.revision
    }
  }

  private async changed(): Promise<ProviderAccountsSnapshot> {
    this.revision += 1
    const next = await this.snapshot()
    this.listeners.forEach((listener) => listener(next))
    return next
  }

  async createProfile(input: ProviderProfileInput): Promise<ProviderProfile> {
    if (!isProviderId(input.provider)) throw new Error('Provider is not supported.')
    if (!['oauth', 'api-key', 'cookie', 'external'].includes(input.authKind)) throw new Error('Authentication kind is not supported.')
    const now = Date.now()
    const profile: StoredProfile = {
      id: randomUUID(),
      provider: input.provider,
      label: safeLabel(input.label, 'Provider account'),
      authKind: input.authKind,
      ...(safeLabel(input.accountLabel, '') ? { accountLabel: safeLabel(input.accountLabel, '') } : {}),
      ...(safeEndpoint(input.endpoint) ? { endpoint: safeEndpoint(input.endpoint) } : {}),
      status: 'needs-auth',
      scopes: normalizeProviderScopes(input.scopes),
      credential: null,
      permissions: [],
      createdAt: now,
      updatedAt: now
    }
    await this.profileStore.mutate<void>((entries) => {
      assertStoredProfiles(entries)
      entries.push({ meta: profile, secretEnc: this.profileStore.seal({ version: 1, value: null }) })
      return { changed: true, result: undefined }
    })
    await this.changed()
    return publicProfile(profile)
  }

  async updateProfile(id: string, input: Partial<ProviderProfileInput>): Promise<ProviderProfile | null> {
    let result: ProviderProfile | null = null
    await this.profileStore.mutate<void>((entries) => {
      assertStoredProfiles(entries)
      const entry = entries.find((candidate) => candidate.meta.id === id)
      if (!entry) return { changed: false, result: undefined }
      const current = entry.meta
      if (input.provider !== undefined && !isProviderId(input.provider)) return { changed: false, result: undefined }
      if (input.authKind !== undefined && !['oauth', 'api-key', 'cookie', 'external'].includes(input.authKind)) return { changed: false, result: undefined }
      current.provider = input.provider ?? current.provider
      if (input.label !== undefined) current.label = safeLabel(input.label, current.label)
      if (input.authKind !== undefined) current.authKind = input.authKind
      if (input.accountLabel !== undefined) current.accountLabel = safeLabel(input.accountLabel, current.accountLabel ?? '') || undefined
      if (input.scopes !== undefined) current.scopes = normalizeProviderScopes(input.scopes)
      if (input.endpoint !== undefined) current.endpoint = safeEndpoint(input.endpoint)
      current.updatedAt = Date.now()
      result = publicProfile(current)
      return { changed: true, result: undefined }
    })
    if (result) await this.changed()
    return result
  }

  async removeProfile(id: string): Promise<boolean> {
    let removed = false
    let credentialRefId: string | undefined
    await this.profileStore.mutate<void>((entries) => {
      assertStoredProfiles(entries)
      const index = entries.findIndex((entry) => entry.meta.id === id)
      if (index < 0) return { changed: false, result: undefined }
      credentialRefId = entries[index].meta.credential?.id
      entries.splice(index, 1)
      removed = true
      return { changed: true, result: undefined }
    })
    if (!removed) return false
    await this.bindingStore.mutate<void>((entries) => {
      assertStoredBindings(entries)
      const next = entries.filter((entry) => entry.meta.profileId !== id && (!credentialRefId || entry.meta.credentialRefId !== credentialRefId))
      if (next.length === entries.length) return { changed: false, result: undefined }
      entries.splice(0, entries.length, ...next)
      return { changed: true, result: undefined }
    })
    if (this.selectedProfileId === id) this.selectedProfileId = null
    await this.changed()
    return true
  }

  async setCredential(input: ProviderCredentialInput): Promise<ProviderProfile | null> {
    if (typeof input.value !== 'string' || input.value.length === 0 || input.value.length > MAX_SECRET) throw new Error('Credential value is invalid or too large.')
    let result: ProviderProfile | null = null
    await this.profileStore.mutate<void>((entries) => {
      assertStoredProfiles(entries)
      const entry = entries.find((candidate) => candidate.meta.id === input.profileId)
      if (!entry) return { changed: false, result: undefined }
      const now = Date.now()
      const permissions = normalizeProviderScopes(input.permissions)
      const ref: CredentialReference = {
        id: randomUUID(),
        vault: 'os',
        provider: entry.meta.provider,
        createdAt: entry.meta.credential?.createdAt ?? now,
        updatedAt: now,
        ...(input.expiresAt !== undefined && Number.isSafeInteger(input.expiresAt) && input.expiresAt > now ? { expiresAt: input.expiresAt } : {}),
        permissions
      }
      entry.secretEnc = this.profileStore.seal({ version: 1, value: input.value })
      entry.meta.credential = ref
      entry.meta.expiresAt = ref.expiresAt
      entry.meta.permissions = permissions
      entry.meta.status = 'ready'
      entry.meta.updatedAt = now
      result = publicProfile(entry.meta)
      return { changed: true, result: undefined }
    })
    if (result) await this.changed()
    return result
  }

  async clearCredential(profileId: string): Promise<boolean> {
    let changed = false
    await this.profileStore.mutate<void>((entries) => {
      assertStoredProfiles(entries)
      const entry = entries.find((candidate) => candidate.meta.id === profileId)
      if (!entry || !entry.meta.credential) return { changed: false, result: undefined }
      entry.secretEnc = this.profileStore.seal({ version: 1, value: null })
      entry.meta.credential = null
      entry.meta.expiresAt = undefined
      entry.meta.permissions = []
      entry.meta.status = 'needs-auth'
      entry.meta.updatedAt = Date.now()
      changed = true
      return { changed: true, result: undefined }
    })
    if (changed) await this.changed()
    return changed
  }

  async selectProfile(profileId: string | null): Promise<ProviderAccountsSnapshot> {
    if (profileId !== null) {
      const profiles = await this.profileStore.load()
      assertStoredProfiles(profiles)
      if (!profiles.some((entry) => entry.meta.id === profileId)) throw new Error('Provider profile does not exist.')
    }
    this.selectedProfileId = profileId
    await this.selectionStore.mutate<void>((entries) => {
      assertStoredSelection(entries)
      const id = '00000000-0000-4000-8000-000000000000'
      const existing = entries.find((entry) => entry.meta.id === id)
      if (existing) existing.meta.selectedProfileId = profileId
      else entries.push({ meta: { id, selectedProfileId: profileId }, secretEnc: this.selectionStore.seal({ version: 1 }) })
      return { changed: true, result: undefined }
    })
    if (profileId !== null) {
      await this.profileStore.mutate<void>((entries) => {
        assertStoredProfiles(entries)
        const entry = entries.find((candidate) => candidate.meta.id === profileId)
        if (entry) entry.meta.lastUsedAt = Date.now()
        return { changed: Boolean(entry), result: undefined }
      })
    }
    return this.changed()
  }

  async bind(input: ProviderBindingInput): Promise<ProviderBinding> {
    const profiles = await this.profileStore.load()
    assertStoredProfiles(profiles)
    if (input.profileId && !profiles.some((entry) => entry.meta.id === input.profileId)) throw new Error('Provider profile does not exist.')
    const credentialOwner = input.credentialRefId ? profiles.find((entry) => entry.meta.credential?.id === input.credentialRefId) : undefined
    if (input.credentialRefId && !credentialOwner) throw new Error('Credential reference does not exist.')
    if (input.profileId && credentialOwner && credentialOwner.meta.id !== input.profileId) throw new Error('Credential reference does not belong to the selected profile.')
    const now = Date.now()
    const binding: ProviderBinding = {
      id: randomUUID(),
      projectId: safeLabel(input.projectId, ''),
      blueprintId: safeLabel(input.blueprintId, ''),
      ...(input.profileId ? { profileId: safeLabel(input.profileId, '') } : {}),
      ...(input.nodeId ? { nodeId: safeLabel(input.nodeId, '') } : {}),
      ...(input.credentialRefId ? { credentialRefId: safeLabel(input.credentialRefId, '') } : {}),
      selected: input.selected !== false,
      createdAt: now,
      updatedAt: now
    }
    if (!binding.projectId || !binding.blueprintId) throw new Error('A project and provider blueprint are required.')
    await this.bindingStore.mutate<void>((entries) => {
      assertStoredBindings(entries)
      if (binding.selected) {
        for (const entry of entries) {
          if (entry.meta.projectId === binding.projectId && entry.meta.nodeId === binding.nodeId) entry.meta.selected = false
        }
      }
      entries.push({ meta: binding, secretEnc: this.bindingStore.seal({ version: 1 }) })
      return { changed: true, result: undefined }
    })
    await this.changed()
    return binding
  }

  async unbind(bindingId: string): Promise<boolean> {
    let removed = false
    await this.bindingStore.mutate<void>((entries) => {
      assertStoredBindings(entries)
      const index = entries.findIndex((entry) => entry.meta.id === bindingId)
      if (index < 0) return { changed: false, result: undefined }
      entries.splice(index, 1)
      removed = true
      return { changed: true, result: undefined }
    })
    if (removed) await this.changed()
    return removed
  }

  async startOAuth(input: OAuthStartInput): Promise<{ handle: OAuthCallbackHandle; authUrl: string }> {
    if (!isProviderId(input.provider)) throw new Error('Provider is not supported.')
    const authUrl = safeEndpoint(input.authUrl)
    const redirectUri = safeEndpoint(input.redirectUri)
    if (!authUrl || !redirectUri) throw new Error('OAuth URLs must use HTTPS, or an explicitly loopback HTTP callback.')
    let profileId = input.profileId
    if (profileId) {
      const profiles = await this.profileStore.load()
      assertStoredProfiles(profiles)
      if (!profiles.some((entry) => entry.meta.id === profileId)) throw new Error('Provider profile does not exist.')
    } else {
      profileId = (await this.createProfile({
        provider: input.provider,
        label: input.label,
        accountLabel: input.accountLabel,
        authKind: 'oauth',
        scopes: input.scopes,
        endpoint: input.endpoint
      })).id
    }
    const handle: OAuthCallbackHandle = {
      id: randomUUID(),
      provider: input.provider,
      profileId,
      state: randomBytes(24).toString('base64url'),
      redirectUri,
      status: 'pending',
      expiresAt: Date.now() + CALLBACK_TTL_MS
    }
    this.callbacks.set(handle.id, { ...handle, authUrl })
    await platform().openExternal(authUrl)
    return { handle, authUrl }
  }

  async completeOAuth(input: OAuthCompleteInput): Promise<ProviderProfile | null> {
    const pending = this.callbacks.get(input.callbackId)
    if (!pending || pending.status !== 'pending') return null
    this.callbacks.delete(input.callbackId)
    if (pending.expiresAt <= Date.now() || input.state !== pending.state) return null
    pending.status = 'completed'
    return this.setCredential({
      profileId: pending.profileId,
      value: input.value,
      expiresAt: input.expiresAt,
      permissions: input.permissions
    })
  }

  async cancelOAuth(callbackId: string): Promise<boolean> {
    const pending = this.callbacks.get(callbackId)
    if (!pending) return false
    this.callbacks.delete(callbackId)
    pending.status = 'cancelled'
    return true
  }

  onChanged(listener: (snapshot: ProviderAccountsSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private expireCallbacks(): void {
    const now = Date.now()
    for (const [id, callback] of this.callbacks) {
      if (callback.expiresAt <= now) {
        callback.status = 'expired'
        this.callbacks.delete(id)
      }
    }
  }
}

export function registerProviderAccountsHandlers(
  corePlatform: CorePlatform,
  service: ProviderAccountsService = new ProviderAccountsService()
): ProviderAccountsService {
  corePlatform.handle(IPC.providerAccountsSnapshot, () => service.snapshot())
  corePlatform.handle(IPC.providerAccountsCreateProfile, (input: ProviderProfileInput) => service.createProfile(input))
  corePlatform.handle(IPC.providerAccountsUpdateProfile, (id: string, input: Partial<ProviderProfileInput>) => service.updateProfile(id, input))
  corePlatform.handle(IPC.providerAccountsRemoveProfile, (id: string) => service.removeProfile(id))
  corePlatform.handle(IPC.providerAccountsSetCredential, (input: ProviderCredentialInput) => service.setCredential(input))
  corePlatform.handle(IPC.providerAccountsClearCredential, (id: string) => service.clearCredential(id))
  corePlatform.handle(IPC.providerAccountsSelectProfile, (id: string | null) => service.selectProfile(id))
  corePlatform.handle(IPC.providerAccountsBind, (input: ProviderBindingInput) => service.bind(input))
  corePlatform.handle(IPC.providerAccountsUnbind, (id: string) => service.unbind(id))
  corePlatform.handle(IPC.providerAccountsOAuthStart, (input: OAuthStartInput) => service.startOAuth(input))
  corePlatform.handle(IPC.providerAccountsOAuthComplete, (input: OAuthCompleteInput) => service.completeOAuth(input))
  corePlatform.handle(IPC.providerAccountsOAuthCancel, (id: string) => service.cancelOAuth(id))
  service.onChanged((snapshot) => corePlatform.broadcast(IPC.providerAccountsChanged, snapshot))
  return service
}
