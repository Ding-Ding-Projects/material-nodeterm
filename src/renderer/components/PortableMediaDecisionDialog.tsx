import { useMemo, useRef, useState } from 'react'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import type { PortableMediaCandidate, PortableMediaDecision } from '../../core/portable-media-assets'

export interface PortableMediaDecisionDialogProps {
  candidates: readonly PortableMediaCandidate[]
  onDecisions: (decisions: ReadonlyMap<string, PortableMediaDecision>) => void
  onCancel: () => void
}

/** Guided Include/Omit/Locate Later picker for portable project-owned media. */
export function PortableMediaDecisionDialog({ candidates, onDecisions, onCancel }: PortableMediaDecisionDialogProps): React.JSX.Element {
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const [decisions, setDecisions] = useState(() => new Map(candidates.map((candidate) => [candidate.assetId, candidate.decision] as const)))
  const filtered = useMemo(() => candidates.filter((candidate) => search.test(`${candidate.label} ${candidate.sourceName} ${candidate.kind}`)), [candidates, search])
  const choose = (assetId: string, decision: PortableMediaDecision): void => {
    setDecisions((current) => new Map(current).set(assetId, decision))
  }
  return (
    <div className="md3-dialog portable-media-decision" role="dialog" aria-modal="true" aria-label="Choose portable media assets">
      <header className="md3-dialog__header"><h2>Choose portable media</h2><p>Included media travels by content address. Machine-local sources never travel.</p></header>
      <div className="menu-filter">
        <div className="menu-filter__row">
          <input ref={inputRef} className="menu-filter__input" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={search.mode === 'regex' ? 'Filter media… (regex)' : 'Filter media…'} aria-label="Filter portable media" />
          <AnchoredRegexBuilder search={search} fieldRef={inputRef} label="Regex — portable media" />
        </div>
        {search.error && <div className="menu-filter__error" role="alert">{search.error}</div>}
      </div>
      <div className="portable-media-decision__list" role="list" aria-label="Portable media choices">
        {filtered.length === 0 ? <p className="portable-media-decision__empty">No media matches this filter.</p> : filtered.map((candidate) => (
          <article key={candidate.assetId} className="portable-media-decision__row" role="listitem">
            <div><strong>{candidate.label}</strong><small>{candidate.kind} · {candidate.sourceName}</small>{candidate.reason && <small>{candidate.reason}</small>}</div>
            <div className="portable-media-decision__actions" role="group" aria-label={`Decision for ${candidate.label}`}>
              {(['include', 'omit', 'locate-later'] as const).map((decision) => <button key={decision} type="button" aria-pressed={decisions.get(candidate.assetId) === decision} onClick={() => choose(candidate.assetId, decision)}>{decision === 'include' ? 'Include' : decision === 'omit' ? 'Omit' : 'Locate Later'}</button>)}
            </div>
          </article>
        ))}
      </div>
      <footer className="md3-dialog__actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="md3-button--filled" onClick={() => onDecisions(decisions)}>Continue with choices</button></footer>
    </div>
  )
}

