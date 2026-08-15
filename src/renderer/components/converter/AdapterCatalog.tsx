import { useMemo, useState } from 'react'
import {
  CONVERTER_CATEGORY_LABELS,
  CONVERTER_CATEGORY_ORDER,
  type ConverterAdapterDescriptor,
  type ConverterCategoryId
} from '@shared/converter'

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
  const [openCategory, setOpenCategory] = useState<ConverterCategoryId | null>('data')
  const [queries, setQueries] = useState<Record<string, string>>({})
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
        const query = (queries[cat] ?? '').toLowerCase()
        const visible = query
          ? rows.filter(
              (r) =>
                r.label.toLowerCase().includes(query) ||
                r.unavailableReason?.toLowerCase().includes(query)
            )
          : rows
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
              <div className="cv-cat__body">
                <input
                  type="search"
                  className="cv-cat__search"
                  placeholder={`Search ${CONVERTER_CATEGORY_LABELS[cat].toLowerCase()}…`}
                  aria-label={`Search ${CONVERTER_CATEGORY_LABELS[cat]} conversions`}
                  value={queries[cat] ?? ''}
                  onChange={(e) => setQueries((q) => ({ ...q, [cat]: e.target.value }))}
                />
                {visible.length === 0 && <p className="cv-empty-note">No conversions match "{queries[cat]}".</p>}
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
            )}
          </section>
        )
      })}
    </div>
  )
}
