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

function EventEditor({ nodeId, timezone, initial, onSave, onCancel }: { nodeId: string; timezone: string; initial?: CalendarEvent; onSave: (event: CalendarEvent) => void; onCancel: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [start, setStart] = useState((initial?.start ?? '').slice(0, 16))
  const [end, setEnd] = useState((initial?.end ?? '').slice(0, 16))
  const [location, setLocation] = useState(initial?.location ?? '')
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? '')
  const valid = title.trim().length > 0 && !!start && !!end && new Date(end).valueOf() > new Date(start).valueOf()
  return <div className="calendar-node__editor" role="region" aria-label={initial ? 'Edit calendar event' : 'Create calendar event'}>
    <h3>{initial ? 'Edit event' : 'Create event'}</h3>
    <p className="calendar-node__hint">Times use {timezone === 'local' ? 'this computer’s timezone' : timezone}. Review the preview before saving.</p>
    <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></label>
    <div className="calendar-node__two-col"><label>Starts<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>Ends<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
    <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
    <label>Recurrence rule (optional)<input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO" /></label>
    {!valid && <p className="calendar-node__error" role="alert">Enter a title and an end time after the start time.</p>}
    <div className="calendar-node__actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" disabled={!valid} onClick={() => onSave({ id: initial?.id ?? `local-${Date.now().toString(36)}`, calendarId: initial?.calendarId ?? 'local', title: title.trim(), start: new Date(start).toISOString(), end: new Date(end).toISOString(), timezone, allDay: false, location: location.trim() || null, description: null, recurrence: recurrence.trim() || null, updatedAt: Date.now() })}>{initial ? 'Save changes' : 'Create event'}</button></div>
  </div>
}

