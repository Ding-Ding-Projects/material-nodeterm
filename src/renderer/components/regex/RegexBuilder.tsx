import { useMemo, useRef, useState } from 'react'
import {
  MAX_PATTERN_LENGTH,
  MAX_SAMPLE_LENGTH,
  REGEX_ENGINE_NAME,
  REGEX_ENGINE_NOTE,
  REGEX_FLAGS,
  clampSample
} from '../../lib/regex/engine'
import { compilePattern } from '../../lib/regex/safety'
import { useSafeEval } from '../../lib/regex/useSafeEval'
import { highlightSegments } from '../../lib/regex/highlight'
import { REGEX_TOKEN_GROUPS, type RegexToken } from './insertTokens'

export interface RegexBuilderValue {
  pattern: string
  flags: string
}

export interface RegexBuilderProps {
  value: RegexBuilderValue
  onChange: (v: RegexBuilderValue) => void
  /** Optional "Done"/close action rendered as a footer button (the anchored popover shell also
   *  closes on Escape/outside-click, so this is a discoverable alternative, not the only exit). */
  onDone?: () => void
}

/** Splices `token` into the pattern at the textarea's current cursor/selection. Wrapping tokens
 *  (groups) wrap the selected text instead of inserting an empty pair when something is selected —
 *  select `foo`, click `(…)`, get `(foo)` with the cursor left after it. */
function applyToken(
  el: HTMLTextAreaElement | null,
  pattern: string,
  token: RegexToken
): { next: string; caret: number } {
  const start = el?.selectionStart ?? pattern.length
  const end = el?.selectionEnd ?? pattern.length
  const selected = pattern.slice(start, end)
  if (token.wraps && selected) {
    const [before, after] = token.wraps
    const next = pattern.slice(0, start) + before + selected + after + pattern.slice(end)
    return { next, caret: start + before.length + selected.length + after.length }
  }
  const insert = token.wraps ? token.wraps[0] + token.wraps[1] : token.insert
  const caretOffset = token.wraps ? token.wraps[0].length : token.insert.length
  const next = pattern.slice(0, start) + insert + pattern.slice(end)
  return { next, caret: start + caretOffset }
}

