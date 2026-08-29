import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import type { CalendarAccount, CalendarApi, CalendarCache, CalendarCalDavConnectInput, CalendarCreateInput, CalendarEvent, CalendarNodeConfig, CalendarOAuthStart, CalendarProvider, CalendarSource, CalendarStatus, CalendarUpdateInput } from '../../shared/calendar'
import { isCalendarNodeId, parseIcs, validateCalendarConfig } from '../../shared/calendar'
import type { CorePlatform } from '../platform'
import { createCalendarProviderAdapters, type RemoteCalendarAccount, validateEndpoint } from './providers'
import { CalendarCredentialVault } from './vault'

interface LocalNodeFile {
  version: 1 | 2; nodeId: string; sourceId: string; provider: CalendarProvider; accountId: string | null
  events: CalendarEvent[]; sourceName: string; fetchedAt: number; sourceRevision: string | null; etag: string | null
  complete: boolean; partial: boolean; retryAt: number | null; backoffMs: number
}
interface OAuthClientFile { version: 1; google?: { clientId: string }; microsoft365?: { clientId: string; tenant?: string } }

const REMOTE = new Set<CalendarProvider>(['caldav', 'google', 'microsoft365'])
const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{7,120}$/
const MAX_BACKOFF = 15 * 60_000

function validEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<CalendarEvent>
  return typeof event.id === 'string' && event.id.length > 0 && event.id.length <= 1000 && typeof event.calendarId === 'string' && event.calendarId.length <= 1000 && typeof event.title === 'string' && event.title.length <= 500 && typeof event.start === 'string' && !Number.isNaN(Date.parse(event.start)) && typeof event.end === 'string' && !Number.isNaN(Date.parse(event.end)) && typeof event.timezone === 'string' && event.timezone.length <= 100 && typeof event.allDay === 'boolean' && typeof event.updatedAt === 'number' && Number.isFinite(event.updatedAt)
}
function validAccount(value: unknown): value is RemoteCalendarAccount {
  if (!value || typeof value !== 'object') return false
  const account = value as Partial<RemoteCalendarAccount>
  return typeof account.id === 'string' && ACCOUNT_ID.test(account.id) && (account.provider === 'caldav' || account.provider === 'google' || account.provider === 'microsoft365') && typeof account.displayName === 'string' && account.displayName.length > 0 && account.displayName.length <= 200 && (account.email === null || (typeof account.email === 'string' && account.email.length <= 320)) && typeof account.credentialRef === 'string' && ACCOUNT_ID.test(account.credentialRef) && (account.endpoint === null || (typeof account.endpoint === 'string' && account.endpoint.length <= 2000))
}
function makeId(prefix: string, bytes = 12): string { return `${prefix}-${randomBytes(bytes).toString('hex')}` }
function base64url(bytes: Buffer): string { return bytes.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }

function mergeIncrementalEvents(cached: CalendarEvent[], changed: CalendarEvent[], deletedIds: string[]): CalendarEvent[] {
  const deleted = new Set(deletedIds)
  const byId = new Map(cached.filter((event) => !deleted.has(event.id)).map((event) => [event.id, event]))
  for (const event of changed) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 10_000)
}

/** Host-owned provider boundary. Portable projects never contain the records managed here. */
export class CalendarService implements CalendarApi {
  private readonly root: string
  private readonly accountsFile: string
  private readonly oauthClientsFile: string
  private readonly vault: CalendarCredentialVault
  private readonly adapters: ReturnType<typeof createCalendarProviderAdapters>
  private readonly oauthServers = new Set<Server>()
  private mutationChain: Promise<void> = Promise.resolve()

