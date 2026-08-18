import { tidySeparators } from '../../lib/ui-visibility'
import type { MenuItem } from '../ContextMenu'

/** Below this many ACTIONABLE rows — items and submenu triggers, the things a query can actually
 *  narrow down — a filter field costs more space than it saves. Separators and section labels are
 *  structural, not content, so they don't count toward the threshold: a 4-action menu split into
 *  3 labelled groups for readability still shouldn't grow a search box it doesn't need, and a
 *  20-action menu split into 6 groups still does. (Previously this counted every row including
 *  separators/labels, which is also why it never mattered in practice — a sectioned menu could
 *  never pass `isFilterable` at all; see below.) */
const FILTER_THRESHOLD = 6

function isActionable(item: MenuItem): boolean {
  return !item.type || item.type === 'item' || item.type === 'submenu'
}

/**
 * A menu of ANY shape — flat, or sectioned with separators/labels/submenus/a colors strip — is
 * filterable once it has enough real rows. This used to require a fully flat menu because nobody
 * had decided what a group's label/separator does once every row under it filters away;
 * `menuRowVisibility` below is that decision, so the restriction is gone.
 */
export function isFilterableMenu(items: MenuItem[]): boolean {
  return items.filter(isActionable).length > FILTER_THRESHOLD
}

/** The label text a row filters against — `undefined` for the two types that don't carry one. */
function rowLabel(item: MenuItem): string | undefined {
  return item.type === 'separator' || item.type === 'colors' ? undefined : item.label
}

/**
 * Which rows of `items` stay visible for the current filter query, index-for-index with `items`.
 *
 * Decisions (the "real UI work" a `label`/`separator`/`submenu`/`colors` mix needs, previously
 * deferred by requiring a fully flat menu — see `ContextMenu.tsx`'s old comment):
 *
 * - A plain item matches on its own label.
 * - A submenu matches on its own label OR any child's label. Otherwise typing the name of
 *   something that only exists inside a submenu (a terminal profile, an agent account) would hide
 *   the one row that reaches it — the opposite of what filtering is for. The submenu's CHILDREN
 *   are not individually filtered — only whether the trigger row shows.
 * - `colors` rows have no label to match, so once a query is active (`hasQuery`) they hide — a
 *   swatch strip with nothing else left in its section reads worse than temporarily losing
 *   color-picking while mid-search. With an empty query they stay visible (parity with never
 *   having filtered).
 * - A `label` (section heading) survives only when some row in ITS section survived — an empty
 *   heading claiming a group that filtered to nothing would be a lie about what's below it. A
 *   section runs from one label up to (not including) the next label, or the end of the menu.
 * - `separator` visibility is decided LAST, against the already-decided rows, by `tidySeparators`
 *   — the exact helper the (always-unfiltered) menu builders use to avoid a dangling rule, so
 *   there is one definition of "this rule would dangle," not a second one that can drift from it.
 */
export function menuRowVisibility(
  items: MenuItem[],
  test: (label: string) => boolean,
  hasQuery: boolean
): boolean[] {
  // Pass 1: does this row's OWN content match? Structural rows (separator/label) are resolved in
  // later passes — they have no content of their own to test.
  const contentMatch = items.map((item) => {
    if (item.type === 'separator' || item.type === 'label') return false
    if (item.type === 'colors') return !hasQuery
    if (item.type === 'submenu') {
      return (
        test(item.label) ||
        item.children.some((child) => {
          const label = rowLabel(child)
          return !!label && test(label)
        })
      )
    }
    return test(item.label)
  })

  // Pass 2: a label inherits visibility from its section (everything up to the next label).
  const visible = items.map((item, i) => {
    if (item.type !== 'label') return contentMatch[i]
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].type === 'label') break
      if (contentMatch[j]) return true
    }
    return false
  })

  // Pass 3: separators are structural, decided against the post-filter row list — reuse the same
  // helper the unfiltered builders already trust rather than re-deriving "would this dangle" here.
  const candidates = items.filter((item, i) => item.type === 'separator' || visible[i])
  const tidied = new Set(tidySeparators(candidates))

  return items.map((item, i) => (item.type === 'separator' ? tidied.has(item) : visible[i]))
}
