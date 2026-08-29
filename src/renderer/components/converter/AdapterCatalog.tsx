import { useMemo, useRef, useState } from 'react'
import {
  CONVERTER_CATEGORY_LABELS,
  CONVERTER_CATEGORY_ORDER,
  type ConverterAdapterDescriptor,
  type ConverterCategoryId
} from '@shared/converter'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'

export interface AdapterCatalogProps {
  catalog: ConverterAdapterDescriptor[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Adapter ids to visually highlight as "detected compatible" (from converter.detect()). Purely
   *  informational — every row (bundled or disabled) stays visible and every bundled row stays
   *  selectable regardless of this hint. */
  suggestedIds?: string[]
}

function CategoryBody({
  category,
  rows,
  selectedId,
  onSelect,
  suggested
}: {
  category: ConverterCategoryId
  rows: ConverterAdapterDescriptor[]
  selectedId: string | null
  onSelect: (id: string) => void
  suggested: Set<string>
}) {
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(
    () => rows.filter((r) => search.test(`${r.label} ${r.unavailableReason ?? ''}`)),
    [rows, search]
  )

  return (
    <div className="cv-cat__body">
      <div className="menu-filter cv-cat__search">
        <div className="menu-filter__row">
          <input
            ref={inputRef}
            type="search"
            className="menu-filter__input"
            placeholder={`Search ${CONVERTER_CATEGORY_LABELS[category].toLowerCase()}…`}
            aria-label={`Search ${CONVERTER_CATEGORY_LABELS[category]} conversions`}
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
          />
          <AnchoredRegexBuilder
            search={search}
            fieldRef={inputRef}
            label={`Regex — ${CONVERTER_CATEGORY_LABELS[category]} conversions`}
            zIndex={40}
          />
        </div>
        {search.error && <div className="menu-filter__error" role="alert">{search.error}</div>}
      </div>
      {visible.length === 0 && <p className="cv-empty-note">No conversions match “{search.value}”.</p>}
      <ul className="cv-rows">
        {visible.map((row) => {
          const isSuggested = suggested.has(row.id)
          const isSelected = selectedId === row.id
          return (
            <li key={row.id}>
              <button
                className={`cv-row${row.available ? '' : ' cv-row--disabled'}${
                  isSelected ? ' cv-row--selected' : ''
                }${isSuggested ? ' cv-row--suggested' : ''}`}
                disabled={!row.available}
                aria-pressed={isSelected}
                title={
                  row.available
                    ? row.lossy
                      ? `Lossy conversion: ${row.lossyNotes?.join(' ') ?? ''}`
                      : row.label
                    : `Not available — ${row.unavailableReason}`
                }
                onClick={() => row.available && onSelect(row.id)}
              >
                <span className="cv-row__label">{row.label}</span>
                {row.lossy && row.available && <span className="cv-row__badge cv-row__badge--lossy">lossy</span>}
                {isSuggested && row.available && (
                  <span className="cv-row__badge cv-row__badge--suggested">detected</span>
                )}
                {!row.available && <span className="cv-row__reason">{row.unavailableReason}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Categorized, searchable catalog of every known conversion, bundled AND disabled, per
 *  docs/file-converter.md. Every category renders, even one that is entirely disabled, so a gap
 *  in bundled coverage is visible rather than silently hidden. Every category owns a plain-text
 *  search field with its adjacent anchored full regex builder. */
export function AdapterCatalog({ catalog, selectedId, onSelect, suggestedIds }: AdapterCatalogProps) {
  const [openCategory, setOpenCategory] = useState<ConverterCategoryId | null>('data')
  const suggested = useMemo(() => new Set(suggestedIds ?? []), [suggestedIds])

  const byCategory = useMemo(() => {
    const out = {} as Record<ConverterCategoryId, ConverterAdapterDescriptor[]>
    for (const c of CONVERTER_CATEGORY_ORDER) out[c] = []
    for (const row of catalog) out[row.category].push(row)
    return out
  }, [catalog])

  return (
    <div className="cv-catalog" role="tree" aria-label="Conversion catalog by category">
      {CONVERTER_CATEGORY_ORDER.map((cat) => {
        const rows = byCategory[cat]
        const open = openCategory === cat
        const bundledCount = rows.filter((r) => r.available).length
        return (
          <section className="cv-cat" key={cat}>
            <button
              className="cv-cat__head"
              aria-expanded={open}
              onClick={() => setOpenCategory(open ? null : cat)}
            >
              <span className="cv-cat__chevron" aria-hidden>
                {open ? '▾' : '▸'}
              </span>
              <span className="cv-cat__label">{CONVERTER_CATEGORY_LABELS[cat]}</span>
              <span className="cv-cat__count">
                {bundledCount}/{rows.length} available
              </span>
            </button>
            {open && (
              <CategoryBody
                category={cat}
                rows={rows}
                selectedId={selectedId}
                onSelect={onSelect}
                suggested={suggested}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}
