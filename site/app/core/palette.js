// site/app/core/palette.js
//
// Command palette on Ctrl+Shift+F (Cmd+Shift+F on macOS — matched on
// e.code so layout doesn't matter). Lists every tab, every registered
// setting (rendered as its LIVE control, not a description of one — the
// same get()/set() the Settings surface itself uses, so the two paths
// can never disagree about a value), and every registered command.
// Selecting a tab or setting teleports to it: switches tabs, scrolls the
// target into view, focuses it, and briefly highlights it.
//
// Size is a persisted visitor choice: a bounded card (default) or a
// full-window view, toggled from the palette's own header.

import { getCommands, onRegistryChange } from './registry.js'
import { allSettingsForPalette, getValue, setValue } from './settings.js'
import { getOrderedTabs, revealInTab, showTab } from './tabs.js'
import { attachAnchoredSearch } from './regexBuilder.js'
import { readJSON, writeJSON } from './storage.js'

const SIZE_KEY = 'palette-size'
let root = null
let dialog = null
let open = false
let query = ''
let isRegex = false
let regex = null

export function mount(container) {
  root = container
  document.addEventListener('keydown', (e) => {
    const wantsPalette = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF'
    if (wantsPalette) {
      e.preventDefault()
      open ? close() : openPalette()
    } else if (e.key === 'Escape' && open) {
      close()
    }
  })
  onRegistryChange(() => open && render())
}

function buildEntries() {
  const entries = []
  getOrderedTabs().forEach((t) => {
    entries.push({ kind: 'tab', id: `tab:${t.id}`, title: t.title, icon: t.icon || '🗂️', sub: 'Go to tab', tabId: t.id })
  })
  allSettingsForPalette().forEach((s) => {
    entries.push({ kind: 'setting', id: `setting:${s.id}`, title: s.title, icon: '⚙️', sub: 'Setting', setting: s })
  })
  getCommands().forEach((c) => {
    entries.push({ kind: 'command', id: `command:${c.id}`, title: c.title, icon: '⌘', sub: c.hint || 'Command', command: c })
  })
  return entries
}

function matches(entry) {
  if (!query) return true
  const haystack = `${entry.title} ${entry.sub || ''}`
  if (isRegex && regex) {
    try {
      return regex.test(haystack)
    } catch (_) {
      return false
    }
  }
  return haystack.toLowerCase().includes(query.toLowerCase())
}

function openPalette() {
  open = true
  render()
  const input = dialog.querySelector('.palette__search')
  input?.focus()
}
function close() {
  open = false
  if (root) root.innerHTML = ''
  dialog = null
}

function activate(entry) {
  if (entry.kind === 'tab') {
    showTab(entry.tabId)
  } else if (entry.kind === 'setting') {
    revealInTab('settings', `setting-${entry.setting.id}`)
  } else if (entry.kind === 'command') {
    entry.command.run && entry.command.run()
  }
  close()
}

function render() {
  root.innerHTML = ''
  const scrim = document.createElement('div')
  scrim.className = 'palette__scrim'
  scrim.addEventListener('click', close)
  root.appendChild(scrim)

  const size = readJSON(SIZE_KEY, 'card')
  dialog = document.createElement('div')
  dialog.className = `palette palette--${size}`
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', 'Command palette')

  const header = document.createElement('div')
  header.className = 'palette__header'
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.className = 'palette__search'
  searchInput.placeholder = 'Jump to a tab, setting, or command…'
  searchInput.setAttribute('aria-label', 'Search the command palette')
  header.appendChild(searchInput)

  const sizeBtn = document.createElement('button')
  sizeBtn.type = 'button'
  sizeBtn.className = 'icon-btn palette__size'
  sizeBtn.title = size === 'card' ? 'Expand to full window' : 'Shrink to card'
  sizeBtn.textContent = size === 'card' ? '⤢' : '⤡'
  sizeBtn.addEventListener('click', () => {
    writeJSON(SIZE_KEY, size === 'card' ? 'full' : 'card')
    render()
    dialog.querySelector('.palette__search')?.focus()
  })
  header.appendChild(sizeBtn)
  dialog.appendChild(header)

  const list = document.createElement('div')
  list.className = 'palette__list'
  list.setAttribute('role', 'listbox')
  dialog.appendChild(list)

  function renderList() {
    list.innerHTML = ''
    const entries = buildEntries().filter(matches)
    if (!entries.length) {
      list.innerHTML = '<p class="palette__empty">No matches.</p>'
      return
    }
    entries.slice(0, 100).forEach((entry, idx) => {
      const row = document.createElement('div')
      row.className = 'palette__row'
      row.setAttribute('role', 'option')
      row.tabIndex = idx === 0 ? 0 : -1

      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'palette__row-main'
      main.innerHTML = `<span class="palette__row-icon" aria-hidden="true">${entry.icon}</span><span class="palette__row-text"><strong>${escapeHtml(
        entry.title
      )}</strong><span class="palette__row-sub">${escapeHtml(entry.sub)}</span></span>`
      main.addEventListener('click', () => activate(entry))
      row.appendChild(main)

      // Rich rows: a setting result renders its LIVE control inline,
      // using the exact same get()/set() as the Settings surface.
      if (entry.kind === 'setting') {
        const controlHost = document.createElement('div')
        controlHost.className = 'palette__row-control'
        try {
          entry.setting.control(
            controlHost,
            () => getValue(entry.setting.id, entry.setting.fallback),
            (v) => setValue(entry.setting.id, v, { title: entry.setting.title })
          )
        } catch (_) {
          /* a feature module's control threw — the row is still usable via "Go to" */
        }
        row.appendChild(controlHost)
      }

      list.appendChild(row)
    })
  }

  attachAnchoredSearch(searchInput, {
    onChange: (state) => {
      query = state.query
      isRegex = state.isRegex
      regex = state.regex
      renderList()
    },
  })

  renderList()
  root.appendChild(dialog)

  function onKeydown(e) {
    if (e.key === 'Escape') {
      close()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...list.querySelectorAll('.palette__row')]
      if (!rows.length) return
      const current = rows.findIndex((r) => r.tabIndex === 0)
      let next = e.key === 'ArrowDown' ? current + 1 : current - 1
      next = Math.max(0, Math.min(rows.length - 1, next))
      rows.forEach((r, i) => (r.tabIndex = i === next ? 0 : -1))
      rows[next].focus()
      e.preventDefault()
    } else if (e.key === 'Enter') {
      const focused = document.activeElement
      const row = focused?.closest?.('.palette__row')
      row?.querySelector('.palette__row-main')?.click()
    }
  }
  dialog.addEventListener('keydown', onKeydown)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
