import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

/** One action exposed by the compact top-bar overflow surface. */
export interface CompactTopBarMenuItem {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  disabledReason?: string
  icon?: ReactNode
}

export interface CompactTopBarMenuProps {
  items: readonly CompactTopBarMenuItem[]
  label?: string
  className?: string
}

/**
 * The compact top-bar overflow menu. It is deliberately a real anchored surface rather than a
 * second copy of the wide controls: the caller supplies the same callbacks, and this component
 * supplies the local search, regex builder, keyboard path, and focus return.
 */
export function CompactTopBarMenu({ items, label = 'More', className }: CompactTopBarMenuProps): React.JSX.Element {
  const vocab = useLocalizedVocabularyText()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()

  const visible = useMemo(
    () => items.filter((item) => search.test(`${item.label} ${item.id}`)),
    [items, search]
  )

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  const close = (): void => setOpen(false)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`md3-icon-btn md3-compact-more${className ? ` ${className}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={vocab('topBar.more.label', label)}
        title={vocab('topBar.more.label', label)}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
        <span className="md3-compact-more__text">{vocab('topBar.more.label', label)}</span>
      </button>
      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        width={320}
        className="md3-compact-more__popover"
        zIndex={96}
      >
        <div className="md3-compact-more__header">
          <strong>{vocab('topBar.more.label', label)}</strong>
          <span role="status" aria-live="polite">
            {search.error ?? vocab('topBar.more.count', '{count} actions shown', { count: String(visible.length) })}
          </span>
        </div>
        <div className="md3-compact-more__search">
          <label htmlFor="compact-top-bar-search">{vocab('topBar.more.search', 'Search actions')}</label>
          <div className="md3-compact-more__search-control">
            <input
              ref={inputRef}
              id="compact-top-bar-search"
              type="search"
              value={search.value}
              spellCheck={false}
              aria-controls="compact-top-bar-actions"
              onChange={(event) => search.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && search.active) {
                  event.preventDefault()
                  search.reset()
                }
              }}
              placeholder={vocab('topBar.more.placeholder', 'Search AWS, portals, help…')}
            />
            <AnchoredRegexBuilder
              search={search}
              fieldRef={inputRef}
              label={vocab('topBar.more.regex', 'Open regex builder for compact actions')}
              zIndex={100}
            />
          </div>
        </div>
        <div id="compact-top-bar-actions" className="md3-compact-more__list" role="menu" aria-label={vocab('topBar.more.label', label)}>
          {visible.length === 0 ? (
            <p className="md3-compact-more__empty" role="status">{vocab('topBar.more.empty', 'No actions match this search.')}</p>
          ) : visible.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabledReason}
              onClick={() => {
                if (item.disabled) return
                item.onSelect()
                close()
              }}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              <span>{vocab(item.id, item.label)}</span>
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </>
  )
}
