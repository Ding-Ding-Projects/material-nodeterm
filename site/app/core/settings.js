// site/app/core/settings.js
//
// The persisted settings STORE (get/set/reset, all routed through
// history.js so every change is recorded) plus the settings SURFACE: a
// tabbed panel with its own search bar wired to the anchored regex
// builder, rendered into whatever container the tab manager hands it
// (see tabs.js registering the built-in "settings" tab).
//
// Built-in settings tabs: Appearance, Notifications, Data & privacy.
// A feature module can add more sections via registerSetting({tabId:
// 'my-section', ...}) — the tab strip inside Settings picks them up
// automatically, in registration order after the built-ins.

import { readJSON, writeJSON, clearAll as clearAllStorage } from './storage.js'
import { record as recordHistory, list as listHistory } from './history.js'
import { getSettingsForTab, getSettingsTabIds, onRegistryChange } from './registry.js'
import { attachAnchoredSearch } from './regexBuilder.js'
import { openConfirmGate } from './confirm.js'
import { notify } from './notifications.js'
import { setDock } from './tabs.js'
// theme.js imports settings.js (getValue/setValue), so settings.js reaches
// back into theme.js via a dynamic import below to avoid a circular
// static-import cycle between the two modules.

const VALUES_KEY = 'settings-values'

function loadValues() {
  return readJSON(VALUES_KEY, {})
}
function saveValues(values) {
  writeJSON(VALUES_KEY, values)
}

const changeListeners = new Set()
export function onSettingChange(fn) {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}
function fireChange(id, value) {
  for (const fn of changeListeners) {
    try {
      fn(id, value)
    } catch (_) {
      /* one bad listener must not break the rest */
    }
  }
}

export function getValue(id, fallback) {
  const values = loadValues()
  return Object.prototype.hasOwnProperty.call(values, id) ? values[id] : fallback
}

export function setValue(id, value, { title, action = 'changed' } = {}) {
  const values = loadValues()
  const from = values[id]
  values[id] = value
  saveValues(values)
  recordHistory({ settingId: id, title: title || id, from, to: value, action })
  fireChange(id, value)
}

export function resetValue(id, fallback, opts = {}) {
  setValue(id, fallback, { ...opts, action: 'reset' })
}

const BUILTIN_TAB_META = {
  appearance: { title: 'Appearance', icon: '🎨' },
  notifications: { title: 'Notifications', icon: '🔔' },
  data: { title: 'Data & privacy', icon: '🗄️' },
}

function orderedSettingsTabIds() {
  const builtins = Object.keys(BUILTIN_TAB_META)
  const registered = getSettingsTabIds().filter((id) => !builtins.includes(id))
  return [...builtins, ...registered.sort()]
}

function tabMeta(id) {
  return BUILTIN_TAB_META[id] || { title: id, icon: '⚙️' }
}

/**
 * renderSettingsSurface(container) — builds the full Settings tab content:
 * a search bar (anchored regex builder), a sub-tab strip, and one panel
 * per sub-tab holding every registered setting for that tab plus the
 * built-in rows (theme, notifications, local data).
 */
