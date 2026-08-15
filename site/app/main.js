// site/app/main.js
//
// Boots the whole playground: creates the store, registers every feature
// (app/features/index.js), wires the one set of delegated DOM listeners
// event delegation replaces "one addEventListener per button" so a full
// re-render never has to re-attach hundreds of handlers, and computes the
// render() -> mount() loop with focus preservation.

import { createStore, makeMatcher } from './core/store.js'
import { withFocusPreserved } from './core/dom.js'
import { render } from './core/render.js'
import {
  applyTheme, toast, notify, log, save, undoEntry, toggleLock, unlockPanel,
  openMenu, closeMenu, menuDefs, openRx, closeRx, rxToggleMode, rxInsertToken, rxApply, rxPlain,
  buildPaletteTargets, askConfirm, confirmCancel, confirmRun, refreshCodes, copyToClipboard, download,
  getRoom, allSettingsCards, registerListRoom, fmtWhen,
} from './core/engine.js'
import { registerFeatures } from './features/index.js'
import { SECTIONS, FEATURES, DOCS, COVERAGE, RX_TOKENS, DISHES } from './shared/data.js'
import { listVoices, findVoice } from './shared/narrator-state.js'
import { createBulkList } from './shared/bulkList.js'

const bulkList = createBulkList()

const root = document.getElementById('app-root')
const store = createStore()
store.dataTables = { SECTIONS, FEATURES, DOCS, COVERAGE, RX_TOKENS, DISHES }

