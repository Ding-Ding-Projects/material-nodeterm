import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import type { VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

/** RUNNING → `running`, NEEDS YOU → `attention`, tmux/ok → `ok`, SLEEPING/idle → `idle`. */
export type StatusTone = 'running' | 'attention' | 'ok' | 'idle'

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone
  /** @default 'default' — 28px, per HANDOFF's literal StatusChip recipe. `'compact'` is 24px,
   *  matching the smaller in-card badge already shipped as `.kanban-badge` for a crowded row. */
  size?: 'default' | 'compact'
  /** Suppress the leading dot entirely (rare — most tones want it). */
  hideDot?: boolean
  children: ReactNode
  vocabularyMode?: VocabularyTextMode
}

/**
 * The agent-status pill: RUNNING `tertiary-container` + pulsing dot / NEEDS YOU `error-container`
 * / ok `success-container` / idle `surface-container-highest` — 28px pill, 11.5px/700
 * (`design/v2/md3/HANDOFF.md`'s literal recipe, matching the Board card-modal header badge).
 * Renders a `<span>`, not a button — the surfaces that need this to be clickable (Eco's SLEEPING
 * wake affordance) already wrap their own `<button>` around the equivalent chip; this primitive
 * is purely the chrome.
 */
export function StatusChip({ tone, size = 'default', hideDot = false, className, children, vocabularyMode = 'authored', ...rest }: StatusChipProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const pulse = tone === 'running' || tone === 'attention'
  return (
    <span
      className={cn(
        'mdx-status-chip',
        `mdx-status-chip--${tone}`,
        size === 'compact' && 'mdx-status-chip--compact',
        pulse && !hideDot && 'mdx-status-chip--pulse',
        className
      )}
      {...rest}
    >
      {!hideDot && <span className="mdx-status-chip__dot" />}
      {vocabularyMode === 'authored' && typeof children === 'string' ? vocab(children) : children}
    </span>
  )
}
