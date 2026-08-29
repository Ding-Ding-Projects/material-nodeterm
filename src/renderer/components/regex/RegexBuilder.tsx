import { useMemo, useRef, useState } from 'react'
import {
  MAX_MATCHES,
  MAX_PATTERN_LENGTH,
  MAX_SAMPLE_LENGTH,
  REGEX_ENGINE_NAME,
  REGEX_ENGINE_NOTE,
  REGEX_FLAGS,
  clampSample,
  escapeForRegex
} from '../../lib/regex/engine'
import { compilePattern, looksCatastrophic } from '../../lib/regex/safety'
import { useSafeEval } from '../../lib/regex/useSafeEval'
import { highlightSegments } from '../../lib/regex/highlight'
import { explainPattern } from '../../lib/regex/explain'
import { REGEX_PRESETS, type RegexPreset } from '../../lib/regex/presets'
import { REGEX_TOKEN_GROUPS, filterTokenGroups, type RegexToken } from './insertTokens'
import { IconDuplicate, IconSearch, IconTrash } from '../icons'
import { IconRegexArrowInsert, IconRegexError, IconRegexQuote, IconRegexWarning } from './regexIcons'
import { TextArea } from '@renderer/ui/md3'

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

/** Splices `token` into the pattern at the pattern field's current cursor/selection. Wrapping
 *  tokens (groups) wrap the selected text instead of inserting an empty pair when something is
 *  selected — select `foo`, click `(…)`, get `(foo)` with the cursor left after it. */
