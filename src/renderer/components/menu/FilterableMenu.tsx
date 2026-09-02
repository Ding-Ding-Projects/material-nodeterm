import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import type { UseMenuFilterResult, MenuFilterItem } from './useMenuFilter'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { Input } from '../../ui/Input'

interface FilterableMenuHeaderProps<T extends MenuFilterItem> {
  filter: UseMenuFilterResult<T>
  placeholder?: string
  /** Accessible label for the anchored builder's trigger (pass a menu-specific one when several
   *  filterable menus can be open on one screen). */
  regexLabel?: string
  /** Forwarded to AnchoredRegexBuilder — pass the host menu's own z-index (or higher) so the
   *  regex builder paints above a menu that overrode its stacking order. */
  zIndex?: number
}

/**
 * The head of a filterable menu/dropdown: a keyboard-focusable filter field plus its own anchored
 * regex builder, and a screen-reader-only live count of what survived the filter. Drop this at
 * the top of any menu/dropdown body and drive the item list from the SAME `filter.filtered` array
 * — see ContextMenu.tsx for the reference wiring (menus with >5 flat items).
 */
export function FilterableMenuHeader<T extends MenuFilterItem>({
  filter,
  placeholder = 'Filter…',
  regexLabel,
  zIndex
}: FilterableMenuHeaderProps<T>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const visiblePlaceholder = vocab(placeholder)
  const visibleRegexLabel = vocab(regexLabel ?? 'Regex — menu filter')
  return (
    <div className="menu-filter" onMouseDown={(e) => e.stopPropagation()}>
      <div className="menu-filter__row">
        <Input
          ref={filter.inputRef}
          type="search"
          vocabularyMode="factual"
          className="menu-filter__input"
          value={filter.search.value}
          spellCheck={false}
          placeholder={filter.search.mode === 'regex' ? `${visiblePlaceholder} (regex)` : visiblePlaceholder}
          aria-label={visiblePlaceholder}
          onChange={(e) => filter.search.setValue(e.target.value)}
          onKeyDown={filter.onInputKeyDown}
        />
        <AnchoredRegexBuilder
          search={filter.search}
          fieldRef={filter.inputRef}
          label={visibleRegexLabel}
          zIndex={zIndex}
        />
      </div>
      {filter.search.error && <div className="menu-filter__error">{vocab(filter.search.error)}</div>}
      <span className="sr-only" role="status" aria-live="polite">
        {filter.filtered.length} result{filter.filtered.length === 1 ? '' : 's'}
      </span>
    </div>
  )
}
