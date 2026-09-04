import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CalendarAccount, CalendarEvent, CalendarNodeConfig, CalendarProvider, CalendarSource, CalendarView } from '@shared/calendar'
import { CALENDAR_PROVIDER_CATALOG, DEFAULT_CALENDAR_NODE_CONFIG, calendarProviderName, calendarTimezones, validateCalendarConfig } from '@shared/calendar'
import type { CanvasNode } from '../state/workspace'
import { useSession } from '../session/session'
import { openDestructiveGate } from '../state/destructiveGate'
import { IconCalendar } from '../components/icons'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button, Checkbox, Chip, Tablist } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'

const PROVIDERS = CALENDAR_PROVIDER_CATALOG.map((entry) => entry.id)
const providerHelp: Record<CalendarProvider, string> = {
  local: 'Events are stored only in this app on this computer.',
  ics: 'Import a local .ics file. The file is read locally and is never uploaded.',
  caldav: 'Requires a connected CalDAV account. Credentials remain in the OS vault.',
  google: 'Requires Google OAuth consent. Tokens remain in the OS vault.',
  microsoft365: 'Requires Microsoft OAuth consent. Tokens remain in the OS vault.'
}

function cacheKey(nodeId: string): string { return `nodeterm.calendar.cache.${nodeId}` }

function readCached(nodeId: string): CalendarEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(nodeId)) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is CalendarEvent => !!v && typeof v === 'object' && typeof (v as CalendarEvent).title === 'string') : []
  } catch { return [] }
}

function saveCached(nodeId: string, events: CalendarEvent[]): void {
  try { localStorage.setItem(cacheKey(nodeId), JSON.stringify(events.slice(0, 10000))) } catch { /* cache is best effort */ }
}

function dateLabel(value: string, timezone: string, allDay: boolean): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return 'Invalid date'
  try {
    if (allDay) return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone === 'local' ? undefined : timezone })
    return date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone === 'local' ? undefined : timezone })
  } catch {
    return date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
}

function dateTimeInputValue(value: string | undefined, timezone: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone === 'local' ? undefined : timezone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result }, {})
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
  } catch { return date.toISOString().slice(0, 16) }
}

function dateTimeInputIso(value: string, timezone: string): string {
  if (timezone === 'local') return new Date(value).toISOString()
  try {
    const [datePart, timePart] = value.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    const guessed = Date.UTC(year, month - 1, day, hour, minute)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guessed)).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result }, {})
    const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
    return new Date(guessed + (guessed - displayed)).toISOString()
  } catch { return new Date(value).toISOString() }
}

