import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import type { CalendarAccount, CalendarApi, CalendarCache, CalendarCreateInput, CalendarEvent, CalendarNodeConfig, CalendarOAuthStart, CalendarProvider, CalendarSource, CalendarStatus, CalendarUpdateInput } from '../../shared/calendar'
import { isCalendarNodeId, parseIcs, validateCalendarConfig } from '../../shared/calendar'

interface LocalNodeFile { version: 1; nodeId: string; sourceId: string; events: CalendarEvent[]; sourceName: string; fetchedAt: number }

function validEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== 'object') return false
  const e = value as Partial<CalendarEvent>
  return typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 240 &&
    typeof e.calendarId === 'string' && e.calendarId.length <= 240 &&
    typeof e.title === 'string' && e.title.length <= 500 &&
    typeof e.start === 'string' && !Number.isNaN(Date.parse(e.start)) &&
    typeof e.end === 'string' && !Number.isNaN(Date.parse(e.end)) &&
    typeof e.timezone === 'string' && e.timezone.length <= 100 &&
    typeof e.allDay === 'boolean' && typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt)
}

function id(): string { return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }

/**
 * Calendar persistence and provider boundary. Only event metadata and opaque account references
 * are returned to the renderer. OAuth values are intentionally not accepted by this service's
 * public methods. A provider adapter can add vault-backed tokens behind the same boundary later.
 */
export class CalendarService implements CalendarApi {
  private readonly root: string
  private readonly accountsFile: string
  constructor(userDataDir: string) {
    this.root = path.join(userDataDir, 'calendar-nodes')
    this.accountsFile = path.join(userDataDir, 'calendar-accounts.json')
  }

