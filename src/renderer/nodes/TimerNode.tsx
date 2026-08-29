import { useCallback, useEffect, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { NodeData } from '@renderer/state/workspace'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'

type TimerNodeProps = NodeProps<{ title: string; timerData?: NodeData['timerData'] }>

/** Thin canvas projection. Timing authority stays in the host occurrence service. */
export function TimerNode({ id, data }: TimerNodeProps) {
  const [timer, setTimer] = useState(data.timerData)
  const [timerId, setTimerId] = useState(id)
  const t = useVocabularyMapper()
  useEffect(() => { let active = true; void window.nodeTerminal.durableOccurrences.load().then(async (state) => { if (!active || !state.ok) return; const match = state.snapshot.timers.find((item) => item.id === id || item.canvasNodeId === id); if (match) { setTimerId(match.id); setTimer(match.data); return } if (!data.timerData) return; const created = { id, canvasNodeId: id, title: data.title, data: data.timerData, updatedAtMs: Date.now() }; const result = await window.nodeTerminal.durableOccurrences.upsertTimer(created); if (result.ok) { setTimerId(id); setTimer(data.timerData) } }); return () => { active = false } }, [data.title, data.timerData, id])
  useEffect(() => window.nodeTerminal.durableOccurrences.onChanged((snapshot) => {
    const match = snapshot.timers.find((item) => item.canvasNodeId === id)
    if (match) { setTimerId(match.id); setTimer(match.data) }
  }), [id])
  const transition = useCallback(async (action: 'start' | 'pause' | 'resume' | 'cancel' | 'reset') => {
    const result = await window.nodeTerminal.durableOccurrences.timerTransition(timerId, action)
    if (result) setTimer(result.data)
  }, [timerId])
  const state = timer?.occurrenceState ?? 'scheduled'
  return <section className="canvas-node timer-node" aria-label={t(data.title)}>
    <header>{t(data.title)}</header>
    <p aria-live="polite">{t(state)}</p>
    <p>{timer?.timerMode === 'stopwatch' ? `${Math.round((timer.elapsedMs ?? 0) / 1000)}s ${t('elapsed')}` : `${Math.round((timer?.remainingMs ?? 0) / 1000)}s ${t('remaining')}`}</p>
    <div role="group" aria-label={t('Timer actions')}>
      <button type="button" onClick={() => transition(state === 'paused' ? 'resume' : 'start')}>{t(state === 'paused' ? 'Resume' : 'Start')}</button>
      <button type="button" onClick={() => transition('pause')} disabled={state !== 'running'}>{t('Pause')}</button>
      <button type="button" onClick={() => transition('reset')}>{t('Reset')}</button>
      <button type="button" onClick={() => transition('cancel')}>{t('Cancel')}</button>
    </div>
  </section>
}