export default function CalendarNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { api } = useSession()
  const { updateNodeData } = useReactFlow()
  const config = validateCalendarConfig(data.calendarConfig ?? DEFAULT_CALENDAR_NODE_CONFIG)
  const [accounts, setAccounts] = useState<CalendarAccount[]>([])
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>(() => readCached(id))
  const [status, setStatus] = useState('Ready to choose a calendar.')
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sourceSearch = useRegexSearchField()
  const sourceSearchRef = useRef<HTMLSelectElement>(null)
  const timezoneSearch = useRegexSearchField()
  const timezoneSearchRef = useRef<HTMLSelectElement>(null)
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [cursorDate, setCursorDate] = useState(() => new Date())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const undoStack = useRef<CalendarEvent[][]>([])

  const setConfig = useCallback((patch: Partial<CalendarNodeConfig>) => updateNodeData(id, { calendarConfig: { ...config, ...patch } }), [config, id, updateNodeData])
  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const [nextAccounts, nextSources] = await Promise.all([api.calendar.accounts(), api.calendar.calendars(config.accountId, config.provider)])
      setAccounts(nextAccounts)
      setSources(nextSources)
    } catch { setStatus('Calendar catalog is unavailable. Existing local cache remains available.') }
  }, [api.calendar, config.accountId, config.provider])
  useEffect(() => { void loadCatalog() }, [loadCatalog])

  useEffect(() => {
    let cancelled = false
    void api.calendar.events(id, config).then((cache) => {
      if (cancelled || cache.events.length === 0) return
      setEvents(cache.events)
      saveCached(id, cache.events)
      setStatus(cache.state === 'stale' || cache.state === 'offline' ? 'Showing the last valid offline cache.' : 'Calendar cache loaded.')
    }).catch(() => {
      if (!cancelled) setStatus('Calendar cache could not be read. Existing browser cache remains available.')
    })
    return () => { cancelled = true }
  }, [api.calendar, config.accountId, config.cacheEnabled, config.calendarId, config.provider, config.showWeekends, config.timezone, config.view, id])

  useEffect(() => {
    if (config.provider === 'local' || config.provider === 'ics') return
    const account = accounts.find((a) => a.id === config.accountId)
    if (!account) setStatus('Choose a connected account. The account list is empty when no vault binding exists.')
  }, [accounts, config.accountId, config.provider])

  const filtered = useMemo(() => events.filter((event) => search.test(`${event.title} ${event.location ?? ''} ${event.description ?? ''}`)).sort((a, b) => a.start.localeCompare(b.start)), [events, search])
  const viewEvents = useMemo(() => {
    if (config.view === 'agenda') return filtered
    const start = new Date(cursorDate)
    if (config.view === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0) }
    else { const day = start.getDay(); start.setDate(start.getDate() - (day === 0 ? 6 : day - 1)); start.setHours(0, 0, 0, 0) }
    const end = new Date(start)
    if (config.view === 'month') end.setMonth(end.getMonth() + 1)
    else end.setDate(end.getDate() + 7)
    return filtered.filter((event) => new Date(event.start) < end && new Date(event.end) >= start)
  }, [config.view, cursorDate, filtered])
  const updateEvents = (next: CalendarEvent[]): void => { undoStack.current = [...undoStack.current.slice(-19), events]; setEvents(next); saveCached(id, next) }
  const undo = (): void => { const prior = undoStack.current.pop(); if (!prior) return; setEvents(prior); saveCached(id, prior); setStatus('Restored the previous local calendar revision.') }
  const exportEvents = async (): Promise<void> => {
    const chosen = viewEvents.filter((event) => selectedIds.has(event.id))
    const payload = { schemaVersion: 1, exportedRange: config.view, events: chosen.length ? chosen : viewEvents, omitted: ['provider credentials', 'OAuth state', 'source paths'] }
    await api.export.saveText('calendar-events.json', JSON.stringify(payload, null, 2), 'application/json')
    setStatus(`${chosen.length || viewEvents.length} event${(chosen.length || viewEvents.length) === 1 ? '' : 's'} exported. Credentials and source paths were omitted.`)
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
      setStatus(`${imported.events.length} event${imported.events.length === 1 ? '' : 's'} imported locally. The source path was not saved.`)
    } catch (error) { setStatus(`ICS import was not applied: ${error instanceof Error ? error.message : 'the file could not be read'}.`) }
    finally { setBusy(false) }
  }

  const connect = async (): Promise<void> => {
    if (config.provider === 'local' || config.provider === 'ics') return
    const result = await api.calendar.beginOAuth(config.provider)
    if (result.state === 'ready' && result.authorizationUrl) {
      await api.shell.openExternal(result.authorizationUrl)
      setStatus('Consent is required in the provider window. Tokens are captured by the trusted shell and kept in the OS vault.')
    } else setStatus(result.reason ?? 'This provider is unavailable.')
  }

  const createEvent = async (event: CalendarEvent): Promise<void> => {
    setBusy(true)
    try { const saved = await api.calendar.create({ nodeId: id, event }); updateEvents([...events.filter((e) => e.id !== saved.id), saved]); setEditing(undefined); setStatus('Event created in the selected calendar.') }
    catch { updateEvents([...events, event]); setEditing(undefined); setStatus('The provider did not confirm the write. The event is kept in the offline cache and is not reported as synced.') }
    finally { setBusy(false) }
  }
  const updateEvent = async (event: CalendarEvent): Promise<void> => {
    setBusy(true)
    try { const saved = await api.calendar.update({ nodeId: id, eventId: event.id, event }); updateEvents(events.map((e) => e.id === event.id ? (saved ?? e) : e)); setEditing(undefined); setStatus(saved ? 'Event changes confirmed by the selected calendar.' : 'The selected calendar did not confirm the change; the cache was left unchanged.') }
    catch { setStatus('The provider did not confirm the edit. The offline cache was left unchanged.') }
    finally { setBusy(false) }
  }
  const removeEvent = (event: CalendarEvent, target: HTMLButtonElement): void => {
    const rect = target.getBoundingClientRect()
    openDestructiveGate({ title: 'Delete this calendar event', description: `Permanently delete “${event.title}” from the selected calendar.`, affected: [event.title], confirmLabel: 'Delete event', anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: target, onConfirm: () => { void api.calendar.remove(id, event.id).then((ok) => { if (ok) updateEvents(events.filter((e) => e.id !== event.id)); setStatus(ok ? 'Event deleted.' : 'The provider did not confirm deletion; no event was removed from the cache.') }).catch(() => setStatus('Deletion was not confirmed by the provider; the cache remains unchanged.')) } })
  }

  const account = accounts.find((a) => a.id === config.accountId)
  const source = sources.find((s) => s.id === config.calendarId)
  return <div className={`term-node calendar-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
    <NodeResizer minWidth={420} minHeight={360} isVisible={selected} color={data.color} />
    <div className="term-node__header" style={{ background: `${data.color}22` }}><IconCalendar /><span className="calendar-node__title">{data.title || 'Calendar'}</span><span className="term-node__spacer" /><span className="calendar-node__state" role="status">{busy ? 'Working…' : status}</span></div>
    <div className="calendar-node__toolbar" role="tablist" aria-label="Calendar views">{(['agenda', 'week', 'month'] as CalendarView[]).map((view) => <button key={view} id={`${id}-tab-${view}`} role="tab" aria-selected={config.view === view} aria-controls={`${id}-panel-${view}`} tabIndex={config.view === view ? 0 : -1} onClick={() => setConfig({ view })}>{view[0].toUpperCase() + view.slice(1)}</button>)}</div>
    <div className="calendar-node__body">
      <div className="calendar-node__filters"><label>Search events<input ref={searchInputRef} value={search.value} onChange={(e) => search.setValue(e.target.value)} placeholder="Plain text search" aria-label="Search calendar events" /></label><AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex for calendar events" /></div>
      <div className="calendar-node__source"><label>Source<select ref={sourceSearchRef} value={config.provider} onChange={(e) => { const provider = e.target.value as CalendarProvider; setConfig({ provider, accountId: null, calendarId: null }); setEvents(provider === 'local' ? readCached(id) : []); setStatus(providerHelp[provider]) }}>{PROVIDERS.filter((provider) => sourceSearch.test(calendarProviderName(provider))).map((provider) => <option key={provider} value={provider} disabled={provider !== 'local' && provider !== 'ics'}>{calendarProviderName(provider)}{provider !== 'local' && provider !== 'ics' ? ' (unavailable)' : ''}</option>)}</select><div className="calendar-node__picker-search"><input value={sourceSearch.value} onChange={(e) => sourceSearch.setValue(e.target.value)} placeholder="Filter sources" aria-label="Filter calendar sources" /><AnchoredRegexBuilder search={sourceSearch} fieldRef={sourceSearchRef} label="Regex for calendar sources" /></div></label><p className="calendar-node__hint">{providerHelp[config.provider]}</p>
        {(config.provider === 'ics') && <button type="button" onClick={() => void importFile()} disabled={busy}>Choose local ICS file…</button>}
        {config.provider !== 'local' && config.provider !== 'ics' && <><label>Account<select value={config.accountId ?? ''} disabled><option value="">No trusted account adapter available</option>{accounts.filter((a) => a.provider === config.provider).map((a) => <option key={a.id} value={a.id}>{a.displayName}{a.email ? ` · ${a.email}` : ''} ({a.state})</option>)}</select></label><button type="button" onClick={() => void connect()} disabled>Connect account unavailable</button><p className="calendar-node__error" role="alert">Remote provider actions are disabled until a trusted OAuth/PKCE adapter is installed.</p></>}
        {config.provider !== 'local' && config.provider !== 'ics' && <label>Calendar<select value={config.calendarId ?? ''} onChange={(e) => setConfig({ calendarId: e.target.value || null })}><option value="">Choose a calendar…</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.timezone}{s.readOnly ? ' (read only)' : ''}</option>)}</select></label>}
        {account && <p className="calendar-node__hint">Account status: {account.state}{account.reason ? ` — ${account.reason}` : ''}. Credential value is never shown.</p>}{source && <p className="calendar-node__hint">Selected calendar: {source.name}; writes are {source.writable ? 'available' : 'disabled because this calendar is read only'}.</p>}
      </div>
      <div className="calendar-node__row"><label>Timezone<select ref={timezoneSearchRef} value={config.timezone} onChange={(e) => setConfig({ timezone: e.target.value })} aria-label="Calendar timezone">{calendarTimezones().filter((value) => timezoneSearch.test(value)).map((value) => <option key={value} value={value}>{value === 'local' ? 'This computer' : value}</option>)}</select><div className="calendar-node__picker-search"><input value={timezoneSearch.value} onChange={(e) => timezoneSearch.setValue(e.target.value)} placeholder="Filter timezones" aria-label="Filter calendar timezones" /><AnchoredRegexBuilder search={timezoneSearch} fieldRef={timezoneSearchRef} label="Regex for calendar timezones" /></div></label><label className="calendar-node__check"><input type="checkbox" checked={config.showWeekends} onChange={(e) => setConfig({ showWeekends: e.target.checked })} /> Show weekends</label></div>
      <div className="calendar-node__actions"><button type="button" onClick={() => setCursorDate((d) => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n })} aria-label="Previous period">Previous</button><strong>{config.view === 'agenda' ? 'Agenda' : cursorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><button type="button" onClick={() => setCursorDate((d) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n })} aria-label="Next period">Next</button><button type="button" onClick={() => setEditing(null)} disabled={config.provider !== 'local' && config.provider !== 'ics' && !source?.writable}>Create event</button><button type="button" onClick={() => void api.calendar.refresh(id, config).then((cache) => { updateEvents(cache.events); setStatus(cache.state === 'offline' ? cache.reason ?? 'Offline cache is in use.' : 'Calendar refreshed.') }).catch(() => setStatus('Refresh failed. The existing cache remains available.'))}>Refresh</button></div>
      <div id={`${id}-panel-${config.view}`} role="tabpanel" aria-labelledby={`${id}-tab-${config.view}`} tabIndex={0}><p className="calendar-node__cache" role="status">{viewEvents.length} visible event{viewEvents.length === 1 ? '' : 's'} · {selectedIds.size} selected · {config.cacheEnabled ? 'offline cache enabled' : 'offline cache disabled'}</p>
      <div className="calendar-node__actions"><button type="button" onClick={() => void exportEvents()}>Export visible or selected</button><button type="button" onClick={undo} disabled={undoStack.current.length === 0}>Undo local change</button></div>
      {editing !== undefined ? <EventEditor nodeId={id} timezone={config.timezone} initial={editing ?? undefined} onCancel={() => setEditing(undefined)} onSave={(event) => editing ? void updateEvent(event) : void createEvent(event)} /> : <div className={`calendar-node__events calendar-node__events--${config.view}`} role="list" aria-label={`${config.view} calendar events`}>{viewEvents.length === 0 ? <p className="calendar-node__empty">No events match this view. Select a source or import an ICS file.</p> : viewEvents.map((event) => <article key={event.id} role="listitem" className="calendar-node__event"><div><label className="calendar-node__event-select"><input type="checkbox" checked={selectedIds.has(event.id)} onChange={(e) => setSelectedIds((current) => { const next = new Set(current); if (e.target.checked) next.add(event.id); else next.delete(event.id); return next })} aria-label={`Select ${event.title}`} /><strong>{event.title}</strong></label><span>{dateLabel(event.start, config.timezone, event.allDay)} to {dateLabel(event.end, config.timezone, event.allDay)}</span>{event.recurrence && <small>Repeats: {event.recurrence}</small>}{event.location && <small>{event.location}</small>}</div><div className="calendar-node__event-actions"><button type="button" onClick={() => setEditing(event)} disabled={!!source && !source.writable}>Edit</button><button type="button" onClick={(e) => removeEvent(event, e.currentTarget)} disabled={!!source && !source.writable}>Delete</button></div></article>)}</div>}</div>
    </div>
  </div>
}
