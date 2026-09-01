// The app's own status surface — the Status rail destination. One M3 card per project gate,
// each carrying its stable state emoji, an honest one-line summary, and the recorded evidence
// behind the claim (expandable, filterable, keyboard-operable). See docs/status-surface.md.
//
// EVERY datum here is committed repository data bundled into the renderer at build time:
//   - docs/assets/shots/capture-manifest.json  (?raw import → parsed by the pure core logic)
//   - src/shared/changelog-data.ts             (the generated changelog)
//   - package.json                             (?raw import → the version of this tree)
// Nothing polls a service, nothing reads the filesystem at runtime, and nothing computes a state
// the repo cannot evidence — which is also why this surface works IDENTICALLY on Desktop and
// Server Edition (the server serves the same built renderer bundle; no main-process read exists
// to go missing). Gates whose verdicts the repo does not record render as UNRUN, on purpose:
// a check that has not run is unrun, not passed, and the emoji never upgrades a state.
//
// The pure derivation lives in @shared/project-status — ONE home, not two. It shipped briefly as a
// canonical copy under src/core plus a byte-identical renderer mirror kept honest by a parity test,
// because the composite tsconfig projects share only src/shared and a renderer import of src/core
// fails with TS6307. Putting the module in src/shared instead removes the second copy rather than
// policing it, so the mirror and its guard are both gone. A parity test never stopped drift; it
// only reported drift after someone had already edited one copy.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip } from '../ui/md3'
import { SearchField } from '../ui/md3/SearchField'
import { CHANGELOG_RELEASES } from '@shared/changelog-data'
import captureManifestRaw from '../../../docs/assets/shots/capture-manifest.json?raw'
import packageJsonRaw from '../../../package.json?raw'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import {
  GATE_STATE_META,
  GATE_STATE_ORDER,
  buildProjectStatus,
  describeRecordedAt,
  shortCommit,
  stateCounts,
  type GateState,
  type StatusGateCard,
  type StatusSummaryPart
} from '../../shared/project-status'