function applyToken(
  el: HTMLInputElement | null,
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

/** Cycles background/foreground token pairs across consecutive matches purely so adjacent
 *  matches in the highlight preview read as visually distinct from one another. */
const MATCH_PALETTE: Array<[string, string]> = [
  ['var(--md-primary-container)', 'var(--md-on-primary-container)'],
  ['var(--md-tertiary-container)', 'var(--md-on-tertiary-container)'],
  ['var(--md-success-container)', 'var(--md-on-success-container)']
]

export function RegexBuilder({ value, onChange, onDone }: RegexBuilderProps): React.JSX.Element {
  const patternRef = useRef<HTMLInputElement>(null)
  const [sample, setSample] = useState('')
  const [replacement, setReplacement] = useState('')
  const [tokQuery, setTokQuery] = useState('')
  const [copied, setCopied] = useState(false)

  const compiled = useMemo(() => compilePattern(value.pattern, value.flags), [value.pattern, value.flags])
  const catastrophicShape = useMemo(() => compiled.ok && looksCatastrophic(value.pattern), [compiled.ok, value.pattern])
  const clampedSample = useMemo(() => clampSample(sample), [sample])
  const safe = useSafeEval(compiled.ok ? value.pattern : '', value.flags, clampedSample.text, replacement)
  const segments = useMemo(
    () => (safe.status === 'ok' ? highlightSegments(clampedSample.text, safe.matches) : []),
    [safe, clampedSample.text]
  )
  const explanation = useMemo(() => explainPattern(value.pattern), [value.pattern])
  const filteredGroups = useMemo(() => filterTokenGroups(REGEX_TOKEN_GROUPS, tokQuery), [tokQuery])

  const insertToken = (token: RegexToken): void => {
    const { next, caret } = applyToken(patternRef.current, value.pattern, token)
    onChange({ ...value, pattern: next.slice(0, MAX_PATTERN_LENGTH) })
    // Restore focus + caret after the state update repaints the field.
    requestAnimationFrame(() => {
      patternRef.current?.focus()
      patternRef.current?.setSelectionRange(caret, caret)
    })
  }

  const usePreset = (preset: RegexPreset): void => {
    onChange({ ...value, pattern: preset.pattern })
    if (preset.sample != null) setSample(preset.sample)
  }

  const toggleFlag = (flag: string): void => {
    onChange({ ...value, flags: value.flags.includes(flag) ? value.flags.replace(flag, '') : value.flags + flag })
  }

  const escapeLiteral = (): void => {
    onChange({ ...value, pattern: escapeForRegex(value.pattern).slice(0, MAX_PATTERN_LENGTH) })
  }

  const clearPattern = (): void => {
    onChange({ ...value, pattern: '' })
  }

  /** Copies the pattern as a `/pattern/flags` literal — the one thing worth a dedicated button
   *  here; a bare pattern string (no delimiters) is one keystroke away by selecting the pattern
   *  field itself, so it doesn't need a second button competing for space in this row. */
  const copyLiteral = (): void => {
    window.nodeTerminal.clipboard.writeText(`/${value.pattern}/${value.flags}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="md3-regex-builder">
      <div className="md3-regex-builder__columns">
      {/* ---- token palette + preset library ---- */}
      <aside className="md3-regex-builder__palette">
        <div className="md3-regex-builder__head">
          <span className="md3-regex-builder__title">Regex Builder</span>
          <span className="md3-regex-builder__engine-chip" title={REGEX_ENGINE_NOTE}>
            {REGEX_ENGINE_NAME}
          </span>
        </div>
        <p className="md3-regex-builder__note">{REGEX_ENGINE_NOTE}</p>
        <div className="md3-regex-builder__token-search">
          <IconSearch />
          <input
            value={tokQuery}
            onChange={(e) => setTokQuery(e.target.value)}
            placeholder="Filter tokens…"
            spellCheck={false}
            aria-label="Filter regex tokens by name or description"
          />
        </div>
        <div className="md3-regex-builder__palette-scroll">
          {filteredGroups.length === 0 && (
            <p className="md3-regex-builder__empty-note">No tokens match &ldquo;{tokQuery}&rdquo;.</p>
          )}
          {filteredGroups.map((g) => (
            <section key={g.title} className="md3-regex-builder__token-section">
              <h3 className="md3-regex-builder__section-title">{g.title}</h3>
              <div className="md3-regex-builder__token-list">
                {g.tokens.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className="md3-regex-builder__token"
                    title={t.hint}
                    onClick={() => insertToken(t)}
                  >
                    <span className="md3-regex-builder__token-glyph">{t.label}</span>
                    <span className="md3-regex-builder__token-desc">{t.hint}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <section className="md3-regex-builder__token-section">
            <h3 className="md3-regex-builder__section-title">Preset library</h3>
            <div className="md3-regex-builder__preset-list">
              {REGEX_PRESETS.map((p) => (
                <button key={p.name} type="button" className="md3-regex-builder__preset" onClick={() => usePreset(p)}>
                  <span className="md3-regex-builder__preset-name">{p.name}</span>
                  <IconRegexArrowInsert />
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>

      {/* ---- pattern / sample / live highlight / substitution ---- */}
      <section className="md3-regex-builder__main">
        <div className="md3-regex-builder__row-head">
          <span className="md3-regex-builder__label">Pattern</span>
          <span className="md3-regex-builder__spacer" />
          <span className="md3-regex-builder__count">
            {value.pattern.length} / {MAX_PATTERN_LENGTH}
          </span>
          <button type="button" className="md3-regex-builder__chip-btn" onClick={copyLiteral}>
            <IconDuplicate />
            {copied ? 'Copied' : 'Copy /literal/'}
          </button>
          <button
            type="button"
            className="md3-regex-builder__chip-btn"
            title="Escape the whole pattern so it matches itself as literal text"
            onClick={escapeLiteral}
          >
            <IconRegexQuote />
            Escape literal
          </button>
          <button
            type="button"
            className="md3-regex-builder__chip-btn md3-regex-builder__chip-btn--muted"
            onClick={clearPattern}
          >
            <IconTrash />
            Clear
          </button>
        </div>
        <div className={`md3-regex-builder__pattern-pill${!compiled.ok && value.pattern ? ' md3-regex-builder__pattern-pill--error' : ''}`}>
          <span className="md3-regex-builder__slash">/</span>
          <input
            ref={patternRef}
            className="md3-regex-builder__pattern-input"
            value={value.pattern}
            spellCheck={false}
            placeholder="pattern"
            maxLength={MAX_PATTERN_LENGTH}
            aria-label="Regex pattern"
            onChange={(e) => onChange({ ...value, pattern: e.target.value })}
          />
          <span className="md3-regex-builder__slash">/</span>
          <span className="md3-regex-builder__flag-string">{value.flags}</span>
        </div>

        <div className="md3-regex-builder__flag-row" role="group" aria-label="Regex flags">
          {REGEX_FLAGS.map((f) => {
            const on = value.flags.includes(f.flag)
            return (
              <button
                key={f.flag}
                type="button"
                className={`md3-regex-builder__flag-chip${on ? ' md3-regex-builder__flag-chip--on' : ''}`}
                title={f.description}
                aria-pressed={on}
                onClick={() => toggleFlag(f.flag)}
              >
                <span className="md3-regex-builder__flag-letter">{f.flag}</span>
                {f.label}
              </button>
            )
          })}
        </div>

        {!compiled.ok && value.pattern && (
          <div className="md3-regex-builder__banner md3-regex-builder__banner--error">
            <IconRegexError />
            {compiled.error}
          </div>
        )}
        {compiled.ok && catastrophicShape && (
          <div className="md3-regex-builder__banner md3-regex-builder__banner--warn">
            <IconRegexWarning />
            This pattern&rsquo;s shape can backtrack catastrophically. Inline filters (menus, lists) refuse a pattern
            like this and fail open; this live preview runs inside a time-boxed Worker, so it can only ever hang
            itself.
          </div>
        )}

        <div className="md3-regex-builder__row-head md3-regex-builder__row-head--mt">
          <span className="md3-regex-builder__label">Sample text</span>
          <span className="md3-regex-builder__spacer" />
          <span className="md3-regex-builder__count">
            {sample.length} / {MAX_SAMPLE_LENGTH}
            {clampedSample.truncated ? ' (truncated for evaluation)' : ''}
          </span>
        </div>
        <TextArea
          className="md3-regex-builder__sample"
          rows={3}
          spellCheck={false}
          placeholder="Paste text to test your pattern against — evaluated locally, never sent anywhere."
          value={sample}
          maxLength={MAX_SAMPLE_LENGTH}
          aria-label="Sample text to test the pattern against"
          onChange={(e) => setSample(e.target.value)}
        />

        <div className="md3-regex-builder__row-head md3-regex-builder__row-head--mt">
          <span className="md3-regex-builder__label">Live highlight</span>
          <span
            className={`md3-regex-builder__match-badge${
              safe.status === 'ok' && safe.matches.length > 0 ? ' md3-regex-builder__match-badge--hit' : ''
            }`}
          >
            {safe.status === 'ok' ? `${safe.matches.length} match${safe.matches.length === 1 ? '' : 'es'}` : '—'}
          </span>
          <span className="md3-regex-builder__hint">
            capped at {MAX_MATCHES} · zero-width safe
          </span>
        </div>
        <div className="md3-regex-builder__highlight" aria-label="Sample text with matches highlighted">
          {!value.pattern.trim() && <span className="md3-regex-builder__muted">Enter a pattern to see matches.</span>}
          {value.pattern.trim() && safe.status === 'running' && <span className="md3-regex-builder__muted">Matching…</span>}
          {safe.status === 'timeout' && <span className="md3-regex-builder__error-text">{safe.error}</span>}
          {safe.status === 'error' && <span className="md3-regex-builder__error-text">{safe.error}</span>}
          {safe.status === 'ok' &&
            (sample
              ? segments.map((seg, i) =>
                  seg.matchIndex != null ? (
                    <mark
                      key={i}
                      className="md3-regex-builder__mark"
                      style={{
                        background: MATCH_PALETTE[seg.matchIndex % MATCH_PALETTE.length][0],
                        color: MATCH_PALETTE[seg.matchIndex % MATCH_PALETTE.length][1]
                      }}
                    >
                      {seg.text || '∅'}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )
              : <span className="md3-regex-builder__muted">Paste sample text above to preview matches.</span>)}
          {safe.status === 'ok' && safe.truncated && (
            <div className="md3-regex-builder__truncated-note">Stopped at the display limit — more matches exist.</div>
          )}
        </div>

        <div className="md3-regex-builder__row-head md3-regex-builder__row-head--mt">
          <span className="md3-regex-builder__label">Substitution</span>
          <span className="md3-regex-builder__hint md3-regex-builder__hint--mono">
            $1 · $&lt;name&gt; · $&amp; · $` · $&apos;
          </span>
        </div>
        <input
          className="md3-regex-builder__replacement"
          value={replacement}
          spellCheck={false}
          placeholder="Replacement…"
          aria-label="Replacement text for substitution preview"
          onChange={(e) => setReplacement(e.target.value)}
        />
        <div className="md3-regex-builder__substituted">
          {safe.status === 'ok' ? (
            sample ? (
              safe.substituted
            ) : (
              <span className="md3-regex-builder__muted">Paste sample text above to preview the substitution.</span>
            )
          ) : (
            <span className="md3-regex-builder__muted">
              {value.pattern.trim() ? 'Waiting on a valid pattern…' : 'Enter a pattern to preview a substitution.'}
            </span>
          )}
        </div>
      </section>

      {/* ---- matches & capture groups + explanation ---- */}
      <aside className="md3-regex-builder__side">
        <h3 className="md3-regex-builder__section-title">Matches &amp; capture groups</h3>
        <div className="md3-regex-builder__match-cards">
          {safe.status === 'ok' &&
            safe.matches.slice(0, 12).map((m, i) => (
              <div key={i} className="md3-regex-builder__match-card">
                <div className="md3-regex-builder__match-card-head">
                  <span className="md3-regex-builder__match-num">#{i + 1}</span>
                  <span className="md3-regex-builder__match-text">{m.text === '' ? '∅ (empty)' : m.text}</span>
                  <span className="md3-regex-builder__match-at">@{m.start}</span>
                </div>
                {m.groups.filter((g) => g.value !== undefined).length > 0 && (
                  <div className="md3-regex-builder__group-rows">
                    {m.groups
                      .filter((g) => g.value !== undefined)
                      .map((g, gi) => (
                        <div key={gi} className="md3-regex-builder__group-row">
                          <span className="md3-regex-builder__group-name">{g.name ?? `$${g.index}`}</span>
                          <span className="md3-regex-builder__group-value">{g.value}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          {safe.status === 'ok' && safe.matches.length === 0 && (
            <div className="md3-regex-builder__no-matches">No matches in the sample.</div>
          )}
          {safe.status !== 'ok' && (
            <div className="md3-regex-builder__no-matches">
              {value.pattern.trim() ? 'Waiting on a valid pattern and sample text.' : 'Enter a pattern to see matches here.'}
            </div>
          )}
        </div>

        <h3 className="md3-regex-builder__section-title md3-regex-builder__section-title--mt">Explanation</h3>
        <div className="md3-regex-builder__explain-rows">
          {explanation.length === 0 && <p className="md3-regex-builder__empty-note">Nothing to explain yet.</p>}
          {explanation.map((e, i) => (
            <div key={i} className="md3-regex-builder__explain-row" style={{ paddingLeft: e.depth * 12 }}>
              <span className="md3-regex-builder__explain-tok">{e.tok}</span>
              <span className="md3-regex-builder__explain-desc">{e.desc}</span>
            </div>
          ))}
        </div>

        <div className="md3-regex-builder__info-card">
          <div className="md3-regex-builder__info-title">Where this field lives</div>
          <p className="md3-regex-builder__info-body">
            Terminal find bar (drives xterm highlight) · command palette · Explorer tree filter (directories never
            hide) · settings search · every flat menu past 6 items. Inline surfaces refuse catastrophic shapes and
            fail open; this preview always runs in a Worker.
          </p>
        </div>
      </aside>
      </div>

      {onDone && (
        <div className="md3-regex-builder__footer">
          <button type="button" className="md3-regex-builder__done" onClick={onDone}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}
