import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { LOOP_DEFAULT_INTERVAL_MS, validLoopInterval } from '../lib/nativeLoop'
import type { CanvasNode } from '../state/workspace'
import { Button, IconButton, TextArea } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

let runNativeLoop: (nodeId: string) => void = () => {}

export function setNativeLoopRunHandler(handler: (nodeId: string) => void): () => void {
  runNativeLoop = handler
  return () => {
    if (runNativeLoop === handler) runNativeLoop = () => {}
  }
}

function intervalParts(intervalMs: number): { value: number; unit: number } {
  const units = [86_400_000, 3_600_000, 60_000]
  const unit = units.find((candidate) => intervalMs % candidate === 0) ?? 60_000
  return { value: Math.max(1, Math.round(intervalMs / unit)), unit }
}

function timeLabel(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value))
}

/** User-created, project-persisted scheduler. Existing hook-derived LoopNode stays separate. */
export function NativeLoopNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { deleteElements, updateNodeData } = useReactFlow()
  const intervalMs = validLoopInterval(data.loopIntervalMs ?? LOOP_DEFAULT_INTERVAL_MS)
  const interval = intervalParts(intervalMs)
  const targetCount = ((data.loopTargetIds as string[] | undefined) ?? []).length

  const setInterval = (value: number, unit: number) => {
    const nextInterval = validLoopInterval(Math.max(1, value) * unit)
    updateNodeData(id, {
      loopIntervalMs: nextInterval,
      loopNextRunAt: data.loopEnabled ? Date.now() + nextInterval : undefined
    })
  }

  const toggleEnabled = () => {
    const enabled = !data.loopEnabled
    updateNodeData(id, {
      loopEnabled: enabled,
      loopNextRunAt: enabled ? Date.now() + intervalMs : undefined
    })
  }

  return (
    <div className={`native-loop-node${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={280} minHeight={230} isVisible={selected} color="var(--md-warning)" />
      <Handle
        id="schedule-out"
        type="source"
        position={Position.Right}
        className="schedule-handle"
        data-tip={vocab('Schedule — drag to an agent node')}
      />

      <div className="native-loop-node__header">
        <span className="native-loop-node__clock">↻</span>
        <Input
          className="mdx-input--bare native-loop-node__title nodrag"
          vocabularyMode="factual"
          value={data.title}
          aria-label={vocab('Loop title')}
          onChange={(event) => updateNodeData(id, { title: event.target.value })}
        />
        <IconButton size="compact" className="native-loop-node__close" icon="close" vocabularyMode="factual" title={vocab('Delete Loop')} aria-label={vocab('Delete Loop')} onClick={() => deleteElements({ nodes: [{ id }] })} />
      </div>

      <TextArea
        className="native-loop-node__task nodrag nowheel"
        value={data.loopTask ?? ''}
        placeholder={vocab('Task sent to every connected agent…')}
        aria-label={vocab('Loop task')}
        onChange={(event) => updateNodeData(id, { loopTask: event.target.value })}
      />

      <div className="native-loop-node__interval nodrag">
        <span>{vocab('Every')}</span>
        <Input
          type="number"
          vocabularyMode="factual"
          min={1}
          value={interval.value}
          aria-label={vocab('Loop interval')}
          onChange={(event) => setInterval(Number(event.target.value), interval.unit)}
        />
        <Select
          value={interval.unit}
          aria-label={vocab('Loop interval unit')}
          onChange={(event) => setInterval(interval.value, Number(event.target.value))}
        >
          <option value={60_000}>{vocab('minutes')}</option>
          <option value={3_600_000}>{vocab('hours')}</option>
          <option value={86_400_000}>{vocab('days')}</option>
        </Select>
      </div>

      <div className="native-loop-node__meta">
        <span>{targetCount} {vocab(targetCount === 1 ? 'agent' : 'agents')}</span>
        <span>{vocab('Next')}: {data.loopEnabled ? timeLabel(data.loopNextRunAt) : vocab('paused')}</span>
        <span>{vocab('Last')}: {timeLabel(data.loopLastRunAt)}</span>
      </div>

      <div className="native-loop-node__actions nodrag">
        <Button
          variant={data.loopEnabled ? 'tonal' : 'filled'}
          size="small"
          vocabularyMode="factual"
          className={data.loopEnabled ? 'active' : ''}
          onClick={toggleEnabled}
          disabled={!String(data.loopTask ?? '').trim() || targetCount === 0}
        >
          {vocab(data.loopEnabled ? 'Pause' : 'Start')}
        </Button>
        <Button
          variant="outlined"
          size="small"
          vocabularyMode="factual"
          onClick={() => runNativeLoop(id)}
          disabled={!String(data.loopTask ?? '').trim() || targetCount === 0}
        >
          {vocab('Run now')}
        </Button>
      </div>
    </div>
  )
}
