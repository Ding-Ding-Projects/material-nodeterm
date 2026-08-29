// Pure selection model shared by every bulk-action surface in the app (see BulkActionBar.tsx).
// Click selects one row and sets the shift-click anchor; shift-click extends from that anchor
// through the clicked row, in whatever order the caller's `visibleIds` currently lists them —
// so it tracks a re-sorted/filtered list correctly rather than an index captured at click time.
//
// None of nodeterm's bulk-action-worthy lists in this repo paginate (SessionMemoryPanel's own
// header note is "never truncates the list", and the local-history panel does not either), so
// "select all" here always means every row CURRENTLY MATCHING the active filter — there is no
// separate "this page" set to distinguish it from. Callers must still say so in the UI copy (see
// BulkActionBar's `allLabel`) rather than leaving the meaning implicit.

export interface BulkSelectionState {
  readonly selected: ReadonlySet<string>
  readonly anchor: string | null
}

export function emptySelection(): BulkSelectionState {
  return { selected: new Set(), anchor: null }
}

export function isSelected(state: BulkSelectionState, id: string): boolean {
  return state.selected.has(id)
}

export function selectionCount(state: BulkSelectionState): number {
  return state.selected.size
}

/** Plain click: toggle one row, and it becomes the new shift-click anchor either way (matches
 *  Finder/Explorer/GMail convention — the anchor always follows the last deliberate click). */
export function toggleOne(state: BulkSelectionState, id: string): BulkSelectionState {
  const next = new Set(state.selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return { selected: next, anchor: id }
}

/** Shift-click: select every row between the current anchor and `id` (inclusive), in
 *  `visibleIds` order. Falls back to a plain toggle when there is no anchor yet (first click of a
 *  session is never a range). */
export function selectRange(
  state: BulkSelectionState,
  id: string,
  visibleIds: readonly string[]
): BulkSelectionState {
  if (!state.anchor) return toggleOne(state, id)
  const from = visibleIds.indexOf(state.anchor)
  const to = visibleIds.indexOf(id)
  if (from === -1 || to === -1) return toggleOne(state, id)
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  const next = new Set(state.selected)
  for (let i = lo; i <= hi; i++) next.add(visibleIds[i])
  return { selected: next, anchor: id }
}

/** Every row currently matching the active filter — see the file header on why this app has no
 *  separate "this page" concept to distinguish it from. */
export function selectAll(visibleIds: readonly string[]): BulkSelectionState {
  return { selected: new Set(visibleIds), anchor: null }
}

export function clearSelection(): BulkSelectionState {
  return emptySelection()
}

/** Flip every currently-visible row's selectedness — selected rows become unselected and vice
 *  versa. A row that scrolled out of the current filter keeps whatever selection it had (it is
 *  simply not touched by an inversion of what is visible now). */
export function invertSelection(state: BulkSelectionState, visibleIds: readonly string[]): BulkSelectionState {
  const next = new Set(state.selected)
  for (const id of visibleIds) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  }
  return { selected: next, anchor: state.anchor }
}

/** Drop ids that no longer exist (a row was deleted elsewhere) — call after any list refresh so a
 *  stale id never lingers in the "N selected" count. */
export function pruneSelection(state: BulkSelectionState, liveIds: readonly string[]): BulkSelectionState {
  const live = new Set(liveIds)
  const next = new Set([...state.selected].filter((id) => live.has(id)))
  return next.size === state.selected.size ? state : { selected: next, anchor: state.anchor }
}