  private file(nodeId: string): string {
    if (!isCalendarNodeId(nodeId)) throw new Error('Calendar node id is invalid.')
    return path.join(this.root, `${nodeId}.json`)
  }
  private async read(nodeId: string): Promise<LocalNodeFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file(nodeId), 'utf8')) as Partial<LocalNodeFile>
      if (parsed.version !== 1 || parsed.nodeId !== nodeId || !Array.isArray(parsed.events) || parsed.events.length > 10000 || !parsed.events.every(validEvent)) throw new Error('Calendar cache has an unsupported shape.')
      const sourceId = typeof (parsed as { sourceId?: unknown }).sourceId === 'string' ? (parsed as { sourceId: string }).sourceId.slice(0, 240) : 'local'
      return { version: 1, nodeId, sourceId, events: parsed.events.slice(0, 10000), sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName.slice(0, 200) : 'Local calendar', fetchedAt: typeof parsed.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : 0 }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, nodeId, sourceId: 'local', events: [], sourceName: 'Local calendar', fetchedAt: 0 }
      throw error
    }
  }
  private async write(value: LocalNodeFile): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const tmp = tempNameFor(this.file(value.nodeId))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
    await renameAtomic(tmp, this.file(value.nodeId))
  }
  async accounts(): Promise<CalendarAccount[]> {
    try {
      const parsed = JSON.parse(await readFile(this.accountsFile, 'utf8')) as unknown
      return Array.isArray(parsed) ? parsed.filter((a): a is CalendarAccount => !!a && typeof a === 'object' && typeof (a as CalendarAccount).id === 'string').map((a) => a.provider === 'local' || a.provider === 'ics' ? { ...a, credentialRef: null } : { ...a, state: 'unavailable' as const, credentialRef: null, reason: 'No trusted provider adapter is installed.' }) : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
  async calendars(accountId: string | null, provider: CalendarProvider): Promise<CalendarSource[]> {
    if (provider === 'local') return [{ id: 'local', accountId: null, provider, name: 'On this computer', timezone: 'local', color: '#6750A4', readOnly: false, writable: true }]
    if (provider === 'ics') return [{ id: accountId ?? 'ics-import', accountId: null, provider, name: 'Imported ICS file', timezone: 'local', color: '#386A20', readOnly: false, writable: true }]
    if (!accountId) return []
    // No remote provider adapter is installed in this lane. Never synthesize a connected or
    // writable source from account metadata: an empty list is surfaced as unavailable by the UI.
    return []
  }
  async events(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache> {
    config = validateCalendarConfig(config)
    const data = await this.read(nodeId)
    const sourceId = config.calendarId ?? 'local'
    const sameSource = data.sourceId === sourceId || (config.provider === 'local' && data.sourceId === 'local')
    const events = sameSource ? data.events : []
    return { nodeId, sourceId, fetchedAt: sameSource ? data.fetchedAt : 0, expiresAt: sameSource && data.fetchedAt ? data.fetchedAt + 15 * 60_000 : 0, events, state: events.length ? (data.fetchedAt && Date.now() - data.fetchedAt < 15 * 60_000 ? 'fresh' : 'stale') : 'empty', reason: sameSource ? null : 'The selected source has no cached events yet.', sourceRevision: sameSource ? String(data.fetchedAt || '') || null : null, etag: null, complete: true, partial: false, retryAt: null, backoffMs: 0 }
  }
  async importIcs(nodeId: string, icsText: string, sourceName = 'Imported ICS file'): Promise<CalendarCache> {
    const events = parseIcs(icsText, `ics-${nodeId}`)
    const fetchedAt = Date.now()
    await this.write({ version: 1, nodeId, sourceId: `ics-${nodeId}`, events, sourceName: sourceName.slice(0, 200), fetchedAt })
    return { nodeId, sourceId: `ics-${nodeId}`, fetchedAt, expiresAt: fetchedAt + 365 * 24 * 60 * 60_000, events, state: events.length ? 'fresh' : 'empty', reason: events.length ? null : 'The ICS file contained no complete VEVENT records.', sourceRevision: String(fetchedAt), etag: null, complete: true, partial: false, retryAt: null, backoffMs: 0 }
  }
  async refresh(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache> {
    config = validateCalendarConfig(config)
    if (config.provider === 'local' || config.provider === 'ics') return this.events(nodeId, config)
    const cached = await this.events(nodeId, config)
    return { ...cached, state: cached.events.length ? 'offline' : 'empty', reason: 'This provider adapter is unavailable. Existing cache was retained; no network request was made.', complete: false, partial: false, retryAt: null, backoffMs: 0 }
  }
  async status(nodeId: string, config: CalendarNodeConfig): Promise<CalendarStatus> {
    const normalized = validateCalendarConfig(config)
    const account = (await this.accounts()).find((a) => a.id === normalized.accountId) ?? null
    const source = (await this.calendars(normalized.accountId, normalized.provider)).find((s) => s.id === normalized.calendarId) ?? (normalized.provider === 'local' ? (await this.calendars(null, 'local'))[0] : null)
    const cache = await this.events(nodeId, normalized)
    const state = normalized.provider === 'local' || normalized.provider === 'ics' ? 'ready' : account ? 'unavailable' : 'unconfigured'
    return { nodeId, provider: normalized.provider, state, account, source, cache, reason: state === 'unconfigured' ? 'Choose a connected account.' : state === 'unavailable' ? 'No trusted provider adapter is installed; remote calendar actions are disabled.' : null }
  }
  async beginOAuth(provider: Exclude<CalendarProvider, 'local' | 'ics'>): Promise<CalendarOAuthStart> {
    return { provider, state: 'unsupported', authorizationUrl: null, redirectUri: null, reason: 'No trusted OAuth/PKCE provider adapter is installed; this provider is unavailable and its actions are disabled.' }
  }
  async create(input: CalendarCreateInput): Promise<CalendarEvent> {
    if (!isCalendarNodeId(input.nodeId) || typeof input.event?.calendarId !== 'string' || !['local', 'ics'].some((prefix) => input.event.calendarId === prefix || input.event.calendarId.startsWith(`${prefix}-`))) throw new Error('Remote calendar writes are unavailable until a trusted writable adapter is connected.')
    if (typeof input.event.title !== 'string' || input.event.title.trim().length === 0 || input.event.title.length > 500 || typeof input.event.start !== 'string' || typeof input.event.end !== 'string' || Number.isNaN(Date.parse(input.event.start)) || Number.isNaN(Date.parse(input.event.end)) || Date.parse(input.event.end) <= Date.parse(input.event.start)) throw new Error('Calendar event fields are invalid.')
    const data = await this.read(input.nodeId); const event = { calendarId: input.event.calendarId, title: input.event.title.trim(), start: input.event.start, end: input.event.end, timezone: input.event.timezone.slice(0, 100), allDay: input.event.allDay === true, location: typeof input.event.location === 'string' ? input.event.location.slice(0, 500) : null, description: typeof input.event.description === 'string' ? input.event.description.slice(0, 4000) : null, recurrence: typeof input.event.recurrence === 'string' ? input.event.recurrence.slice(0, 500) : null, id: id(), updatedAt: Date.now() }; await this.write({ ...data, events: [...data.events, event], fetchedAt: Date.now() }); return event
  }
  async update(input: CalendarUpdateInput): Promise<CalendarEvent | null> { if (!input || typeof input.nodeId !== 'string' || typeof input.eventId !== 'string' || !input.event || typeof input.event !== 'object') throw new Error('Calendar update fields are invalid.'); const data = await this.read(input.nodeId); const current = data.events.find((e) => e.id === input.eventId); if (!current) return null; if (!['local', 'ics'].some((prefix) => current.calendarId === prefix || current.calendarId.startsWith(`${prefix}-`))) throw new Error('Remote calendar writes are unavailable until a trusted writable adapter is connected.'); const patch = input.event; const event = { ...current, title: typeof patch.title === 'string' ? patch.title.slice(0, 500) : current.title, start: typeof patch.start === 'string' ? patch.start : current.start, end: typeof patch.end === 'string' ? patch.end : current.end, timezone: typeof patch.timezone === 'string' ? patch.timezone.slice(0, 100) : current.timezone, allDay: typeof patch.allDay === 'boolean' ? patch.allDay : current.allDay, location: typeof patch.location === 'string' ? patch.location.slice(0, 500) : patch.location === null ? null : current.location, description: typeof patch.description === 'string' ? patch.description.slice(0, 4000) : patch.description === null ? null : current.description, recurrence: typeof patch.recurrence === 'string' ? patch.recurrence.slice(0, 500) : patch.recurrence === null ? null : current.recurrence, id: current.id, updatedAt: Date.now() }; if (!event.title.trim() || Number.isNaN(Date.parse(event.start)) || Number.isNaN(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start)) throw new Error('Calendar event fields are invalid.'); await this.write({ ...data, events: data.events.map((e) => e.id === current.id ? event : e), fetchedAt: Date.now() }); return event }
  async remove(nodeId: string, eventId: string): Promise<boolean> { const data = await this.read(nodeId); const current = data.events.find((e) => e.id === eventId); if (current && !['local', 'ics'].some((prefix) => current.calendarId === prefix || current.calendarId.startsWith(`${prefix}-`))) throw new Error('Remote calendar writes are unavailable until a trusted writable adapter is connected.'); const next = data.events.filter((e) => e.id !== eventId); if (next.length === data.events.length) return false; await this.write({ ...data, events: next, fetchedAt: Date.now() }); return true }
}
