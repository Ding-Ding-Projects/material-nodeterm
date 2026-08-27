import { randomUUID } from 'node:crypto'
import type { CalendarCreateInput, CalendarEvent, CalendarSource, CalendarUpdateInput } from '../../shared/calendar'
import type { CalendarCredential, CalendarCredentialVault } from './vault'

export interface RemoteCalendarAccount {
  id: string
  provider: 'caldav' | 'google' | 'microsoft365'
  displayName: string
  email: string | null
  credentialRef: string
  endpoint: string | null
}

export interface CalendarSyncCursor { revision: string | null; etag: string | null }
export interface CalendarSyncResult {
  events: CalendarEvent[]
  sourceRevision: string | null
  etag: string | null
  complete: boolean
  partial: boolean
}

export interface CalendarProviderAdapter {
  calendars(account: RemoteCalendarAccount): Promise<CalendarSource[]>
  sync(account: RemoteCalendarAccount, calendarId: string, cursor: CalendarSyncCursor): Promise<CalendarSyncResult>
  create(account: RemoteCalendarAccount, input: CalendarCreateInput): Promise<CalendarEvent>
  update(account: RemoteCalendarAccount, input: CalendarUpdateInput): Promise<CalendarEvent | null>
  remove(account: RemoteCalendarAccount, calendarId: string, eventId: string): Promise<boolean>
}

type Json = Record<string, unknown>
type FetchImpl = typeof fetch
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_PAGES = 40
const MAX_EVENTS = 10_000

function bounded(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function iso(value: unknown): string | null {
  const text = bounded(value, 100)
  return text && !Number.isNaN(Date.parse(text)) ? text : null
}

async function textResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Calendar provider response exceeds the 8 MB limit.')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Calendar provider response exceeds the 8 MB limit.')
  if (!response.ok) throw new Error(`Calendar provider request failed with HTTP ${response.status}.`)
  return text
}

async function jsonResponse(response: Response): Promise<Json> {
  const text = await textResponse(response)
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Calendar provider returned an invalid JSON object.')
  return parsed as Json
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}

function safeProviderUrl(provider: RemoteCalendarAccount['provider'], raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('Calendar provider URLs must use HTTPS.')
  if (url.username || url.password) throw new Error('Calendar provider URLs must not contain credentials.')
  if (provider === 'google' && url.hostname !== 'www.googleapis.com' && url.hostname !== 'oauth2.googleapis.com') throw new Error('Unexpected Google Calendar host.')
  if (provider === 'microsoft365' && url.hostname !== 'graph.microsoft.com' && url.hostname !== 'login.microsoftonline.com') throw new Error('Unexpected Microsoft 365 host.')
  return url
}

function validateEndpoint(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('CalDAV endpoint must be an HTTPS URL without embedded credentials or a fragment.')
  return url.toString()
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function unescapeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function serializeIcs(event: Omit<CalendarEvent, 'id' | 'updatedAt'> & { id?: string }): string {
  const date = (value: string): string => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const clean = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nodeterm//Calendar Node//EN', 'BEGIN:VEVENT', `UID:${clean(event.id ?? crypto.randomUUID())}`, `DTSTAMP:${date(new Date().toISOString())}`, `DTSTART:${date(event.start)}`, `DTEND:${date(event.end)}`, `SUMMARY:${clean(event.title)}`, event.location ? `LOCATION:${clean(event.location)}` : '', event.description ? `DESCRIPTION:${clean(event.description)}` : '', event.recurrence ? event.recurrence.replace(/^RRULE:/i, 'RRULE:') : '', 'END:VEVENT', 'END:VCALENDAR', ''].filter(Boolean).join('\r\n')
}

class CredentialedAdapter {
  constructor(protected readonly vault: CalendarCredentialVault, protected readonly fetchImpl: FetchImpl) {}

  protected async credential(account: RemoteCalendarAccount): Promise<CalendarCredential> {
    const credential = await this.vault.read(account.credentialRef)
    if (!credential) throw new Error('Calendar account credential is unavailable. Reconnect the account.')
    return credential
  }

  protected async oauth(account: RemoteCalendarAccount): Promise<string> {
    const credential = await this.credential(account)
    if (credential.kind !== 'oauth') throw new Error('Calendar account requires OAuth credentials.')
    if (credential.expiresAt > Date.now() + 60_000) return credential.accessToken
    if (!credential.refreshToken) throw new Error('Calendar consent expired. Reconnect the account.')
    const tokenUrl = safeProviderUrl(account.provider, credential.tokenUrl)
    const response = await this.fetchImpl(tokenUrl, {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: credential.clientId, grant_type: 'refresh_token', refresh_token: credential.refreshToken, scope: credential.scope })
    })
    const json = await jsonResponse(response)
    const accessToken = bounded(json.access_token, 16_384)
    if (!accessToken) throw new Error('Calendar provider did not return a refreshed access token.')
    const expiresIn = typeof json.expires_in === 'number' && Number.isFinite(json.expires_in) ? Math.max(60, Math.min(json.expires_in, 86_400)) : 3600
    await this.vault.save(account.credentialRef, { ...credential, accessToken, refreshToken: bounded(json.refresh_token, 16_384) ?? credential.refreshToken, expiresAt: Date.now() + expiresIn * 1000 })
    return accessToken
  }
}

