import { useEffect, useMemo, useRef, useState } from 'react'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Switch } from '@renderer/ui/Switch'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { notify } from '@renderer/lib/adhdNotify'
import type { PlannerFile, PlannerOccurrence, PlannerSchedule, PlannerWeekday } from '@shared/planner-occurrences'

const ROWS = {
  schedules: {
    title: 'Planner schedules',
    description: 'Create durable local notifications that continue while this window is closed.',
    keywords: ['planner', 'schedule', 'alarm', 'timer', 'recurrence', 'timezone', 'DST', 'missed', 'notification', 'export']
  }
}
const ENTRIES = Object.values(ROWS)

function localDateTime(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function timeZoneChoices(): string[] {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const values = supported?.('timeZone') ?? []
  const current = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  return Array.from(new Set([current, 'UTC', ...values])).sort()
}

function freshSchedule(): PlannerSchedule {
  const id = `planner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    title: 'New planner reminder',
    enabled: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    startLocal: localDateTime(),
    recurrence: { kind: 'once' },
    notification: { title: 'Planner reminder', body: 'Your scheduled planner occurrence is due.' }
  }
}

export function PlannerSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const [file, setFile] = useState<PlannerFile | null>(null)
  const [history, setHistory] = useState<PlannerOccurrence[]>([])
  const [draft, setDraft] = useState<PlannerSchedule>(() => freshSchedule())
  const [error, setError] = useState<string | null>(null)
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const zones = useMemo(() => timeZoneChoices(), [])
  const planner = window.nodeTerminal?.planner

  useEffect(() => {
    if (!planner) {
      setError('Planner is unavailable on this surface.')
      return
    }
    let mounted = true
    void planner.load().then((state) => {
      if (!mounted) return
      if (state.ok) setFile(state.file)
      else setError(`${state.error.message} Repair ${state.error.path} and restart before saving.`)
    }).catch(() => mounted && setError('Planner data could not be loaded.'))
    void planner.history().then((items) => mounted && setHistory(items)).catch(() => undefined)
    const unsubscribe = planner.onOccurrence((occurrence) => {
      if (!mounted) return
      setHistory((items) => [...items, occurrence].slice(-2_000))
      notify({ kind: 'info', title: occurrence.title, body: occurrence.body })
    })
    return () => { mounted = false; unsubscribe() }
  }, [planner])

  const saveFile = (next: PlannerFile): void => {
    if (!planner) {
      setError('Planner is unavailable on this surface.')
      return
    }
    setFile(next)
    setError(null)
    void planner.save(next).then((result) => {
      if (!result.ok) setError(result.error)
    }).catch(() => setError('Planner data could not be saved.'))
  }

  const addSchedule = (): void => {
    if (!file) return
    saveFile({ ...file, schedules: [...file.schedules, draft] })
    setDraft(freshSchedule())
  }

  const updateSchedule = (schedule: PlannerSchedule, patch: Partial<PlannerSchedule>): void => {
    if (!file) return
    saveFile({ ...file, schedules: file.schedules.map((item) => item.id === schedule.id ? { ...item, ...patch } : item) })
  }

  const visible = (file?.schedules ?? []).filter((schedule) => search.test(`${schedule.title} ${schedule.notification.title} ${schedule.notification.body} ${schedule.recurrence.kind} ${schedule.timeZone}`))
  return (
    <SettingsSection id="planner" title="Planner" description="Durable local planner occurrences run while the computer is available, even after this window closes. A powered-off computer cannot wake or evaluate time; overdue entries are recorded as missed when the app starts again." isActive={isActive} searchEntries={ENTRIES}>
      <SearchableRow {...ROWS.schedules}>
        <div className="space-y-5">
          <div className="flex items-end gap-3">
            <label className="min-w-0 flex-1 text-sm font-medium">Search planner schedules
              <input ref={searchInputRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} className="mt-1 w-full rounded-xl border border-outline/50 bg-surface px-3 py-2" placeholder="Plain text search" aria-label="Search planner schedules" />
            </label>
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex builder for planner schedules" />
          </div>
          {search.error ? <p className="text-sm text-[color:var(--caution)]" role="alert">{search.error}</p> : null}
          {error ? <p className="text-sm text-[color:var(--caution)]" role="alert">{error}</p> : null}
          <p className="text-xs text-text-muted">The host checks this durable file every few seconds. DST repeated times fire once at the earliest instant, and nonexistent spring-forward times move to the next valid minute. Cross-midnight end times are retained as a planning window description.</p>
          <div className="rounded-2xl border border-outline/30 bg-surface-container p-4 space-y-3">
            <h3 className="font-semibold">Add a schedule</h3>
            <FieldRow label="Reminder title" control={<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="w-full rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Reminder title" />} />
            <FieldRow label="Start date and time" description="Choose a local wall-clock value. The selected timezone and daylight-saving rules determine the actual instant." control={<input type="datetime-local" value={draft.startLocal} onChange={(event) => setDraft({ ...draft, startLocal: event.target.value })} className="rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Start date and time" />} />
            <FieldRow label="Timezone" control={<select value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} className="rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Schedule timezone">{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>} />
            <FieldRow label="Recurrence" control={<select value={draft.recurrence.kind} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value === 'interval' ? { kind: 'interval', everyMinutes: 60 } : event.target.value === 'weekly' ? { kind: 'weekly', days: [new Date().getDay() as PlannerWeekday] } : { kind: event.target.value as 'once' | 'daily' | 'weekdays' } })} className="rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Recurrence"><option value="once">Once</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Selected weekdays</option><option value="interval">Every interval</option></select>} />
            {draft.recurrence.kind === 'interval' ? <FieldRow label="Interval in minutes" control={<input type="number" min={1} max={1000000} value={draft.recurrence.everyMinutes} onChange={(event) => setDraft({ ...draft, recurrence: { kind: 'interval', everyMinutes: Number(event.target.value) } })} className="w-32 rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Interval in minutes" />} /> : null}
            {draft.recurrence.kind === 'weekly' ? <FieldRow label="Weekdays" control={<div className="flex flex-wrap gap-2">{(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((label, day) => <label key={label} className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={draft.recurrence.days.includes(day as PlannerWeekday)} onChange={(event) => { const days = event.target.checked ? [...draft.recurrence.days, day as PlannerWeekday] : draft.recurrence.days.filter((value) => value !== day); setDraft({ ...draft, recurrence: { kind: 'weekly', days: Array.from(new Set(days)).sort((a, b) => a - b) as PlannerWeekday[] } }) }} />{label}</label>)}</div>} /> : null}
            <FieldRow label="Optional end time" description="An end earlier than the start describes a cross-midnight planning window." control={<input type="time" value={draft.endTime ?? ''} onChange={(event) => setDraft({ ...draft, endTime: event.target.value || undefined })} className="rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Optional end time" />} />
            <FieldRow label="Notification body" control={<textarea value={draft.notification.body} onChange={(event) => setDraft({ ...draft, notification: { ...draft.notification, body: event.target.value } })} className="min-h-20 w-full rounded-xl border border-outline/50 bg-surface px-3 py-2" aria-label="Notification body" />} />
            <Button onClick={addSchedule}>Add schedule</Button>
          </div>
          <div className="space-y-3" aria-live="polite">
            {visible.length === 0 ? <p className="text-sm text-text-muted">{file ? (search.active ? 'No schedules match this search.' : 'No schedules yet. Add one above.') : 'Loading planner schedules…'}</p> : null}
            {visible.map((schedule) => <div key={schedule.id} className="rounded-2xl border border-outline/30 bg-surface-container p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0 flex-1 space-y-2"><input value={schedule.title} onChange={(event) => updateSchedule(schedule, { title: event.target.value })} className="w-full rounded-xl border border-outline/50 bg-surface px-3 py-2 font-semibold" aria-label={`Edit ${schedule.title}`} /><div className="flex flex-wrap items-center gap-2 text-xs text-text-muted"><input type="datetime-local" value={schedule.startLocal} onChange={(event) => updateSchedule(schedule, { startLocal: event.target.value })} className="rounded-lg border border-outline/50 bg-surface px-2 py-1" aria-label={`Edit start for ${schedule.title}`} /><span>{schedule.timeZone} · {schedule.recurrence.kind}{schedule.endTime && ` · window ends ${schedule.endTime}`}</span></div></div><Switch checked={schedule.enabled} ariaLabel={`Enable ${schedule.title}`} onChange={(enabled) => updateSchedule(schedule, { enabled })} /></div><p className="mt-2 text-sm text-text-muted">{schedule.notification.body}</p></div>)}
          </div>
          <div className="rounded-2xl border border-outline/30 bg-surface-container p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Occurrence history</h3><div className="flex gap-2"><Button variant="ghost" disabled={!planner} onClick={() => planner && void planner.export('json').then((result) => window.nodeTerminal.export.saveText(result.filename, result.content, 'application/json'))}>Export JSON</Button><Button variant="ghost" disabled={!planner} onClick={() => planner && void planner.export('csv').then((result) => window.nodeTerminal.export.saveText(result.filename, result.content, 'text/csv'))}>Export CSV</Button></div></div>{history.length === 0 ? <p className="mt-2 text-sm text-text-muted">No occurrences have been observed yet.</p> : <ul className="mt-3 space-y-2">{history.slice(-20).reverse().map((occurrence) => <li key={occurrence.id} className="text-sm"><span className="font-medium">{occurrence.status}</span> · {new Date(occurrence.scheduledAtMs).toLocaleString()} · {occurrence.title}</li>)}</ul>}</div>
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
