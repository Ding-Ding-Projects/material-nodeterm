import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { useAgentNodes } from '../state/agentNodes'
import { ContextMeter } from '../components/ContextMeter'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * The collapsed contract is calculated from the children that are actually rendered. The old
 * fixed floor was shorter than the task and metadata lines, so a resize could hide the very
 * information that identifies a subagent. Keep the context strip and card chrome in the same
 * arithmetic as the rendered children, with a small border/spacing allowance.
 */
export function subagentCollapsedHeight(hasTask: boolean, hasMeta: boolean): number {
  const contextStrip = 54
  const header = 34
  const task = hasTask ? 24 : 0
  const metadata = hasMeta ? 24 : 0
  const bordersAndGaps = 20
  return contextStrip + header + task + metadata + bordersAndGaps
}

export const SUBAGENT_MIN_HEIGHT = subagentCollapsedHeight(true, true)

/**
 * Subagent node — a first-class canvas node (select/drag/resize) visualizing a subagent the
 * Claude session spawned. Shows type + task + live timer / duration-tokens; expand to read
 * its live transcript in a terminal-styled panel (subagents have no PTY).
 */
export function SubagentNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const working = data.subagentState !== 'done'
  const startedAt = (data.subagentStartedAt as number) || 0
  const durationMs = data.subagentDurationMs as number | undefined
  const tokens = data.subagentTokens as number | undefined
  const toolUses = data.subagentToolUses as number | undefined
  const result = (data.subagentResult as string) || ''
  const text = useLocalizedVocabularyText()
  // Live transcript: subscribed here per-id (not passed through Canvas's ephemeral node data)
  // so streaming chunks re-render only this card, never the whole canvas.
  const activity = useAgentNodes((s) => s.activityById[id]) || ''
  const body = activity || result
  const expanded = !!data.ephExpanded
  const bodyRef = useRef<HTMLDivElement>(null)
  const toggle = () => useAgentNodes.getState().toggleExpanded(id)

  useEffect(() => {
    if (expanded && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [body, expanded])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [working])

  const elapsed = working && startedAt ? fmtDur(now - startedAt) : durationMs ? fmtDur(durationMs) : ''
  const meta = [
    elapsed ? text('subagent.elapsed', '{duration}', { duration: elapsed }) : null,
    tokens != null ? text('subagent.tokens', '↓ {tokens} tokens', { tokens: fmtTokens(tokens) }) : null,
    toolUses ? text('subagent.tools', '{count} tools', { count: String(toolUses) }) : null
  ]
    .filter(Boolean)
    .join(' · ')

  const collapsedHeight = subagentCollapsedHeight(!!data.title, !!meta)

  // The cards are `selectable: false` in React Flow (a rubber band must not sweep a fan-out
  // into the selection), so selecting one — which is what reveals its resize frame — is ours.
  const select = () => useAgentNodes.getState().select(id)

  return (
    <div onPointerDownCapture={select} className={`subagent-node${working ? ' working' : ' done'}`}>
      <NodeResizer isVisible={selected} minWidth={180} minHeight={collapsedHeight} color="#d97757" />
      <ContextMeter agentId="claude" sessionId={null} telemetryAvailable={false} source="local" />
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="subagent-node__head nodrag" onClick={toggle} style={{ cursor: 'pointer' }}>
        <button
          className="subagent-node__expand"
          title={expanded ? text('subagent.collapse', 'Collapse') : text('subagent.openOutput', 'Open output')}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="subagent-node__dot" />
        <span className="subagent-node__type">{(data.subagentType as string) || text('subagent.type', 'subagent')}</span>
        <span className="subagent-node__state">{working ? text('subagent.working', 'working') : text('subagent.done', 'done')}</span>
      </div>
      {data.title && !expanded && <div className="subagent-node__task">{data.title as string}</div>}
      {meta && <div className="subagent-node__meta">{meta}</div>}
      {expanded && (
        <div className="subagent-node__term nodrag nowheel" ref={bodyRef}>
          {data.title ? <div className="subagent-node__result-task">{data.title as string}</div> : null}
          {body || (working ? text('subagent.workingOutput', 'Working... live output appears here') : text('subagent.noOutput', 'No output.'))}
        </div>
      )}
    </div>
  )
}