function EventEditor({ nodeId, timezone, initial, onSave, onCancel }: { nodeId: string; timezone: string; initial?: CalendarEvent; onSave: (event: CalendarEvent) => void; onCancel: () => void }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [start, setStart] = useState(dateTimeInputValue(initial?.start, timezone))
  const [end, setEnd] = useState(dateTimeInputValue(initial?.end, timezone))
  const [location, setLocation] = useState(initial?.location ?? '')
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? '')
  const valid = title.trim().length > 0 && !!start && !!end && new Date(end).valueOf() > new Date(start).valueOf()
  return <div className="calendar-node__editor" role="region" aria-label={vocab(initial ? 'Edit calendar event' : 'Create calendar event')}>
    <h3>{vocab(initial ? 'Edit event' : 'Create event')}</h3>
    <p className="calendar-node__hint">{mapOwnedSentence(vocab, [copy('Times use '), fact(timezone === 'local' ? 'this computer’s timezone' : timezone), copy('. Review the preview before saving.')])}</p>
    <label>{vocab('Title')}<Input vocabularyMode="factual" value={title} aria-label={vocab('Event title')} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
    <div className="calendar-node__two-col"><label>{vocab('Starts')}<Input vocabularyMode="factual" type="datetime-local" value={start} aria-label={vocab('Event start')} onChange={(e) => setStart(e.target.value)} /></label><label>{vocab('Ends')}<Input vocabularyMode="factual" type="datetime-local" value={end} aria-label={vocab('Event end')} onChange={(e) => setEnd(e.target.value)} /></label></div>
    <label>{vocab('Location')}<Input vocabularyMode="factual" value={location} aria-label={vocab('Event location')} onChange={(e) => setLocation(e.target.value)} /></label>
    <label>{vocab('Recurrence rule (optional)')}<Input vocabularyMode="factual" value={recurrence} aria-label={vocab('Event recurrence rule')} onChange={(e) => setRecurrence(e.target.value)} placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO" /></label>
    {!valid && <p className="calendar-node__error" role="alert">{vocab('Enter a title and an end time after the start time.')}</p>}
    <div className="calendar-node__actions"><Button variant="outlined" size="small" vocabularyMode="factual" onClick={onCancel}>{vocab('Cancel')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={!valid} onClick={() => onSave({ id: initial?.id ?? `local-${Date.now().toString(36)}`, calendarId: initial?.calendarId ?? 'local', title: title.trim(), start: dateTimeInputIso(start, timezone), end: dateTimeInputIso(end, timezone), timezone, allDay: false, location: location.trim() || null, description: null, recurrence: recurrence.trim() || null, updatedAt: Date.now() })}>{vocab(initial ? 'Save changes' : 'Create event')}</Button></div>
  </div>
}

