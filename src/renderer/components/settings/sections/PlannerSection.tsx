import { useEffect, useMemo, useRef, useState } from 'react'
import { SettingsSection } from '../SettingsSection'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import { useLocalizedVocabularyText } from '../../../lib/personalVocabulary/useLocalizedVocabularyText'
import { useSchoolMode } from '../../../state/schoolMode'
import type { DurableOccurrenceSnapshot, DurableSchedule, DurableWeekday } from '@shared/durable-occurrences'

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/Toronto']
const DAYS: Array<[DurableWeekday, string]> = [[0, 'Sun'], [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat']]
const blank = (): DurableSchedule => ({ id: `planner-${Date.now().toString(36)}`, title: '', enabled: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', startLocal: new Date().toISOString().slice(0, 16), recurrence: { kind: 'daily' }, notification: { title: '', body: '', soundEnabled: true, narratorEnabled: false } })

export function PlannerSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [snapshot, setSnapshot] = useState<DurableOccurrenceSnapshot | null>(null)
  const [generation, setGeneration] = useState(0)
  const [draft, setDraft] = useState(blank)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const school = useSchoolMode((state) => state.enabled)
  const localize = useLocalizedVocabularyText()
  const t = (fallback: string): string => localize(`planner.${fallback.toLowerCase().replaceAll(' ', '-')}`, fallback)
  useEffect(() => { if (!isActive) return; let live = true; void window.nodeTerminal.durableOccurrences.load().then((state) => { if (live && state.ok) { setSnapshot(state.snapshot); setGeneration(state.snapshot.generation) } }); return () => { live = false } }, [isActive])
  const visible = useMemo(() => (snapshot?.schedules ?? []).filter((item) => search.test(`${item.title} ${item.startLocal} ${item.timeZone}`)), [snapshot, search])
  async function save(nextSchedules: DurableSchedule[]) {
    if (!draft.title.trim() || !draft.notification.title.trim()) { setStatus(t('Planner title and notification title are required.')); return }
    const base = snapshot ?? await window.nodeTerminal.durableOccurrences.load().then((state) => state.ok ? state.snapshot : null)
    if (!base) { setStatus(t('Planner host is unavailable.')); return }
    const result = await window.nodeTerminal.durableOccurrences.save({ ...base, schedules: nextSchedules }, generation)
    if (!result.ok) { setStatus(result.error); return }
    const loaded = await window.nodeTerminal.durableOccurrences.load(); if (loaded.ok) { setSnapshot(loaded.snapshot); setGeneration(loaded.snapshot.generation) }
    setStatus(t('Planner schedule saved.'))
  }
  async function addAlarm() {
    const base = snapshot ?? await window.nodeTerminal.durableOccurrences.load().then((state) => state.ok ? state.snapshot : null)
    if (!base) { setStatus(t('Planner host is unavailable.')); return }
    const now = Date.now(); const id = `alarm-${now.toString(36)}`
    const alarm = { id, canvasNodeId: `alarm-node-${now.toString(36)}`, title: 'Alarm', enabled: false, timeZone: draft.timeZone, startLocal: draft.startLocal, recurrence: { kind: 'once' as const }, snoozeMinutes: 10, soundEnabled: true, narratorEnabled: false, createdAtMs: now, updatedAtMs: now }
    const result = await window.nodeTerminal.durableOccurrences.upsertAlarm(alarm)
    if (!result.ok) { setStatus(result.error); return }
    const loaded = await window.nodeTerminal.durableOccurrences.load(); if (loaded.ok) { setSnapshot(loaded.snapshot); setGeneration(loaded.snapshot.generation) }; setStatus(t('Alarm saved.'))
  }
  async function addTimer() {
    const base = snapshot ?? await window.nodeTerminal.durableOccurrences.load().then((state) => state.ok ? state.snapshot : null)
    if (!base) { setStatus(t('Planner host is unavailable.')); return }
    const now = Date.now(); const id = `timer-${now.toString(36)}`; const durationMs = 5 * 60_000
    const timer = { id, canvasNodeId: `timer-node-${now.toString(36)}`, title: 'Timer', updatedAtMs: now, data: { timerMode: 'countdown' as const, durationMs, remainingMs: durationMs, elapsedMs: 0, running: false, paused: false, repeatCount: 0, repeatRemaining: 0, sequence: [], sequenceIndex: 0, lapsMs: [], nextOccurrenceAt: null, occurrenceState: 'scheduled' as const, alarmEnabled: true, alarmTone: 'chime' as const, missedCount: 0, wallAnchorMs: null, monotonicAnchorMs: null } }
    const result = await window.nodeTerminal.durableOccurrences.upsertTimer(timer)
    if (!result.ok) { setStatus(result.error); return }
    const loaded = await window.nodeTerminal.durableOccurrences.load(); if (loaded.ok) { setSnapshot(loaded.snapshot); setGeneration(loaded.snapshot.generation) }; setStatus(t('Timer saved.'))
  }
  return <SettingsSection id="planner" title={t('Planner')} description={t('Schedules are owned by the host and remain recorded when the canvas is closed.')} isActive={isActive} searchEntries={[{ title: 'Planner', keywords: ['planner', 'alarm', 'timer', 'timezone', 'occurrence'] }]}> 
    <div className="planner-section"><div className="md3-settings-row md3-settings-row--stacked">
      <div className="flex min-w-0 items-center gap-2"><input ref={searchRef} className="md3-field min-w-0 flex-1" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={t('Search planner schedules')} aria-label={t('Search planner schedules')} /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label={t('Open planner regex builder')} /></div>
      {search.error ? <p role="alert">{search.error}</p> : null}
      {visible.length === 0 ? <p role="status">{t('No planner schedules match this search.')}</p> : <ul aria-label={t('Planner schedules')}>{visible.map((item) => <li key={item.id}>{t(item.title)} · {item.startLocal} · {item.timeZone}</li>)}</ul>}
      <h3>{t('Occurrence history')}</h3>
      {(snapshot?.occurrences ?? []).filter((item) => search.test(`${item.title} ${item.status} ${item.local.date} ${item.local.time}`)).length === 0 ? <p role="status">{t('No occurrence history matches this search.')}</p> : <ul aria-label={t('Occurrence history')}>{(snapshot?.occurrences ?? []).filter((item) => search.test(`${item.title} ${item.status} ${item.local.date} ${item.local.time}`)).map((item) => <li key={item.id}><label><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />{t(item.title)} · {item.local.date} {item.local.time} · {item.status}</label></li>)}</ul>}
      {(snapshot?.occurrences ?? []).length > 0 ? <div className="flex flex-wrap gap-2"><button type="button" className="md3-btn" onClick={() => setSelected((snapshot?.occurrences ?? []).map((item) => item.id))}>{t('Select all occurrences')}</button><button type="button" className="md3-btn" onClick={() => setSelected((snapshot?.occurrences ?? []).map((item) => item.id).filter((id) => !selected.includes(id)))}>{t('Invert selection')}</button>{selected.length > 0 ? <button type="button" className="md3-btn" onClick={async () => { for (const id of selected) await window.nodeTerminal.durableOccurrences.dismiss(id); setSelected([]); const loaded = await window.nodeTerminal.durableOccurrences.load(); if (loaded.ok) setSnapshot(loaded.snapshot) }}>{t('Dismiss selected occurrences')}</button> : null}</div> : null}
    </div></div>
    {!school ? <div className="md3-settings-row md3-settings-row--stacked">
      <label>{t('Schedule title')}<input className="md3-field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>{t('Local start')}<input className="md3-field" type="datetime-local" value={draft.startLocal} onChange={(event) => setDraft({ ...draft, startLocal: event.target.value })} /></label>
      <label>{t('Timezone')}<select className="md3-field" value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}>{ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
      <label>{t('Recurrence')}<select className="md3-field" value={draft.recurrence.kind} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value === 'weekly' ? { kind: 'weekly', weekdays: [1] } : { kind: event.target.value as 'once' | 'daily' | 'weekdays' } })}><option value="once">{t('Once')}</option><option value="daily">{t('Daily')}</option><option value="weekdays">{t('Weekdays')}</option><option value="weekly">{t('Weekly')}</option></select></label>
      {draft.recurrence.kind === 'weekly' ? <div role="group" aria-label={t('Weekly weekdays')}>{DAYS.map(([day, label]) => <label key={day}><input type="checkbox" checked={draft.recurrence.weekdays.includes(day)} onChange={(event) => { const days = draft.recurrence.kind === 'weekly' ? draft.recurrence.weekdays : []; const next = event.target.checked ? [...new Set([...days, day])] : days.filter((value) => value !== day); setDraft({ ...draft, recurrence: { kind: 'weekly', weekdays: next as DurableWeekday[] } }) }} />{t(label)}</label>)}</div> : null}
      <label>{t('Notification title')}<input className="md3-field" value={draft.notification.title} onChange={(event) => setDraft({ ...draft, notification: { ...draft.notification, title: event.target.value } })} /></label>
      <label>{t('Notification body')}<textarea className="md3-field" value={draft.notification.body} onChange={(event) => setDraft({ ...draft, notification: { ...draft.notification, body: event.target.value } })} /></label>
      <button type="button" className="md3-btn md3-btn--filled" onClick={() => void save([...(snapshot?.schedules ?? []), draft])}>{t('Add schedule')}</button>
      <button type="button" className="md3-btn" onClick={() => { const exported = window.nodeTerminal.durableOccurrences.exportSchedules(); void exported.then((file) => window.nodeTerminal.export.saveText(file.filename, file.content, 'application/json')) }}>{t('Export schedules and history')}</button>
      <h3>{t('Alarm and Timer catalog')}</h3>
      <p>{t('Choose a host-owned Alarm or Timer configuration. Canvas cards are projections of these records.')}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="md3-btn" onClick={() => void addAlarm()}>{t('Add alarm')}</button><button type="button" className="md3-btn" onClick={() => void addTimer()}>{t('Add timer')}</button></div>
      {status ? <p role="status">{status}</p> : null}
    </div> : <p role="note">{t('The selected School mode hides planner controls and keeps the saved choices unchanged.')}</p>}
  </SettingsSection>
}
