// site/app/core/tabs.js
//
// Browser-style tabbed navigation — NOT one long scrolling page. The tab
// strip docks to any edge (left / right / top / bottom, LEFT by default)
// and docking is an ORIENTATION change, never a rotation: no label is
// ever rotated 90°. Every edge carries the full contract — an overflow
// "More" menu when tabs exceed the available space, drag-to-reorder,
// pinning, and persistence of order/pinned-state/active-tab/dock across
// reloads. Accessibility follows the AXIS, not the markup: a vertical
// strip is aria-orientation="vertical" with Up/Down arrow traversal; a
// horizontal one is aria-orientation="horizontal" with Left/Right.
//
// Tabs come from two sources, merged: statically authored panels already
// in the document (elements with [data-tab-panel], e.g. "Overview"), and
// tabs registered at runtime by a feature module via registry.js.

import { getTabs as registryTabs, onRegistryChange } from './registry.js'
import { readJSON, writeJSON } from './storage.js'
import { openMenu } from './menu.js'
import { attachAnchoredSearch } from './regexBuilder.js'

const DOCK_KEY = 'tab-dock'
const ORDER_KEY = 'tab-order'
const PINNED_KEY = 'tab-pinned'
const ACTIVE_KEY = 'tab-active'

let railEl = null
let panelsRoot = null
let searchInput = null
let tabsState = [] // [{id, title, icon, panelEl?, render?, order, _rendered}]
let orderIds = []
let pinnedIds = new Set()
let activeId = null
let dock = 'left'
let filterQuery = ''

function collectStaticTabs() {
  return [...panelsRoot.querySelectorAll(':scope > [data-tab-panel]')].map((el) => ({
    id: el.dataset.tabPanel,
    title: el.dataset.tabTitle || el.dataset.tabPanel,
    icon: el.dataset.tabIcon || '',
    panelEl: el,
    order: Number(el.dataset.tabOrder || 0),
  }))
}

function collectAllTabs() {
  const byId = new Map()
  collectStaticTabs().forEach((t) => byId.set(t.id, t))
  registryTabs().forEach((t) => {
    if (!byId.has(t.id)) byId.set(t.id, t)
  })
  return [...byId.values()]
}

function tabById(id) {
  return tabsState.find((t) => t.id === id)
}

export function init({ rail, panels, search }) {
  railEl = rail
  panelsRoot = panels
  searchInput = search || null

  tabsState = collectAllTabs()
  const saved = readJSON(ORDER_KEY, null)
  const declared = [...tabsState].sort((a, b) => (a.order || 0) - (b.order || 0)).map((t) => t.id)
  if (saved) {
    const known = new Set(saved)
    orderIds = [...saved.filter((id) => tabsState.some((t) => t.id === id)), ...declared.filter((id) => !known.has(id))]
  } else {
    orderIds = declared
  }
  pinnedIds = new Set(readJSON(PINNED_KEY, []))
  activeId = readJSON(ACTIVE_KEY, orderIds[0])
  dock = readJSON(DOCK_KEY, 'left')

  applyDockAttr()
  renderRail()
  showTab(tabsState.some((t) => t.id === activeId) ? activeId : orderIds[0])

  onRegistryChange(() => {
    const before = new Set(tabsState.map((t) => t.id))
    tabsState = collectAllTabs()
    const extras = tabsState.filter((t) => !before.has(t.id)).map((t) => t.id)
    if (extras.length) orderIds = [...orderIds, ...extras]
    renderRail()
  })

  if (searchInput) {
    attachAnchoredSearch(searchInput, {
      onChange: ({ query }) => {
        filterQuery = query
        renderRail()
      },
    })
  }

  window.addEventListener('resize', () => {
    applyDockAttr() // the vertical/horizontal axis can flip at the narrow-viewport breakpoint
    updateOverflow()
  })
}

export function setDock(edge) {
  if (!['left', 'right', 'top', 'bottom'].includes(edge)) return
  dock = edge
  writeJSON(DOCK_KEY, edge)
  applyDockAttr()
  renderRail()
}
export function getDock() {
  return dock
}
export function getActiveTabId() {
  return activeId
}
export function getOrderedTabs() {
  return orderedVisibleIds()
    .map((id) => tabById(id))
    .filter(Boolean)
}

