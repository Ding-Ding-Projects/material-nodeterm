import { useState } from 'react'
import { IconBellFilled, IconCircleCheck } from './icons'
import type { SessionRowVM } from '../lib/sessionList'
import { contextUsageKey, useContextWindow } from '../state/contextWindow'
import { useSessionNaming } from '../state/sessionNaming'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { contextSourceForNode, CONTEXT_STALE_AFTER_MS, contextPercentFromCounts } from '@shared/context-source'
import { useContextClock } from '../lib/contextClock'

export interface SessionRowProps {
  row: SessionRowVM
  onClick(): void
  onClose(): void
  onRename(title: string): void
  onAiName(): void | Promise<void>
  onContextMenu(e: React.MouseEvent): void
  onDragStart(): void
  onDragEnd(): void
}

function ctxColor(pct: number): string {
  if (pct > 85) return '#ff453a'
  if (pct >= 60) return '#ffd60a'
  return '#30d158'
}

function dirName(p?: string): string {
  if (!p) return ''
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

const compactTokens = (n: number): string => new Intl.NumberFormat('en-US').format(Math.round(n))

export function SessionRow({
  row,
  onClick,
  onClose,
  onRename,
  onAiName,
  onContextMenu,
  onDragStart,
  onDragEnd
}: SessionRowProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.title)
  // Naming progress lives in a store keyed by node id, so the spinner persists across the row
  // unmounting (sidebar close / hover-peek collapse) while the name is still generating.
  const naming = useSessionNaming((s) => !!s.byId[row.id])
  const text = useLocalizedVocabularyText()
  const contextSource = contextSourceForNode({
    agentId: row.agentId,
    sshRemoteTmux: row.sshRemote,
    source: row.contextSource
  })
  const usage = useContextWindow((s) => {
    const candidate = contextSource.telemetryAvailable && row.sessionId && row.agentId
      ? s.bySessionId[contextUsageKey(row.sessionId, row.agentId, row.contextSource)]
      : undefined
    if (candidate && row.agentId && candidate.agentId && candidate.agentId !== row.agentId) return undefined
    if (candidate && candidate.source !== row.contextSource) return undefined
    return candidate
  })
  const clockNow = useContextClock(!!usage)
  const telemetryAvailable = contextSource.telemetryAvailable
  const state = usage
    ? clockNow - usage.updatedAt > CONTEXT_STALE_AFTER_MS
      ? 'stale'
      : 'known'
    : telemetryAvailable
      ? row.sessionId
        ? 'unknown'
        : 'not-reported'
      : 'unavailable'
  const stateCopy = text(`contextMeter.state.${state}`, state === 'known' ? 'reported' : state)
  const rawPercent = usage ? (contextPercentFromCounts(usage.usedTokens, usage.windowTokens) ?? 0) : 0
  const levelKey = !usage || state === 'stale' ? null : rawPercent > 85 ? 'critical' : rawPercent >= 60 ? 'warning' : 'healthy'
  const levelCopy = levelKey ? text(`contextMeter.level.${levelKey}`, levelKey) : ''
  const compactSummary = usage
    ? text('contextMeter.summary', 'Used {used} / {total} tokens · {remaining} remaining · {percent}%', {
        used: compactTokens(usage.usedTokens),
        total: compactTokens(usage.windowTokens),
        remaining: compactTokens(Math.max(0, usage.windowTokens - usage.usedTokens)),
        percent: String(Math.round(rawPercent))
      }) + ` · ${state === 'stale' ? text('contextMeter.staleTelemetry', 'stale telemetry') : levelCopy}`
    : text('contextMeter.contextState', 'Context: {state}', { state: stateCopy })

  const commit = (): void => {
    const t = draft.trim()
    if (t && t !== row.title) onRename(t)
    setEditing(false)
  }

  const aiName = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (naming) return
    void onAiName()
  }

  return (
    <div
      className="ss-row"
      draggable={!editing}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        // Some browsers require data to be set for a drag to start.
        e.dataTransfer.setData('text/plain', row.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      {row.statusKind === 'attention' ? (
        // Needs-you rings a bell — louder than one more colored dot.
        <span className="ss-bell" title={row.stateLabel}>
          <IconBellFilled />
        </span>
      ) : row.statusKind !== 'working' && row.unread ? (
        // Finished (or reset to idle) while the user wasn't looking: the SAME check glyph,
        // but accent-blue and pulsing until they visit the node. Working/attention win —
        // a new turn or a permission prompt is more urgent than an old unread mark.
        <span className="ss-check ss-check--unread" title="Finished — new for you">
          <IconCircleCheck />
        </span>
      ) : row.statusKind === 'done' ? (
        // Completion glyph: a check icon scans better than one more dot.
        <span className="ss-check" title={row.stateLabel}>
          <IconCircleCheck />
        </span>
      ) : (
        <span className={`ss-dot ss-dot--${row.statusKind}`} title={row.stateLabel} />
      )}
      <div className="ss-row__body">
        <div className="ss-row__titleline">
          <span className="ss-mark" style={{ background: row.color }} />
          {editing ? (
            <input
              className="ss-title-input"
              autoFocus
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <span
              className={`ss-title${row.unread ? ' is-unread' : ''}`}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setDraft(row.title)
                setEditing(true)
              }}
            >
              {row.title}
            </span>
          )}
          {row.session && <span className="ss-chip">{row.session}</span>}
          {row.loop && (
            <span className="ss-loop">
              {row.loop.kind} · {row.loop.count}
            </span>
          )}
          {row.agentId && (
            <span
              className={`ss-ctx ss-ctx--${state}`}
              role="progressbar"
              aria-label={compactSummary}
              aria-valuemin={0}
              aria-valuemax={100}
              {...(usage
                ? {
                    'aria-valuenow': Math.round(rawPercent),
                    'aria-valuetext': compactSummary
                  }
                : { 'aria-valuetext': compactSummary })}
              style={usage ? { background: ctxColor(rawPercent) } : undefined}
            >
              {usage ? `${Math.round(rawPercent)}% ${stateCopy}` : stateCopy}
            </span>
          )}
          <button
            className="ss-row__ai"
            title="Name with AI (from terminal output)"
            disabled={naming}
            onClick={aiName}
          >
            {naming ? '…' : '✦'}
          </button>
          <button
            className="ss-row__close"
            title="Close session"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          >
            ×
          </button>
        </div>
        {(row.cwd || row.sshHost) && (
          <div className="ss-meta">
            {row.sshHost && <span className="ss-meta__ssh">⇅ {row.sshHost}</span>}
            {row.cwd && <span className="ss-meta__cwd">{dirName(row.cwd)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
