import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { useSettings } from '../state/settings'
import { useNotifications } from '../state/notifications'
import { playSfx } from '../lib/sfx'
import { narrate } from '../lib/narrator'
import { nextAlarmOccurrence, alarmOccurrenceId, localDateTimeToEpoch, validateAlarm, type AlarmOccurrence, type AlarmRecurrence, type AlarmSchedule } from '@shared/alarm-clock'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'

const COMMON_TIMEZONES = ['UTC', 'America/Toronto', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney']
const RECURRENCES: { value: AlarmRecurrence; label: string }[] = [
  { value: 'once', label: 'One shot' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function timezoneChoices(current: string): string[] {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const all = supported ? supported('timeZone') : []
  return Array.from(new Set([current, ...COMMON_TIMEZONES, ...all])).filter(Boolean).sort((a, b) => a.localeCompare(b))
}

function safeSchedule(data: CanvasNode['data']): AlarmSchedule {
  const value = data.alarmSchedule
  if (!value || typeof value !== 'object') return { recurrence: 'once', date: localDate(), time: '09:00' }
  const candidate = value as Partial<AlarmSchedule>
  return {
    recurrence: RECURRENCES.some((entry) => entry.value === candidate.recurrence) ? candidate.recurrence as AlarmRecurrence : 'once',
    date: typeof candidate.date === 'string' ? candidate.date : localDate(),
    time: typeof candidate.time === 'string' ? candidate.time : '09:00',
    weekdays: Array.isArray(candidate.weekdays) ? candidate.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6) : undefined,
    monthDay: typeof candidate.monthDay === 'number' ? candidate.monthDay : 1
  }
}

function displayTime(epoch: number | undefined, timeZone: string): string {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return 'Not scheduled'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(epoch))
  } catch {
    return 'Invalid timezone'
  }
}

function compileSearch(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags.replace(/[^imuysdg]/g, ''))
  } catch {
    return null
  }
}

