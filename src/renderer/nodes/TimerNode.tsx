import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { clampTimerDuration, formatTimerMs, timerNextState, type TimerMode, type TimerNodeData } from '@shared/timer'
import { useEffect, useRef, useState } from 'react'
import { notify } from '../lib/adhdNotify'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button, Checkbox, Chip, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

export default function TimerNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, deleteElements } = useReactFlow()
  const vocab = useVocabularyMapper()
  const timer = data as TimerNodeData
  const [tick, setTick] = useState(Date.now())
  const last = useRef(Date.now())
  const monotonic = useRef(typeof performance === 'undefined' ? Date.now() : performance.now())
  const timerRef = useRef(timer)
  timerRef.current = timer
  useEffect(() => {
    if (!timer.running || timer.paused) return
    const handle = window.setInterval(() => {
      const now = Date.now()
      const monoNow = typeof performance === 'undefined' ? now : performance.now()
      const current = timerRef.current
      const next = timerNextState(current, now, last.current)
      const monotonicDelta = Math.max(0, monoNow - monotonic.current)
      monotonic.current = monoNow
      const safeNext = current.timerMode === 'stopwatch'
        ? { ...next, elapsedMs: current.elapsedMs + monotonicDelta }
        : { ...next, elapsedMs: current.elapsedMs + monotonicDelta }
      last.current = now
      if (safeNext.completed && current.timerMode === 'interval' && current.sequence.length > 0) {
        const nextIndex = current.sequenceIndex + 1
        if (nextIndex < current.sequence.length) {
          const durationMs = clampTimerDuration(current.sequence[nextIndex].durationMs)
          updateNodeData(id, { sequenceIndex: nextIndex, durationMs, remainingMs: durationMs, elapsedMs: 0, running: true, paused: false, occurrenceState: 'running' })
        } else if (current.repeatRemaining > 0) {
          const durationMs = clampTimerDuration(current.sequence[0].durationMs)
          updateNodeData(id, { sequenceIndex: 0, repeatRemaining: current.repeatRemaining - 1, durationMs, remainingMs: durationMs, elapsedMs: 0, running: true, paused: false, occurrenceState: 'running' })
        } else {
          updateNodeData(id, { remainingMs: 0, elapsedMs: next.elapsedMs, running: false, paused: false, occurrenceState: 'completed' })
          if (current.occurrenceId) void window.nodeTerminal.timer.transition(current.occurrenceId, 'completed')
        }
      } else {
        updateNodeData(id, { remainingMs: safeNext.remainingMs, elapsedMs: safeNext.elapsedMs, running: safeNext.completed ? false : current.running, paused: false, occurrenceState: safeNext.completed ? 'completed' : 'running', wallAnchorMs: now, monotonicAnchorMs: monoNow })
        if (safeNext.completed && current.occurrenceId) void window.nodeTerminal.timer.transition(current.occurrenceId, 'completed')
      }
      setTick(now)
      if (next.completed && current.timerMode !== 'interval' && current.alarmEnabled) notify({
        kind: 'success',
        title: mapOwnedSentence(vocab, [fact(String(current.title)), copy(' complete')]),
        titleKind: 'fact',
        body: current.alarmTone === 'silent'
          ? 'Alarm is silent.'
          : mapOwnedSentence(vocab, [copy('Alarm tone: '), fact(String(current.alarmTone)), copy('.')]),
        bodyKind: 'fact'
      })
    }, 250)
    return () => window.clearInterval(handle)
  }, [id, timer.running, timer.paused, updateNodeData, vocab])

  const display = timer.timerMode === 'stopwatch' ? timer.elapsedMs : timer.remainingMs
  const setMode = (mode: TimerMode) => updateNodeData(id, { timerMode: mode, running: false, paused: false, remainingMs: timer.durationMs, elapsedMs: 0, occurrenceState: 'scheduled' })
  const start = () => {
    last.current = Date.now()
    monotonic.current = typeof performance === 'undefined' ? Date.now() : performance.now()
    const first = timer.timerMode === 'interval' && timer.sequence.length > 0 ? clampTimerDuration(timer.sequence[0].durationMs) : timer.durationMs
    const apply = (occurrenceId?: string) => updateNodeData(id, { running: true, paused: false, occurrenceState: 'running', repeatRemaining: timer.repeatCount, remainingMs: first, durationMs: first, sequenceIndex: 0, occurrenceId, wallAnchorMs: Date.now(), monotonicAnchorMs: monotonic.current })
    void window.nodeTerminal.timer.schedule(id, Date.now()).then((occurrence) => apply(occurrence?.id)).catch(() => apply())
  }
  const reset = () => updateNodeData(id, { running: false, paused: false, remainingMs: timer.durationMs, elapsedMs: 0, lapsMs: [], sequenceIndex: 0, occurrenceState: 'scheduled' })
  const lap = () => updateNodeData(id, { lapsMs: [...(timer.lapsMs ?? []), timer.elapsedMs] })
  return <div className={`timer-node${selected ? ' selected' : ''}`} aria-label={mapOwnedSentence(vocab, [copy('Timer node: '), fact(String(timer.title))])}>
    <NodeResizer minWidth={320} minHeight={300} isVisible={selected} color="var(--md-primary)" />
    <Handle type="target" position={Position.Left} />
    <div className="timer-node__header"><span aria-hidden="true">◷</span><Input className="mdx-input--bare timer-node__title nodrag" vocabularyMode="factual" aria-label={vocab('Timer title')} value={timer.title} onChange={(e) => updateNodeData(id, { title: e.target.value })} /><IconButton size="compact" className="term-node__close" icon="close" vocabularyMode="factual" title={vocab('Delete timer')} aria-label={vocab('Delete timer')} onClick={() => deleteElements({ nodes: [{ id }] })} /></div>
    <div className="timer-node__modes nodrag" role="tablist" aria-label={vocab('Timer mode')}>
      {(['countdown', 'stopwatch', 'interval'] as TimerMode[]).map((mode) => <Chip key={mode} role="tab" vocabularyMode="factual" selected={timer.timerMode === mode} aria-selected={timer.timerMode === mode} aria-label={vocab(mode === 'countdown' ? 'Countdown' : mode === 'stopwatch' ? 'Stopwatch' : 'Work / rest')} onClick={() => setMode(mode)}>{vocab(mode === 'countdown' ? 'Countdown' : mode === 'stopwatch' ? 'Stopwatch' : 'Work / rest')}</Chip>)}
    </div>
    <output className="timer-node__display" aria-live="polite" aria-label={mapOwnedSentence(vocab, [fact(String(timer.title)), copy(' '), fact(timer.paused ? 'paused' : timer.running ? 'running' : 'ready'), copy(' '), fact(formatTimerMs(display))])}>{formatTimerMs(display)}</output>
    {timer.timerMode !== 'stopwatch' && <label className="timer-node__duration nodrag">{vocab('Duration')} <Input vocabularyMode="factual" type="number" min={1} value={Math.round(timer.durationMs / 1000)} aria-label={vocab('Duration seconds')} onChange={(e) => { const durationMs = clampTimerDuration(Number(e.target.value) * 1000); updateNodeData(id, { durationMs, remainingMs: durationMs }) }} /> {vocab('seconds')}</label>}
    <label className="timer-node__repeat nodrag">{vocab('Repeat')} <Input vocabularyMode="factual" type="number" min={0} max={999} value={timer.repeatCount} aria-label={vocab('Repeat count')} onChange={(e) => updateNodeData(id, { repeatCount: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })} /> {vocab('times')}</label>
    {timer.timerMode === 'interval' && <div className="timer-node__sequence nodrag"><strong>{vocab('Work / rest sequence')}</strong>{(timer.sequence ?? []).map((step, i) => <div key={step.id}><Input vocabularyMode="factual" aria-label={mapOwnedSentence(vocab, [copy('Sequence step '), fact(String(i + 1)), copy(' label')])} maxLength={80} value={step.label} onChange={(e) => updateNodeData(id, { sequence: timer.sequence.map((s, j) => j === i ? { ...s, label: e.target.value } : s) })} /><Input vocabularyMode="factual" type="number" min={1} max={604800} aria-label={mapOwnedSentence(vocab, [copy('Sequence step '), fact(String(i + 1)), copy(' seconds')])} value={Math.round(step.durationMs / 1000)} onChange={(e) => updateNodeData(id, { sequence: timer.sequence.map((s, j) => j === i ? { ...s, durationMs: clampTimerDuration(Number(e.target.value) * 1000) } : s) })} /><IconButton size="compact" vocabularyMode="factual" aria-label={mapOwnedSentence(vocab, [copy('Move step '), fact(String(i + 1)), copy(' up')])} title={vocab('Move step up')} disabled={i === 0} onClick={() => { const sequence = [...timer.sequence]; [sequence[i - 1], sequence[i]] = [sequence[i], sequence[i - 1]]; updateNodeData(id, { sequence }) }}>↑</IconButton><IconButton size="compact" vocabularyMode="factual" aria-label={mapOwnedSentence(vocab, [copy('Move step '), fact(String(i + 1)), copy(' down')])} title={vocab('Move step down')} disabled={i === timer.sequence.length - 1} onClick={() => { const sequence = [...timer.sequence]; [sequence[i], sequence[i + 1]] = [sequence[i + 1], sequence[i]]; updateNodeData(id, { sequence }) }}>↓</IconButton><IconButton size="compact" icon="close" vocabularyMode="factual" aria-label={mapOwnedSentence(vocab, [copy('Remove sequence step '), fact(String(i + 1))])} title={vocab('Remove sequence step')} onClick={() => updateNodeData(id, { sequence: timer.sequence.filter((_, j) => j !== i) })} /></div>)}<Button variant="outlined" size="small" vocabularyMode="factual" disabled={(timer.sequence ?? []).length >= 32} onClick={() => updateNodeData(id, { sequence: [...(timer.sequence ?? []), { id: `step-${Date.now()}`, label: 'New step', durationMs: 60_000 }] })}>{vocab('Add step')}</Button></div>}
    <div className="timer-node__actions nodrag"><Button variant="filled" size="small" vocabularyMode="factual" onClick={timer.running ? () => updateNodeData(id, { paused: !timer.paused, occurrenceState: timer.paused ? 'running' : 'paused' }) : start}>{vocab(timer.running ? (timer.paused ? 'Resume' : 'Pause') : 'Start')}</Button>{timer.timerMode === 'stopwatch' && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={lap} disabled={!timer.running}>{vocab('Lap')}</Button>}<Button variant="outlined" size="small" vocabularyMode="factual" onClick={reset}>{vocab('Reset')}</Button></div>
    <label className="timer-node__alarm nodrag"><Checkbox checked={timer.alarmEnabled} onChange={(e) => updateNodeData(id, { alarmEnabled: e.target.checked })} /> {vocab('Alarm')}</label>
    <div className="timer-node__meta">{fact(timer.occurrenceState).text} · {fact(String(timer.lapsMs?.length ?? 0)).text} {vocab('laps')} · {fact(String(timer.missedCount ?? 0)).text} {vocab('missed')}</div>
    {tick < 0 && <span aria-hidden="true" />}
  </div>
}