export function renderSettingsSurface(container) {
  container.innerHTML = ''
  container.className = 'settings-surface'

  const header = document.createElement('div')
  header.className = 'settings-surface__header'
  header.innerHTML = `<h2>Settings</h2><p class="settings-surface__sub">Every value here lives only in this browser. Nothing is sent anywhere.</p>`
  container.appendChild(header)

  const searchWrap = document.createElement('div')
  searchWrap.className = 'settings-surface__search'
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = 'Search settings…'
  searchInput.setAttribute('aria-label', 'Search settings')
  searchWrap.appendChild(searchInput)
  container.appendChild(searchWrap)

  const body = document.createElement('div')
  body.className = 'settings-surface__body'
  container.appendChild(body)

  const subrail = document.createElement('div')
  subrail.className = 'settings-subrail'
  subrail.setAttribute('role', 'tablist')
  subrail.setAttribute('aria-label', 'Settings sections')
  body.appendChild(subrail)

  const panels = document.createElement('div')
  panels.className = 'settings-panels'
  body.appendChild(panels)

  let activeTabId = null
  let searchState = { query: '', isRegex: false, regex: null }

  function rowMatches(row) {
    if (!searchState.query) return true
    const haystack = `${row.title} ${typeof row.describe === 'function' ? row.describe() : row.describe || ''}`
    if (searchState.isRegex && searchState.regex) {
      try {
        return searchState.regex.test(haystack)
      } catch (_) {
        return false
      }
    }
    return haystack.toLowerCase().includes(searchState.query.toLowerCase())
  }

  function renderRow(row) {
    const el = document.createElement('div')
    el.className = 'settings-row'
    el.id = `setting-${row.id}`
    el.dataset.settingId = row.id

    const head = document.createElement('div')
    head.className = 'settings-row__head'

    const titleEl = document.createElement('span')
    titleEl.className = 'settings-row__title'
    titleEl.textContent = row.title
    head.appendChild(titleEl)

    const infoBtn = document.createElement('button')
    infoBtn.type = 'button'
    infoBtn.className = 'settings-row__info'
    infoBtn.setAttribute('aria-expanded', 'false')
    infoBtn.setAttribute('aria-label', `About ${row.title}`)
    infoBtn.textContent = 'ⓘ'
    head.appendChild(infoBtn)
    el.appendChild(head)

    const desc = document.createElement('div')
    desc.className = 'settings-row__desc'
    desc.hidden = true
    const describeText = typeof row.describe === 'function' ? row.describe() : row.describe
    desc.innerHTML = `<p>${describeText || 'No description provided.'}</p><p class="settings-row__provenance">${provenanceLine(row)}</p>`
    el.appendChild(desc)
    infoBtn.addEventListener('click', () => {
      const open = desc.hidden
      desc.hidden = !open
      infoBtn.setAttribute('aria-expanded', String(open))
    })

    const controlHost = document.createElement('div')
    controlHost.className = 'settings-row__control'
    el.appendChild(controlHost)
    row.control(
      controlHost,
      () => getValue(row.id, row.fallback),
      (v) => setValue(row.id, v, { title: row.title })
    )

    return el
  }

  function provenanceLine(row) {
    const values = loadValues()
    const has = Object.prototype.hasOwnProperty.call(values, row.id)
    if (!has) {
      const fb = row.fallback
      return `Using the built-in default${fb !== undefined ? ` (${JSON.stringify(fb)})` : ''} — nothing saved yet.`
    }
    return 'Set by you, saved in this browser.'
  }

  function renderPanel(tabId) {
    const panel = document.createElement('div')
    panel.className = 'settings-panel'
    panel.id = `settings-panel-${tabId}`
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', `settings-tab-${tabId}`)

    const rows = [...builtinRowsForTab(tabId), ...getSettingsForTab(tabId)]
    const visible = rows.filter(rowMatches)
    if (rows.length && !visible.length) {
      const empty = document.createElement('p')
      empty.className = 'settings-empty'
      empty.textContent = 'No settings match your search here.'
      panel.appendChild(empty)
    } else {
      visible.forEach((row) => panel.appendChild(renderRow(row)))
    }
    return panel
  }

  function renderAll() {
    const ids = orderedSettingsTabIds()
    if (!activeTabId || !ids.includes(activeTabId)) activeTabId = ids[0]

    subrail.innerHTML = ''
    ids.forEach((id) => {
      const meta = tabMeta(id)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.id = `settings-tab-${id}`
      btn.className = 'settings-subrail__tab'
      btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-selected', String(id === activeTabId))
      btn.setAttribute('aria-controls', `settings-panel-${id}`)
      btn.textContent = `${meta.icon} ${meta.title}`

      // If the current search matches something in a DIFFERENT sub-tab,
      // say so — the contract requires stating plainly when a match sits
      // elsewhere rather than leaving the visitor to guess.
      if (searchState.query) {
        const rows = [...builtinRowsForTab(id), ...getSettingsForTab(id)]
        const hits = rows.filter(rowMatches).length
        if (hits > 0) {
          const badge = document.createElement('span')
          badge.className = 'settings-subrail__hit'
          badge.textContent = String(hits)
          btn.appendChild(badge)
        }
      }

      btn.addEventListener('click', () => {
        activeTabId = id
        renderAll()
      })
      subrail.appendChild(btn)
    })

    panels.innerHTML = ''
    panels.appendChild(renderPanel(activeTabId))
  }

  attachAnchoredSearch(searchInput, {
    onChange: ({ query, isRegex, regex }) => {
      searchState = { query, isRegex, regex }
      renderAll()
    },
  })

  renderAll()
  const unsub = onRegistryChange(renderAll)
  const unsubVal = onSettingChange(renderAll)
  // Return a disposer in case a future re-mount needs it; not required by
  // the current single-instance shell but keeps this composable.
  return () => {
    unsub()
    unsubVal()
  }
}

// ---------------------------------------------------------------------
// Built-in rows
// ---------------------------------------------------------------------

