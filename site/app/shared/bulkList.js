// site/app/shared/bulkList.js
//
// Generic pick / invert-picks / bulk-remove-with-preview behaviour shared
// by every list room (Guide book, What changed, Messages, Time machine,
// Dim sum, Checklist, Code maker, Model shop). A list room supplies its own
// rows (via app/core/rooms.js); this module only knows about picked-id
// bookkeeping, which is why it is reusable across all of them.

export function createBulkList() {
  return {
    togglePick(state, id) {
      const picked = Object.assign({}, state.picked)
      if (picked[id]) delete picked[id]
      else picked[id] = true
      return { picked }
    },
    selectAll(state, rowIds) {
      const allPicked = rowIds.length > 0 && rowIds.every((id) => state.picked[id])
      const picked = {}
      if (!allPicked) rowIds.forEach((id) => (picked[id] = true))
      return { picked }
    },
    invert(state, rowIds) {
      const picked = {}
      rowIds.forEach((id) => {
        if (!state.picked[id]) picked[id] = true
      })
      return { picked }
    },
    pickedIdsIn(state, rowIds) {
      return rowIds.filter((id) => state.picked[id])
    },
  }
}
