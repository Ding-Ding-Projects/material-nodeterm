import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContextWindowUsage } from '@shared/types'
import {
  contextFillColor,
  formatModelLabel,
  formatTokensShort
} from '../lib/usageFormat'
import {
  contextSourceKey,
  contextStatus,
  retainContextSession,
  useContextWindow
} from '../state/contextWindow'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapBuiltinAgentLabel } from '../lib/personalVocabulary/agentLabel'
import { Button } from '@renderer/ui/md3'

type Copy = (key: string, fallback: string, params?: Record<string, string>) => string

function safePercent(usage: ContextWindowUsage | undefined): number | null {
  const value = usage?.usedPercent
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
}

function statusText(status: ContextWindowUsage['status'], vocab: Copy): string {
  switch (status) {
    case 'known':
      return vocab('contextWindow.status.known', 'reported')
    case 'stale':
      return vocab('contextWindow.status.stale', 'stale')
    case 'unavailable':
      return vocab('contextWindow.status.unavailable', 'unavailable')
    case 'unknown':
      return vocab('contextWindow.status.unknown', 'unknown')
    default:
      return vocab('contextWindow.status.notReported', 'not reported')
  }
}

function detailText(
  usage: ContextWindowUsage | undefined,
  status: ContextWindowUsage['status'],
  level: 'healthy' | 'warning' | 'critical' | ContextWindowUsage['status'],
  vocab: Copy
): string {
  if (!usage || status !== 'known' || usage.usedTokens === null || usage.windowTokens === null || usage.usedPercent === null) {
    return statusText(status, vocab)
  }
  const remaining = Math.max(0, usage.windowTokens - usage.usedTokens)
  const values = vocab(
    'contextWindow.detail',
    'Used {used} of {total} tokens, {remaining} remaining, {percent}% used',
    {
      used: formatTokensShort(usage.usedTokens),
      total: formatTokensShort(usage.windowTokens),
      remaining: formatTokensShort(remaining),
      percent: String(Math.round(usage.usedPercent))
    }
  )
  return `${vocab(`contextWindow.level.${level}`, level)} · ${values}`
}

export interface ContextMeterProps {
  sessionId: string | null
  agentId?: string | null
  /** Stable local/remote scope prevents a same-id SSH session from winning a local meter. */
  sourceKey?: string
}

export function ContextMeter({ sessionId, agentId, sourceKey }: ContextMeterProps): JSX.Element {
  const now = useContextWindow((s) => s.now)
  const usage = useContextWindow((s) => s.get(sessionId, sourceKey ?? contextSourceKey(agentId)))
  const percent = safePercent(usage)
  const status = usage
    ? contextStatus(usage, now)
    : !sessionId || !['claude', 'codex', 'gemini'].includes(agentId ?? '')
      ? 'unavailable'
      : 'not-reported'
  const level: 'healthy' | 'warning' | 'critical' | ContextWindowUsage['status'] =
    percent === null ? status : percent > 85 ? 'critical' : percent >= 60 ? 'warning' : 'healthy'
  const vocab = useLocalizedVocabularyText()
  const mapVocabulary = useVocabularyMapper()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = useMemo(
    () => detailText(usage, status, level, vocab),
    [status, level, usage?.usedTokens, usage?.windowTokens, usage?.usedPercent, vocab]
  )
  const modelLabel = usage?.model ? formatModelLabel(usage.model) : null
  const title = `${vocab('contextWindow.title', 'Context window')}: ${label}`
  const fill = percent === null ? 0 : percent
  const color = percent === null ? 'var(--md-outline)' : contextFillColor(percent)
  const sourceRaw = usage?.provider ?? agentId
  const source = sourceRaw
    ? mapBuiltinAgentLabel(mapVocabulary, sourceRaw, sourceRaw)
    : vocab('contextWindow.provider.unknown', 'agent')
  const resolvedSourceKey = sourceKey ?? contextSourceKey(agentId)

  useEffect(() => {
    return retainContextSession(sessionId, resolvedSourceKey)
  }, [sessionId, resolvedSourceKey])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="ctx-meter nodrag" ref={ref} data-context-status={status} data-context-level={level}>
      {open && (
        <section className="ctx-popover" role="dialog" aria-label={title}>
          <div className="ctx-popover__title">{vocab('contextWindow.title', 'Context window')}</div>
          <div className="ctx-bar" role="presentation">
            <div
              className="ctx-bar__fill"
              style={{ width: `${fill}%`, background: color }}
              data-context-known={percent !== null}
            />
          </div>
          <p className="ctx-popover__meta">{label}</p>
          <p className="ctx-popover__sub">
            {source}
            {modelLabel ? ` · ${modelLabel}` : ''}
            {usage?.updatedAt ? ` · ${vocab('contextWindow.updated', 'updated')} ${new Date(usage.updatedAt).toLocaleTimeString()}` : ''}
          </p>
        </section>
      )}
      <Button variant="outlined" size="small" vocabularyMode="factual"
        type="button"
        className="ctx-pill"
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        <span className="ctx-pill__label">{vocab('contextWindow.shortLabel', 'Context')}</span>
        <span
          className="ctx-pill__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? { 'aria-valuetext': label } : { 'aria-valuenow': percent, 'aria-valuetext': label })}
        >
          <span
            className="ctx-pill__fill"
            style={{ width: `${fill}%`, background: color }}
            aria-hidden="true"
          />
        </span>
        <span className="ctx-pill__num">{percent === null ? statusText(status, vocab) : `${Math.round(percent)}%`}</span>
      </Button>
    </div>
  )
}