  constructor(private readonly platform: CorePlatform) {
    this.root = path.join(platform.userDataDir, 'calendar-nodes')
    this.accountsFile = path.join(platform.userDataDir, 'calendar-accounts.json')
    this.oauthClientsFile = path.join(platform.userDataDir, 'calendar-oauth-clients.json')
    this.vault = new CalendarCredentialVault(platform)
    this.adapters = createCalendarProviderAdapters(this.vault)
  }
  /** Serialize local read-modify-write mutations so concurrent callers cannot erase each other. */
  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(operation)
    this.mutationChain = run.then(() => undefined, () => undefined)
    return run
  }
  private file(nodeId: string): string { if (!isCalendarNodeId(nodeId)) throw new Error('Calendar node id is invalid.'); return path.join(this.root, `${nodeId}.json`) }
  private empty(nodeId: string): LocalNodeFile { return { version: 2, nodeId, sourceId: 'local', provider: 'local', accountId: null, events: [], sourceName: 'Local calendar', fetchedAt: 0, sourceRevision: null, etag: null, complete: true, partial: false, retryAt: null, backoffMs: 0 } }
  private async read(nodeId: string): Promise<LocalNodeFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file(nodeId), 'utf8')) as Partial<LocalNodeFile>
      if ((parsed.version !== 1 && parsed.version !== 2) || parsed.nodeId !== nodeId || !Array.isArray(parsed.events) || parsed.events.length > 10_000 || !parsed.events.every(validEvent)) throw new Error('Calendar cache has an unsupported shape.')
      const provider = typeof parsed.provider === 'string' && ['local', 'ics', 'caldav', 'google', 'microsoft365'].includes(parsed.provider) ? parsed.provider as CalendarProvider : 'local'
      return { version: 2, nodeId, sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId.slice(0, 1000) : 'local', provider, accountId: typeof parsed.accountId === 'string' && ACCOUNT_ID.test(parsed.accountId) ? parsed.accountId : null, events: parsed.events.slice(0, 10_000), sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName.slice(0, 200) : 'Local calendar', fetchedAt: typeof parsed.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : 0, sourceRevision: typeof parsed.sourceRevision === 'string' ? parsed.sourceRevision.slice(0, 5000) : null, etag: typeof parsed.etag === 'string' ? parsed.etag.slice(0, 1000) : null, complete: parsed.complete !== false, partial: parsed.partial === true, retryAt: typeof parsed.retryAt === 'number' && Number.isFinite(parsed.retryAt) ? parsed.retryAt : null, backoffMs: typeof parsed.backoffMs === 'number' && Number.isFinite(parsed.backoffMs) ? Math.max(0, Math.min(parsed.backoffMs, MAX_BACKOFF)) : 0 }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.empty(nodeId); throw error }
  }
  private async write(value: LocalNodeFile): Promise<void> { await mkdir(this.root, { recursive: true, mode: 0o700 }); const temporary = tempNameFor(this.file(value.nodeId)); await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); await renameAtomic(temporary, this.file(value.nodeId)) }
  private async records(): Promise<RemoteCalendarAccount[]> {
    try { const parsed = JSON.parse(await readFile(this.accountsFile, 'utf8')) as unknown; const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1 ? (parsed as { accounts?: unknown }).accounts : []; return Array.isArray(rows) ? rows.filter(validAccount).slice(0, 100) : [] }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  private async saveRecords(accounts: RemoteCalendarAccount[]): Promise<void> { await mkdir(path.dirname(this.accountsFile), { recursive: true, mode: 0o700 }); const temporary = tempNameFor(this.accountsFile); await writeFile(temporary, JSON.stringify({ version: 1, accounts }, null, 2), { encoding: 'utf8', mode: 0o600 }); await renameAtomic(temporary, this.accountsFile) }
  private async record(id: string | null, provider?: CalendarProvider): Promise<RemoteCalendarAccount | null> { if (!id || !ACCOUNT_ID.test(id)) return null; const account = (await this.records()).find((candidate) => candidate.id === id) ?? null; return account && (!provider || account.provider === provider) ? account : null }
  private expose(account: RemoteCalendarAccount, state: CalendarAccount['state'], reason: string | null): CalendarAccount { return { id: account.id, provider: account.provider, displayName: account.displayName, email: account.email, credentialRef: account.credentialRef, state, reason } }

  async accounts(): Promise<CalendarAccount[]> {
    const result: CalendarAccount[] = []
    for (const account of await this.records()) {
      try { const credential = await this.vault.read(account.credentialRef); result.push(this.expose(account, credential ? 'connected' : 'needs-consent', credential ? null : 'The machine-local credential is missing. Reconnect this account.')) }
      catch { result.push(this.expose(account, 'unavailable', 'The machine-local credential could not be read.')) }
    }
    return result
  }
  async calendars(accountId: string | null, provider: CalendarProvider): Promise<CalendarSource[]> {
    if (provider === 'local') return [{ id: 'local', accountId: null, provider, name: 'On this computer', timezone: 'local', color: '#6750A4', readOnly: false, writable: true }]
    if (provider === 'ics') return [{ id: accountId ?? 'ics-import', accountId: null, provider, name: 'Imported ICS file', timezone: 'local', color: '#386A20', readOnly: false, writable: true }]
    const account = await this.record(accountId, provider); return account ? this.adapters[account.provider].calendars(account) : []
  }
  async events(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache> {
    config = validateCalendarConfig(config); const data = await this.read(nodeId); const sourceId = config.calendarId ?? 'local'; const same = data.sourceId === sourceId || (config.provider === 'local' && data.sourceId === 'local'); const events = same ? data.events : []
    return { nodeId, sourceId, fetchedAt: same ? data.fetchedAt : 0, expiresAt: same && data.fetchedAt ? data.fetchedAt + 15 * 60_000 : 0, events, state: events.length ? (data.fetchedAt && Date.now() - data.fetchedAt < 15 * 60_000 ? 'fresh' : 'stale') : 'empty', reason: same ? null : 'The selected source has no cached events yet.', sourceRevision: same ? data.sourceRevision : null, etag: same ? data.etag : null, complete: same ? data.complete : true, partial: same ? data.partial : false, retryAt: same ? data.retryAt : null, backoffMs: same ? data.backoffMs : 0 }
  }
  async importIcs(nodeId: string, icsText: string, sourceName = 'Imported ICS file'): Promise<CalendarCache> {
    return this.enqueueMutation(async () => {
      const sourceId = `ics-${nodeId}`; const events = parseIcs(icsText, sourceId); const fetchedAt = Date.now(); await this.write({ version: 2, nodeId, sourceId, provider: 'ics', accountId: null, events, sourceName: sourceName.slice(0, 200), fetchedAt, sourceRevision: String(fetchedAt), etag: null, complete: true, partial: false, retryAt: null, backoffMs: 0 }); return { nodeId, sourceId, fetchedAt, expiresAt: fetchedAt + 365 * 24 * 60 * 60_000, events, state: events.length ? 'fresh' : 'empty', reason: events.length ? null : 'The ICS file contained no complete VEVENT records.', sourceRevision: String(fetchedAt), etag: null, complete: true, partial: false, retryAt: null, backoffMs: 0 }
    })
  }
  async refresh(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache> {
    config = validateCalendarConfig(config); if (config.provider === 'local' || config.provider === 'ics') return this.events(nodeId, config)
    const cached = await this.read(nodeId)
    if (cached.retryAt && cached.retryAt > Date.now()) { const value = await this.events(nodeId, config); return { ...value, state: value.events.length ? 'offline' : 'empty', reason: `The provider retry window begins at ${new Date(cached.retryAt).toISOString()}. Existing cache was retained.` } }
    const account = await this.record(config.accountId, config.provider)
    if (!account || !config.calendarId) { const value = await this.events(nodeId, config); return { ...value, state: value.events.length ? 'offline' : 'empty', reason: 'Choose a connected account and calendar. Existing cache was retained.', complete: false } }
    try {
      const sameSource = cached.sourceId === config.calendarId
      const result = await this.adapters[account.provider].sync(account, config.calendarId, { revision: sameSource ? cached.sourceRevision : null, etag: sameSource ? cached.etag : null }); const fetchedAt = Date.now()
      // Google sync tokens and Microsoft delta links return only changes after the
      // initial full page. Replacing the cache with that short response silently
      // erased every unchanged event, so merge updates and provider tombstones.
      const events = result.incremental && sameSource
        ? mergeIncrementalEvents(cached.events, result.events, result.deletedEventIds ?? [])
        : result.events.length === 0 && sameSource && cached.events.length > 0 ? cached.events : result.events
      await this.write({ version: 2, nodeId, sourceId: config.calendarId, provider: account.provider, accountId: account.id, events, sourceName: config.calendarId.slice(0, 200), fetchedAt, sourceRevision: result.sourceRevision, etag: result.etag, complete: result.complete, partial: result.partial, retryAt: null, backoffMs: 0 })
      return { nodeId, sourceId: config.calendarId, fetchedAt, expiresAt: fetchedAt + 15 * 60_000, events, state: events.length ? 'fresh' : 'empty', reason: result.partial ? 'The provider result reached a safety bound. Refresh again to continue.' : null, sourceRevision: result.sourceRevision, etag: result.etag, complete: result.complete, partial: result.partial, retryAt: null, backoffMs: 0 }
    } catch (error) {
      const backoffMs = Math.min(Math.max(cached.backoffMs ? cached.backoffMs * 2 : 5000, 5000), MAX_BACKOFF); const retryAt = Date.now() + backoffMs; const reason = error instanceof Error ? error.message : 'Calendar provider refresh failed.'
      await this.write({ ...cached, version: 2, nodeId, sourceId: config.calendarId, provider: account.provider, accountId: account.id, retryAt, backoffMs }); const value = await this.events(nodeId, config); return { ...value, state: value.events.length ? 'offline' : 'empty', reason: `${reason} Existing cache was retained.`, complete: false, retryAt, backoffMs }
    }
  }
  async status(nodeId: string, config: CalendarNodeConfig): Promise<CalendarStatus> {
    const normalized = validateCalendarConfig(config); const account = (await this.accounts()).find((candidate) => candidate.id === normalized.accountId) ?? null; let source: CalendarSource | null = null
    try { source = (await this.calendars(normalized.accountId, normalized.provider)).find((candidate) => candidate.id === normalized.calendarId) ?? (normalized.provider === 'local' ? (await this.calendars(null, 'local'))[0] : null) } catch { source = null }
    const cache = await this.events(nodeId, normalized); const state: CalendarStatus['state'] = normalized.provider === 'local' || normalized.provider === 'ics' ? 'ready' : !account ? 'unconfigured' : account.state === 'connected' ? (source ? 'ready' : 'unconfigured') : account.state; const reason = state === 'unconfigured' ? (account ? 'Choose a calendar from the connected account.' : 'Choose or connect an account on this computer.') : account?.reason ?? null
    return { nodeId, provider: normalized.provider, state, account, source, cache, reason }
  }
  private async oauthClients(): Promise<OAuthClientFile> { try { const parsed = JSON.parse(await readFile(this.oauthClientsFile, 'utf8')) as Partial<OAuthClientFile>; if (parsed.version !== 1) throw new Error('Calendar OAuth client configuration has an unsupported version.'); return parsed as OAuthClientFile } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 }; throw error } }
  async beginOAuth(provider: Exclude<CalendarProvider, 'local' | 'ics'>): Promise<CalendarOAuthStart> {
    if (provider === 'caldav') return { provider, state: 'unsupported', authorizationUrl: null, redirectUri: null, reason: 'CalDAV uses the guided connection form instead of OAuth.' }
    const clients = await this.oauthClients(); const config = clients[provider]; const clientId = config?.clientId?.trim()
    if (!clientId || clientId.length > 512) return { provider, state: 'unsupported', authorizationUrl: null, redirectUri: null, reason: `This computer has no ${provider === 'google' ? 'Google' : 'Microsoft'} OAuth client registration in calendar-oauth-clients.json.` }
    const verifier = base64url(randomBytes(48)); const challenge = base64url(createHash('sha256').update(verifier).digest()); const state = base64url(randomBytes(24)); const tenant = provider === 'microsoft365' && config && 'tenant' in config && typeof config.tenant === 'string' && /^[a-zA-Z0-9.-]{1,200}$/.test(config.tenant) ? config.tenant : 'common'; const scope = provider === 'google' ? 'openid email profile https://www.googleapis.com/auth/calendar' : 'openid profile email offline_access Calendars.ReadWrite User.Read'; const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
    let server: Server | null = null; let redirectUri = ''
    redirectUri = await new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1'); if (url.pathname !== '/calendar/oauth/callback') { response.writeHead(404).end('Not found'); return }
        const code = url.searchParams.get('code'); const returnedState = url.searchParams.get('state'); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end('<!doctype html><meta charset="utf-8"><title>Calendar connection</title><p>The calendar connection response was received. You can return to nodeterm.</p>'); if (server) { server.close(); this.oauthServers.delete(server) }
        if (code && returnedState === state) void this.finishOAuth(provider, clientId, tokenUrl, scope, verifier, redirectUri, code).catch(() => {})
      }); server.once('error', reject); server.listen(0, '127.0.0.1', () => { this.oauthServers.add(server!); const address = server!.address(); if (!address || typeof address === 'string') { reject(new Error('OAuth callback listener did not bind to loopback.')); return }; resolve(`http://127.0.0.1:${address.port}/calendar/oauth/callback`) })
    })
    setTimeout(() => { if (server) { server.close(); this.oauthServers.delete(server) } }, 10 * 60_000).unref()
    const authorizationUrl = provider === 'google' ? new URL('https://accounts.google.com/o/oauth2/v2/auth') : new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`); authorizationUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state, code_challenge: challenge, code_challenge_method: 'S256', ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : {}) }).toString(); return { provider, state: 'ready', authorizationUrl: authorizationUrl.toString(), redirectUri, reason: null }
  }
  private async finishOAuth(provider: 'google' | 'microsoft365', clientId: string, tokenUrl: string, scope: string, verifier: string, redirectUri: string, code: string): Promise<void> {
    const tokenResponse = await fetch(tokenUrl, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri, scope }) }); if (!tokenResponse.ok) throw new Error(`Calendar OAuth token exchange failed with HTTP ${tokenResponse.status}.`); const token = await tokenResponse.json() as Record<string, unknown>; const accessToken = typeof token.access_token === 'string' ? token.access_token : ''; if (!accessToken || accessToken.length > 16_384) throw new Error('Calendar OAuth response did not contain a valid access token.')
    const profileUrl = provider === 'google' ? 'https://www.googleapis.com/oauth2/v2/userinfo' : 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName'; const profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } }); if (!profileResponse.ok) throw new Error(`Calendar account profile request failed with HTTP ${profileResponse.status}.`); const profile = await profileResponse.json() as Record<string, unknown>; const email = typeof profile.email === 'string' ? profile.email : typeof profile.mail === 'string' ? profile.mail : typeof profile.userPrincipalName === 'string' ? profile.userPrincipalName : null; const displayName = typeof profile.name === 'string' ? profile.name : typeof profile.displayName === 'string' ? profile.displayName : email ?? (provider === 'google' ? 'Google Calendar' : 'Microsoft 365'); const existing = (await this.records()).find((candidate) => candidate.provider === provider && candidate.email && candidate.email === email); const id = existing?.id ?? makeId(provider); const ref = existing?.credentialRef ?? makeId('calendar', 16); const expiresIn = typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) ? Math.max(60, Math.min(token.expires_in, 86_400)) : 3600
    await this.vault.save(ref, { kind: 'oauth', accessToken, refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null, expiresAt: Date.now() + expiresIn * 1000, clientId, tokenUrl, scope }); const next: RemoteCalendarAccount = { id, provider, displayName: displayName.slice(0, 200), email: email?.slice(0, 320) ?? null, credentialRef: ref, endpoint: null }; await this.saveRecords([...(await this.records()).filter((candidate) => candidate.id !== id), next])
  }
  async connectCalDav(input: CalendarCalDavConnectInput): Promise<CalendarAccount> {
    if (!input || typeof input !== 'object') throw new Error('CalDAV connection details are required.'); const endpoint = validateEndpoint(input.endpoint); const displayName = input.displayName.trim().slice(0, 200); const username = input.username.trim().slice(0, 320); if (!displayName || !username || typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 4096) throw new Error('CalDAV display name, username, and password are required.'); const id = makeId('caldav'); const ref = makeId('calendar', 16); await this.vault.save(ref, { kind: 'caldav', username, password: input.password }); const account: RemoteCalendarAccount = { id, provider: 'caldav', displayName, email: typeof input.email === 'string' ? input.email.trim().slice(0, 320) || null : null, credentialRef: ref, endpoint }
    try { if ((await this.adapters.caldav.calendars(account)).length === 0) throw new Error('The CalDAV endpoint returned no calendars.'); await this.saveRecords([...(await this.records()), account]); return this.expose(account, 'connected', null) } catch (error) { await this.vault.clear(ref); throw error }
  }
  async disconnectAccount(id: string): Promise<boolean> { const account = await this.record(id); if (!account) return false; await this.vault.clear(account.credentialRef); await this.saveRecords((await this.records()).filter((candidate) => candidate.id !== account.id)); return true }
  private async remoteContext(nodeId: string, calendarId: string): Promise<{ account: RemoteCalendarAccount; adapter: ReturnType<typeof createCalendarProviderAdapters>[RemoteCalendarAccount['provider']] }> { const data = await this.read(nodeId); if (!data.accountId || data.sourceId !== calendarId || !REMOTE.has(data.provider)) throw new Error('Refresh this remote calendar before changing its events.'); const account = await this.record(data.accountId, data.provider); if (!account) throw new Error('The connected calendar account is unavailable.'); return { account, adapter: this.adapters[account.provider] } }
  async create(input: CalendarCreateInput): Promise<CalendarEvent> {
    return this.enqueueMutation(async () => {
      if (!isCalendarNodeId(input.nodeId) || typeof input.event?.calendarId !== 'string' || typeof input.event.title !== 'string' || !input.event.title.trim() || input.event.title.length > 500 || Number.isNaN(Date.parse(input.event.start)) || Number.isNaN(Date.parse(input.event.end)) || Date.parse(input.event.end) <= Date.parse(input.event.start)) throw new Error('Calendar event fields are invalid.'); if (!['local', 'ics'].some((prefix) => input.event.calendarId === prefix || input.event.calendarId.startsWith(`${prefix}-`))) { const { account, adapter } = await this.remoteContext(input.nodeId, input.event.calendarId); return adapter.create(account, input) }
      const data = await this.read(input.nodeId); const event: CalendarEvent = { ...input.event, title: input.event.title.trim(), id: makeId('local', 5), updatedAt: Date.now() }; await this.write({ ...data, events: [...data.events, event], fetchedAt: Date.now() }); return event
    })
  }
  async update(input: CalendarUpdateInput): Promise<CalendarEvent | null> {
    return this.enqueueMutation(async () => {
      if (!input || !isCalendarNodeId(input.nodeId) || typeof input.eventId !== 'string' || !input.event || typeof input.event !== 'object') throw new Error('Calendar update fields are invalid.'); const data = await this.read(input.nodeId); const current = data.events.find((event) => event.id === input.eventId); if (!current) return null; const event: CalendarEvent = { ...current, ...input.event, id: current.id, calendarId: current.calendarId, updatedAt: Date.now() }; if (!event.title.trim() || Number.isNaN(Date.parse(event.start)) || Number.isNaN(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start)) throw new Error('Calendar event fields are invalid.'); if (!['local', 'ics'].some((prefix) => current.calendarId === prefix || current.calendarId.startsWith(`${prefix}-`))) { const { account, adapter } = await this.remoteContext(input.nodeId, current.calendarId); return adapter.update(account, { ...input, event }) }; await this.write({ ...data, events: data.events.map((candidate) => candidate.id === current.id ? event : candidate), fetchedAt: Date.now() }); return event
    })
  }
  async remove(nodeId: string, eventId: string): Promise<boolean> { return this.enqueueMutation(async () => { const data = await this.read(nodeId); const current = data.events.find((event) => event.id === eventId); if (!current) return false; if (!['local', 'ics'].some((prefix) => current.calendarId === prefix || current.calendarId.startsWith(`${prefix}-`))) { const { account, adapter } = await this.remoteContext(nodeId, current.calendarId); return adapter.remove(account, current.calendarId, eventId) }; await this.write({ ...data, events: data.events.filter((event) => event.id !== eventId), fetchedAt: Date.now() }); return true }) }
}
