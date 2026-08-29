import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { useDialogStack } from '../dialog-stack'
import { IconGroup } from '../icons'

export interface GroupPickerOption {
  id: string
  title: string
  color?: string
  /** How many nodes are already inside this frame — shown so the picker isn't just a bare name
   *  list; it's what tells the user "Feature work (4)" from "Feature work (empty)". */
  memberCount: number
}

interface GroupPickerDialogProps {
  /** What's being moved, for the accessible name and the empty state — "1 node" / "3 nodes". */
  count: number
  groups: GroupPickerOption[]
  onPick: (groupId: string) => void
  onCancel: () => void
}

/**
 * "Add to existing group…" — the picker every move-into-group action opens, per
 * docs/appearance.md's contract: a searchable listbox (own anchored regex builder, plain text
 * default), never a menu item per group. The context menu that spawned this has already closed
 * by the time it renders (its own portal unmounted with it), so this is its own top-level modal
 * rather than something anchored to a DOM node that no longer exists — it still paints its own
 * surface, stays inside the viewport, and is fully keyboard-operable.
 */
export function GroupPickerDialog({ count, groups, onPick, onCancel }: GroupPickerDialogProps): React.JSX.Element {
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const isTop = useDialogStack()

  const filtered = useMemo(
    () => groups.filter((g) => search.test(g.title || 'Group')),
    [groups, search]
  )

  // Re-clamp whenever the filtered set changes shape, so a query that shrinks the list never
  // leaves the highlighted row pointing past its end (or at a row Enter can no longer reach).
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        const target = filtered[activeIndex]
        if (target) {
          e.preventDefault()
          onPick(target.id)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isTop, filtered, activeIndex, onPick, onCancel])

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    // jsdom (unit tests) has no scrollIntoView implementation — guard rather than crash the effect.
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  return createPortal(
    <>
      <div className="group-picker__backdrop" onClick={onCancel} />
      <div
        className="group-picker"
        role="dialog"
        aria-label={`Add ${count === 1 ? '1 node' : `${count} nodes`} to existing group`}
      >
        <div className="group-picker__title">
          Add {count === 1 ? '1 node' : `${count} nodes`} to existing group
        </div>
        <div className="menu-filter group-picker__search">
          <div className="menu-filter__row">
            <input
              ref={inputRef}
              className="menu-filter__input"
              value={search.value}
              spellCheck={false}
              placeholder={search.mode === 'regex' ? 'Filter groups… (regex)' : 'Filter groups…'}
              aria-label="Filter groups"
              onChange={(e) => search.setValue(e.target.value)}
            />
            <AnchoredRegexBuilder search={search} fieldRef={inputRef} label="Regex — group picker" zIndex={93} />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>
        <div
          ref={listRef}
          className="group-picker__list"
          role="listbox"
          aria-label="Groups"
          tabIndex={-1}
        >
          {filtered.length === 0 ? (
            <div className="group-picker__empty">
              {groups.length === 0 ? 'No groups yet.' : 'No groups match that filter.'}
            </div>
          ) : (
            filtered.map((g, idx) => (
              <button
                key={g.id}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={idx === activeIndex}
                className={`group-picker__option${idx === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => onPick(g.id)}
              >
                <span className="group-picker__swatch" style={g.color ? { background: g.color } : undefined}>
                  {!g.color && <IconGroup />}
                </span>
                <span className="group-picker__name">{g.title || 'Group'}</span>
                <span className="group-picker__count">
                  {g.memberCount} {g.memberCount === 1 ? 'node' : 'nodes'}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="group-picker__footer">
          <button type="button" className="group-picker__cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