export default function CalendarNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { api } = useSession()
  const { updateNodeData } = useReactFlow()
  const vocab = useVocabularyMapper()
  const config = validateCalendarConfig(data.calendarConfig ?? DEFAULT_CALENDAR_NODE_CONFIG)
  const [accounts, setAccounts] = useState<CalendarAccount[]>([])
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>(() => readCached(id))
  const [status, setStatus] = useState<string>(() => vocab('Ready to choose a calendar.'))
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sourceSearch = useRegexSearchField()
  const sourceSearchRef = useRef<HTMLInputElement>(null)
  const accountSearch = useRegexSearchField()
  const accountSearchRef = useRef<HTMLInputElement>(null)
  const calendarSearch = useRegexSearchField()
  const calendarSearchRef = useRef<HTMLInputElement>(null)
  const timezoneSearch = useRegexSearchField()
  const timezoneSearchRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [calDavName, setCalDavName] = useState('My CalDAV account')
  const [calDavEndpoint, setCalDavEndpoint] = useState('')
  const [calDavUsername, setCalDavUsername] = useState('')
  const [calDavPassword, setCalDavPassword] = useState('')
  const [cursorDate, setCursorDate] = useState(() => new Date())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const undoStack = useRef<CalendarEvent[][]>([])

  const setConfig = useCallback((patch: Partial<CalendarNodeConfig>) => updateNodeData(id, { calendarConfig: { ...config, ...patch } }), [config, id, updateNodeData])
  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const [nextAccounts, nextSources] = await Promise.all([api.calendar.accounts(), api.calendar.calendars(config.accountId, config.provider)])
      setAccounts(nextAccounts)
      setSources(nextSources)
    } catch { setStatus(vocab('Calendar catalog is unavailable. Existing local cache remains available.')) }
  }, [api.calendar, config.accountId, config.provider, vocab])
  useEffect(() => { void loadCatalog() }, [loadCatalog])

  useEffect(() => {
    let cancelled = false
    void api.calendar.events(id, config).then((cache) => {
      if (cancelled || cache.events.length === 0) return
      setEvents(cache.events)
      saveCached(id, cache.events)
      setStatus(cache.state === 'stale' || cache.state === 'offline' ? vocab('Showing the last valid offline cache.') : vocab('Calendar cache loaded.'))
    }).catch(() => {
      if (!cancelled) setStatus(vocab('Calendar cache could not be read. Existing browser cache remains available.'))
    })
    return () => { cancelled = true }
  }, [api.calendar, config.accountId, config.cacheEnabled, config.calendarId, config.provider, config.showWeekends, config.timezone, config.view, id, vocab])

  useEffect(() => {
    if (config.provider === 'local' || config.provider === 'ics') return
    const account = accounts.find((a) => a.id === config.accountId)
    if (!account) setStatus(vocab('Choose a connected account. The account list is empty when no vault binding exists.'))
  }, [accounts, config.accountId, config.provider, vocab])

  const filtered = useMemo(() => events.filter((event) => search.test(`${event.title} ${event.location ?? ''} ${event.description ?? ''}`)).sort((a, b) => a.start.localeCompare(b.start)), [events, search])
  const viewEvents = useMemo(() => {
    if (config.view === 'agenda') return filtered
    const start = new Date(cursorDate)
    if (config.view === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0) }
    else { const day = start.getDay(); start.setDate(start.getDate() - (day === 0 ? 6 : day - 1)); start.setHours(0, 0, 0, 0) }
    const end = new Date(start)
    if (config.view === 'month') end.setMonth(end.getMonth() + 1)
    else end.setDate(end.getDate() + 7)
    const inRange = filtered.filter((event) => new Date(event.start) < end && new Date(event.end) >= start)
    return config.showWeekends ? inRange : inRange.filter((event) => { const day = new Date(event.start).getDay(); return day !== 0 && day !== 6 })
  }, [config.showWeekends, config.view, cursorDate, filtered])
  const updateEvents = (next: CalendarEvent[]): void => { undoStack.current = [...undoStack.current.slice(-19), events]; setEvents(next); saveCached(id, next) }
  const undo = (): void => { const prior = undoStack.current.pop(); if (!prior) return; setEvents(prior); saveCached(id, prior); setStatus(vocab('Restored the previous local calendar revision.')) }
  const exportEvents = async (): Promise<void> => {
    const chosen = viewEvents.filter((event) => selectedIds.has(event.id))
    const payload = { schemaVersion: 1, exportedRange: config.view, events: chosen.length ? chosen : viewEvents, omitted: ['provider credentials', 'OAuth state', 'source paths'] }
    await api.export.saveText('calendar-events.json', JSON.stringify(payload, null, 2), 'application/json')
    const count = chosen.length || viewEvents.length
    setStatus(mapOwnedSentence(vocab, [fact(String(count)), copy(` event${count === 1 ? '' : 's'} exported. Credentials and source paths were omitted.`)]))
  }

  const importFile = async (): Promise<void> => {
    const path = await api.dialog.selectFile()
    if (!path) return
    setBusy(true)
    try {
      const text = await api.fs.read(path)
      const imported = await api.calendar.importIcs(id, text, path.split(/[\\/]/).pop() || 'Imported ICS file')
      updateEvents(imported.events)
      setConfig({ provider: 'ics', calendarId: `ics-${id}` })
      setStatus(mapOwnedSentence(vocab, [fact(String(imported.events.length)), copy(` event${imported.events.length === 1 ? '' : 's'} imported locally. The source path was not saved.`)]))
    } catch (error) {
      setStatus(mapOwnedSentence(vocab, [copy('ICS import was not applied: '), fact(error instanceof Error ? error.message : 'the file could not be read'), copy('.')]))
    }
    finally { setBusy(false) }
  }

  const connect = async (): Promise<void> => {
    if (config.provider === 'local' || config.provider === 'ics') return
    if (config.provider === 'caldav') {
      setBusy(true)
      try {
        const connected = await api.calendar.connectCalDav({ displayName: calDavName, email: null, endpoint: calDavEndpoint, username: calDavUsername, password: calDavPassword })
        setCalDavPassword('')
        setConfig({ accountId: connected.id, calendarId: null })
        await loadCatalog()
        setStatus(vocab('CalDAV account connected. Choose one of its calendars.'))
      } catch (error) { setStatus(mapOwnedSentence(vocab, [copy('CalDAV account was not connected: '), fact(error instanceof Error ? error.message : 'the provider refused the connection'), copy('.')])) }
      finally { setBusy(false) }
      return
    }
    const result = await api.calendar.beginOAuth(config.provider)
    if (result.state === 'ready' && result.authorizationUrl) {
      await api.shell.openExternal(result.authorizationUrl)
      setStatus(vocab('Complete consent in the provider window, then refresh the account list. Tokens stay in machine-local credential storage.'))
    } else setStatus(result.reason ?? vocab('This provider is unavailable.'))
  }

  const disconnect = (target: HTMLButtonElement): void => {
    if (!account) return
    const rect = target.getBoundingClientRect()
    openDestructiveGate({ title: vocab('Disconnect this calendar account'), description: mapOwnedSentence(vocab, [copy('Remove the machine-local binding for “'), fact(account.displayName), copy('”. Cached events remain available until replaced.')]), affected: [account.displayName], confirmLabel: vocab('Disconnect account'), anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: target, onConfirm: () => { void api.calendar.disconnectAccount(account.id).then(async (removed) => { if (removed) { setConfig({ accountId: null, calendarId: null }); await loadCatalog() }; setStatus(removed ? vocab('Calendar account disconnected. Cached events were retained.') : vocab('The account was already disconnected.')) }).catch(() => setStatus(vocab('The account could not be disconnected.'))) } })
  }

  const createEvent = async (event: CalendarEvent): Promise<void> => {
    setBusy(true)
    try { const saved = await api.calendar.create({ nodeId: id, event }); updateEvents([...events.filter((e) => e.id !== saved.id), saved]); setEditing(undefined); setStatus(vocab('Event created in the selected calendar.')) }
    catch { updateEvents([...events, event]); setEditing(undefined); setStatus(vocab('The provider did not confirm the write. The event is kept in the offline cache and is not reported as synced.')) }
    finally { setBusy(false) }
  }
  const updateEvent = async (event: CalendarEvent): Promise<void> => {
    setBusy(true)
    try { const saved = await api.calendar.update({ nodeId: id, eventId: event.id, event }); updateEvents(events.map((e) => e.id === event.id ? (saved ?? e) : e)); setEditing(undefined); setStatus(saved ? vocab('Event changes confirmed by the selected calendar.') : vocab('The selected calendar did not confirm the change; the cache was left unchanged.')) }
    catch { setStatus(vocab('The provider did not confirm the edit. The offline cache was left unchanged.')) }
    finally { setBusy(false) }
  }
  const removeEvent = (event: CalendarEvent, target: HTMLButtonElement): void => {
    const rect = target.getBoundingClientRect()
    openDestructiveGate({ title: vocab('Delete this calendar event'), description: mapOwnedSentence(vocab, [copy('Permanently delete “'), fact(event.title), copy('” from the selected calendar.')]), affected: [event.title], confirmLabel: vocab('Delete event'), anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: target, onConfirm: () => { void api.calendar.remove(id, event.id).then((ok) => { if (ok) updateEvents(events.filter((e) => e.id !== event.id)); setStatus(ok ? vocab('Event deleted.') : vocab('The provider did not confirm deletion; no event was removed from the cache.')) }).catch(() => setStatus(vocab('Deletion was not confirmed by the provider; the cache remains unchanged.'))) } })
  }

  const account = accounts.find((a) => a.id === config.accountId)
  const source = sources.find((s) => s.id === config.calendarId)
  return <div className={`term-node calendar-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }} aria-label={mapOwnedSentence(vocab, [copy('Calendar node: '), fact(String(data.title || 'Calendar'))])}>
    <NodeResizer minWidth={420} minHeight={360} isVisible={selected} color={data.color} />
    <div className="term-node__header" style={{ background: `${data.color}22` }}><IconCalendar /><span className="calendar-node__title">{data.title || vocab('Calendar')}</span><span className="term-node__spacer" /><span className="calendar-node__state" role="status">{busy ? vocab('Working…') : status}</span></div>
    <Tablist className="calendar-node__toolbar" ariaLabel={vocab('Calendar views')}>{(['agenda', 'week', 'month'] as CalendarView[]).map((view) => <Chip vocabularyMode="factual" selected={config.view === view} key={view} id={`${id}-tab-${view}`} role="tab" aria-selected={config.view === view} aria-controls={`${id}-panel-${view}`} tabIndex={config.view === view ? 0 : -1} onClick={() => setConfig({ view })}>{vocab(view[0].toUpperCase() + view.slice(1))}</Chip>)}</Tablist>
    <div className="calendar-node__body">
      <div className="calendar-node__filters"><label>{vocab('Search events')}<Input vocabularyMode="factual" ref={searchInputRef} value={search.value} onChange={(e) => search.setValue(e.target.value)} placeholder={vocab('Plain text search')} aria-label={vocab('Search calendar events')} /></label><AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label={vocab('Regex for calendar events')} /></div>
      <div className="calendar-node__source"><label>{vocab('Source')}<Select vocabularyMode="factual" value={config.provider} aria-label={vocab('Calendar source')} onChange={(e) => { const provider = e.target.value as CalendarProvider; setConfig({ provider, accountId: null, calendarId: null }); setEvents(provider === 'local' ? readCached(id) : []); setStatus(vocab(providerHelp[provider])) }}>{PROVIDERS.filter((provider) => sourceSearch.test(calendarProviderName(provider))).map((provider) => <option key={provider} value={provider}>{calendarProviderName(provider)}</option>)}</Select><div className="calendar-node__picker-search"><Input vocabularyMode="factual" ref={sourceSearchRef} value={sourceSearch.value} onChange={(e) => sourceSearch.setValue(e.target.value)} placeholder={vocab('Filter sources')} aria-label={vocab('Filter calendar sources')} /><AnchoredRegexBuilder search={sourceSearch} fieldRef={sourceSearchRef} label={vocab('Regex for calendar sources')} /></div></label><p className="calendar-node__hint">{vocab(providerHelp[config.provider])}</p>
        {(config.provider === 'ics') && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void importFile()} disabled={busy}>{vocab('Choose local ICS file…')}</Button>}
        {config.provider === 'caldav' && !config.accountId && <div className="calendar-node__editor" role="region" aria-label={vocab('Connect CalDAV account')}><h3>{vocab('Connect CalDAV')}</h3><label>{vocab('Account name')}<Input vocabularyMode="factual" value={calDavName} aria-label={vocab('Account name')} onChange={(event) => setCalDavName(event.target.value)} /></label><label>{vocab('HTTPS server URL')}<Input vocabularyMode="factual" type="url" value={calDavEndpoint} aria-label={vocab('HTTPS server URL')} onChange={(event) => setCalDavEndpoint(event.target.value)} placeholder="https://calendar.example.com/dav/" /></label><label>{vocab('Username')}<Input vocabularyMode="factual" autoComplete="username" value={calDavUsername} aria-label={vocab('Username')} onChange={(event) => setCalDavUsername(event.target.value)} /></label><label>{vocab('Password')}<Input vocabularyMode="factual" type="password" autoComplete="current-password" value={calDavPassword} aria-label={vocab('Password')} onChange={(event) => setCalDavPassword(event.target.value)} /></label><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void connect()} disabled={busy || !calDavName.trim() || !calDavEndpoint.trim() || !calDavUsername.trim() || !calDavPassword}>{vocab('Connect and verify')}</Button><p className="calendar-node__hint">{vocab('The endpoint must use HTTPS. The password is sent once to the host and never stored in the project.')}</p></div>}
        {config.provider !== 'local' && config.provider !== 'ics' && <><label>{vocab('Account')}<Select vocabularyMode="factual" value={config.accountId ?? ''} aria-label={vocab('Calendar account')} onChange={(event) => setConfig({ accountId: event.target.value || null, calendarId: null })}><option value="">{vocab('Choose an account…')}</option>{accounts.filter((candidate) => candidate.provider === config.provider && accountSearch.test(`${candidate.displayName} ${candidate.email ?? ''}`)).map((candidate) => <option key={candidate.id} value={candidate.id}>{fact(`${candidate.displayName}${candidate.email ? ` · ${candidate.email}` : ''} (${candidate.state})`).text}</option>)}</Select><div className="calendar-node__picker-search"><Input vocabularyMode="factual" ref={accountSearchRef} value={accountSearch.value} onChange={(event) => accountSearch.setValue(event.target.value)} placeholder={vocab('Filter accounts')} aria-label={vocab('Filter calendar accounts')} /><AnchoredRegexBuilder search={accountSearch} fieldRef={accountSearchRef} label={vocab('Regex for calendar accounts')} /></div></label>{config.provider !== 'caldav' && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void connect()} disabled={busy}>{vocab('Connect another account…')}</Button>}<Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void loadCatalog()} disabled={busy}>{vocab('Refresh accounts')}</Button>{account && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={(event) => disconnect(event.currentTarget)} disabled={busy}>{vocab('Disconnect account…')}</Button>}</>}
        {config.provider !== 'local' && config.provider !== 'ics' && <label>{vocab('Calendar')}<Select vocabularyMode="factual" value={config.calendarId ?? ''} aria-label={vocab('Provider calendar')} onChange={(e) => setConfig({ calendarId: e.target.value || null })}><option value="">{vocab('Choose a calendar…')}</option>{sources.filter((candidate) => calendarSearch.test(`${candidate.name} ${candidate.timezone}`)).map((candidate) => <option key={candidate.id} value={candidate.id}>{fact(`${candidate.name} · ${candidate.timezone}${candidate.readOnly ? ' (read only)' : ''}`).text}</option>)}</Select><div className="calendar-node__picker-search"><Input vocabularyMode="factual" ref={calendarSearchRef} value={calendarSearch.value} onChange={(event) => calendarSearch.setValue(event.target.value)} placeholder={vocab('Filter calendars')} aria-label={vocab('Filter provider calendars')} /><AnchoredRegexBuilder search={calendarSearch} fieldRef={calendarSearchRef} label={vocab('Regex for provider calendars')} /></div></label>}
        {account && <p className="calendar-node__hint">{mapOwnedSentence(vocab, [copy('Account status: '), fact(account.state), account.reason ? copy(' — ') : copy(''), fact(account.reason ?? ''), copy('. Credential value is never shown.')])}</p>}{source && <p className="calendar-node__hint">{mapOwnedSentence(vocab, [copy('Selected calendar: '), fact(source.name), copy('; writes are '), fact(source.writable ? 'available' : 'disabled because this calendar is read only'), copy('.')])}</p>}
      </div>
      <div className="calendar-node__row"><label>{vocab('Timezone')}<Select vocabularyMode="factual" value={config.timezone} onChange={(e) => setConfig({ timezone: e.target.value })} aria-label={vocab('Calendar timezone')}>{calendarTimezones().filter((value) => timezoneSearch.test(value)).map((value) => <option key={value} value={value}>{fact(value === 'local' ? 'This computer' : value).text}</option>)}</Select><div className="calendar-node__picker-search"><Input vocabularyMode="factual" ref={timezoneSearchRef} value={timezoneSearch.value} onChange={(e) => timezoneSearch.setValue(e.target.value)} placeholder={vocab('Filter timezones')} aria-label={vocab('Filter calendar timezones')} /><AnchoredRegexBuilder search={timezoneSearch} fieldRef={timezoneSearchRef} label={vocab('Regex for calendar timezones')} /></div></label><label className="calendar-node__check"><Checkbox vocabularyMode="factual" checked={config.showWeekends} onChange={(e) => setConfig({ showWeekends: e.target.checked })} /> {vocab('Show weekends')}</label></div>
      <div className="calendar-node__actions"><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => setCursorDate((d) => { const n = new Date(d); if (config.view === 'week') n.setDate(n.getDate() - 7); else if (config.view === 'month') n.setMonth(n.getMonth() - 1); else n.setDate(n.getDate() - 1); return n })} aria-label={vocab('Previous period')}>{vocab('Previous')}</Button><strong>{config.view === 'agenda' ? vocab('Agenda') : fact(cursorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })).text}</strong><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => setCursorDate((d) => { const n = new Date(d); if (config.view === 'week') n.setDate(n.getDate() + 7); else if (config.view === 'month') n.setMonth(n.getMonth() + 1); else n.setDate(n.getDate() + 1); return n })} aria-label={vocab('Next period')}>{vocab('Next')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => setEditing(null)} disabled={config.provider !== 'local' && config.provider !== 'ics' && !source?.writable}>{vocab('Create event')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void api.calendar.refresh(id, config).then((cache) => { updateEvents(cache.events); setStatus(cache.state === 'offline' ? cache.reason ?? 'Offline cache is in use.' : vocab('Calendar refreshed.')) }).catch(() => setStatus(vocab('Refresh failed. The existing cache remains available.')))}>{vocab('Refresh')}</Button></div>
      <div id={`${id}-panel-${config.view}`} role="tabpanel" aria-labelledby={`${id}-tab-${config.view}`} tabIndex={0}><p className="calendar-node__cache" role="status">{mapOwnedSentence(vocab, [fact(String(viewEvents.length)), copy(` visible event${viewEvents.length === 1 ? '' : 's'} · `), fact(String(selectedIds.size)), copy(' selected · '), fact(config.cacheEnabled ? 'offline cache enabled' : 'offline cache disabled')])}</p>
      <div className="calendar-node__actions"><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void exportEvents()}>{vocab('Export visible or selected')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={undo} disabled={undoStack.current.length === 0}>{vocab('Undo local change')}</Button></div>
      {editing !== undefined ? <EventEditor nodeId={id} timezone={config.timezone} initial={editing ?? undefined} onCancel={() => setEditing(undefined)} onSave={(event) => editing ? void updateEvent(event) : void createEvent(event)} /> : <div className={`calendar-node__events calendar-node__events--${config.view}`} role="list" aria-label={mapOwnedSentence(vocab, [fact(config.view), copy(' calendar events')])}>{viewEvents.length === 0 ? <p className="calendar-node__empty">{vocab('No events match this view. Select a source or import an ICS file.')}</p> : viewEvents.map((event) => <article key={event.id} role="listitem" className="calendar-node__event"><div><label className="calendar-node__event-select"><Checkbox vocabularyMode="factual" checked={selectedIds.has(event.id)} onChange={(e) => setSelectedIds((current) => { const next = new Set(current); if (e.target.checked) next.add(event.id); else next.delete(event.id); return next })} aria-label={mapOwnedSentence(vocab, [copy('Select '), fact(event.title)])} /><strong>{fact(event.title).text}</strong></label><span>{fact(dateLabel(event.start, config.timezone, event.allDay)).text} {vocab('to')} {fact(dateLabel(event.end, config.timezone, event.allDay)).text}</span>{event.recurrence && <small>{mapOwnedSentence(vocab, [copy('Repeats: '), fact(event.recurrence)])}</small>}{event.location && <small>{fact(event.location).text}</small>}</div><div className="calendar-node__event-actions"><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => setEditing(event)} disabled={config.provider !== 'local' && config.provider !== 'ics' ? !source?.writable : false}>{vocab('Edit')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={(e) => removeEvent(event, e.currentTarget)} disabled={config.provider !== 'local' && config.provider !== 'ics' ? !source?.writable : false}>{vocab('Delete')}</Button></div></article>)}</div>}</div>
    </div>
  </div>
}
