import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { LOOP_DEFAULT_INTERVAL_MS, validLoopInterval } from '../lib/nativeLoop'
import type { CanvasNode } from '../state/workspace'
import { TextArea } from '@renderer/ui/md3'
import { Select } from '@renderer/ui/Select'

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
        data-tip="Schedule — drag to an agent node"
      />

      <div className="native-loop-node__header">
        <span className="native-loop-node__clock">↻</span>
        <input
          className="native-loop-node__title nodrag"
          value={data.title}
          aria-label="Loop title"
          onChange={(event) => updateNodeData(id, { title: event.target.value })}
        />
        <button className="native-loop-node__close" title="Delete Loop" onClick={() => deleteElements({ nodes: [{ id }] })}>
          ×
        </button>
      </div>

      <TextArea
        className="native-loop-node__task nodrag nowheel"
        value={data.loopTask ?? ''}
        placeholder="Task sent to every connected agent…"
        aria-label="Loop task"
        onChange={(event) => updateNodeData(id, { loopTask: event.target.value })}
      />

      <div className="native-loop-node__interval nodrag">
        <span>Every</span>
        <input
          type="number"
          min={1}
          value={interval.value}
          aria-label="Loop interval"
          onChange={(event) => setInterval(Number(event.target.value), interval.unit)}
        />
        <Select
          value={interval.unit}
          aria-label="Loop interval unit"
          onChange={(event) => setInterval(interval.value, Number(event.target.value))}
        >
          <option value={60_000}>minutes</option>
          <option value={3_600_000}>hours</option>
          <option value={86_400_000}>days</option>
        </Select>
      </div>

      <div className="native-loop-node__meta">
        <span>{targetCount} agent{targetCount === 1 ? '' : 's'}</span>
        <span>Next: {data.loopEnabled ? timeLabel(data.loopNextRunAt) : 'paused'}</span>
        <span>Last: {timeLabel(data.loopLastRunAt)}</span>
      </div>

      <div className="native-loop-node__actions nodrag">
        <button
          className={data.loopEnabled ? 'active' : ''}
          onClick={toggleEnabled}
          disabled={!String(data.loopTask ?? '').trim() || targetCount === 0}
        >
          {data.loopEnabled ? 'Pause' : 'Start'}
        </button>
        <button
          onClick={() => runNativeLoop(id)}
          disabled={!String(data.loopTask ?? '').trim() || targetCount === 0}
        >
          Run now
        </button>
      </div>
    </div>
  )
}
