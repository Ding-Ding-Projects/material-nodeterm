import { useEffect, useMemo, useRef, useState } from 'react'
import { TextArea } from '@renderer/ui/md3'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { SettingsText } from '../SettingsText'
import { Button } from '@renderer/ui/Button'
import { Switch } from '@renderer/ui/Switch'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { notify } from '@renderer/lib/adhdNotify'
import { openDestructiveGate } from '@renderer/state/destructiveGate'
import type { PlannerFile, PlannerOccurrence, PlannerSchedule, PlannerWeekday } from '@shared/planner-occurrences'
import { useVocabularyMapper } from '../../../lib/personalVocabulary/useVocabularyText'
import { settingsSearchEntryWithVocabulary } from '../vocabulary'

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
  const vocab = useVocabularyMapper()
  const sectionDescription = 'Durable local planner occurrences run while the computer is available, even after this window closes. A powered-off computer cannot wake or evaluate time; overdue entries are recorded as missed when the app starts again.'
  const mappedEntries = useMemo(
    () => ENTRIES.map((entry) => settingsSearchEntryWithVocabulary(entry, vocab)),
    [vocab]
  )
  const resolvedVocabulary = { source: 'localized-vocabulary' as const, fields: 'all' as const, searchEntries: 'mapped' as const }
  const [file, setFile] = useState<PlannerFile | null>(null)
  const [history, setHistory] = useState<PlannerOccurrence[]>([])
  const [draft, setDraft] = useState<PlannerSchedule>(() => freshSchedule())
  const weeklyDays = draft.recurrence.kind === 'weekly' ? draft.recurrence.days : []
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [retryFile, setRetryFile] = useState<PlannerFile | null>(null)
  const saveGeneration = useRef(0)
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
    const generation = ++saveGeneration.current
    setFile(next)
    setSaving(true)
    setError(null)
    void planner.save(next).then((result) => {
      if (generation !== saveGeneration.current) return
      setSaving(false)
      if (result.ok) {
        setRetryFile(null)
        return
      }
      setRetryFile(next)
      setError(`${result.error} The host kept the previous schedules. Retry this save after resolving the storage problem.`)
      void planner.load().then((state) => {
        if (generation === saveGeneration.current && state.ok) setFile(state.file)
      }).catch(() => undefined)
    }).catch(() => {
      if (generation !== saveGeneration.current) return
      setSaving(false)
      setRetryFile(next)
      setError('Planner data could not be saved. The host kept the previous schedules. Retry this save after checking local storage access.')
      void planner.load().then((state) => {
        if (generation === saveGeneration.current && state.ok) setFile(state.file)
      }).catch(() => undefined)
    })
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

  const removeSchedule = (schedule: PlannerSchedule): void => {
    if (!planner) return
    void planner.load().then((state) => {
      if (!state.ok) {
        setError(state.error.message)
        return
      }
      const current = state.file.schedules.find((item) => item.id === schedule.id)
      if (!current || current.title !== schedule.title) {
        setError('The schedule changed while confirmation was open. Nothing was deleted; review it and try again.')
        return
      }
      saveFile({ ...state.file, schedules: state.file.schedules.filter((item) => item.id !== schedule.id) })
    }).catch(() => setError('The schedule could not be re-read, so nothing was deleted. Retry after checking local storage access.'))
  }

  const visible = (file?.schedules ?? []).filter((schedule) => search.test(`${schedule.title} ${schedule.notification.title} ${schedule.notification.body} ${schedule.recurrence.kind} ${schedule.timeZone}`))
  return (
    <SettingsSection id="planner" title={vocab('Planner')} description={vocab(sectionDescription)} isActive={isActive} searchEntries={mappedEntries} resolvedVocabulary={resolvedVocabulary}>
      <SearchableRow {...ROWS.schedules}>
        <div className="space-y-5">
          <div className="flex items-end gap-3">
            <label className="min-w-0 flex-1 text-sm font-medium"><SettingsText>Search planner schedules</SettingsText>
              <Input vocabularyMode="factual" ref={searchInputRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} className="mt-1 w-full" placeholder={vocab('Plain text search')} aria-label={vocab('Search planner schedules')} />
            </label>
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex builder for planner schedules" />
          </div>
          {search.error ? <p className="text-sm text-[color:var(--caution)]" role="alert"><SettingsText segments={[{ kind: 'fact', value: search.error }]} /></p> : null}
          {error ? <p className="text-sm text-[color:var(--caution)]" role="alert"><SettingsText segments={[{ kind: 'fact', value: error }]} /></p> : null}
          <div className="flex items-center gap-2 text-xs text-text-muted" aria-live="polite">
            <span><SettingsText>{saving ? 'Saving planner schedules…' : retryFile ? 'The latest save needs attention.' : 'Planner schedules are synchronized with the host.'}</SettingsText></span>
            {retryFile ? <Button variant="ghost" onClick={() => saveFile(retryFile)}><SettingsText>Retry save</SettingsText></Button> : null}
          </div>
          <p className="text-xs text-text-muted"><SettingsText>The host checks this durable file every few seconds. DST repeated times fire once at the earliest instant, and nonexistent spring-forward times move to the next valid minute. Cross-midnight end times are retained as a planning window description.</SettingsText></p>
          <div className="rounded-2xl border border-outline/30 bg-surface-container p-4 space-y-3">
            <h3 className="font-semibold"><SettingsText>Add a schedule</SettingsText></h3>
            <FieldRow label="Reminder title" control={<Input vocabularyMode="factual" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="w-full" aria-label={vocab('Reminder title')} />} />
            <FieldRow label="Start date and time" description="Choose a local wall-clock value. The selected timezone and daylight-saving rules determine the actual instant." control={<Input vocabularyMode="factual" type="datetime-local" value={draft.startLocal} onChange={(event) => setDraft({ ...draft, startLocal: event.target.value })} className="w-full" aria-label={vocab('Start date and time')} />} />
            <FieldRow label="Timezone" control={<Select vocabularyMode="factual" value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} className="w-full" aria-label={vocab('Schedule timezone')}>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</Select>} />
            <FieldRow label="Recurrence" control={<Select vocabularyMode="factual" value={draft.recurrence.kind} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value === 'interval' ? { kind: 'interval', everyMinutes: 60 } : event.target.value === 'weekly' ? { kind: 'weekly', days: [new Date().getDay() as PlannerWeekday] } : { kind: event.target.value as 'once' | 'daily' | 'weekdays' } })} className="w-full" aria-label={vocab('Recurrence')}><option value="once"><SettingsText>Once</SettingsText></option><option value="daily"><SettingsText>Every day</SettingsText></option><option value="weekdays"><SettingsText>Weekdays</SettingsText></option><option value="weekly"><SettingsText>Selected weekdays</SettingsText></option><option value="interval"><SettingsText>Every interval</SettingsText></option></Select>} />
            {draft.recurrence.kind === 'interval' ? <FieldRow label="Interval in minutes" control={<Input vocabularyMode="factual" type="number" min={1} max={1000000} value={draft.recurrence.everyMinutes} onChange={(event) => setDraft({ ...draft, recurrence: { kind: 'interval', everyMinutes: Number(event.target.value) } })} className="w-32" aria-label={vocab('Interval in minutes')} />} /> : null}
            {draft.recurrence.kind === 'weekly' ? <FieldRow label="Weekdays" control={<div className="flex flex-wrap gap-2">{(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((label, day) => <label key={label} className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={weeklyDays.includes(day as PlannerWeekday)} onChange={(event) => { const days = event.target.checked ? [...weeklyDays, day as PlannerWeekday] : weeklyDays.filter((value) => value !== day); setDraft({ ...draft, recurrence: { kind: 'weekly', days: Array.from(new Set(days)).sort((a, b) => a - b) as PlannerWeekday[] } }) }} /> <SettingsText>{label}</SettingsText></label>)}</div>} /> : null}
            <FieldRow label="Optional end time" description="An end earlier than the start describes a cross-midnight planning window." control={<Input vocabularyMode="factual" type="time" value={draft.endTime ?? ''} onChange={(event) => setDraft({ ...draft, endTime: event.target.value || undefined })} className="w-full" aria-label={vocab('Optional end time')} />} />
            <FieldRow label="Notification body" control={<TextArea vocabularyMode="factual" value={draft.notification.body} onChange={(event) => setDraft({ ...draft, notification: { ...draft.notification, body: event.target.value } })} className="min-h-20 w-full" aria-label={vocab('Notification body')} />} />
            <Button onClick={addSchedule}><SettingsText>Add schedule</SettingsText></Button>
          </div>
          <div className="space-y-3" aria-live="polite">
            {visible.length === 0 ? <p className="text-sm text-text-muted"><SettingsText>{file ? (search.active ? 'No schedules match this search.' : 'No schedules yet. Add one above.') : 'Loading planner schedules…'}</SettingsText></p> : null}
            {visible.map((schedule) => (
              <div key={schedule.id} className="rounded-2xl border border-outline/30 bg-surface-container p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      vocabularyMode="factual"
                      value={schedule.title}
                      onChange={(event) => updateSchedule(schedule, { title: event.target.value })}
                      className="w-full font-semibold"
                      aria-label={`${vocab('Edit')} ${schedule.title}`}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <Input
                        vocabularyMode="factual"
                        type="datetime-local"
                        value={schedule.startLocal}
                        onChange={(event) => updateSchedule(schedule, { startLocal: event.target.value })}
                        className="w-full max-w-xs"
                        aria-label={`${vocab('Edit start for')} ${schedule.title}`}
                      />
                      <span>{schedule.timeZone} · {schedule.recurrence.kind}{schedule.endTime && ` · ${vocab('window ends')} ${schedule.endTime}`}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={schedule.enabled}
                      vocabularyMode="factual"
                      ariaLabel={`${vocab('Enable')} ${schedule.title}`}
                      onChange={(enabled) => updateSchedule(schedule, { enabled })}
                    />
                    <Button
                      variant="ghost"
                      vocabularyMode="factual"
                      aria-label={`${vocab('Delete')} ${schedule.title}`}
                      onClick={(event) => {
                        const target = event.currentTarget
                        const rect = target.getBoundingClientRect()
                        openDestructiveGate({
                          title: 'Delete planner schedule “{scheduleTitle}”',
                          titleParams: { scheduleTitle: schedule.title },
                          description: 'Permanently delete “{scheduleTitle}”. Its existing redacted occurrence history remains available for export.',
                          descriptionParams: { scheduleTitle: schedule.title },
                          affected: [schedule.title],
                          confirmLabel: 'Delete schedule',
                          anchor: { x: rect.left, y: rect.bottom },
                          restoreFocusEl: target,
                          onConfirm: () => removeSchedule(schedule)
                        })
                      }}
                    >
                      <SettingsText>Delete</SettingsText>
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-text-muted">{schedule.notification.body}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-outline/30 bg-surface-container p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold"><SettingsText>Occurrence history</SettingsText></h3>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={!planner} onClick={() => planner && void planner.export('json').then((result) => window.nodeTerminal.export.saveText(result.filename, result.content, 'application/json'))}><SettingsText>Export JSON</SettingsText></Button>
                <Button variant="ghost" disabled={!planner} onClick={() => planner && void planner.export('csv').then((result) => window.nodeTerminal.export.saveText(result.filename, result.content, 'text/csv'))}><SettingsText>Export CSV</SettingsText></Button>
              </div>
            </div>
            {history.length === 0 ? <p className="mt-2 text-sm text-text-muted"><SettingsText>No occurrences have been observed yet.</SettingsText></p> : <ul className="mt-3 space-y-2">{history.slice(-20).reverse().map((occurrence) => <li key={occurrence.id} className="text-sm"><span className="font-medium">{occurrence.status}</span> · {new Date(occurrence.scheduledAtMs).toLocaleString()} · {occurrence.title}</li>)}</ul>}
          </div>
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