export default function AlarmClockNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const settings = useSettings((state) => state.settings)
  const [now, setNow] = useState(() => Date.now())
  const [search, setSearch] = useState('')
  const [regexOpen, setRegexOpen] = useState(false)
  const [regexPattern, setRegexPattern] = useState('')
  const [regexFlags, setRegexFlags] = useState('i')
  const emittedRef = useRef(new Set<string>())
  const schedule = safeSchedule(data)
  const scheduleSignature = JSON.stringify(schedule)
  const timeZone = typeof data.alarmTimeZone === 'string' && data.alarmTimeZone ? data.alarmTimeZone : 'UTC'
  const history = Array.isArray(data.alarmHistory) ? data.alarmHistory as AlarmOccurrence[] : []
  const hostAlarm = window.nodeTerminal.alarm
  const regex = regexOpen && regexPattern ? compileSearch(regexPattern, regexFlags) : null
  const visibleHistory = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return history.filter((entry) => {
      const text = `${entry.status} ${displayTime(entry.scheduledAt, entry.timeZone)}`
      if (regex) {
        regex.lastIndex = 0
        return regex.test(text)
      }
      return !query || text.toLocaleLowerCase().includes(query)
    }).slice().reverse().slice(0, 8)
  }, [history, regex, search, timeZone])

  const patch = useCallback((next: Partial<CanvasNode['data']>) => updateNodeData(id, next), [id, updateNodeData])
  const updateSchedule = useCallback((next: Partial<AlarmSchedule>) => {
    patch({ alarmSchedule: { ...schedule, ...next } })
  }, [patch, schedule])

  const applyHostSnapshot = useCallback((snapshot: Awaited<ReturnType<NonNullable<typeof hostAlarm>['state']>>) => {
    const alarm = snapshot.alarms.find((item) => item.id === id)
    if (!alarm) return
    const hostHistory = snapshot.history.filter((item) => item.alarmId === id)
    const combined = new Map(history.map((item) => [item.id, item]))
    hostHistory.forEach((item) => combined.set(item.id, item))
    const alarmHistory = [...combined.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-1000)
    const next: Partial<CanvasNode['data']> = {}
    if (data.alarmEnabled !== alarm.enabled) next.alarmEnabled = alarm.enabled
    if (data.alarmNextOccurrenceAt !== alarm.nextOccurrenceAt) next.alarmNextOccurrenceAt = alarm.nextOccurrenceAt
    if (JSON.stringify(history) !== JSON.stringify(alarmHistory)) next.alarmHistory = alarmHistory
    if (Object.keys(next).length) patch(next)
  }, [data.alarmEnabled, data.alarmNextOccurrenceAt, history, id, patch])

  const deliver = useCallback((occurrence: AlarmOccurrence, kind: 'due' | 'snooze' | 'missed') => {
    const title = String(data.title || 'Alarm Clock')
    const body = kind === 'missed' ? `${title} was missed at ${displayTime(occurrence.scheduledAt, timeZone)}.` : `${title} is due now.`
    useNotifications.getState().push({
      kind: kind === 'missed' ? 'warning' : 'info',
      title: kind === 'missed' ? 'Missed alarm' : 'Alarm due',
      body: `${body} This app cannot wake a powered-off computer.`,
      autoDismissMs: kind === 'missed' ? null : 12_000,
      actions: kind === 'missed' ? undefined : [
        { label: `Snooze ${data.alarmSnoozeMinutes ?? 10} min`, onClick: () => {
          if (hostAlarm) void hostAlarm.snooze(occurrence.id, Number(data.alarmSnoozeMinutes ?? 10)).then(applyHostSnapshot)
          else patch({ alarmHistory: history.map((item) => item.id === occurrence.id ? { ...item, status: 'snoozed', snoozedUntil: Date.now() + Number(data.alarmSnoozeMinutes ?? 10) * 60_000, resolvedAt: undefined } : item) })
        } },
        { label: 'Dismiss', onClick: () => {
          if (hostAlarm) void hostAlarm.dismiss(occurrence.id).then(applyHostSnapshot)
          else patch({ alarmHistory: history.map((item) => item.id === occurrence.id ? { ...item, status: 'dismissed', resolvedAt: Date.now(), snoozedUntil: undefined } : item) })
        } }
      ]
    })
    if (data.alarmSoundEnabled !== false) playSfx('needsYou', settings.soundVolume)
    if (data.alarmNarratorEnabled !== false && settings.narratorEnabled) {
      narrate({ category: `alarm:${id}`, language: settings.narratorLanguage, en: body, yue: kind === 'missed' ? '鬧鐘錯過咗，呢部電腦熄機時唔可以叫醒佢。' : '鬧鐘到喇，呢部電腦熄機時唔可以叫醒佢。', rate: settings.narratorRate, pitch: settings.narratorPitch, voiceEn: settings.narratorVoiceEn, voiceYue: settings.narratorVoiceYue, important: kind !== 'due' })
    }
  }, [applyHostSnapshot, data, history, hostAlarm, id, patch, settings, timeZone])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!hostAlarm) return
    const input = {
      id,
      title: String(data.title || 'Alarm Clock'),
      enabled: data.alarmEnabled === true,
      timeZone,
      schedule,
      snoozeMinutes: Number(data.alarmSnoozeMinutes ?? 10),
      soundEnabled: data.alarmSoundEnabled !== false,
      narratorEnabled: data.alarmNarratorEnabled !== false,
      nextOccurrenceAt: typeof data.alarmNextOccurrenceAt === 'number' ? data.alarmNextOccurrenceAt : undefined
    }
    if (!validateAlarm(input).ok) return
    let active = true
    void hostAlarm.upsert(input).then((snapshot) => {
      if (active) applyHostSnapshot(snapshot)
    }).catch(() => {
      if (active) useNotifications.getState().push({ kind: 'error', title: 'Alarm planner unavailable', body: 'The host could not persist this alarm. The canvas copy remains unchanged.', autoDismissMs: null })
    })
    return () => { active = false }
  }, [applyHostSnapshot, data.alarmEnabled, data.alarmNarratorEnabled, data.alarmNextOccurrenceAt, data.alarmSnoozeMinutes, data.alarmSoundEnabled, data.title, hostAlarm, id, scheduleSignature, timeZone])

  useEffect(() => {
    if (!hostAlarm) return
    return hostAlarm.onDue((event) => {
      if (event.alarm.id !== id) return
      const alarmHistory = [...history.filter((item) => item.id !== event.occurrence.id), event.occurrence].slice(-1000)
      const next = event.alarm.schedule.recurrence === 'once'
        ? null
        : nextAlarmOccurrence(event.alarm, event.occurrence.scheduledAt)
      patch({ alarmHistory, alarmEnabled: next !== null, alarmNextOccurrenceAt: next ?? undefined })
      deliver(event.occurrence, event.kind)
    })
  }, [deliver, history, hostAlarm, id, patch])

  useEffect(() => {
    if (hostAlarm) return
    if (!data.alarmEnabled) return
    const current = typeof data.alarmNextOccurrenceAt === 'number' ? data.alarmNextOccurrenceAt : nextAlarmOccurrence({ timeZone, schedule }, now - 1)
    if (current === null || current === undefined) {
      patch({ alarmEnabled: false, alarmNextOccurrenceAt: undefined })
      return
    }
    if (typeof data.alarmNextOccurrenceAt !== 'number') {
      patch({ alarmNextOccurrenceAt: current })
      return
    }
    if (current > now) return
    const occurrenceId = alarmOccurrenceId(id, current)
    if (emittedRef.current.has(occurrenceId) || history.some((item) => item.id === occurrenceId)) return
    emittedRef.current.add(occurrenceId)
    const late = now - current > 60_000
    const occurrence: AlarmOccurrence = { id: occurrenceId, alarmId: id, scheduledAt: current, status: late ? 'missed' : 'fired', createdAt: now, timeZone }
    const next = schedule.recurrence === 'once' ? null : nextAlarmOccurrence({ timeZone, schedule }, current)
    patch({ alarmHistory: [...history, occurrence].slice(-1000), alarmEnabled: next !== null, alarmNextOccurrenceAt: next ?? undefined })
    deliver(occurrence, late ? 'missed' : 'due')
  }, [data.alarmEnabled, data.alarmNextOccurrenceAt, deliver, history, hostAlarm, id, now, patch, schedule, timeZone])

  useEffect(() => {
    if (hostAlarm) return
    const expired = history.find((item) => item.status === 'snoozed' && typeof item.snoozedUntil === 'number' && item.snoozedUntil <= now)
    if (!expired) return
    const nextHistory = history.map((item) => item.id === expired.id ? { ...item, status: 'fired' as const, snoozedUntil: undefined } : item)
    patch({ alarmHistory: nextHistory })
    deliver({ ...expired, status: 'fired', snoozedUntil: undefined }, 'snooze')
  }, [deliver, history, hostAlarm, now, patch])

  const validDateTime = localDateTimeToEpoch(schedule.date ?? '', schedule.time, timeZone) !== null || schedule.recurrence !== 'once'
  const validWeekdays = schedule.recurrence !== 'weekly' || (schedule.weekdays?.length ?? 0) > 0
  const canStart = validDateTime && validWeekdays && schedule.time.length >= 5
  const toggle = () => {
    const enabled = !data.alarmEnabled
    const next = enabled ? nextAlarmOccurrence({ timeZone, schedule }, now - 1) : null
    patch({ alarmEnabled: enabled && next !== null, alarmNextOccurrenceAt: next ?? undefined })
  }
  const snooze = (occurrence: AlarmOccurrence) => {
    if (hostAlarm) void hostAlarm.snooze(occurrence.id, Number(data.alarmSnoozeMinutes ?? 10)).then(applyHostSnapshot)
    else patch({ alarmHistory: history.map((item) => item.id === occurrence.id ? { ...item, status: 'snoozed', snoozedUntil: now + Number(data.alarmSnoozeMinutes ?? 10) * 60_000, resolvedAt: undefined } : item) })
  }
  const dismiss = (occurrence: AlarmOccurrence) => {
    if (hostAlarm) void hostAlarm.dismiss(occurrence.id).then(applyHostSnapshot)
    else patch({ alarmHistory: history.map((item) => item.id === occurrence.id ? { ...item, status: 'dismissed', resolvedAt: now, snoozedUntil: undefined } : item) })
  }
  const headerFill = nodeHeaderFillStyle(data.color)

  return (
    <div className={`term-node alarm-clock-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={340} minHeight={300} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <span aria-hidden="true" className="alarm-clock-node__glyph">⏰</span>
        <EditableNodeTitle value={String(data.title ?? '')} onChange={(title) => patch({ title })} emptyLabel="Alarm Clock" title="Click to rename" ariaLabel="Alarm Clock node name" rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button className="term-node__close" title="Close" aria-label="Close Alarm Clock" onClick={() => {
          if (hostAlarm) void hostAlarm.remove(id)
          void deleteElements({ nodes: [{ id }] })
        }}>×</button>
      </div>
      <div className="alarm-clock-node__body nodrag nowheel">
        <label>Schedule
          <select value={schedule.recurrence} aria-label="Alarm recurrence" onChange={(event) => updateSchedule({ recurrence: event.target.value as AlarmRecurrence })}>
            {RECURRENCES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        {schedule.recurrence !== 'daily' && schedule.recurrence !== 'weekdays' && schedule.recurrence !== 'weekly' && schedule.recurrence !== 'monthly' ? <label>Date <input type="date" value={schedule.date ?? ''} aria-label="Alarm date" onChange={(event) => updateSchedule({ date: event.target.value })} /></label> : null}
        <label>Time <input type="time" step={1} value={schedule.time} aria-label="Alarm local time" onChange={(event) => updateSchedule({ time: event.target.value })} /></label>
        <label>Timezone <select value={timeZone} aria-label="Alarm timezone" onChange={(event) => patch({ alarmTimeZone: event.target.value, alarmNextOccurrenceAt: undefined })}>{timezoneChoices(timeZone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        {schedule.recurrence === 'weekly' ? <fieldset><legend>Weekdays</legend><div className="alarm-clock-node__days">{WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={schedule.weekdays?.includes(index) ?? false} onChange={(event) => updateSchedule({ weekdays: event.target.checked ? [...new Set([...(schedule.weekdays ?? []), index])] : (schedule.weekdays ?? []).filter((value) => value !== index) })} />{day}</label>)}</div></fieldset> : null}
        {schedule.recurrence === 'monthly' ? <label>Day of month <input type="number" min={1} max={31} value={schedule.monthDay ?? 1} aria-label="Alarm day of month" onChange={(event) => updateSchedule({ monthDay: Number(event.target.value) })} /></label> : null}
        <div className="alarm-clock-node__options"><label>Snooze (minutes) <input type="number" min={1} max={120} value={data.alarmSnoozeMinutes ?? 10} onChange={(event) => patch({ alarmSnoozeMinutes: Math.min(120, Math.max(1, Number(event.target.value) || 10)) })} /></label><label><input type="checkbox" checked={data.alarmSoundEnabled !== false} onChange={(event) => patch({ alarmSoundEnabled: event.target.checked })} /> Sound</label><label><input type="checkbox" checked={data.alarmNarratorEnabled !== false} onChange={(event) => patch({ alarmNarratorEnabled: event.target.checked })} /> Narrator</label></div>
        {!canStart ? <p className="alarm-clock-node__error" role="alert">Choose a valid time and required recurrence values before starting.</p> : null}
        <p className="alarm-clock-node__honesty">This alarm can notify while the app is running. It cannot wake a powered-off computer.</p>
        <div className="alarm-clock-node__status"><strong>{data.alarmEnabled ? 'Running' : 'Paused'}</strong><span>Next: {displayTime(data.alarmNextOccurrenceAt, timeZone)}</span><span>Now: {displayTime(now, timeZone)}</span></div>
        <div className="alarm-clock-node__actions"><button disabled={!canStart} className={data.alarmEnabled ? 'active' : ''} onClick={toggle}>{data.alarmEnabled ? 'Pause' : 'Start alarm'}</button></div>
        <div className="alarm-clock-node__history"><div className="alarm-clock-node__history-head"><strong>Occurrence history</strong><span>{history.length}</span></div><div className="alarm-clock-node__search"><input value={search} placeholder="Search history" aria-label="Search alarm history" onChange={(event) => setSearch(event.target.value)} /><button aria-expanded={regexOpen} title="Open regex builder" onClick={() => setRegexOpen((open) => !open)}>.*</button></div>{regexOpen ? <div className="alarm-clock-node__regex" role="dialog" aria-label="Alarm history regex builder"><label>Pattern <input value={regexPattern} onChange={(event) => setRegexPattern(event.target.value)} /></label><label>Flags <input value={regexFlags} onChange={(event) => setRegexFlags(event.target.value)} /></label><span role="status">{regexPattern && !regex ? 'Invalid regular expression.' : 'Plain text is the default.'}</span></div> : null}{visibleHistory.length === 0 ? <p className="alarm-clock-node__empty">No matching alarm occurrences yet.</p> : <ul>{visibleHistory.map((occurrence) => <li key={occurrence.id}><span><b>{occurrence.status}</b> {displayTime(occurrence.scheduledAt, occurrence.timeZone)}</span>{occurrence.status === 'fired' || occurrence.status === 'snoozed' ? <span><button onClick={() => snooze(occurrence)}>Snooze</button><button onClick={() => dismiss(occurrence)}>Dismiss</button></span> : null}</li>)}</ul>}</div>
      </div>
    </div>
  )
}
