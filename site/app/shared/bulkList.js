// site/app/shared/bulkList.js
//
// A reusable bulk-action list: multi-select with shift-click ranges and a
// keyboard equivalent, a select-all that states whether it means "every
// row currently shown" or "every row that matches the search" (there is no
// pagination on this site's lists, so those two coincide once a search is
// applied — the label still says which one is meant), inverse selection,
// and a reviewable preview + exact count before any destructive action
// runs. Used by the toy-lock list, the notification/version history lists,
// and the personal-vocabulary entry list.

import { h, clear, injectStyleOnce } from './dom.js'
import { createSearchWithRegex } from './regexBuilder.js'

injectStyleOnce(
  'site-bulklist-style',
  `
  .site-bulklist { display: flex; flex-direction: column; gap: 8px; }
  .site-bulklist__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .site-bulklist__count { font-size: 13px; opacity: 0.8; }
  .site-bulklist__rows { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; }
  .site-bulklist__row {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    border-radius: var(--md-shape-sm, 8px); border: 1px solid var(--md-outline-variant, #cac4ce);
    background: var(--md-surface-container-low, #f5f1f8);
  }
  .site-bulklist__row[data-selected="true"] { border-color: var(--md-primary, #6b4fd8); background: var(--md-primary-container, #e7ddff); }
  .site-bulklist__row-body { flex: 1 1 auto; min-width: 0; }
  .site-bulklist__actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .site-bulklist__btn {
    min-height: var(--touch-target, 44px); padding: 0 12px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit;
  }
  .site-bulklist__btn--danger { border-color: var(--md-error, #ba1a1a); color: var(--md-error, #ba1a1a); }
  .site-bulklist__btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .site-bulklist__empty { font-size: 13px; opacity: 0.7; padding: 8px 0; }
  .site-bulklist__preview {
    border: 1px dashed var(--md-outline, #79767e); border-radius: var(--md-shape-sm, 8px); padding: 8px;
    font-size: 13px; display: flex; flex-direction: column; gap: 6px;
  }
  `,
)

/**
 * @param {{
 *   getItems: () => any[],
 *   getId: (item: any) => string,
 *   getSearchText: (item: any) => string,
 *   renderRow: (item: any) => Node,
 *   actions: Array<{id: string, label: string, run: (ids: string[]) => void, destructive?: boolean}>,
 *   emptyLabel?: string,
 *   searchLabel?: string,
 * }} opts
 */
export function createBulkList(opts) {
  const { getItems, getId, getSearchText, renderRow, actions, emptyLabel = 'Nothing here yet.', searchLabel = 'Search' } = opts
  const selected = new Set()
  let lastClickedId = null
  let predicate = () => true
  let pendingAction = null

  const rowsEl = h('div', { class: 'site-bulklist__rows' })
  const countEl = h('span', { class: 'site-bulklist__count' }, '')
  const previewEl = h('div', { class: 'site-bulklist__preview', hidden: true })

  const search = createSearchWithRegex({
    placeholder: 'Filter…',
    ariaLabel: searchLabel,
    onChange: (pred) => {
      predicate = pred
      render()
    },
  })

  const selectAllBtn = h('button', { type: 'button', class: 'site-bulklist__btn', onClick: () => selectAll() }, 'Select all matches')
  const invertBtn = h('button', { type: 'button', class: 'site-bulklist__btn', onClick: () => invertSelection() }, 'Invert selection')
  const clearBtn = h('button', { type: 'button', class: 'site-bulklist__btn', onClick: () => clearSelection() }, 'Clear selection')

  const actionButtons = actions.map((a) =>
    h(
      'button',
      {
        type: 'button',
        class: 'site-bulklist__btn' + (a.destructive ? ' site-bulklist__btn--danger' : ''),
        onClick: () => requestAction(a),
      },
      a.label,
    ),
  )

  const toolbar = h('div', { class: 'site-bulklist__toolbar' }, [
    search.root,
    selectAllBtn,
    invertBtn,
    clearBtn,
    countEl,
  ])
  const actionsRow = h('div', { class: 'site-bulklist__actions' }, actionButtons)
  const root = h('div', { class: 'site-bulklist' }, [toolbar, actionsRow, previewEl, rowsEl])

  function visibleItems() {
    return getItems().filter((it) => predicate(getSearchText(it)))
  }

  function selectAll() {
    const items = visibleItems()
    for (const it of items) selected.add(getId(it))
    render()
  }
  function invertSelection() {
    const items = visibleItems()
    for (const it of items) {
      const id = getId(it)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
    }
    render()
  }
  function clearSelection() {
    selected.clear()
    render()
  }

  function toggle(id, opts2) {
    const items = visibleItems()
    if (opts2 && opts2.shiftKey && lastClickedId) {
      const ids = items.map(getId)
      const a = ids.indexOf(lastClickedId)
      const b = ids.indexOf(id)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        for (let i = lo; i <= hi; i++) selected.add(ids[i])
        render()
        return
      }
    }
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    lastClickedId = id
    render()
  }

  function requestAction(action) {
    const ids = [...selected]
    if (ids.length === 0) {
      pendingAction = null
      previewEl.hidden = true
      return
    }
    pendingAction = { action, ids }
    renderPreview()
  }

  function renderPreview() {
    if (!pendingAction) {
      previewEl.hidden = true
      clear(previewEl)
      return
    }
    previewEl.hidden = false
    clear(previewEl)
    const { action, ids } = pendingAction
    previewEl.appendChild(
      h('div', {}, `${action.label}: ${ids.length} item${ids.length === 1 ? '' : 's'} will change.`),
    )
    const row = h('div', { class: 'site-bulklist__actions' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'site-bulklist__btn' + (action.destructive ? ' site-bulklist__btn--danger' : ''),
          onClick: () => {
            action.run(ids)
            selected.clear()
            pendingAction = null
            render()
          },
        },
        'Confirm',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'site-bulklist__btn',
          onClick: () => {
            pendingAction = null
            render()
          },
        },
        'Cancel',
      ),
    ])
    previewEl.appendChild(row)
  }

  function render() {
    const items = visibleItems()
    clear(rowsEl)
    if (items.length === 0) {
      rowsEl.appendChild(h('div', { class: 'site-bulklist__empty' }, emptyLabel))
    }
    for (const item of items) {
      const id = getId(item)
      const isSel = selected.has(id)
      const checkbox = h('input', {
        type: 'checkbox',
        checked: isSel,
        'aria-label': 'Select row',
        onClick: (e) => {
          e.stopPropagation()
          toggle(id, { shiftKey: e.shiftKey })
        },
      })
      const row = h(
        'div',
        {
          class: 'site-bulklist__row',
          'data-selected': String(isSel),
          tabindex: '0',
          onKeydown: (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              toggle(id, { shiftKey: e.shiftKey })
            }
          },
        },
        [checkbox, h('div', { class: 'site-bulklist__row-body' }, renderRow(item))],
      )
      rowsEl.appendChild(row)
    }
    const total = getItems().length
    countEl.textContent =
      selected.size === 0
        ? `${items.length} of ${total} shown`
        : `${selected.size} selected of ${items.length} shown (${total} total)`
    for (const btn of actionButtons) btn.disabled = selected.size === 0
    renderPreview()
  }

  render()
  return { root, refresh: render }
}
