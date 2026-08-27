/**
 * Calendar node contracts shared by the core, desktop shell, Server Edition, and renderer.
 *
 * The portable part is deliberately small: provider, account/calendar references, view choices,
 * and timezone are safe intent. Access tokens, refresh tokens, OAuth state, local file paths, and
 * cached events belong to the machine-local calendar service and never cross the project-file seam.
 */

export type CalendarProvider = 'local' | 'ics' | 'caldav' | 'google' | 'microsoft365'
export type CalendarView = 'month' | 'week' | 'agenda'

/** Runtime timezone catalog, using the platform's IANA database when available. */
export function calendarTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const values = intl.supportedValuesOf?.('timeZone') ?? ['UTC', 'America/Toronto', 'America/Los_Angeles', 'Europe/London', 'Asia/Hong_Kong']
  return ['local', ...values]
}

/** Complete provider catalog. Disabled providers stay visible in the picker with their reason. */
export const CALENDAR_PROVIDER_CATALOG: readonly { id: CalendarProvider; label: string; configuredBy: 'local' | 'file' | 'vault'; availability: 'available' | 'requires-account' | 'requires-adapter' }[] = [
  { id: 'local', label: 'Local calendar', configuredBy: 'local', availability: 'available' },
  { id: 'ics', label: 'ICS file', configuredBy: 'file', availability: 'available' },
  { id: 'caldav', label: 'CalDAV', configuredBy: 'vault', availability: 'requires-account' },
  { id: 'google', label: 'Google Calendar', configuredBy: 'vault', availability: 'requires-account' },
  { id: 'microsoft365', label: 'Microsoft 365', configuredBy: 'vault', availability: 'requires-account' }
] as const

export interface CalendarNodeConfig {
  provider: CalendarProvider
  accountId: string | null
  calendarId: string | null
  timezone: string
  view: CalendarView
  showWeekends: boolean
  cacheEnabled: boolean
}

export interface CalendarAccount {
  id: string
  provider: CalendarProvider
  displayName: string
  email: string | null
  /** A stable reference only. The credential value is held by the core vault. */
  credentialRef: string | null
  state: 'connected' | 'needs-consent' | 'offline' | 'unavailable'
  reason: string | null
}

export interface CalendarSource {
  id: string
  accountId: string | null
  provider: CalendarProvider
  name: string
  timezone: string
  color: string
  readOnly: boolean
  writable: boolean
}

export interface CalendarEvent {
  id: string
  calendarId: string
  title: string
  start: string
  end: string
  timezone: string
  allDay: boolean
  location: string | null
  description: string | null
  recurrence: string | null
  updatedAt: number
}

export interface CalendarCache {
  nodeId: string
  sourceId: string
  fetchedAt: number
  expiresAt: number
  events: CalendarEvent[]
  state: 'fresh' | 'stale' | 'offline' | 'empty'
  reason: string | null
  /** Provider synchronization evidence. Null means the source supplied no validator. */
  sourceRevision: string | null
  etag: string | null
  complete: boolean
  partial: boolean
  retryAt: number | null
  backoffMs: number
}

export interface CalendarStatus {
  nodeId: string
  provider: CalendarProvider
  state: 'unconfigured' | 'ready' | 'offline' | 'needs-consent' | 'unavailable'
  account: CalendarAccount | null
  source: CalendarSource | null
  cache: CalendarCache | null
  reason: string | null
}

export interface CalendarOAuthStart {
  provider: Exclude<CalendarProvider, 'local' | 'ics'>
  state: 'ready' | 'unsupported'
  authorizationUrl: string | null
  redirectUri: string | null
  reason: string | null
}

export interface CalendarCalDavConnectInput {
  displayName: string
  email: string | null
  endpoint: string
  username: string
  password: string
}

export interface CalendarCreateInput {
  nodeId: string
  event: Omit<CalendarEvent, 'id' | 'updatedAt'>
}

export interface CalendarUpdateInput {
  nodeId: string
  eventId: string
  event: Partial<Omit<CalendarEvent, 'id' | 'updatedAt'>>
}

