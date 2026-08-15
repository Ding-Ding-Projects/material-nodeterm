// site/app/core/registry.js
//
// THE REGISTRY CONTRACT — the single point of contact between this lane
// (the site shell: tabs, search, palette, settings surface, notifications,
// appearance, destructive-confirm gate) and the site-content lane
// (site/app/features/**, owned by a sibling pig).
//
// Nothing in this file touches the DOM or localStorage. It is pure
// bookkeeping: feature modules call the register* functions below: the
// shell modules (tabs.js, settings.js, palette.js) read them back through
// the getters and render the live UI. This keeps the two lanes buildable
// and reviewable independently — neither imports the other's internals.
//
// Registration is idempotent-by-id: registering the same id twice replaces
// the earlier entry (last writer wins) and notifies subscribers, so a
// feature module can be hot-replaced during development without a stale
// duplicate entry lingering in the tab strip or command palette.

const tabs = new Map()
const settings = new Map()
const commands = new Map()
const listeners = new Set()

function notify() {
  for (const fn of listeners) {
    try {
      fn()
    } catch (err) {
      // A single misbehaving subscriber must never wedge every other one.
      console.error('[registry] subscriber threw', err)
    }
  }
}

/**
 * onRegistryChange(fn) — subscribe to any registration change (a tab,
 * setting, or command was added or removed). Returns an unsubscribe
 * function. The shell uses this so a feature module that registers AFTER
 * the shell has already booted (e.g. behind an async import) still shows
 * up without a page reload.
 */
export function onRegistryChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * registerTab({ id, title, icon, group, order, render, panelEl })
 *
 *   id       unique string (required)
 *   title    visible label shown in the tab strip and command palette
 *   icon     single emoji/glyph shown beside the label (optional)
 *   group    optional group label — tabs sharing a group are visually
 *            clustered in the strip and can be found together via the
 *            "search tab groups by name" surface
 *   order    optional sort weight, lower sorts earlier (default 0)
 *   render(container)   called ONCE, lazily, the first time the tab is
 *            opened; populate `container` with the panel's content. Use
 *            this for a feature module that has no pre-existing DOM.
 *   panelEl  OR, if the panel already exists in the document (a
 *            statically authored tab such as "Overview"), pass the
 *            element directly instead of a render function — the tab
 *            manager adopts it in place rather than reparenting content.
 *
 * Returns an unregister function.
 */
export function registerTab(tab) {
  if (!tab || !tab.id) throw new Error('registerTab: "id" is required')
  if (!tab.render && !tab.panelEl) {
    throw new Error(`registerTab("${tab.id}"): needs either "render" or "panelEl"`)
  }
  tabs.set(tab.id, { order: 0, ...tab })
  notify()
  return () => {
    tabs.delete(tab.id)
    notify()
  }
}

/**
 * registerSetting({ id, tabId, title, describe, control })
 *
 *   id        unique string (required)
 *   tabId     which settings tab/section this belongs under (required —
 *             the settings surface is itself tabbed; see settings.js)
 *   title     visible label, also indexed by the settings search and the
 *             command palette
 *   describe  optional string OR function() => string; the full
 *             explanation shown behind progressive disclosure
 *   control(container, get, set)   renders the LIVE control into
 *             `container`. `get()` reads the persisted value, `set(value)`
 *             writes it AND records a local version-history revision —
 *             never write to localStorage directly from a feature module,
 *             always go through `set`, so history/undo stays truthful.
 */
export function registerSetting(setting) {
  if (!setting || !setting.id) throw new Error('registerSetting: "id" is required')
  if (!setting.tabId) throw new Error(`registerSetting("${setting.id}"): "tabId" is required`)
  settings.set(setting.id, setting)
  notify()
  return () => {
    settings.delete(setting.id)
    notify()
  }
}

/**
 * registerCommand({ id, title, run, hint })
 *
 *   id     unique string (required)
 *   title  shown in the command palette
 *   run()  invoked when the user selects the command
 *   hint   optional secondary text (e.g. a keyboard shortcut label)
 */
export function registerCommand(command) {
  if (!command || !command.id) throw new Error('registerCommand: "id" is required')
  commands.set(command.id, command)
  notify()
  return () => {
    commands.delete(command.id)
    notify()
  }
}

export function getTabs() {
  return [...tabs.values()].sort((a, b) => (a.order || 0) - (b.order || 0))
}
export function getTab(id) {
  return tabs.get(id)
}
export function getSettings() {
  return [...settings.values()]
}
export function getSettingsForTab(tabId) {
  return [...settings.values()].filter((s) => s.tabId === tabId)
}
export function getSettingsTabIds() {
  return [...new Set([...settings.values()].map((s) => s.tabId))]
}
export function getCommands() {
  return [...commands.values()]
}
