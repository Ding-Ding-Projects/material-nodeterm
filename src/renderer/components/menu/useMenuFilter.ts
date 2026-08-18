import { useEffect, useRef, useState } from 'react'
import type { RegexSearchFieldState } from '../../lib/regex/useRegexSearchField'

export interface MenuFilterItem {
  /** Stable identity for keyboard tracking (index survives a re-filter better with this). */
  id: string
  /** Display/debug label — NOT used to decide matching. Whether an item belongs in `items` is the
   *  caller's decision (see the hook doc below), because only the caller knows the matching rule
   *  for its own menu shape (a flat menu matches an item's own label; a sectioned menu also
   *  matches a submenu on a child's label — one hardcoded `search.test(it.label)` here couldn't
   *  serve both). */
  label: string
  disabled?: boolean
}

export interface UseMenuFilterResult<T extends MenuFilterItem> {
  search: RegexSearchFieldState
  /** Exactly the `items` passed in, unchanged — kept under this name because `FilterableMenuHeader`
   *  and every render site already read `.filtered`. */
  filtered: T[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  inputRef: React.RefObject<HTMLInputElement>
  /** Wire this on the filter `<input>`'s onKeyDown: ArrowUp/Down move `activeIndex`, Enter
   *  activates the active item (via `onActivate`), Escape clears the filter then closes. */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Keyboard bookkeeping for a filterable list: which row is "active" (arrow keys move it, Enter
 * activates it via `onActivate`), kept in range as `items` shrinks/grows every keystroke.
 *
 * `items` must already be the CALLER's filtered candidate list for the current query — this hook
 * does not call `search.test` itself. It used to (`items.filter(it => search.test(it.label))`),
 * but that hardcoded "match on this exact field" is wrong once a caller's matching rule is more
 * than one field (ContextMenu.tsx's sectioned menus match a submenu row on a CHILD's label too,
 * via `menuRowVisibility`) — a single `label` string can't encode an OR-of-several-fields test.
 * Own your `search` state (`useRegexSearchField`) and your matching decision; hand this hook only
 * the result plus that same `search` object (`FilterableMenuHeader` binds directly to it).
 */
export function useMenuFilter<T extends MenuFilterItem>(
  items: T[],
  search: RegexSearchFieldState,
  opts?: { onActivate?: (item: T) => void; onEmptyEscape?: () => void }
): UseMenuFilterResult<T> {
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the active row in range as the caller's filtered set shrinks/grows (typing narrows it
  // every keystroke) rather than pointing at an index that no longer exists.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[activeIndex]
      if (item && !item.disabled) opts?.onActivate?.(item)
    } else if (e.key === 'Escape') {
      if (search.active) {
        e.preventDefault()
        e.stopPropagation()
        search.reset()
      } else {
        opts?.onEmptyEscape?.()
      }
    }
  }

  return { search, filtered: items, activeIndex, setActiveIndex, inputRef, onInputKeyDown }
}
