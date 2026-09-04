import { useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { DurableAlarmNode } from '@shared/durable-occurrences'
import type { CanvasNode } from '@renderer/state/workspace'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'

/** Alarm canvas projection. The host owns scheduling, delivery claims, and missed state. */
export function AlarmNode({ id, data }: NodeProps<CanvasNode>) {
  const alarmId = (data as { alarmId?: string }).alarmId
  const [alarm, setAlarm] = useState<DurableAlarmNode | undefined>()
  const t = useVocabularyMapper()
  useEffect(() => { let active = true; void window.nodeTerminal.durableOccurrences.load().then(async (state) => { if (!active || !state.ok) return; const match = state.snapshot.alarms.find((item) => item.id === alarmId || item.canvasNodeId === id); if (match) { setAlarm(match); return } if (!alarmId) return; const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; const created = { id: alarmId, canvasNodeId: id, title: data.title, enabled: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', startLocal: `${date}T09:00`, recurrence: { kind: 'once' as const }, snoozeMinutes: 10, soundEnabled: true, narratorEnabled: false, createdAtMs: Date.now(), updatedAtMs: Date.now() }; const result = await window.nodeTerminal.durableOccurrences.upsertAlarm(created); if (result.ok) setAlarm(created) }); return () => { active = false } }, [alarmId, data.title, id])
  useEffect(() => window.nodeTerminal.durableOccurrences.onChanged((snapshot) => { const match = snapshot.alarms.find((item) => item.id === alarmId || item.canvasNodeId === id); if (match) setAlarm(match) }), [alarmId, id])
  return <section className="canvas-node alarm-node" aria-label={t(data.title)}>
    <header>{t(data.title)}</header>
    <p>{alarm ? `${alarm.startLocal} · ${alarm.timeZone}` : t('Alarm unavailable')}</p>
    <p>{alarm?.enabled ? t('Enabled') : t('Stopped')}</p>
  </section>
}