export function RegexBuilder({ value, onChange, onDone }: RegexBuilderProps): React.JSX.Element {
  const patternRef = useRef<HTMLTextAreaElement>(null)
  const [sample, setSample] = useState('')
  const [copied, setCopied] = useState<'pattern' | 'literal' | null>(null)
  const [activeGroup, setActiveGroup] = useState(0)

  const compiled = useMemo(() => compilePattern(value.pattern, value.flags), [value.pattern, value.flags])
  const clampedSample = useMemo(() => clampSample(sample), [sample])
  const safe = useSafeEval(compiled.ok ? value.pattern : '', value.flags, clampedSample.text)
  const segments = useMemo(
    () => (safe.status === 'ok' ? highlightSegments(clampedSample.text, safe.matches) : []),
    [safe, clampedSample.text]
  )

  const insertToken = (token: RegexToken): void => {
    const { next, caret } = applyToken(patternRef.current, value.pattern, token)
    onChange({ ...value, pattern: next.slice(0, MAX_PATTERN_LENGTH) })
    // Restore focus + caret after the state update repaints the textarea.
    requestAnimationFrame(() => {
      patternRef.current?.focus()
      patternRef.current?.setSelectionRange(caret, caret)
    })
  }

  const toggleFlag = (flag: string): void => {
    onChange({ ...value, flags: value.flags.includes(flag) ? value.flags.replace(flag, '') : value.flags + flag })
  }

  const copy = (kind: 'pattern' | 'literal'): void => {
    const text = kind === 'pattern' ? value.pattern : `/${value.pattern}/${value.flags}`
    window.nodeTerminal.clipboard.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500)
  }

  return (
    <div className="regex-builder">
      <div className="regex-builder__head">
        <span className="regex-builder__title">Regex Builder</span>
        <span className="regex-builder__engine" title={REGEX_ENGINE_NOTE}>
          {REGEX_ENGINE_NAME}
        </span>
      </div>
      <p className="regex-builder__note">{REGEX_ENGINE_NOTE}</p>

      <div className="regex-builder__pattern-row">
        <span className="regex-builder__slash">/</span>
        <textarea
          ref={patternRef}
          className={`regex-builder__pattern${compiled.ok ? '' : ' invalid'}`}
          rows={1}
          spellCheck={false}
          placeholder="pattern"
          value={value.pattern}
          maxLength={MAX_PATTERN_LENGTH}
          onChange={(e) => onChange({ ...value, pattern: e.target.value })}
        />
        <span className="regex-builder__slash">/{value.flags}</span>
      </div>
      {!compiled.ok && value.pattern && <div className="regex-builder__error">{compiled.error}</div>}
      <div className="regex-builder__count">
        {value.pattern.length}/{MAX_PATTERN_LENGTH}
      </div>

      <div className="regex-builder__flags">
        {REGEX_FLAGS.map((f) => (
          <label key={f.flag} className="regex-builder__flag" title={f.description}>
            <input
              type="checkbox"
              checked={value.flags.includes(f.flag)}
              onChange={() => toggleFlag(f.flag)}
            />
            <span>{f.flag}</span>
            <span className="regex-builder__flag-label">{f.label}</span>
          </label>
        ))}
      </div>

      <div className="regex-builder__tabs">
        {REGEX_TOKEN_GROUPS.map((g, i) => (
          <button
            key={g.title}
            type="button"
            className={`regex-builder__tab${i === activeGroup ? ' active' : ''}`}
            onClick={() => setActiveGroup(i)}
          >
            {g.title}
          </button>
        ))}
      </div>
      <div className="regex-builder__tokens">
        {REGEX_TOKEN_GROUPS[activeGroup].tokens.map((t) => (
          <button
            key={t.label}
            type="button"
            className="regex-builder__token"
            title={t.hint}
            onClick={() => insertToken(t)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="regex-builder__sample-row">
        <label className="regex-builder__sample-label" htmlFor="regex-builder-sample">
          Sample text
        </label>
        <span className="regex-builder__count">
          {sample.length}/{MAX_SAMPLE_LENGTH}
          {clampedSample.truncated ? ' (truncated for evaluation)' : ''}
        </span>
      </div>
      <textarea
        id="regex-builder-sample"
        className="regex-builder__sample"
        rows={4}
        spellCheck={false}
        placeholder="Paste text to test your pattern against — evaluated locally, never sent anywhere."
        value={sample}
        maxLength={MAX_SAMPLE_LENGTH}
        onChange={(e) => setSample(e.target.value)}
      />

      <div className="regex-builder__status">
        {!value.pattern.trim() && <span className="regex-builder__muted">Enter a pattern to see matches.</span>}
        {value.pattern.trim() && safe.status === 'running' && <span className="regex-builder__muted">Matching…</span>}
        {safe.status === 'timeout' && <span className="regex-builder__warn">{safe.error}</span>}
        {safe.status === 'error' && <span className="regex-builder__error">{safe.error}</span>}
        {safe.status === 'ok' && (
          <span className="regex-builder__muted">
            {safe.matches.length} match{safe.matches.length === 1 ? '' : 'es'}
            {safe.truncated ? ' (stopped at the display limit)' : ''}
          </span>
        )}
      </div>

      {safe.status === 'ok' && sample && (
        <div className="regex-builder__preview" aria-label="Sample text with matches highlighted">
          {segments.map((seg, i) =>
            seg.matchIndex != null ? (
              <mark key={i} className="regex-builder__mark">
                {seg.text || '​'}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </div>
      )}

      {safe.status === 'ok' && safe.matches.length > 0 && (
        <div className="regex-builder__matches">
          {safe.matches.slice(0, 20).map((m, i) => (
            <div key={i} className="regex-builder__match-row">
              <span className="regex-builder__match-index">#{i + 1}</span>
              <span className="regex-builder__match-text">{m.text || '(empty match)'}</span>
              <span className="regex-builder__match-pos">
                {m.start}–{m.end}
              </span>
              {m.groups.length > 0 && (
                <div className="regex-builder__groups">
                  {m.groups.map((g, gi) => (
                    <span key={gi} className="regex-builder__group-chip">
                      {g.name ?? gi + 1}: {g.value === undefined ? '∅' : `"${g.value}"`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="regex-builder__footer">
        <button type="button" className="regex-builder__copy" onClick={() => copy('pattern')}>
          {copied === 'pattern' ? 'Copied!' : 'Copy pattern'}
        </button>
        <button type="button" className="regex-builder__copy" onClick={() => copy('literal')}>
          {copied === 'literal' ? 'Copied!' : 'Copy as /pattern/flags'}
        </button>
        {onDone && (
          <button type="button" className="regex-builder__done" onClick={onDone}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