function readVersion(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/** How often the "viewing at" heartbeat and the relative ages refresh in place. */
const HEARTBEAT_MS = 30_000

export function statusSummaryParts(card: StatusGateCard): readonly StatusSummaryPart[] {
  return card.summaryParts ?? [{ kind: 'factual', text: card.summary }]
}

export function renderStatusSummary(card: StatusGateCard, vocab: (text: string) => string): string {
  return statusSummaryParts(card)
    .map((part) => (part.kind === 'authored' ? vocab(part.text) : part.text))
    .join('')
}

export function statusSearchCorpus(card: StatusGateCard, meta: { label: string }, vocab: (text: string) => string): string {
  return [
    vocab(card.title),
    renderStatusSummary(card, vocab),
    vocab(meta.label),
    ...card.evidence.flatMap((e) => [vocab(e.label), e.value]),
    ...card.rows.flatMap((row) => [row.labelOwnership === 'authored' ? vocab(row.label) : row.label, row.note])
  ].join(' ')
}

function StatusCard({
  card,
  open,
  nowMs,
  onToggle
}: {
  card: StatusGateCard
  open: boolean
  nowMs: number
  onToggle: () => void
}): JSX.Element {
  const meta = GATE_STATE_META[card.state]
  const vocab = useVocabularyMapper()
  const detailCount = card.evidence.length + card.rows.length
  return (
    <section className={`status-card status-card--${card.state}`} aria-label={`${vocab(card.title)}: ${vocab(meta.label)}`}>
      <div className="status-card__head">
        <span className="status-card__emoji" aria-hidden="true">
          {meta.emoji}
        </span>
        <div className="status-card__titles">
          <h3 className="status-card__title">{vocab(card.title)}</h3>
          <div className="status-card__stateline">
            <span className={`status-chip status-chip--${card.state}`}>{vocab(meta.label)}</span>
            <span className="status-card__age">{vocab('evidence')}: {describeRecordedAt(card.recordedAt, nowMs)}</span>
          </div>
        </div>
        <Button
          variant="text"
          size="small"
          className="status-card__expand"
          vocabularyMode="factual"
          aria-expanded={open}
          aria-controls={`status-evidence-${card.id}`}
          onClick={onToggle}
        >
          {open ? vocab('Hide evidence') : `${vocab('Evidence')} (${detailCount})`}
        </Button>
      </div>
      <p className="status-card__summary">{renderStatusSummary(card, vocab)}</p>
      {open && (
        <div id={`status-evidence-${card.id}`} className="status-card__detail">
          <dl className="status-card__facts">
            {card.evidence.map((e, i) => (
              <div className="status-card__fact" key={`${e.label}-${i}`}>
                <dt>{vocab(e.label)}</dt>
                <dd>
                  {e.href ? (
                    <a href={e.href} target="_blank" rel="noreferrer">
                      {e.value}
                    </a>
                  ) : (
                    e.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {card.rows.length > 0 && (
            <ul className="status-card__rows">
              {card.rows.map((r) => (
                <li key={r.id} className={`status-row status-row--${r.state}`}>
                  <span aria-hidden="true">{GATE_STATE_META[r.state].emoji}</span>
                  <span className="status-row__label">{r.labelOwnership === 'authored' ? vocab(r.label) : r.label}</span>
                  <span className="status-row__note">{r.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function StatusSurface(): JSX.Element {
  const vocab = useVocabularyMapper()
  // Bundled, committed evidence — computed once; nothing here changes while the app runs.
  const model = useMemo(
    () =>
      buildProjectStatus({
        manifestRaw: captureManifestRaw,
        releases: CHANGELOG_RELEASES,
        currentVersion: readVersion(packageJsonRaw)
      }),
    []
  )
  const counts = useMemo(() => stateCounts(model.cards), [model])

  // Expansion survives filtering: hiding a card must not forget that the user opened it.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [stateFilter, setStateFilter] = useState<GateState | 'all'>('all')
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // The heartbeat: recorded evidence is frozen at build time, but the AGES beside it refresh in
  // place so the surface is visibly current about how old that evidence is right now.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [])

  const ordered = useMemo(() => {
    const rank = new Map(GATE_STATE_ORDER.map((s, i) => [s, i]))
    // Stable worst-first sort: a failure never sits below a pile of green.
    return [...model.cards].sort(
      (a, b) => (rank.get(a.state) ?? 99) - (rank.get(b.state) ?? 99)
    )
  }, [model])

  const visible = ordered.filter(
    (c) =>
      (stateFilter === 'all' || c.state === stateFilter) &&
      search.test(statusSearchCorpus(c, GATE_STATE_META[c.state], vocab))
  )

  const toggleCard = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const version = readVersion(packageJsonRaw)

  return (
    <div className="md3-status-screen" data-screen-label="Status" data-easter-surface="status">
      <div className="md3-status-screen__head">
        <div className="md3-status-screen__heading">
          <h2 className="md3-status-screen__title">{vocab('Status')}</h2>
          <div className="md3-status-screen__subtitle">
            {vocab('What this build can prove about its own gates — recorded evidence only, bundled at build time. A check that has not run is unrun, not passed.')}
          </div>
        </div>
        <dl className="md3-status-screen__baseline">
          <div>
            <dt>{vocab('Verified baseline')}</dt>
            <dd>
              {model.baselineCommit
                ? `${vocab('capture commit')} ${shortCommit(model.baselineCommit)}`
                : vocab('no capture baseline recorded')}
            </dd>
          </div>
          <div>
            <dt>{vocab('Version in this tree')}</dt>
            <dd>{version ?? vocab('unreadable')}</dd>
          </div>
          <div>
            <dt>{vocab('Freshest recorded evidence')}</dt>
            <dd>{describeRecordedAt(model.newestRecordedAt, nowMs)}</dd>
          </div>
          <div>
            <dt>{vocab('Viewing at')}</dt>
            <dd>
              {new Date(nowMs).toLocaleTimeString()} — {vocab('ages refresh in place; the evidence itself is whatever the repository recorded')}
            </dd>
          </div>
        </dl>
      </div>

      <div className="md3-status-screen__toolbar">
        <SearchField
          ref={searchInputRef}
          className="md3-status-search"
          dense
          placeholder={search.mode === 'regex' ? 'Filter gates (regex)…' : 'Filter gates…'}
          value={search.value}
          onChange={(e) => search.setValue(e.target.value)}
          aria-label="Filter status checks"
          trailingSlot={
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label={vocab('Regex — status gate filter')} />
          }
        />
        {search.error && (
          <div className="md3-status-screen__search-error" role="alert">
            {search.error}
          </div>
        )}
        <div className="md3-status-filters" role="group" aria-label={vocab('Filter status checks by state')}>
          <Chip
            selected={stateFilter === 'all'}
            vocabularyMode="factual"
            className={`status-filter-chip${stateFilter === 'all' ? ' status-filter-chip--on' : ''}`}
            onClick={() => setStateFilter('all')}
          >
            {`${vocab('All')} (${model.cards.length})`}
          </Chip>
          {GATE_STATE_ORDER.map((s) => (
            <Chip
              key={s}
              selected={stateFilter === s}
              vocabularyMode="factual"
              className={`status-filter-chip${stateFilter === s ? ' status-filter-chip--on' : ''}`}
              disabled={counts[s] === 0}
              title={counts[s] === 0 ? vocab('No gate is in this state right now') : undefined}
              onClick={() => setStateFilter(s)}
            >
              <span aria-hidden="true">{GATE_STATE_META[s].emoji}</span> {vocab(GATE_STATE_META[s].label)} ({counts[s]})
            </Chip>
          ))}
        </div>
      </div>

      <div className="md3-status-screen__body">
        {visible.length === 0 ? (
          <p className="md3-status-screen__empty">
             {vocab('No gate matches the current filter')}
             {stateFilter !== 'all' ? ` (${vocab('state')}: ${vocab(GATE_STATE_META[stateFilter].label)})` : ''}
             {search.active ? ` ${vocab('and search')}` : ''}. {vocab('Clearing them shows all')} {model.cards.length} {vocab('gates')}.
          </p>
        ) : (
          <div className="md3-status-grid">
            {visible.map((card) => (
              <StatusCard
                key={card.id}
                card={card}
                open={expanded.has(card.id)}
                nowMs={nowMs}
                onToggle={() => toggleCard(card.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
