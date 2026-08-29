import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { hasUsage, type AgentId } from '@shared/agents/config'
import { contextUsageKey, useContextWindow } from '../state/contextWindow'
import { formatModelLabel, formatTimeAgo } from '../lib/usageFormat'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { useContextClock } from '../lib/contextClock'
import { CONTEXT_STALE_AFTER_MS, contextPercentFromCounts } from '@shared/context-source'


type MeterState = 'known' | 'stale' | 'unknown' | 'not-reported' | 'unavailable'

function meterColor(usedPercent: number): string {
  if (usedPercent > 85) return 'var(--md-error)'
  if (usedPercent >= 60) return 'var(--md-warning)'
  return 'var(--md-success)'
}

function formatTokens(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(n)))
}

function meterState(
  agentId: string | undefined,
  sessionId: string | null,
  usage: { updatedAt: number } | undefined,
  now: number
): MeterState {
  if (!usage) {
    if (!sessionId) return 'not-reported'
    return agentId && hasUsage(agentId as AgentId) ? 'unknown' : 'unavailable'
  }
  return now - usage.updatedAt > CONTEXT_STALE_AFTER_MS ? 'stale' : 'known'
}

function statusFallback(state: MeterState): string {
  switch (state) {
    case 'known':
      return 'reported'
    case 'stale':
      return 'stale'
    case 'unknown':
      return 'unknown'
    case 'not-reported':
      return 'not reported'
    case 'unavailable':
      return 'unavailable'
  }
}

interface ContextMeterProps {
  agentId?: string
  sessionId: string | null
  telemetryAvailable: boolean
  source: string
}

/**
 * Context-window telemetry at the top edge of every agent node. The source is deliberately
 * session-scoped and local: Claude, Codex, and Gemini are filled from their own transcript tails;
 * Grok, OpenCode, custom agents, and sessions without a verified report remain labelled instead
 * of inheriting a denominator from another provider. The top bar is outside the node header so it
 * survives collapse, grouping, minimization, and restore.
 */
