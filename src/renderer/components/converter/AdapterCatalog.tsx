import { useMemo, useRef, useState } from 'react'
import {
  CONVERTER_CATEGORY_LABELS,
  CONVERTER_CATEGORY_ORDER,
  type ConverterAdapterDescriptor,
  type ConverterCategoryId
} from '@shared/converter'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { copy, fact, mapOwnedSentence } from '../../lib/personalVocabulary/ownedCopy'

export interface AdapterCatalogProps {
  catalog: ConverterAdapterDescriptor[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Adapter ids to visually highlight as "detected compatible" (from converter.detect()). Purely
   *  informational — every row (bundled or disabled) stays visible and every bundled row stays
   *  selectable regardless of this hint. */
  suggestedIds?: string[]
}

/** Categorized, searchable catalog of every known conversion — bundled AND disabled, per
 *  docs/file-converter.md. Every category renders, even one that is entirely disabled, so a gap
 *  in bundled coverage is visible rather than silently hidden. Each category has its own plain-text
 *  search box (not the full anchored regex builder — see the panel's own doc note on that gap). */
export function AdapterCatalog({ catalog, selectedId, onSelect, suggestedIds }: AdapterCatalogProps) {
  const vocab = useVocabularyMapper()
  const [openCategory, setOpenCategory] = useState<ConverterCategoryId | null>('data')
  const suggested = useMemo(() => new Set(suggestedIds ?? []), [suggestedIds])

  const byCategory = useMemo(() => {
    const out = {} as Record<ConverterCategoryId, ConverterAdapterDescriptor[]>
    for (const c of CONVERTER_CATEGORY_ORDER) out[c] = []
    for (const row of catalog) out[row.category].push(row)
    return out
  }, [catalog])

  return (
    <div className="cv-catalog" role="tree" aria-label={vocab('Conversion catalog by category')}>
      {CONVERTER_CATEGORY_ORDER.map((cat) => {
        const rows = byCategory[cat]
        const open = openCategory === cat
        return (
          <AdapterCategory key={cat} category={cat} rows={rows} open={open} suggested={suggested} selectedId={selectedId} onSelect={onSelect} onToggle={() => setOpenCategory(open ? null : cat)} vocab={vocab} />
        )
      })}
    </div>
  )
}

export function adapterSearchCorpus(row: ConverterAdapterDescriptor): string {
  return `${row.id} ${row.label} ${row.unavailableReason ?? ''}`
}

function AdapterCategory({
  category,
  rows,
  open,
  suggested,
  selectedId,
  onSelect,
  onToggle,
  vocab
}: {
  category: ConverterCategoryId
  rows: ConverterAdapterDescriptor[]
  open: boolean
  suggested: ReadonlySet<string>
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: () => void
  vocab: (text: string) => string
}): JSX.Element {
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const categoryLabel = vocab(CONVERTER_CATEGORY_LABELS[category])
  const visible = rows.filter((row) => search.test(adapterSearchCorpus(row)))
  const bundledCount = rows.filter((row) => row.available).length
  return (
    <section className="cv-cat">
      <button className="cv-cat__head" aria-expanded={open} onClick={onToggle}>
        <span className="cv-cat__chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="cv-cat__label">{categoryLabel}</span>
        <span className="cv-cat__count">{mapOwnedSentence(vocab, [fact(`${bundledCount}/${rows.length}`), copy(' available')])}</span>
      </button>
      {open && (
        <div className="cv-cat__body">
          <div className="cv-cat__search-wrap">
            <input
              ref={searchInputRef}
              type="search"
              className="cv-cat__search"
              placeholder={vocab(`Search ${CONVERTER_CATEGORY_LABELS[category].toLowerCase()}…`)}
              aria-label={vocab(`Search ${CONVERTER_CATEGORY_LABELS[category]} conversions`)}
              value={search.value}
              onChange={(e) => search.setValue(e.target.value)}
            />
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label={`${categoryLabel} regex search`} />
          </div>
          {search.error && <p className="cv-empty-note" role="alert">{search.error}</p>}
          {visible.length === 0 && <p className="cv-empty-note">{mapOwnedSentence(vocab, [copy('No conversions match "'), fact(search.value), copy('".')])}</p>}
          <ul className="cv-rows">
            {visible.map((row) => {
              const isSuggested = suggested.has(row.id)
              const isSelected = selectedId === row.id
              return (
                <li key={row.id}>
                  <button
                    className={`cv-row${row.available ? '' : ' cv-row--disabled'}${isSelected ? ' cv-row--selected' : ''}${isSuggested ? ' cv-row--suggested' : ''}`}
                    disabled={!row.available}
                    aria-pressed={isSelected}
                    title={row.available
                      ? (row.lossy
                        ? mapOwnedSentence(vocab, [copy('Lossy conversion: '), fact(row.lossyNotes?.join(' ') ?? '')])
                        : row.label)
                      : mapOwnedSentence(vocab, [copy('Not available — '), fact(row.unavailableReason ?? '')])}
                    onClick={() => row.available && onSelect(row.id)}
                  >
                    <span className="cv-row__label">{row.label}</span>
                    {row.lossy && row.available && <span className="cv-row__badge cv-row__badge--lossy">{vocab('lossy')}</span>}
                    {isSuggested && row.available && <span className="cv-row__badge cv-row__badge--suggested">{vocab('detected')}</span>}
                    {!row.available && <span className="cv-row__reason">{row.unavailableReason}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