// ---------------------------------------------------------------------
// Cross-cutting helpers every feature/menu item can call
// ---------------------------------------------------------------------
function speak(text) {
  if (!store.state.narrate) return
  try {
    const u = new SpeechSynthesisUtterance(String(text))
    u.rate = 0.6 + store.state.rate * 0.2
    const v = findVoice(store.state.voice)
    if (v) u.voice = v
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch (_err) {
    /* speechSynthesis unavailable */
  }
}
function toastX(icon, title, body, sub) {
  toast(store, icon, title, body, sub, speak)
}

function enterDoor(id) {
  const s = store.state
  const key = 'room:' + id
  if (s.locks[key] && !s.unlocked[key]) {
    store.setState({ knock: id }, { persist: false })
    setTimeout(() => store.setState({ knock: null }, { persist: false }), 700)
    const pass = window.prompt('This door is locked. What is its password?\n\n(Toy lock — a speed bump, not real safety.)')
    if (pass === null) return
    import('./shared/crypto.js').then(({ sha256Hex }) =>
      sha256Hex(pass).then((h) => {
        if (h === s.locks[key]) {
          store.setState((st) => ({ unlocked: Object.assign({}, st.unlocked, { [key]: true }) }), { persist: false })
          toastX('🔓', 'Click!', 'The door opened. It stays open for this visit.')
          enterDoor(id)
        } else {
          toastX('❌', 'Not that one', 'Every door has its very own password.')
        }
      }),
    )
    return
  }
  store.setState({ opening: id }, { persist: false })
  speak('Opening the ' + id + ' room')
  setTimeout(() => store.setState({ view: 'room', sec: id, opening: null, qSec: '', picked: {} }, { persist: false }), 620)
}
function goRoom(id) {
  store.setState({ sec: id, view: 'room', menuOpen: false, paletteOpen: false, qSec: '', picked: {} }, { persist: false })
}
function leaveRoom() {
  store.setState({ view: 'hall', opening: null }, { persist: false })
  toastX('🚪', 'Door closed', 'You are back in the hallway.')
}
function toggleTheme() {
  const t = store.state.theme === 'night' ? 'day' : 'night'
  save(store, { theme: t }, 'Switched to ' + t + ' colours')
  applyTheme(store.state)
  toastX(t === 'night' ? '🌙' : '☀️', t === 'night' ? 'Night time' : 'Day time', 'The whole playground changed colour.')
}
function togglePick(id) {
  store.setState((s) => {
    const p = Object.assign({}, s.picked)
    if (p[id]) delete p[id]
    else p[id] = true
    return { picked: p }
  }, { persist: false })
}
function currentRawRows() {
  const room = getRoom(store.state.sec)
  return room && room.kind === 'list' ? room.getRows(store.state) : []
}
function removeRows(ids) {
  const room = getRoom(store.state.sec)
  if (room && room.kind === 'list' && typeof room.remove === 'function') {
    room.remove(store, ids)
    toastX('🗑', 'Done', ids.length + ' thing(s) removed.')
  } else {
    store.setState({ picked: {} }, { persist: false })
    toastX('🙂', 'Nothing to remove', 'This list is built into the page, so it stays exactly where it is.')
  }
}
function wipe() {
  try {
    localStorage.removeItem('nodeterm-playground.v1')
  } catch (_err) {}
  const nowIso = new Date().toISOString()
  store.setState(
    {
      notes: [], history: [{ id: 'h0', title: 'Started fresh', body: 'Everything was cleared.', when: nowIso, tag: 'start' }],
      locks: {}, unlocked: {}, picked: {}, auth: [], cart: {},
      theme: 'day', lang: 'en', funnyEn: 2, funnyYue: 3, emoji: true, bigText: false, sound: false,
      accent: '#ffd93d', nick: '', logo: '', preset: 'playground',
      school: false, schoolPin: '', narrate: false, voice: '', rate: 3, vocab: '', schedOn: false, schedTime: '19:00', schedTheme: 'night',
    },
    { persist: false },
  )
  store.persist()
  applyTheme(store.state)
  toastX('🧹', 'All clear', 'Everything is back to how it started.')
}

const deps = { enterDoor, goRoom, toggleTheme, copy: (t) => copyToClipboard(store, t), speak, togglePick, removeRows, wipe, sections: SECTIONS, features: FEATURES, docs: DOCS, coverage: COVERAGE }

// ---------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------
function computeCaches() {
  store.menuItemsCache = store.state.menuOpen ? menuDefs(store, deps) : []
  store.paletteItemsCache = store.state.paletteOpen ? buildPaletteTargets(store, deps) : []
  if (store.state.confirm) {
    const pickedIds = Object.keys(store.state.picked)
    const rows = currentRawRows().filter((r) => store.state.picked[r.id])
    store.confirmPreviewCache = pickedIds.length && rows.length ? rows.map((r) => '• ' + r.title).join('\n') : 'Everything this page saved in your browser.'
  }
}

function doRender() {
  computeCaches()
  withFocusPreserved(root, () => {
    root.innerHTML = render(store)
  })
}
store.subscribe(doRender)

// ---------------------------------------------------------------------
// Delegated events
// ---------------------------------------------------------------------
root.addEventListener('click', (e) => {
  const closeTarget = e.target.closest('[data-action]')
  const el = closeTarget
  if (!el) {
    // clicking the scrim itself (data-action="close-menu"/"close-rx"/"close-palette") is
    // handled below via data-action too; nothing else to do for a bare click.
    return
  }
  const action = el.dataset.action
  const id = el.dataset.id
  const arg = el.dataset.arg

  switch (action) {
    case 'enter-door':
      enterDoor(id)
      return
    case 'toggle-theme':
      toggleTheme()
      return
    case 'open-palette':
      store.setState({ paletteOpen: true, paletteQuery: '', menuOpen: false }, { persist: false })
      return
    case 'close-palette':
      if (e.target === el) store.setState({ paletteOpen: false }, { persist: false })
      return
    case 'copy-brew':
      copyToClipboard(store, 'brew install --cask nodeterm')
      return
    case 'go-room':
      goRoom(id)
      return
    case 'leave-room':
      leaveRoom()
      return
    case 'lock-room':
      toggleLock(store, 'room:' + store.state.sec, window.prompt.bind(window))
      return
    case 'reset-all':
      askConfirm(store, 'Start completely fresh?', 'This clears every setting, message, log entry, saved code and toy lock this page put in your browser. It cannot be undone.', 'fresh', wipe)
      return
    case 'toggle-pick':
      togglePick(id)
      return
    case 'select-all': {
      const ids = currentRawRows().map((r) => r.id)
      store.setState(bulkList.selectAll(store.state, ids), { persist: false })
      return
    }
    case 'invert-picks': {
      const ids = currentRawRows().map((r) => r.id)
      store.setState(bulkList.invert(store.state, ids), { persist: false })
      return
    }
    case 'bulk-remove': {
      const pickedIds = bulkList.pickedIdsIn(store.state, currentRawRows().map((r) => r.id))
      if (!pickedIds.length) {
        toastX('👆', 'Pick something first', 'Click the rows you mean, then press this.')
        return
      }
      askConfirm(store, 'Throw ' + pickedIds.length + ' thing(s) away?', 'Here is exactly what will go. Nothing happens until you type the word.', 'bye', () => removeRows(pickedIds))
      return
    }
    case 'panel-action': {
      const room = getRoom(store.state.sec)
      const actions = room && room.panelActions ? room.panelActions(store) : []
      const a = actions[Number(id)]
      if (a) a.run()
      return
    }
    case 'date-range': {
      const d = new Date()
      if (id === 'all') store.setState({ dateFrom: '', dateTo: '' }, { persist: false })
      else {
        const days = Number(id)
        const f = new Date(d.getTime() - days * 864e5)
        store.setState({ dateFrom: f.toISOString().slice(0, 10), dateTo: d.toISOString().slice(0, 10) }, { persist: false })
      }
      return
    }
    case 'open-rx':
      openRx(store, id, arg)
      return
    case 'close-rx':
      if (e.target === el) closeRx(store)
      return
    case 'rx-toggle-mode':
      rxToggleMode(store, store.state.rxTarget ? store.state.rxTarget.key : 'global')
      return
    case 'rx-insert':
      rxInsertToken(store, store.state.rxTarget ? store.state.rxTarget.key : 'global', RX_TOKENS[Number(id)][1])
      return
    case 'rx-apply':
      rxApply(store)
      return
    case 'rx-plain':
      rxPlain(store)
      return
    case 'close-menu':
      if (e.target === el) closeMenu(store)
      return
    case 'run-menu-item': {
      const item = (store.menuItemsCache || [])[Number(id)]
      if (item) item.run()
      return
    }
    case 'run-palette-item': {
      const item = (store.paletteItemsCache || [])[Number(id)]
      if (item) item.run()
      return
    }
    case 'confirm-cancel':
      confirmCancel(store)
      return
    case 'confirm-run':
      confirmRun(store)
      return
    case 'dismiss-toast':
      store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }), { persist: false })
      return
    case 'toggle-lock':
      toggleLock(store, id, window.prompt.bind(window))
      return
    case 'unlock-panel':
      unlockPanel(store, id)
      return
    case 'pick-accent':
      save(store, { accent: id }, 'Colour changed')
      return
    default:
      // Feature-registered actions (settings-card toggles/buttons) are
      // dispatched through the shared action registry below.
      runFeatureAction(action, id, el)
  }
})