// Below this width the strip visually collapses to a bottom icon bar
// (see styles.css) REGARDLESS of the chosen dock edge — a side rail has
// no room to earn its keep on a phone. aria-orientation and the arrow-key
// bindings below must track the ACTUAL rendered axis, never the stored
// preference, or the strip would look right and be unusable by keyboard.
const NARROW_QUERY = '(max-width: 767px)'
function isNarrowViewport() {
  return window.matchMedia(NARROW_QUERY).matches
}
function isVerticalNow() {
  if (isNarrowViewport()) return false
  return dock === 'left' || dock === 'right'
}

function applyDockAttr() {
  const shell = document.getElementById('app-shell')
  if (shell) shell.setAttribute('data-dock', dock)
  railEl.setAttribute('aria-orientation', isVerticalNow() ? 'vertical' : 'horizontal')
}

function orderedVisibleIds() {
  const ids = orderIds.filter((id) => tabsState.some((t) => t.id === id))
  const pinned = ids.filter((id) => pinnedIds.has(id))
  const rest = ids.filter((id) => !pinnedIds.has(id))
  return [...pinned, ...rest]
}

export function showTab(id) {
  const target = tabById(id)
  if (!target) return
  activeId = id
  writeJSON(ACTIVE_KEY, id)

  tabsState.forEach((t) => {
    let panel = t.panelEl
    if (!panel) {
      panel = document.getElementById(`panel-${t.id}`)
      if (!panel) {
        panel = document.createElement('div')
        panel.id = `panel-${t.id}`
        panelsRoot.appendChild(panel)
      }
      t.panelEl = panel
    }
    panel.classList.add('tabpanel')
    panel.setAttribute('role', 'tabpanel')
    panel.tabIndex = 0
    panel.setAttribute('aria-labelledby', `tab-${t.id}`)
    panel.hidden = t.id !== id
    if (t.id === id && t.render && !t._rendered) {
      t.render(panel)
      t._rendered = true
    }
  })
  renderRail()
}

/**
 * revealInTab(tabId, elementId) — the "teleport" used by the command
 * palette: switch to the tab, then scroll the target element into view,
 * focus it, and briefly highlight it, without disturbing anything else.
 */
export function revealInTab(tabId, elementId) {
  showTab(tabId)
  requestAnimationFrame(() => {
    const el = document.getElementById(elementId)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('teleport-highlight')
    setTimeout(() => el.classList.remove('teleport-highlight'), 1600)
    const focusable = el.matches('input,select,button,textarea') ? el : el.querySelector('input,select,button,textarea')
    ;(focusable || el).focus?.({ preventScroll: true })
  })
}

function renderRail() {
  railEl.innerHTML = ''
  let ids = orderedVisibleIds()
  if (filterQuery) {
    const q = filterQuery.toLowerCase()
    ids = ids.filter((id) => tabById(id).title.toLowerCase().includes(q))
  }

  ids.forEach((id, idx) => {
    const t = tabById(id)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = `tab-${id}`
    btn.className = 'tab-rail__tab'
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-selected', String(id === activeId))
    btn.setAttribute('aria-controls', t.panelEl ? t.panelEl.id : `panel-${id}`)
    btn.tabIndex = id === activeId ? 0 : -1
    btn.draggable = true
    btn.dataset.tabId = id
    if (pinnedIds.has(id)) btn.classList.add('is-pinned')
    if (id === activeId) btn.classList.add('is-active')
    btn.innerHTML = `<span class="tab-rail__icon" aria-hidden="true">${t.icon || ''}</span><span class="tab-rail__label">${t.title}</span>${
      pinnedIds.has(id) ? '<span class="tab-rail__pin" aria-hidden="true" title="Pinned">📌</span>' : ''
    }`

    btn.addEventListener('click', () => showTab(id))
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      openTabMenu(id, e.clientX, e.clientY, btn)
    })
    btn.addEventListener('keydown', (e) => onTabKeydown(e, ids, idx))
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', id)
      e.dataTransfer.effectAllowed = 'move'
    })
    btn.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    })
    btn.addEventListener('drop', (e) => {
      e.preventDefault()
      const draggedId = e.dataTransfer.getData('text/plain')
      if (draggedId && draggedId !== id) reorder(draggedId, id)
    })

    railEl.appendChild(btn)
  })

  updateOverflow()
}

