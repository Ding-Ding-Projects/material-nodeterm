import { useEffect, useRef } from 'react'
import type { SearchMode } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'

/** Identical shape to SearchSnippet in useTerminalSearch.ts (imported by the consumer). */
export interface FindBarSnippet {
  source: 'terminal' | 'claude'
  role?: 'user' | 'assistant' | 'tool'
  text: string
}

interface Props {
  query: string
  onQueryChange: (q: string) => void
  matchIndex: number // 1-based; 0 when no matches
  matchCount: number
  current: FindBarSnippet | null
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  /** Plain text (default) vs regex — an explicit opt-in. Optional so any other caller of this
   *  component keeps working with plain-text-only search. */
  mode?: SearchMode
  onModeChange?: (m: SearchMode) => void
  pattern?: string
  flags?: string
  onFlagsChange?: (f: string) => void
  error?: string | null
}

export function FindBar({
  query,
  onQueryChange,
  matchIndex,
  matchCount,
  current,
  onNext,
  onPrev,
  onClose,
  mode,
  onModeChange,
  pattern,
  flags,
  onFlagsChange,
  error
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const regexCapable = mode != null && onModeChange != null && pattern != null && flags != null && onFlagsChange != null

  return (
    <div className="term-node__find nodrag nowheel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="term-node__find-row">
        <input
          ref={inputRef}
          className="term-node__find-input"
          placeholder={mode === 'regex' ? 'Find (regex)…' : 'Find…'}
          value={query}
          spellCheck={false}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) onPrev()
              else onNext()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        {regexCapable && (
          <AnchoredRegexBuilder
            fieldRef={inputRef}
            label="Regex — terminal find"
            search={{
              mode: mode!,
              pattern: pattern!,
              flags: flags!,
              setMode: onModeChange!,
              setValue: onQueryChange,
              setFlags: onFlagsChange!
            }}
          />
        )}
        <span className="term-node__find-count">{matchCount ? `${matchIndex} / ${matchCount}` : '0 / 0'}</span>
        <button
          type="button"
          className="term-node__find-btn"
          title="Previous (Shift+Enter)"
          aria-label="Previous match"
          onClick={onPrev}
          disabled={!matchCount}
        >
          ↑
        </button>
        <button
          type="button"
          className="term-node__find-btn"
          title="Next (Enter)"
          aria-label="Next match"
          onClick={onNext}
          disabled={!matchCount}
        >
          ↓
        </button>
        <button
          type="button"
          className="term-node__find-btn"
          title="Close (Esc)"
          aria-label="Close search"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {error && <div className="term-node__find-error">{error}</div>}
      {current && (
        <div className="term-node__find-snippet">
          <span className={`term-node__find-tag term-node__find-tag--${current.source}`}>
            {current.source === 'claude' ? current.role ?? 'claude' : 'terminal'}
          </span>
          <span className="term-node__find-snippet-text">{current.text.trim() || '(empty line)'}</span>
        </div>
      )}
    </div>
  )
}
