import { useEffect, useMemo, useRef, useState } from 'react'
import { useRegexSearchField, type RegexSearchFieldState } from '../../lib/regex/useRegexSearchField'

export interface MenuFilterItem {
  /** Stable identity for keyboard tracking (index survives a re-filter better with this). */
  id: string
  /** What the filter matches against — plain text substring, or the regex pattern in regex mode. */
  label: string
  disabled?: boolean
}

export interface UseMenuFilterResult<T extends MenuFilterItem> {
  search: RegexSearchFieldState
  /** Items whose label currently matches (plain text or regex — an empty query matches all). */
  filtered: T[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  inputRef: React.RefObject<HTMLInputElement>
  /** Wire this on the filter `<input>`'s onKeyDown: ArrowUp/Down move `activeIndex`, Enter
   *  activates the active item (via `onActivate`), Escape clears the filter then closes. */
  onInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * Backs every filterable menu/dropdown in the app — a keyboard-focusable filter field at the head
 * of a list of items, filtering LOCALLY without changing what any item does. See FilterableMenu.md
 * (docs/regex-builder.md) for the full contract this hook exists to satisfy.
 */
export function useMenuFilter<T extends MenuFilterItem>(
  items: T[],
  opts?: { onActivate?: (item: T) => void; onEmptyEscape?: () => void }
): UseMenuFilterResult<T> {
  const search = useRegexSearchField()
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => items.filter((it) => search.test(it.label)), [items, search])

  // Keep the active row in range as the filtered set shrinks/grows (typing narrows it every
  // keystroke) rather than pointing at an index that no longer exists.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
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

  return { search, filtered, activeIndex, setActiveIndex, inputRef, onInputKeyDown }
}