// dialog scrims: a click directly on the scrim (not its inner dialog)
// closes the topmost open overlay.
root.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('dialog-scrim')) {
    if (store.state.rxOpen) closeRx(store)
    else if (store.state.paletteOpen) store.setState({ paletteOpen: false }, { persist: false })
  }
  if (e.target.classList && e.target.classList.contains('menu-scrim')) closeMenu(store)
})

root.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-menu-kind]')
  if (!el) return
  e.preventDefault()
  e.stopPropagation()
  let extra = el.dataset.menuExtra
  if (extra) {
    try {
      extra = JSON.parse(extra)
    } catch (_err) {
      /* keep as string */
    }
  }
  openMenu(store, e.clientX, e.clientY, el.dataset.menuKind, el.dataset.menuLabel, extra || null)
})

root.addEventListener('input', (e) => {
  const t = e.target
  if (t.dataset && t.dataset.bindRx) {
    const key = store.state.rxTarget ? store.state.rxTarget.key : 'global'
    const field = t.dataset.bindRx === 'pattern' ? 'rxPat' : 'rxFlags'
    const cap = t.dataset.bindRx === 'pattern' ? 200 : 6
    store.setState((s) => ({ [field]: Object.assign({}, s[field], { [key]: t.value.slice(0, cap) }) }), { persist: false })
  } else if (t.dataset && t.dataset.bind) {
    store.setState({ [t.dataset.bind]: t.value }, { persist: t.dataset.bind === 'vocab' || t.dataset.bind === 'nick' })
  } else if (t.dataset && t.dataset.bindText) {
    runFeatureBind(t.dataset.bindText, t.dataset.id, t.value)
  } else if (t.dataset && t.dataset.bindUnlock) {
    const id = t.dataset.bindUnlock
    store.setState((s) => ({ unlockVals: Object.assign({}, s.unlockVals, { [id]: t.value }) }), { persist: false })
  } else if (t.dataset && t.dataset.bindRange) {
    runFeatureBind(t.dataset.bindRange, t.dataset.id, t.value)
  }
})
root.addEventListener('change', (e) => {
  const t = e.target
  if (t.dataset && t.dataset.bindSelect) runFeatureBind(t.dataset.bindSelect, t.dataset.id, t.value)
  else if (t.dataset && t.dataset.bind) store.setState({ [t.dataset.bind]: t.value }, { persist: t.dataset.bind === 'vocab' || t.dataset.bind === 'nick' })
})
root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.paletteInput) {
    const first = (store.paletteItemsCache || []).filter((p) => makeMatcher(store.state, 'palette', store.state.paletteQuery)(p.label + ' ' + p.hint))[0]
    if (first) first.run()
  }
})

document.addEventListener('keydown', (e) => {
  if ((e.key === 'F' || e.key === 'f') && e.shiftKey && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    store.setState({ paletteOpen: true, paletteQuery: '' }, { persist: false })
  }
  if (e.key === 'Escape') store.setState({ paletteOpen: false, menuOpen: false, rxOpen: false }, { persist: false })
})

