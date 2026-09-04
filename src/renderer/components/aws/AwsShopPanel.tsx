import { useMemo, useRef, useState } from 'react'
import { AWS_CATALOG, type AwsCatalogCategory, type AwsCatalogEntry } from '@shared/aws-catalog'
import { searchAwsCatalog } from '@shared/aws-catalog'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { Button, Checkbox, SearchField } from '../../ui/md3'

const CATEGORIES: Array<AwsCatalogCategory | 'all'> = [
  'all', 'Identity', 'Compute', 'Storage', 'Networking', 'Observability', 'Infrastructure', 'Developer tools'
]

export interface AwsShopPanelProps {
  universeId: string
  onCreate: (entry: AwsCatalogEntry) => void
  onClose?: () => void
}

/**
 * The AWS Shop's guided catalog. It is deliberately renderer-only: selecting a row creates a
 * typed blueprint, while credentials, account bindings, and AWS calls stay behind later lanes.
 */
export function AwsShopPanel({ universeId, onCreate, onClose }: AwsShopPanelProps) {
  const [category, setCategory] = useState<AwsCatalogCategory | 'all'>('all')
  const [includeUnavailable, setIncludeUnavailable] = useState(true)
  const search = useRegexSearchField()
  const inputRef = useRef<HTMLInputElement>(null)
  const result = useMemo(
    () => searchAwsCatalog({
      query: search.value,
      mode: search.mode,
      flags: search.flags,
      category,
      includeUnavailable,
      scope: 'aws-universe'
    }),
    [category, includeUnavailable, search.flags, search.mode, search.value]
  )

  return (
    <section className="aws-shop" aria-label="AWS Shop">
      <header className="aws-shop__header">
        <div>
          <p className="aws-shop__eyebrow">AWS Universe</p>
          <h2>AWS Shop</h2>
          <p>Choose a typed AWS operation blueprint. No AWS operation starts from this catalog.</p>
        </div>
        {onClose ? <Button variant="text" onClick={onClose}>Close</Button> : null}
      </header>
      <div className="aws-shop__toolbar">
        <div className="aws-shop__search">
          <SearchField
            ref={inputRef}
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
            placeholder={search.mode === 'regex' ? 'Search AWS catalog with regex…' : 'Search AWS catalog…'}
            aria-label="Search AWS catalog"
            trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={inputRef} label="Regex builder for AWS catalog" />}
          />
        </div>
        <label className="aws-shop__toggle">
          <Checkbox checked={includeUnavailable} onChange={(event) => setIncludeUnavailable(event.target.checked)} />
          Show unavailable entries
        </label>
      </div>
      <div className="aws-shop__categories" role="tablist" aria-label="AWS catalog categories">
        {CATEGORIES.map((item) => (
          <Button
            variant={category === item ? 'tonal' : 'text'}
            size="small"
            role="tab"
            key={item}
            aria-selected={category === item}
            className={category === item ? 'is-selected' : ''}
            onClick={() => setCategory(item)}
          >
            {item === 'all' ? 'All' : item}
          </Button>
        ))}
      </div>
      {search.error || result.error ? <p className="aws-shop__error" role="alert">{search.error ?? result.error}</p> : null}
      <p className="aws-shop__count" aria-live="polite">{result.matchedCount} catalog entries shown in universe {universeId}</p>
      <div className="aws-shop__list" role="listbox" aria-label="AWS catalog entries">
        {result.entries.length === 0 ? <p className="aws-shop__empty">No AWS catalog entries match this search.</p> : null}
        {result.entries.map((entry) => {
          const unavailable = entry.availability.state === 'unavailable'
          const nextAction = unavailable ? entry.availability.nextAction : undefined
          return (
            <article className={`aws-shop__entry${unavailable ? ' is-unavailable' : ''}`} key={entry.id} role="option" aria-disabled={unavailable}>
              <div className="aws-shop__entry-copy">
                <span className="aws-shop__category">{entry.category}</span>
                <h3>{entry.label}</h3>
                <p>{entry.description}</p>
                <p className="aws-shop__availability">
                  {unavailable ? `Unavailable: ${entry.availability.reason}` : `Available: ${entry.availability.reason}`}
                </p>
                {nextAction ? <p className="aws-shop__next">Next: {nextAction}</p> : null}
              </div>
              <Button variant="filled" disabled={unavailable} title={nextAction} onClick={() => onCreate(entry)}>
                Create blueprint
              </Button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export { AWS_CATALOG }