export interface CalendarApi {
  status(nodeId: string, config: CalendarNodeConfig): Promise<CalendarStatus>
  accounts(): Promise<CalendarAccount[]>
  calendars(accountId: string | null, provider: CalendarProvider): Promise<CalendarSource[]>
  events(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache>
  importIcs(nodeId: string, icsText: string, sourceName?: string): Promise<CalendarCache>
  refresh(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache>
  beginOAuth(provider: Exclude<CalendarProvider, 'local' | 'ics'>): Promise<CalendarOAuthStart>
  connectCalDav(input: CalendarCalDavConnectInput): Promise<CalendarAccount>
  disconnectAccount(accountId: string): Promise<boolean>
  create(input: CalendarCreateInput): Promise<CalendarEvent>
  update(input: CalendarUpdateInput): Promise<CalendarEvent | null>
  remove(nodeId: string, eventId: string): Promise<boolean>
}

const PROVIDER_NAMES: Record<CalendarProvider, string> = {
  local: 'Local calendar',
  ics: 'ICS file',
  caldav: 'CalDAV',
  google: 'Google Calendar',
  microsoft365: 'Microsoft 365'
}

export function calendarProviderName(provider: CalendarProvider): string {
  return PROVIDER_NAMES[provider]
}

export const DEFAULT_CALENDAR_NODE_CONFIG: CalendarNodeConfig = {
  provider: 'local',
  accountId: null,
  calendarId: null,
  timezone: 'local',
  view: 'agenda',
  showWeekends: true,
  cacheEnabled: true
}

/** The id becomes a filename under the private cache root. Validate before joining any path. */
export function isCalendarNodeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{1,120}$/.test(value)
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

function unfoldIcs(ics: string): string[] {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const unfolded: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += line.slice(1)
    else unfolded.push(line)
  }
  return unfolded
}

function property(lines: string[], name: string): string | null {
  const prefix = `${name.toUpperCase()}:`
  const row = lines.find((line) => line.toUpperCase().startsWith(prefix))
  return row ? unescapeIcs(row.slice(prefix.length)) : null
}

function propertyWithParams(lines: string[], name: string): { value: string; params: string } | null {
  const row = lines.find((line) => line.toUpperCase().startsWith(`${name.toUpperCase()};`) || line.toUpperCase().startsWith(`${name.toUpperCase()}:`))
  if (!row) return null
  const colon = row.indexOf(':')
  if (colon < 0) return null
  return { params: row.slice(0, colon), value: unescapeIcs(row.slice(colon + 1)) }
}

function parseIcsDate(value: string, allDay: boolean): string {
  const clean = value.trim()
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(clean)
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(clean)
  if (!dateOnly && !dateTime) throw new Error(`ICS date is invalid: ${clean.slice(0, 40)}`)
  const year = Number((dateOnly ?? dateTime)![1])
  const month = Number((dateOnly ?? dateTime)![2])
  const day = Number((dateOnly ?? dateTime)![3])
  const hour = dateTime ? Number(dateTime[4]) : 0
  const minute = dateTime ? Number(dateTime[5]) : 0
  const second = dateTime ? Number(dateTime[6]) : 0
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60 || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`ICS date is out of range: ${clean.slice(0, 40)}`)
  }
  if (dateOnly && !allDay) throw new Error('ICS date-only DTSTART/DTEND must declare VALUE=DATE.')
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(Math.min(second, 59)).padStart(2, '0')}`
  return dateTime?.[7] ? `${iso}Z` : iso
}

function validTimeZone(value: string): string {
  if (!value || value === 'local') return 'local'
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format() ; return value } catch { return 'local' }
}

/** Parse bounded VEVENT records. Unknown components and malformed events are skipped, never guessed. */
export function parseIcs(ics: string, calendarId = 'ics-import'): CalendarEvent[] {
  if (new TextEncoder().encode(ics).byteLength > 2_000_000) throw new Error('ICS input exceeds the 2 MB UTF-8 safety limit.')
  const lines = unfoldIcs(ics)
  const events: CalendarEvent[] = []
  const seenUids = new Set<string>()
  let current: string[] | null = null
  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VEVENT') current = []
    else if (line.toUpperCase() === 'END:VEVENT' && current) {
      const start = propertyWithParams(current, 'DTSTART')
      const end = propertyWithParams(current, 'DTEND')
      const uid = property(current, 'UID')
      const title = property(current, 'SUMMARY')
      if (start && end && uid && title && !seenUids.has(uid)) {
        const allDay = /VALUE=DATE/i.test(start.params)
        const parsedStart = parseIcsDate(start.value, allDay)
        const parsedEnd = parseIcsDate(end.value, allDay)
        if (parsedStart >= parsedEnd) throw new Error(`ICS event has an invalid time range: ${uid.slice(0, 80)}`)
        seenUids.add(uid)
        events.push({
          id: uid,
          calendarId,
          title,
          start: parsedStart,
          end: parsedEnd,
          timezone: validTimeZone(/TZID=([^;:]+)/i.exec(start.params)?.[1] ?? property(current, 'X-WR-TIMEZONE') ?? 'local'),
          allDay,
          location: property(current, 'LOCATION'),
          description: property(current, 'DESCRIPTION'),
          recurrence: property(current, 'RRULE'),
          updatedAt: Date.now()
        })
      }
      current = null
    } else if (current) current.push(line)
  }
  return events.slice(0, 10_000)
}

export function validateCalendarConfig(value: unknown): CalendarNodeConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CALENDAR_NODE_CONFIG }
  const raw = value as Partial<CalendarNodeConfig>
  const provider: CalendarProvider = ['local', 'ics', 'caldav', 'google', 'microsoft365'].includes(raw.provider as string)
    ? (raw.provider as CalendarProvider)
    : 'local'
  const view: CalendarView = ['month', 'week', 'agenda'].includes(raw.view as string) ? (raw.view as CalendarView) : 'agenda'
  const accountId = typeof raw.accountId === 'string' && raw.accountId.length <= 160 ? raw.accountId : null
  const calendarId = typeof raw.calendarId === 'string' && raw.calendarId.length <= 160 ? raw.calendarId : null
  const timezone = typeof raw.timezone === 'string' && raw.timezone.length <= 100 && !/[\u0000-\u001f]/.test(raw.timezone) ? raw.timezone : 'local'
  return { provider, view, accountId, calendarId, timezone, showWeekends: raw.showWeekends !== false, cacheEnabled: raw.cacheEnabled !== false }
}