class CalDavAdapter extends CredentialedAdapter implements CalendarProviderAdapter {
  private async request(account: RemoteCalendarAccount, url: string, init: RequestInit): Promise<Response> {
    const credential = await this.credential(account)
    if (credential.kind !== 'caldav') throw new Error('CalDAV account requires a username and password credential.')
    if (!account.endpoint) throw new Error('CalDAV account endpoint is unavailable.')
    const endpoint = new URL(validateEndpoint(account.endpoint))
    const target = new URL(validateEndpoint(url))
    if (target.origin !== endpoint.origin) throw new Error('CalDAV resource URL left the configured server origin.')
    return this.fetchImpl(target, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { ...init.headers, authorization: basicAuth(credential.username, credential.password) } })
  }

  async calendars(account: RemoteCalendarAccount): Promise<CalendarSource[]> {
    if (!account.endpoint) throw new Error('CalDAV account endpoint is unavailable.')
    const response = await this.request(account, account.endpoint, { method: 'PROPFIND', headers: { depth: '1', 'content-type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:calendar-description/><c:calendar-timezone/></d:prop></d:propfind>' })
    const xml = await textResponse(response)
    const sources: CalendarSource[] = []
    for (const match of xml.matchAll(/<(?:d:)?response\b[\s\S]*?<\/(?:d:)?response>/gi)) {
      const row = match[0]
      if (!/<(?:c:)?calendar\b/i.test(row)) continue
      const href = unescapeXml(/<(?:d:)?href\b[^>]*>([\s\S]*?)<\/(?:d:)?href>/i.exec(row)?.[1]?.trim() ?? '')
      if (!href) continue
      const id = new URL(href, account.endpoint).toString()
      const name = unescapeXml(/<(?:d:)?displayname\b[^>]*>([\s\S]*?)<\/(?:d:)?displayname>/i.exec(row)?.[1]?.trim() ?? 'CalDAV calendar').slice(0, 200)
      sources.push({ id, accountId: account.id, provider: 'caldav', name, timezone: 'local', color: '#006A6A', readOnly: false, writable: true })
      if (sources.length >= 250) break
    }
    return sources
  }

  async sync(account: RemoteCalendarAccount, calendarId: string, cursor: CalendarSyncCursor): Promise<CalendarSyncResult> {
    const endpoint = validateEndpoint(calendarId)
    const body = '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'
    const response = await this.request(account, endpoint, { method: 'REPORT', headers: { depth: '1', 'content-type': 'application/xml; charset=utf-8', ...(cursor.etag ? { 'if-none-match': cursor.etag } : {}) }, body })
    if (response.status === 304) return { events: [], sourceRevision: cursor.revision, etag: cursor.etag, complete: true, partial: false }
    const xml = await textResponse(response)
    const { parseIcs } = await import('../../shared/calendar')
    const events: CalendarEvent[] = []
    for (const match of xml.matchAll(/<(?:d:)?response\b[\s\S]*?<\/(?:d:)?response>/gi)) {
      const row = match[0]
      const data = /<(?:c:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:c:)?calendar-data>/i.exec(row)?.[1]
      if (!data) continue
      const href = unescapeXml(/<(?:d:)?href\b[^>]*>([\s\S]*?)<\/(?:d:)?href>/i.exec(row)?.[1]?.trim() ?? '')
      const resourceUrl = href ? new URL(href, endpoint).toString() : null
      const parsed = parseIcs(unescapeXml(data), calendarId)
      if (resourceUrl && parsed.length === 1) parsed[0] = { ...parsed[0], id: resourceUrl }
      events.push(...parsed)
      if (events.length >= MAX_EVENTS) break
    }
    return { events: events.slice(0, MAX_EVENTS), sourceRevision: response.headers.get('sync-token') ?? response.headers.get('date'), etag: response.headers.get('etag'), complete: events.length < MAX_EVENTS, partial: events.length >= MAX_EVENTS }
  }

  async create(account: RemoteCalendarAccount, input: CalendarCreateInput): Promise<CalendarEvent> {
    const uid = randomUUID()
    const url = new URL(`${encodeURIComponent(uid)}.ics`, validateEndpoint(input.event.calendarId)).toString()
    const event: CalendarEvent = { ...input.event, id: url, updatedAt: Date.now() }
    await textResponse(await this.request(account, url, { method: 'PUT', headers: { 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' }, body: serializeIcs(event) }))
    return event
  }
  async update(account: RemoteCalendarAccount, input: CalendarUpdateInput): Promise<CalendarEvent | null> {
    const current: CalendarEvent = { id: input.eventId, calendarId: String(input.event.calendarId ?? ''), title: String(input.event.title ?? ''), start: String(input.event.start ?? ''), end: String(input.event.end ?? ''), timezone: String(input.event.timezone ?? 'local'), allDay: input.event.allDay === true, location: input.event.location ?? null, description: input.event.description ?? null, recurrence: input.event.recurrence ?? null, updatedAt: Date.now() }
    if (!current.calendarId || !current.title || !iso(current.start) || !iso(current.end)) throw new Error('CalDAV update requires the complete event record.')
    const url = input.eventId.startsWith('https://') ? validateEndpoint(input.eventId) : new URL(`${encodeURIComponent(input.eventId)}.ics`, validateEndpoint(current.calendarId)).toString()
    await textResponse(await this.request(account, url, { method: 'PUT', headers: { 'content-type': 'text/calendar; charset=utf-8' }, body: serializeIcs(current) }))
    return current
  }
  async remove(account: RemoteCalendarAccount, calendarId: string, eventId: string): Promise<boolean> {
    const url = eventId.startsWith('https://') ? validateEndpoint(eventId) : new URL(`${encodeURIComponent(eventId)}.ics`, validateEndpoint(calendarId)).toString()
    const response = await this.request(account, url, { method: 'DELETE' })
    if (response.status === 404) return false
    await textResponse(response); return true
  }
}

abstract class JsonCalendarAdapter extends CredentialedAdapter implements CalendarProviderAdapter {
  protected abstract provider: 'google' | 'microsoft365'
  protected abstract calendarListUrl(): string
  protected abstract source(row: Json, account: RemoteCalendarAccount): CalendarSource | null
  protected abstract event(row: Json, calendarId: string): CalendarEvent | null
  protected abstract eventsUrl(calendarId: string, cursor: CalendarSyncCursor): string
  protected abstract next(json: Json, currentUrl: string): string | null
  protected abstract revision(json: Json): string | null
  protected abstract eventUrl(calendarId: string, eventId?: string): string
  protected abstract eventPayload(event: Partial<CalendarEvent>): Json

  protected async request(account: RemoteCalendarAccount, url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.oauth(account)
    return this.fetchImpl(safeProviderUrl(this.provider, url), { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json', ...init.headers, authorization: `Bearer ${token}` } })
  }
  async calendars(account: RemoteCalendarAccount): Promise<CalendarSource[]> {
    const result: CalendarSource[] = []; let next: string | null = this.calendarListUrl()
    for (let page = 0; next && page < MAX_PAGES && result.length < 1000; page++) {
      const json = await jsonResponse(await this.request(account, next)); const rows = Array.isArray(json.items) ? json.items : Array.isArray(json.value) ? json.value : []
      for (const row of rows) { if (row && typeof row === 'object') { const source = this.source(row as Json, account); if (source) result.push(source) } }
      next = this.next(json, next)
    }
    return result.slice(0, 1000)
  }
  async sync(account: RemoteCalendarAccount, calendarId: string, cursor: CalendarSyncCursor): Promise<CalendarSyncResult> {
    const events: CalendarEvent[] = []; let next: string | null = this.eventsUrl(calendarId, cursor); let revision: string | null = null; let pages = 0
    while (next && pages++ < MAX_PAGES && events.length < MAX_EVENTS) {
      const currentUrl = next
      const response = await this.request(account, currentUrl, { headers: cursor.etag ? { 'if-none-match': cursor.etag } : {} })
      if (response.status === 304) return { events: [], sourceRevision: cursor.revision, etag: cursor.etag, complete: true, partial: false }
      const json = await jsonResponse(response); const rows = Array.isArray(json.items) ? json.items : Array.isArray(json.value) ? json.value : []
      for (const row of rows) { if (row && typeof row === 'object') { const event = this.event(row as Json, calendarId); if (event) events.push(event) } }
      revision = this.revision(json) ?? revision; next = this.next(json, currentUrl)
    }
    const partial = !!next || events.length >= MAX_EVENTS
    return { events: events.slice(0, MAX_EVENTS), sourceRevision: revision, etag: null, complete: !partial, partial }
  }
  async create(account: RemoteCalendarAccount, input: CalendarCreateInput): Promise<CalendarEvent> {
    const json = await jsonResponse(await this.request(account, this.eventUrl(input.event.calendarId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.eventPayload(input.event)) }))
    const event = this.event(json, input.event.calendarId); if (!event) throw new Error('Calendar provider returned an invalid created event.'); return event
  }
  async update(account: RemoteCalendarAccount, input: CalendarUpdateInput): Promise<CalendarEvent | null> {
    const calendarId = bounded(input.event.calendarId, 1000); if (!calendarId) throw new Error('Remote calendar update requires its calendar id.')
    const json = await jsonResponse(await this.request(account, this.eventUrl(calendarId, input.eventId), { method: this.provider === 'google' ? 'PUT' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.eventPayload(input.event)) }))
    return this.event(json, calendarId)
  }
  async remove(account: RemoteCalendarAccount, calendarId: string, eventId: string): Promise<boolean> {
    const response = await this.request(account, this.eventUrl(calendarId, eventId), { method: 'DELETE' }); if (response.status === 404) return false; if (!response.ok) await textResponse(response); return true
  }
}

class GoogleAdapter extends JsonCalendarAdapter {
  protected provider = 'google' as const
  protected calendarListUrl = (): string => 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250'
  protected next = (json: Json, currentUrl: string): string | null => { const token = bounded(json.nextPageToken, 2000); if (!token) return null; const url = new URL(currentUrl); url.searchParams.set('pageToken', token); return url.toString() }
  protected revision = (json: Json): string | null => bounded(json.nextSyncToken, 4000)
  protected source(row: Json, account: RemoteCalendarAccount): CalendarSource | null { const id = bounded(row.id, 1000); if (!id) return null; return { id, accountId: account.id, provider: 'google', name: bounded(row.summary, 200) ?? id, timezone: bounded(row.timeZone, 100) ?? 'local', color: bounded(row.backgroundColor, 20) ?? '#1A73E8', readOnly: row.accessRole === 'reader' || row.accessRole === 'freeBusyReader', writable: row.accessRole !== 'reader' && row.accessRole !== 'freeBusyReader' } }
  protected eventsUrl(calendarId: string, cursor: CalendarSyncCursor): string { const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`); url.searchParams.set('singleEvents', 'true'); url.searchParams.set('showDeleted', 'false'); url.searchParams.set('maxResults', '2500'); if (cursor.revision) url.searchParams.set('syncToken', cursor.revision); return url.toString() }
  protected eventUrl(calendarId: string, eventId?: string): string { return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}` }
  protected event(row: Json, calendarId: string): CalendarEvent | null { const id = bounded(row.id, 1000); const summary = bounded(row.summary, 500); const startObj = row.start as Json | undefined; const endObj = row.end as Json | undefined; const start = iso(startObj?.dateTime) ?? (bounded(startObj?.date, 20) ? `${startObj?.date}T00:00:00Z` : null); const end = iso(endObj?.dateTime) ?? (bounded(endObj?.date, 20) ? `${endObj?.date}T00:00:00Z` : null); if (!id || !summary || !start || !end) return null; return { id, calendarId, title: summary, start, end, timezone: bounded(startObj?.timeZone, 100) ?? 'local', allDay: !!startObj?.date, location: bounded(row.location, 500), description: bounded(row.description, 4000), recurrence: Array.isArray(row.recurrence) ? bounded(row.recurrence[0], 500) : null, updatedAt: Date.parse(String(row.updated ?? '')) || Date.now() } }
  protected eventPayload(event: Partial<CalendarEvent>): Json { const allDay = event.allDay === true; return { summary: event.title, description: event.description, location: event.location, start: allDay ? { date: event.start?.slice(0, 10) } : { dateTime: event.start, timeZone: event.timezone === 'local' ? undefined : event.timezone }, end: allDay ? { date: event.end?.slice(0, 10) } : { dateTime: event.end, timeZone: event.timezone === 'local' ? undefined : event.timezone }, recurrence: event.recurrence ? [event.recurrence] : undefined } }
}

class MicrosoftAdapter extends JsonCalendarAdapter {
  protected provider = 'microsoft365' as const
  protected calendarListUrl = (): string => 'https://graph.microsoft.com/v1.0/me/calendars?$top=100'
  protected next = (json: Json, _currentUrl: string): string | null => bounded(json['@odata.nextLink'], 4000)
  protected revision = (json: Json): string | null => bounded(json['@odata.deltaLink'], 4000)
  protected source(row: Json, account: RemoteCalendarAccount): CalendarSource | null { const id = bounded(row.id, 1000); if (!id) return null; const color = typeof row.color === 'string' && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : '#0078D4'; const writable = row.canEdit !== false; return { id, accountId: account.id, provider: 'microsoft365', name: bounded(row.name, 200) ?? id, timezone: 'local', color, readOnly: !writable, writable } }
  protected eventsUrl(calendarId: string, cursor: CalendarSyncCursor): string { if (cursor.revision) return cursor.revision; const start = new Date(Date.now() - 366 * 24 * 60 * 60_000).toISOString(); const end = new Date(Date.now() + 732 * 24 * 60 * 60_000).toISOString(); return `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=1000` }
  protected eventUrl(calendarId: string, eventId?: string): string { return `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}` }
  protected event(row: Json, calendarId: string): CalendarEvent | null { const id = bounded(row.id, 1000); const title = bounded(row.subject, 500); const startObj = row.start as Json | undefined; const endObj = row.end as Json | undefined; const start = iso(startObj?.dateTime); const end = iso(endObj?.dateTime); if (!id || !title || !start || !end) return null; const body = row.body as Json | undefined; return { id, calendarId, title, start, end, timezone: bounded(startObj?.timeZone, 100) ?? 'local', allDay: row.isAllDay === true, location: bounded((row.location as Json | undefined)?.displayName, 500), description: bounded(body?.content, 4000), recurrence: row.recurrence ? JSON.stringify(row.recurrence).slice(0, 500) : null, updatedAt: Date.parse(String(row.lastModifiedDateTime ?? '')) || Date.now() } }
  protected eventPayload(event: Partial<CalendarEvent>): Json { return { subject: event.title, body: { contentType: 'text', content: event.description ?? '' }, start: { dateTime: event.start, timeZone: event.timezone === 'local' ? 'UTC' : event.timezone }, end: { dateTime: event.end, timeZone: event.timezone === 'local' ? 'UTC' : event.timezone }, isAllDay: event.allDay, location: event.location ? { displayName: event.location } : undefined, recurrence: null } }
}

export function createCalendarProviderAdapters(vault: CalendarCredentialVault, fetchImpl: FetchImpl = fetch): Record<RemoteCalendarAccount['provider'], CalendarProviderAdapter> {
  return { caldav: new CalDavAdapter(vault, fetchImpl), google: new GoogleAdapter(vault, fetchImpl), microsoft365: new MicrosoftAdapter(vault, fetchImpl) }
}

export { validateEndpoint }