export function ContextMeter({ agentId, sessionId, telemetryAvailable, source }: ContextMeterProps): JSX.Element {
  const usage = useContextWindow((s) => {
    const candidate = telemetryAvailable && sessionId && agentId
      ? s.bySessionId[contextUsageKey(sessionId, agentId, source)]
      : undefined
    if (candidate && agentId && candidate.agentId && candidate.agentId !== agentId) return undefined
    if (candidate && candidate.source && candidate.source !== source) return undefined
    return candidate
  })
  const text = useLocalizedVocabularyText()
  const [open, setOpen] = useState(false)
  const now = useContextClock(!!usage)
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const anchor = ref.current?.getBoundingClientRect()
      const popover = popoverRef.current
      if (!anchor || !popover) return
      const margin = 12
      const gap = 8
      const measured = popover.getBoundingClientRect()
      const width = Math.min(measured.width || 320, Math.max(0, window.innerWidth - margin * 2))
      const naturalHeight = measured.height || 280
      const belowSpace = Math.max(0, window.innerHeight - margin - (anchor.bottom + gap))
      const aboveSpace = Math.max(0, anchor.top - gap - margin)
      if (belowSpace === 0 && aboveSpace === 0) {
        // There is literally no viewport slot that avoids the anchor. Keep the measured portal
        // hidden rather than covering the control; the next resize/scroll recomputes it.
        setPopoverPosition(null)
        return
      }
      // Prefer below, then above. If neither side has the natural height, shrink the overlay to
      // the larger side and let its own content scroll. This keeps the anchor visible even in a
      // tiny viewport instead of painting a panel over the control that opened it.
      const below = belowSpace >= naturalHeight || belowSpace >= aboveSpace
      const maxHeight = Math.max(1, Math.min(naturalHeight, below ? belowSpace : aboveSpace))
      const top = below
        ? Math.min(window.innerHeight - margin - maxHeight, anchor.bottom + gap)
        : Math.max(margin, anchor.top - gap - maxHeight)
      setPopoverPosition({
        left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        top,
        maxHeight
      })
    }
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !popoverRef.current?.contains(e.target as Node)) setOpen(false)
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const state = !usage && !telemetryAvailable
    ? 'unavailable'
    : meterState(agentId, sessionId, usage, now)
  const derivedPercent = usage ? contextPercentFromCounts(usage.usedTokens, usage.windowTokens) : null
  const known = derivedPercent !== null
  const rawPercent = derivedPercent ?? 0
  const pct = Math.round(rawPercent)
  const color = known ? meterColor(rawPercent) : 'var(--md-outline)'
  const remaining = known ? Math.max(0, usage.windowTokens - usage.usedTokens) : null
  const stateCopy = text(`contextMeter.state.${state}`, statusFallback(state))
  const titleCopy = text('contextMeter.title', 'Context window')
  const staleCopy = text('contextMeter.staleTelemetry', 'stale telemetry')
  const levelKey = !known || state === 'stale' ? null : rawPercent > 85 ? 'critical' : rawPercent >= 60 ? 'warning' : 'healthy'
  const levelCopy = levelKey ? text(`contextMeter.level.${levelKey}`, levelKey) : ''
  const exactSummary = known
    ? text('contextMeter.summary', 'Used {used} / {total} tokens · {remaining} remaining · {percent}%', {
        used: formatTokens(usage.usedTokens),
        total: formatTokens(usage.windowTokens),
        remaining: formatTokens(remaining!),
        percent: String(pct)
      }) + (state === 'stale' ? ` · ${stateCopy}` : ` · ${levelCopy}`)
    : text('contextMeter.contextState', 'Context: {state}', { state: stateCopy })
  const accessibleSummary = known
    ? `${titleCopy}: ${exactSummary}${state === 'stale' ? ` · ${staleCopy}` : ''}`
    : text('contextMeter.contextState', 'Context window: {state}', { state: stateCopy })
  const level = !known || state === 'stale' ? state : rawPercent > 85 ? 'critical' : rawPercent >= 60 ? 'warning' : 'healthy'

  return (
    <div className={`ctx-meter ctx-meter--top ctx-meter--${state} nodrag`} ref={ref}>
      <div
        className="ctx-meter__topline"
        role="progressbar"
        aria-label={accessibleSummary}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(known
          ? { 'aria-valuenow': pct, 'aria-valuetext': accessibleSummary }
          : { 'aria-valuetext': accessibleSummary })}
        data-level={level}
      >
        <span className="ctx-meter__track" aria-hidden="true">
          <span
            className="ctx-meter__fill"
            style={{ width: known ? `${pct}%` : '0%', background: color }}
          />
        </span>
        <span className="ctx-meter__summary">{exactSummary}</span>
      </div>
      {open && createPortal(
        <div
          className="ctx-popover ctx-popover--portal"
          role="status"
          ref={popoverRef}
          style={{
            left: popoverPosition?.left ?? -10000,
            top: popoverPosition?.top ?? -10000,
            maxHeight: popoverPosition?.maxHeight,
            visibility: popoverPosition ? 'visible' : 'hidden'
          }}
        >
          <div className="ctx-popover__title">{titleCopy}</div>
          <div className="ctx-bar" role="presentation">
            <div className="ctx-bar__fill" style={{ width: known ? `${pct}%` : '0%', background: color }} />
          </div>
          <div className="ctx-popover__meta">{exactSummary}</div>
          <div className="ctx-popover__sub">
            {known
              ? `${usage.model ? `${usage.model} · ` : ''}${state === 'stale' ? staleCopy : text('contextMeter.updated', 'Updated {time}', { time: formatTimeAgo(usage.updatedAt) })}`
              : text('contextMeter.telemetryState', 'Telemetry: {state}', { state: stateCopy })}
          </div>
        </div>,
        document.body
      )}
      <button
        className="ctx-pill"
        type="button"
        title={accessibleSummary}
        aria-label={accessibleSummary}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => {
            if (!v) setPopoverPosition(null)
            return !v
          })
        }}
      >
        {known && formatModelLabel(usage.model) && (
          <span className="ctx-pill__model">{formatModelLabel(usage.model)}</span>
        )}
        <span className="ctx-pill__bar" aria-hidden="true">
          <span className="ctx-pill__fill" style={{ width: known ? `${pct}%` : '0%', background: color }} />
        </span>
        <span className="ctx-pill__num">{known ? `${pct}%` : stateCopy}</span>
      </button>
    </div>
  )
}
