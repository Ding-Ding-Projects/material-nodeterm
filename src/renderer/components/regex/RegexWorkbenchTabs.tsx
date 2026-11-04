import { useEffect, useId, useMemo, useState } from 'react'
import { Button, Chip, Tabs } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { REGEX_TARGETS, convertRegex, grepLines, type RegexTarget } from '../../lib/regex/convert'
import { MAX_TEST_CASES, caseSummary, type RegexTestCase } from '../../lib/regex/lab'
import { useRegexLab } from '../../lib/regex/useRegexLab'
import { regexHistory, useRegexHistory } from '../../lib/regex/history'
import { REGEX_ENGINE_NAME } from '../../lib/regex/engine'
import type { RegexMatchResult } from '../../lib/regex/matcher'
import type { RegexBuilderValue } from './RegexBuilder'

type WorkbenchTab = 'cases' | 'grep' | 'use' | 'bench' | 'history'

const TABS: { id: WorkbenchTab; label: string }[] = [
  { id: 'cases', label: 'Test cases' },
  { id: 'grep', label: 'GREP' },
  { id: 'use', label: 'Use & convert' },
  { id: 'bench', label: 'Benchmark' },
  { id: 'history', label: 'History' }
]

/** How long a valid pattern must sit unchanged before it is recorded in the session history. */
const HISTORY_SETTLE_MS = 1200

export interface RegexWorkbenchTabsProps {
  value: RegexBuilderValue
  onChange: (v: RegexBuilderValue) => void
  /** Whether the pattern compiles; nothing is recorded or run for a pattern that does not. */
  valid: boolean
  sample: string
  /** Matches from the live preview Worker, or null while it has no answer. */
  matches: readonly RegexMatchResult[] | null
}

/**
 * The deeper workbench tabs under the live builder (design/v3 `Regex.dc.html`): assertion-style
 * test cases, GREP over the sample, conversion to other languages with paste-ready code, a
 * benchmark, and this session's pattern history. Every evaluation runs in a time-boxed Worker
 * (useRegexLab / the live preview); conversion is syntax only and says which constructs another
 * engine cannot express rather than guessing.
 */