// ---------------------------------------------------------------------
// Feature action registry — settings-card controls register their own
// handlers here (via registerAction) rather than main.js knowing every
// feature's field names.
// ---------------------------------------------------------------------
const featureActions = new Map()
const featureBindings = new Map()
export function registerAction(name, fn) {
  featureActions.set(name, fn)
}
export function registerBinding(name, fn) {
  featureBindings.set(name, fn)
}
function runFeatureAction(name, id, el) {
  const fn = featureActions.get(name)
  if (fn) fn(store, id, el, { toast: toastX, notify: (t, b, tag) => notify(store, t, b, tag), save: (p, n) => save(store, p, n), speak, applyTheme: () => applyTheme(store.state), askConfirm: (t, b, w, r) => askConfirm(store, t, b, w, r) })
}
function runFeatureBind(name, id, value) {
  const fn = featureBindings.get(name)
  if (fn) fn(store, id, value, { save: (p, n) => save(store, p, n), applyTheme: () => applyTheme(store.state) })
}

// Feature modules import { registerAction, registerBinding } from this
// module — a tiny circular import, resolved fine by ES module loaders
// because both sides only read the map at call time, never at import time.
window.__nodetermRegisterAction = registerAction
window.__nodetermRegisterBinding = registerBinding

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
function registerCoreRooms() {
  // Messages (notifications) and Time machine (local history) are core
  // engine concepts, not a single owned feature module — see
  // app/core/engine.js#notify/#log. Both rooms are still registered
  // through the same list-room contract every feature room uses.
  registerListRoom('notes', {
    getRows: (s) => s.notes.map((n) => ({ id: n.id, title: n.title, body: n.body, tag: n.tag, meta: fmtWhen(n.when), right: '' })),
    emptyText: 'No messages. Lovely and quiet. 🌤',
    remove: (store2, ids) => {
      const set = new Set(ids)
      store2.setState({ notes: store2.state.notes.filter((n) => !set.has(n.id)), picked: {} })
    },
    panelActions: (store2) => [
      { label: '➕ Add a test message', run: () => { notify(store2, 'Test message', 'You made this one yourself from the Messages room.', 'test'); toastX('🔔', 'Added', 'A new message is at the top.') } },
    ],
  })
  registerListRoom('history', {
    getRows: (s) => s.history.map((h) => ({ id: h.id, title: h.title, body: h.body, tag: h.tag, meta: fmtWhen(h.when), right: '' })),
    emptyText: 'Nothing logged yet.',
    remove: (store2, ids) => {
      const set = new Set(ids)
      store2.setState({ history: store2.state.history.filter((h) => !set.has(h.id)), picked: {} }, { persist: false })
    },
    panelActions: (store2) => [
      { label: '↩️ Put the newest change back', run: () => { const h = store2.state.history[0]; if (!h) { toastX('🙂', 'Nothing to undo', 'The log is empty.'); return } undoEntry(store2, h.id) } },
    ],
  })
}

async function boot() {
  registerCoreRooms()
  registerFeatures({ store, deps: { toast: toastX, notify: (t, b, tag) => notify(store, t, b, tag), save: (p, n) => save(store, p, n), speak, applyTheme: () => applyTheme(store.state), download: (n, t) => download(store, n, t), copy: (t) => copyToClipboard(store, t), askConfirm: (t, b, w, r) => askConfirm(store, t, b, w, r), refreshCodes: () => refreshCodes(store), log: (t, b) => log(store, t, b), undoEntry: (id) => undoEntry(store, id) }, registerAction, registerBinding })

  applyTheme(store.state)
  store.state.dishIdx = Math.floor(Math.random() * DISHES.length)
  doRender()

  if (!store.state.school && Math.random() < 0.1) {
    const d = DISHES[store.state.dishIdx]
    toastX('🥟', 'The trolley rolled by!', d.en + ' · ' + d.yue, d.body)
  }

  refreshCodes(store)

  const readVoices = () => {
    store.state.voices = listVoices()
    doRender()
  }
  readVoices()
  try {
    window.speechSynthesis.addEventListener('voiceschanged', readVoices)
  } catch (_err) {}

  setInterval(() => {
    const s = store.state
    if (s.schedOn) checkSchedule()
    if (s.view === 'room' && s.sec === 'auth' && s.auth.length) refreshCodes(store)
  }, 1000)

  function checkSchedule() {
    const s = store.state
    const now = new Date()
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    if (hhmm === s.schedTime && s.theme !== s.schedTheme && now.getSeconds() < 2) {
      save(store, { theme: s.schedTheme }, 'Timer switched the theme to ' + s.schedTheme)
      applyTheme(store.state)
      notify(store, 'A timer went off', 'It was ' + s.schedTime + ', so the page switched to ' + s.schedTheme + ' colours.', 'timer')
      toastX('⏰', 'Timer!', 'Switched to ' + s.schedTheme + ' colours, as you asked.')
    }
  }
}

boot()