function onTabKeydown(e, ids, idx) {
  const vertical = isVerticalNow()
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft'
  let targetIdx = null
  if (e.key === nextKey) targetIdx = (idx + 1) % ids.length
  else if (e.key === prevKey) targetIdx = (idx - 1 + ids.length) % ids.length
  else if (e.key === 'Home') targetIdx = 0
  else if (e.key === 'End') targetIdx = ids.length - 1
  else return
  e.preventDefault()
  const targetId = ids[targetIdx]
  showTab(targetId)
  document.getElementById(`tab-${targetId}`)?.focus()
}

function reorder(draggedId, targetId) {
  const idx1 = orderIds.indexOf(draggedId)
  if (idx1 === -1) return
  orderIds.splice(idx1, 1)
  const idx2 = orderIds.indexOf(targetId)
  orderIds.splice(idx2 === -1 ? orderIds.length : idx2, 0, draggedId)
  writeJSON(ORDER_KEY, orderIds)
  renderRail()
}

function moveTo(id, where) {
  orderIds = orderIds.filter((x) => x !== id)
  if (where === 'start') orderIds.unshift(id)
  else orderIds.push(id)
  writeJSON(ORDER_KEY, orderIds)
  renderRail()
}

function togglePin(id) {
  if (pinnedIds.has(id)) pinnedIds.delete(id)
  else pinnedIds.add(id)
  writeJSON(PINNED_KEY, [...pinnedIds])
  renderRail()
}

function openTabMenu(id, x, y, anchor) {
  const t = tabById(id)
  const pinned = pinnedIds.has(id)
  openMenu({
    x,
    y,
    anchor,
    ariaLabel: `${t.title} tab options`,
    items: [
      { id: 'pin', label: pinned ? 'Unpin tab' : 'Pin tab', onSelect: () => togglePin(id) },
      { id: 'move-start', label: 'Move to start', onSelect: () => moveTo(id, 'start') },
      { id: 'move-end', label: 'Move to end', onSelect: () => moveTo(id, 'end') },
    ],
  })
}

// ---------------------------------------------------------------------
// Overflow: when the strip's main axis runs out of room, move the
// trailing (unpinned) tabs into a "More" menu rather than clipping them
// or letting them wrap illegibly.
// ---------------------------------------------------------------------
function updateOverflow() {
  const existingMore = railEl.querySelector('.tab-rail__more')
  if (existingMore) existingMore.remove()
  // Reset EVERY tab button (including ones a previous pass hid into
  // overflow) before remeasuring — otherwise a tab pushed into "More"
  // could never come back once the strip has room for it again, since
  // it would be excluded from both the visible set and the measurement.
  const buttons = [...railEl.querySelectorAll('.tab-rail__tab')]
  buttons.forEach((b) => (b.hidden = false))

  const vertical = isVerticalNow()
  const available = vertical ? railEl.clientHeight : railEl.clientWidth
  if (!available) return

  const RESERVE = 44 // space kept for the "More" button itself
  let total = 0
  let cutFrom = -1
  for (let i = 0; i < buttons.length; i++) {
    const size = vertical ? buttons[i].offsetHeight : buttons[i].offsetWidth
    total += size
    if (cutFrom === -1 && total > available - RESERVE && !buttons[i].classList.contains('is-pinned')) {
      cutFrom = i
    }
  }
  if (cutFrom === -1) return

  const hiddenIds = []
  for (let i = cutFrom; i < buttons.length; i++) {
    if (buttons[i].classList.contains('is-pinned')) continue
    buttons[i].hidden = true
    hiddenIds.push(buttons[i].dataset.tabId)
  }
  if (!hiddenIds.length) return

  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'tab-rail__more'
  more.setAttribute('aria-haspopup', 'true')
  more.textContent = vertical ? `⋯ (${hiddenIds.length})` : `More (${hiddenIds.length}) ▾`
  more.addEventListener('click', (e) => {
    const items = hiddenIds.map((id) => {
      const t = tabById(id)
      return { id, label: `${t.icon || ''} ${t.title}`.trim(), onSelect: () => showTab(id) }
    })
    openMenu({ x: e.clientX, y: e.clientY, anchor: more, items, ariaLabel: 'More tabs' })
  })
  railEl.appendChild(more)
}