export function RegexWorkbenchTabs({ value, onChange, valid, sample, matches }: RegexWorkbenchTabsProps) {
  const vocab = useVocabularyMapper()
  const [tab, setTab] = useState<WorkbenchTab>('cases')
  const [cases, setCases] = useState<RegexTestCase[]>([])
  const [draft, setDraft] = useState('')
  const [draftExpect, setDraftExpect] = useState<RegexTestCase['expect']>('match')
  const [target, setTarget] = useState<RegexTarget>('python')
  const [benchNonce, setBenchNonce] = useState(0)
  const [copied, setCopied] = useState(false)
  const history = useRegexHistory()
  const panelPrefix = useId()

  const lab = useRegexLab(valid ? value.pattern : '', value.flags, cases, sample, benchNonce)
  const conversion = useMemo(() => convertRegex(value.pattern, value.flags, target), [value.pattern, value.flags, target])
  const grep = useMemo(() => (matches ? grepLines(sample, matches.map((m) => m.start)) : []), [sample, matches])

  // Record a valid pattern once it has settled, so the history holds what the user worked on
  // rather than every keystroke.
  useEffect(() => {
    if (!valid || !value.pattern.trim()) return
    const t = window.setTimeout(
      () => regexHistory.record({ pattern: value.pattern, flags: value.flags, at: Date.now() }),
      HISTORY_SETTLE_MS
    )
    return () => window.clearTimeout(t)
  }, [valid, value.pattern, value.flags])

  const addCase = () => {
    if (!draft || cases.length >= MAX_TEST_CASES) return
    setCases((c) => [...c, { text: draft, expect: draftExpect }])
    setDraft('')
  }

  const summary = caseSummary(lab.cases)
  const panelId = `${panelPrefix}-${tab}`

  return (
    <section className="md3-regex-lab" aria-label={vocab('Regex workbench')}>
      <Tabs
        items={TABS}
        value={tab}
        onChange={(id) => setTab(id as WorkbenchTab)}
        ariaLabel="Regex workbench tabs"
        className="md3-regex-lab__tabs"
        tabClassName="md3-regex-lab__tab"
        activeTabClassName="md3-regex-lab__tab--on"
        idPrefix={`${panelPrefix}-tab`}
        panelIdPrefix={panelPrefix}
      />
      <div className="md3-regex-lab__panel" role="tabpanel" id={panelId} aria-labelledby={`${panelPrefix}-tab-${tab}`}>
        {tab === 'cases' && (
          <>
            <p className="md3-regex-lab__note">
              {vocab('Each case says whether the text should contain a match. Cases run in a background worker every time the pattern changes.')}
            </p>
            <div className="md3-regex-lab__add">
              <Input
                vocabularyMode="factual"
                value={draft}
                spellCheck={false}
                placeholder={vocab('Text to test…')}
                aria-label={vocab('New test case text')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addCase()
                }}
              />
              <Chip vocabularyMode="factual" selected={draftExpect === 'match'} onClick={() => setDraftExpect('match')}>
                {vocab('Should match')}
              </Chip>
              <Chip vocabularyMode="factual" selected={draftExpect === 'no-match'} onClick={() => setDraftExpect('no-match')}>
                {vocab('Should not match')}
              </Chip>
              <Button variant="tonal" size="small" vocabularyMode="factual" disabled={!draft || cases.length >= MAX_TEST_CASES} onClick={addCase}>
                {vocab('Add case')}
              </Button>
            </div>
            {cases.length > 0 && lab.status === 'ok' && (
              <p className="md3-regex-lab__summary" aria-live="polite">
                {`${summary.passed} ${vocab('passed')} · ${summary.failed} ${vocab('failed')}`}
              </p>
            )}
            {(lab.status === 'timeout' || lab.status === 'error') && <p className="md3-regex-lab__error">{lab.error}</p>}
            <ul className="md3-regex-lab__cases">
              {cases.map((c, i) => {
                const r = lab.status === 'ok' ? lab.cases[i] : undefined
                return (
                  <li key={i} className={`md3-regex-lab__case${r ? (r.pass ? ' is-pass' : ' is-fail') : ''}`}>
                    <span className="md3-regex-lab__case-verdict">{r ? vocab(r.pass ? 'Pass' : 'Fail') : '…'}</span>
                    <code className="md3-regex-lab__case-text">{c.text}</code>
                    <span className="md3-regex-lab__case-expect">{vocab(c.expect === 'match' ? 'should match' : 'should not match')}</span>
                    <Button
                      variant="text"
                      size="small"
                      vocabularyMode="factual"
                      aria-label={`${vocab('Remove case')} ${i + 1}`}
                      onClick={() => setCases((list) => list.filter((_, j) => j !== i))}
                    >
                      {vocab('Remove')}
                    </Button>
                  </li>
                )
              })}
            </ul>
            {cases.length === 0 && <p className="md3-regex-lab__empty">{vocab('No test cases yet.')}</p>}
          </>
        )}

        {tab === 'grep' && (
          <>
            <p className="md3-regex-lab__note">{vocab('Lines of the sample that contain at least one match, with their line numbers.')}</p>
            {matches === null ? (
              <p className="md3-regex-lab__empty">{vocab('Waiting on a valid pattern and sample text.')}</p>
            ) : grep.length === 0 ? (
              <p className="md3-regex-lab__empty">{vocab('No lines match.')}</p>
            ) : (
              <ol className="md3-regex-lab__grep">
                {grep.map((g) => (
                  <li key={g.line}>
                    <span className="md3-regex-lab__grep-line">{g.line}</span>
                    <code className="md3-regex-lab__grep-text">{g.text}</code>
                    {g.hits > 1 && <span className="md3-regex-lab__grep-hits">×{g.hits}</span>}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

        {tab === 'use' && (
          <>
            <div className="md3-regex-lab__targets" role="group" aria-label={vocab('Target language')}>
              {REGEX_TARGETS.map((t) => (
                <Chip key={t.id} vocabularyMode="factual" selected={target === t.id} title={t.engine} onClick={() => setTarget(t.id)}>
                  {t.label}
                </Chip>
              ))}
            </div>
            <p className="md3-regex-lab__note">
              {`${vocab('Converted from')} ${REGEX_ENGINE_NAME} ${vocab('to')} ${REGEX_TARGETS.find((t) => t.id === target)!.engine}. ${vocab('Syntax is rewritten here; the result has not been run on that engine.')}`}
            </p>
            {!value.pattern.trim() ? (
              <p className="md3-regex-lab__empty">{vocab('Enter a pattern to convert it.')}</p>
            ) : conversion.ok ? (
              <>
                <pre className="md3-regex-lab__code">{conversion.code}</pre>
                <Button
                  variant="outlined"
                  size="small"
                  vocabularyMode="factual"
                  onClick={() => {
                    window.nodeTerminal.clipboard.writeText(conversion.code!)
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {vocab(copied ? 'Copied' : 'Copy code')}
                </Button>
              </>
            ) : (
              <div className="md3-regex-lab__error" role="status">
                <strong>{vocab('This pattern cannot be expressed here:')}</strong>
                <ul>
                  {conversion.unsupported.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            {conversion.warnings.length > 0 && (
              <ul className="md3-regex-lab__warnings">
                {conversion.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'bench' && (
          <>
            <p className="md3-regex-lab__note">
              {vocab('Scans the sample text repeatedly in a background worker and reports the time for one full scan. Timing depends on this machine and on what else it is doing.')}
            </p>
            <Button variant="tonal" size="small" vocabularyMode="factual" disabled={!valid || !value.pattern.trim()} onClick={() => setBenchNonce((n) => n + 1)}>
              {vocab(lab.status === 'running' ? 'Running…' : 'Run benchmark')}
            </Button>
            {(lab.status === 'timeout' || lab.status === 'error') && <p className="md3-regex-lab__error">{lab.error}</p>}
            {lab.bench ? (
              <dl className="md3-regex-lab__bench" aria-live="polite">
                <dt>{vocab('Median')}</dt>
                <dd>{`${lab.bench.medianMs.toFixed(3)} ms`}</dd>
                <dt>{vocab('Fastest')}</dt>
                <dd>{`${lab.bench.fastestMs.toFixed(3)} ms`}</dd>
                <dt>{vocab('Slowest')}</dt>
                <dd>{`${lab.bench.slowestMs.toFixed(3)} ms`}</dd>
                <dt>{vocab('Runs')}</dt>
                <dd>{lab.bench.runs}</dd>
                <dt>{vocab('Matches per run')}</dt>
                <dd>{lab.bench.matches}</dd>
              </dl>
            ) : (
              <p className="md3-regex-lab__empty">{vocab('No benchmark run for this pattern yet.')}</p>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            <p className="md3-regex-lab__note">
              {vocab('Patterns you worked on in this session. Kept in memory only, never written to disk, because a pattern can hold pasted private text.')}
            </p>
            {history.length === 0 ? (
              <p className="md3-regex-lab__empty">{vocab('Nothing yet. A valid pattern is recorded once you stop typing.')}</p>
            ) : (
              <>
                <ul className="md3-regex-lab__history">
                  {history.map((h) => (
                    <li key={`${h.pattern}/${h.flags}`}>
                      <Button
                        variant="text"
                        size="small"
                        vocabularyMode="factual"
                        className="md3-regex-lab__history-item"
                        onClick={() => onChange({ pattern: h.pattern, flags: h.flags })}
                      >
                        <code>{`/${h.pattern}/${h.flags}`}</code>
                        <span className="md3-regex-lab__history-time">{new Date(h.at).toLocaleTimeString()}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button variant="text" size="small" vocabularyMode="factual" onClick={() => regexHistory.clear()}>
                  {vocab('Clear history')}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