function builtinAppearanceRows() {
  return [
    {
      id: 'theme',
      title: 'Color theme',
      fallback: 'system',
      describe: 'Light, dark, or follow the operating system setting. Applies instantly, everywhere on this page.',
      control(container, get, set) {
        const sel = document.createElement('select')
        ;[
          ['system', 'Match system'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ].forEach(([v, label]) => {
          const opt = document.createElement('option')
          opt.value = v
          opt.textContent = label
          if (get() === v) opt.selected = true
          sel.appendChild(opt)
        })
        sel.addEventListener('change', () => set(sel.value))
        container.appendChild(sel)
      },
    },
    {
      id: 'appearance-open',
      title: 'Appearance editor',
      fallback: null,
      describe: 'Pick the accent color with the infinite color picker and translator.',
      control(container) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn btn-secondary btn-sm'
        btn.textContent = 'Open appearance editor'
        btn.addEventListener('click', () => {
          import('./theme.js').then((m) => m.openAppearanceEditor())
        })
        container.appendChild(btn)
      },
    },
    {
      id: 'tab-dock',
      title: 'Tab strip position',
      fallback: 'left',
      describe: 'Which edge of the window the tab strip docks to. Left is the default.',
      control(container, get, set) {
        const sel = document.createElement('select')
        ;['left', 'right', 'top', 'bottom'].forEach((v) => {
          const opt = document.createElement('option')
          opt.value = v
          opt.textContent = v[0].toUpperCase() + v.slice(1)
          if (get() === v) opt.selected = true
          sel.appendChild(opt)
        })
        sel.addEventListener('change', () => {
          set(sel.value)
          setDock(sel.value)
        })
        container.appendChild(sel)
      },
    },
  ]
}

function builtinNotificationRows() {
  return [
    {
      id: 'notify-test',
      title: 'Send a test notification',
      fallback: null,
      describe: 'Fires one non-blocking toast in the bottom-right corner, and adds it to the notification centre.',
      control(container) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn btn-secondary btn-sm'
        btn.textContent = 'Send test toast'
        btn.addEventListener('click', () => {
          notify({ kind: 'success', title: 'This is a test notification', body: 'It will auto-dismiss shortly.' })
        })
        container.appendChild(btn)
      },
    },
  ]
}

function builtinDataRows() {
  return [
    {
      id: 'history-browser',
      title: 'Local settings history',
      fallback: null,
      describe: 'Every settings change you make on this page, append-only. Restoring an older value adds a new entry rather than erasing what came after it.',
      control(container) {
        // No subscription here: the settings surface's OWN
        // onSettingChange(renderAll) already tears this whole row down
        // and rebuilds it (calling this control function again) on every
        // change, so a second listener registered on each rebuild would
        // never be cleaned up and would leak one closure per change for
        // the life of the page.
        const list = document.createElement('div')
        list.className = 'history-list'
        const entries = listHistory().slice(0, 25)
        if (!entries.length) {
          list.innerHTML = '<p class="settings-empty">No changes recorded yet.</p>'
        } else {
          entries.forEach((e) => {
            const row = document.createElement('div')
            row.className = 'history-row'
            const when = new Date(e.at).toLocaleString()
            row.innerHTML = `<span class="history-row__action">${e.action}</span><span class="history-row__title">${e.title}</span><span class="history-row__when">${when}</span>`
            list.appendChild(row)
          })
        }
        container.appendChild(list)
      },
    },
    {
      id: 'clear-local-data',
      title: 'Clear local site data',
      fallback: null,
      describe: 'Erases every setting, the tab layout, and the version history stored by this page in this browser. This is irreversible and gated behind the destructive-action confirmation below.',
      control(container) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn btn-danger btn-sm'
        btn.textContent = 'Clear local site data…'
        btn.addEventListener('click', () => {
          openConfirmGate({
            anchor: btn,
            title: 'Clear all local site data',
            description:
              'This permanently erases every setting, the tab layout and pinned tabs, the appearance customization, the notification history, and the settings version history stored by this page — all of it, in this browser only. Nothing on any server is touched. This cannot be undone.',
            confirmLabel: 'Erase everything',
            onConfirm: () => {
              clearAllStorage()
              notify({ kind: 'warning', title: 'Local site data cleared', body: 'Reload the page to see the defaults.' })
            },
          })
        })
        container.appendChild(btn)
      },
    },
  ]
}

function builtinRowsForTab(tabId) {
  if (tabId === 'appearance') return builtinAppearanceRows()
  if (tabId === 'notifications') return builtinNotificationRows()
  if (tabId === 'data') return builtinDataRows()
  return []
}

export function allSettingsForPalette() {
  const ids = orderedSettingsTabIds()
  const rows = []
  ids.forEach((tabId) => {
    ;[...builtinRowsForTab(tabId), ...getSettingsForTab(tabId)].forEach((row) => rows.push({ ...row, tabId }))
  })
  return rows
}
