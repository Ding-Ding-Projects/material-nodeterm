// site/app/core/engine.js
//
// The generic engine shared by every room: theme, toasts, the message
// board (Messages / Time machine), the toy-lock helpers, the right-click
// menu, the regex-builder dialog, the command palette, the destructive
// confirm gate, and the room/settings-card registries that
// app/features/*.js modules populate. app/core/render.js turns all of this
// into markup; this file only ever touches `state`.
//
// (Guard note: this file and everything else under app/core/ is
// intentionally NOT part of the completeness guard's per-feature registry
// — it is the shared chassis every feature runs on top of, the same way
// React itself isn't a "feature". The guard checks app/features/*.js and
// app/shared/*.js, which is where each canonical feature actually lives.)

import { sha256Hex, totp, totpSecondsLeft } from '../shared/crypto.js'
import { REPO_URL } from '../shared/data.js'

function nowIso() {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------
// Room + settings-card + menu-extra registries
// ---------------------------------------------------------------------
const rooms = new Map() // id -> { section (from SECTIONS), render(store, ctx) -> html, mount(root, store)?, badge(state)? }
const settingsCards = new Map() // id -> { icon, title, desc, note, controlsHtml(store), mount(root, store) }
const settingsCardOrder = []
const menuExtraProviders = [] // fn(store, kind, extra) -> [{icon,label,hint,run}]
const paletteExtraProviders = [] // fn(store) -> [{icon,label,hint,run}]

export function registerRoom(id, def) {
  rooms.set(id, def)
}
// Convenience for the common "pick / bulk-remove / right-click / search"
// list-room shape shared by Guide book, What changed, Messages, Time
// machine, Dim sum, Checklist, Code maker and Model shop.
export function registerListRoom(id, config) {
  registerRoom(id, Object.assign({ kind: 'list' }, config))
}
export function getRoom(id) {
  return rooms.get(id)
}
export function registerSettingsCard(id, def) {
  settingsCards.set(id, def)
  settingsCardOrder.push(id)
}
export function allSettingsCards() {
  return settingsCardOrder.map((id) => Object.assign({ id }, settingsCards.get(id)))
}
export function registerMenuExtras(fn) {
  menuExtraProviders.push(fn)
}
export function registerPaletteExtras(fn) {
  paletteExtraProviders.push(fn)
}

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
export function applyTheme(state) {
  try {
    document.documentElement.setAttribute('data-theme', state.theme === 'night' ? 'night' : 'day')
    document.documentElement.style.fontSize = state.bigText ? '19px' : '16px'
    document.body.style.fontSize = state.bigText ? '17px' : '15px'
  } catch (_err) {
    /* not running in a document (should not happen on this site) */
  }
}

// ---------------------------------------------------------------------
// Sound (a little blip on win/miss/message, entirely local Web Audio)
// ---------------------------------------------------------------------
let audioCtx = null
export function blip(state, kind) {
  if (!state.sound) return
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = kind === 'bad' ? 180 : kind === 'win' ? 780 : 480
    gain.gain.value = 0.06
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18)
    osc.stop(audioCtx.currentTime + 0.2)
  } catch (_err) {
    /* Web Audio unavailable */
  }
}

// ---------------------------------------------------------------------
// Toasts + Messages room (notifications-state)
// ---------------------------------------------------------------------
export function toast(store, icon, title, body, sub, speakFn) {
  const id = 't' + Date.now() + Math.random().toString(36).slice(2, 6)
  store.setState((s) => ({ toasts: s.state ? s.state.toasts : s.toasts }))
  store.setState((s) => ({ toasts: (s.toasts || []).concat([{ id, icon, title, body, sub: sub || '' }]).slice(-3) }))
  blip(store.state, icon === '❌' ? 'bad' : 'ok')
  if (typeof speakFn === 'function') speakFn(title + '. ' + body)
  setTimeout(() => {
    store.setState((s) => ({ toasts: (s.toasts || []).filter((t) => t.id !== id) }), { persist: false })
  }, 7000)
}
export function dismissToast(store, id) {
  store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }), { persist: false })
}
export function notify(store, title, body, tag) {
  store.setState((s) => ({
    notes: [{ id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5), title, body, when: nowIso(), tag: tag || 'note' }].concat(s.notes).slice(0, 200),
  }))
}

// ---------------------------------------------------------------------
// Time machine (local history log)
// ---------------------------------------------------------------------
export function log(store, title, body) {
  store.setState((s) => ({
    history: [{ id: 'h' + Date.now() + Math.random().toString(36).slice(2, 6), title, body: body || '', when: nowIso(), tag: 'change' }].concat(s.history).slice(0, 300),
  }))
}
export function undoEntry(store, id) {
  const entry = store.state.history.find((h) => h.id === id)
  if (!entry) return
  store.setState({ history: store.state.history.filter((h) => h.id !== id) })
  log(store, 'Undid: ' + entry.title, 'That step was taken out of the log. This undo is itself a new step, so you can undo the undo.')
  toast(store, '↩️', 'Put back', '“' + entry.title + '” was undone as a brand new step.')
}

// A patch-and-log helper mirroring the design's `this.save(patch, note)`.
export function save(store, patch, note) {
  store.setState(patch)
  if (note) log(store, note)
}

export function fmtWhen(iso) {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch (_err) {
    return String(iso)
  }
}

// ---------------------------------------------------------------------
// Toy locks (cross-cutting: every settings card and every hallway door)
// ---------------------------------------------------------------------
export async function toggleLock(store, id, promptFn) {
  const s = store.state
  if (s.locks[id]) {
    const locks = Object.assign({}, s.locks)
    delete locks[id]
    save(store, { locks }, 'Toy lock removed from ' + id)
    toast(store, '🔓', 'Lock removed', 'That box is open to everyone again.')
    return
  }
  const pass = promptFn('Pick a password for this box.\n\nThis is a toy lock — a speed bump, not real safety. If you forget it, the only way back in is “Start fresh”, which wipes everything this page saved.')
  if (!pass) return
  const hash = await sha256Hex(pass)
  save(store, { locks: Object.assign({}, s.locks, { [id]: hash }) }, 'Toy lock added to ' + id)
  notify(store, 'A box was locked', 'You put a toy lock on “' + id + '”. Each lock has its very own password.', 'lock')
  toast(store, '🔒', 'Locked', 'That box now asks for its own password.')
}
export async function unlockPanel(store, id) {
  const hash = await sha256Hex(store.state.unlockVals[id] || '')
  if (hash === store.state.locks[id]) {
    store.setState((s) => ({ unlocked: Object.assign({}, s.unlocked, { [id]: true }) }), { persist: false })
    toast(store, '🔓', 'Open!', 'That box is unlocked for this visit only.')
  } else {
    toast(store, '❌', 'Not that one', 'Every box has its very own password.')
  }
}

// ---------------------------------------------------------------------
// Right-click menu
// ---------------------------------------------------------------------
export function openMenu(store, clientX, clientY, kind, label, extra) {
  const w = window.innerWidth || 900
  const h = window.innerHeight || 700
  store.setState(
    {
      menuOpen: true,
      // Clamp only enough to keep the menu's TOP-LEFT on screen and leave it somewhere usable to
      // grow. The panel's own CSS is what actually guarantees it fits: `width` clamps to the
      // viewport and `max-height` is set inline to the room remaining below `menuY`. This used to
      // subtract a hard-coded 360px "panel height" that was simply wrong (the panel is ~392px),
      // which pushed the last menu item off the bottom of a normal phone.
      menuX: Math.max(8, Math.min(clientX, w - 8 - Math.min(276, w - 16))),
      // Keep at least ~140px of room below the tap so the menu is not a one-line sliver, but never
      // push it above 8px — on a very short viewport the max-height simply takes over.
      menuY: Math.max(8, Math.min(clientY, Math.max(8, h - 140))),
      menuKind: kind,
      menuLabel: label || '',
      menuQuery: '',
      menuExtra: extra === undefined ? null : extra,
    },
    { persist: false },
  )
}
export function closeMenu(store) {
  store.setState({ menuOpen: false }, { persist: false })
}

export function menuDefs(store, deps) {
  const s = store.state
  const kind = s.menuKind
  const base = [
    { icon: '🏠', label: 'Go home', hint: '', run: () => deps.enterDoor('home') },
    { icon: '✨', label: 'Open the jump box', hint: 'Ctrl+Shift+F', run: () => store.setState({ paletteOpen: true, menuOpen: false, paletteQuery: '' }, { persist: false }) },
    { icon: '🌗', label: s.theme === 'night' ? 'Switch to day colours' : 'Switch to night colours', hint: '', run: () => { closeMenu(store); deps.toggleTheme() } },
    { icon: '✅', label: 'See the big checklist', hint: '', run: () => deps.goRoom('coverage') },
    { icon: '⚙️', label: 'Open settings', hint: '', run: () => deps.goRoom('settings') },
  ]
  if (kind === 'search' || kind === 'header') {
    return [
      { icon: '🧩', label: 'Build a pattern for the big search', hint: '.*', run: () => openRx(store, 'global', 'the big search') },
      { icon: '🧹', label: 'Clear the big search', hint: '', run: () => store.setState({ qGlobal: '', menuOpen: false }, { persist: false }) },
      { icon: '🔤', label: s.rxOn.global ? 'Treat it as plain words again' : 'Treat what I typed as a pattern', hint: '', run: () => store.setState((st) => ({ rxOn: Object.assign({}, st.rxOn, { global: !st.rxOn.global }), menuOpen: false }), { persist: false }) },
      { icon: '📋', label: 'Copy what I searched for', hint: '', run: () => { deps.copy(s.qGlobal); closeMenu(store) } },
    ].concat(base)
  }
  if (kind === 'rail') {
    return [
      { icon: '🧹', label: 'Clear the room filter', hint: '', run: () => store.setState({ qNav: '', menuOpen: false }, { persist: false }) },
      { icon: '🧩', label: 'Build a pattern for the room filter', hint: '.*', run: () => openRx(store, 'nav', 'the room finder') },
      { icon: '📚', label: 'Open the guide book', hint: '', run: () => deps.goRoom('docs') },
    ].concat(base)
  }
  if (kind === 'room') {
    return [
      { icon: '➡️', label: 'Open this room', hint: '', run: () => deps.goRoom(s.menuExtra) },
      { icon: '🔗', label: 'Copy a link to this room', hint: '', run: () => { deps.copy('#' + s.menuExtra); closeMenu(store) } },
      { icon: '🔎', label: 'Search the whole site for it', hint: '', run: () => store.setState({ qGlobal: s.menuLabel, menuOpen: false }, { persist: false }) },
      { icon: '📦', label: 'Take this data home', hint: '', run: () => deps.goRoom('export') },
    ].concat(base)
  }
  if (kind === 'card') {
    return [
      { icon: '📚', label: 'Read about “' + s.menuLabel + '”', hint: '', run: () => store.setState({ sec: 'docs', qSec: s.menuLabel, view: 'room', menuOpen: false }, { persist: false }) },
      { icon: '📋', label: 'Copy this card', hint: '', run: () => { deps.copy(s.menuLabel); closeMenu(store) } },
      { icon: '🔎', label: 'Search for it', hint: '', run: () => store.setState({ qGlobal: s.menuLabel, menuOpen: false }, { persist: false }) },
      { icon: '🔊', label: 'Read it out loud', hint: '', run: () => { store.setState({ menuOpen: false, narrate: true }); deps.speak(s.menuLabel) } },
    ].concat(base)
  }
  if (kind === 'row') {
    const row = s.menuExtra || {}
    const extras = []
    if (row.url) extras.push({ icon: '🌐', label: 'Open this on GitHub', hint: 'new tab', run: () => { try { window.open(row.url, '_blank', 'noopener') } catch (_err) {} closeMenu(store) } })
    if (s.sec === 'history') extras.push({ icon: '↩️', label: 'Put this change back', hint: '', run: () => { closeMenu(store); undoEntry(store, row.id) } })
    if (s.sec === 'shop') extras.push({ icon: '🧺', label: 'Put it in the basket', hint: '', run: () => { store.setState((st) => ({ cart: Object.assign({}, st.cart, { [row.id]: true }), menuOpen: false })); toast(store, '🧺', 'In the basket', 'A shopping list for your own machine — this page cannot pull models.') } })
    if (s.sec === 'auth') extras.push({ icon: '📋', label: 'Copy the six digits', hint: '', run: () => { deps.copy(s.codes[row.id] || ''); closeMenu(store) } })
    return extras
      .concat([
        { icon: '✅', label: 'Pick or unpick this one', hint: '', run: () => { deps.togglePick(row.id); closeMenu(store) } },
        { icon: '📋', label: 'Copy it', hint: '', run: () => { deps.copy((row.title || '') + ' — ' + (row.body || '')); closeMenu(store) } },
        { icon: '🗑', label: 'Throw this one away', hint: 'asks first', run: () => { closeMenu(store); askConfirm(store, 'Throw one away?', 'This removes “' + (row.title || '') + '” from the list. The time machine will remember that you did.', 'bye', () => deps.removeRows([row.id])) } },
        { icon: '🔊', label: 'Read it out loud', hint: '', run: () => { store.setState({ menuOpen: false, narrate: true }); deps.speak((row.title || '') + '. ' + (row.body || '')) } },
        { icon: '📦', label: 'Take this list home', hint: '', run: () => deps.goRoom('export') },
      ])
      .concat(base)
  }
  if (kind === 'setting') {
    return [
      { icon: '🔒', label: s.locks[s.menuExtra] ? 'Take the toy lock off' : 'Put a toy lock on this box', hint: '', run: () => { closeMenu(store); toggleLock(store, s.menuExtra, window.prompt.bind(window)) } },
      { icon: '↩️', label: 'See my recent changes', hint: '', run: () => deps.goRoom('history') },
      { icon: '📦', label: 'Save my settings to a file', hint: '', run: () => deps.goRoom('export') },
    ].concat(base)
  }
  if (kind === 'stat') {
    return [{ icon: '🔎', label: 'Search for “' + s.menuLabel + '”', hint: '', run: () => store.setState({ qGlobal: s.menuLabel, menuOpen: false }, { persist: false }) }].concat(base)
  }
  const extraFromProviders = menuExtraProviders.flatMap((fn) => fn(store, kind, s.menuExtra) || [])
  return extraFromProviders.concat(base)
}

// ---------------------------------------------------------------------
// Regex builder dialog
// ---------------------------------------------------------------------
export function openRx(store, key, name) {
  store.setState({ rxOpen: true, rxTarget: { key, name }, menuOpen: false }, { persist: false })
}
export function closeRx(store) {
  store.setState({ rxOpen: false }, { persist: false })
}
export function rxToggleMode(store, key) {
  store.setState((st) => ({ rxOn: Object.assign({}, st.rxOn, { [key]: !st.rxOn[key] }) }), { persist: false })
}
export function rxInsertToken(store, key, token) {
  store.setState((st) => ({ rxPat: Object.assign({}, st.rxPat, { [key]: ((st.rxPat[key] || '') + token).slice(0, 200) }) }), { persist: false })
}
export function rxApply(store) {
  const s = store.state
  const key = s.rxTarget ? s.rxTarget.key : 'global'
  const pattern = s.rxPat[key] || ''
  const patch = { rxOn: Object.assign({}, s.rxOn, { [key]: true }), rxOpen: false }
  if (key === 'global') patch.qGlobal = pattern
  if (key === 'nav') patch.qNav = pattern
  if (key === 'sec') patch.qSec = pattern
  if (key === 'menu') patch.menuQuery = pattern
  if (key === 'palette') patch.paletteQuery = pattern
  store.setState(patch, { persist: false })
  toast(store, '🧩', 'Pattern set', 'That search box is now matching by pattern.')
}
export function rxPlain(store) {
  const key = store.state.rxTarget ? store.state.rxTarget.key : 'global'
  store.setState((st) => ({ rxOn: Object.assign({}, st.rxOn, { [key]: false }), rxOpen: false }), { persist: false })
}
export function computeRx(state) {
  const key = state.rxTarget ? state.rxTarget.key : 'global'
  const pattern = state.rxPat[key] || ''
  const flags = state.rxFlags[key] || 'i'
  let result = 'Type a pattern, then try it on the words below.'
  let bad = false
  let groups = []
  if (state.rxOpen && pattern) {
    try {
      const clean = flags.replace(/[^gimsuy]/g, '') || 'i'
      const re = new RegExp(pattern.slice(0, 200), clean.includes('g') ? clean : clean + 'g')
      const sample = String(state.rxSample || '').slice(0, 2000)
      const found = sample.match(re) || []
      result = found.length ? 'Found ' + found.length + ' → ' + found.slice(0, 8).map((f) => '“' + f + '”').join(', ') : 'Nothing matched yet. Try loosening it.'
      const one = new RegExp(pattern.slice(0, 200), clean.replace('g', '')).exec(sample)
      if (one && one.length > 1) groups = one.slice(1).map((v, i) => ({ n: '#' + (i + 1), v: v === undefined ? '(nothing)' : v }))
    } catch (err) {
      bad = true
      result = 'Not finished yet: ' + err.message
    }
  }
  return { key, pattern, flags, result, bad, groups }
}

// ---------------------------------------------------------------------
// Command palette
// ---------------------------------------------------------------------
export function buildPaletteTargets(store, deps) {
  const targets = []
  deps.sections.forEach((x) => targets.push({ icon: x.icon, label: 'Go to ' + x.label, hint: 'room', run: () => deps.goRoom(x.id) }))
  deps.features.forEach((f) => targets.push({ icon: f.icon, label: f.title, hint: 'card', run: () => store.setState({ sec: 'home', qSec: f.title, view: 'room', paletteOpen: false }, { persist: false }) }))
  deps.docs.forEach((d) => targets.push({ icon: '📖', label: d[0], hint: 'guide page', run: () => store.setState({ sec: 'docs', qSec: d[0], view: 'room', paletteOpen: false }, { persist: false }) }))
  allSettingsCards().forEach((c) => {
    const controls = typeof c.controlLabels === 'function' ? c.controlLabels(store.state) : typeof c.controls === 'function' ? c.controls(store.state).map((x) => x.label) : []
    controls.forEach((label) => targets.push({ icon: c.icon, label, hint: c.title, run: () => store.setState({ sec: 'settings', qSec: c.title, view: 'room', paletteOpen: false }, { persist: false }) }))
  })
  deps.coverage.forEach((c) => targets.push({ icon: c[2] === 'done' ? '✅' : '⚠️', label: c[0], hint: 'checklist', run: () => store.setState({ sec: 'coverage', qSec: c[0], view: 'room', paletteOpen: false }, { persist: false }) }))
  targets.push({ icon: '🚪', label: 'Back to the hallway', hint: 'action', run: () => store.setState({ view: 'hall', paletteOpen: false }, { persist: false }) })
  targets.push({ icon: '🌗', label: 'Switch day / night', hint: 'action', run: () => { store.setState({ paletteOpen: false }, { persist: false }); deps.toggleTheme() } })
  targets.push({ icon: '🧺', label: 'Empty the model basket', hint: 'action', run: () => { store.setState({ cart: {}, paletteOpen: false }); toast(store, '🧺', 'Basket emptied', 'Nothing was downloaded either way.') } })
  targets.push({
    icon: '🗑', label: 'Start fresh (wipe everything)', hint: 'action',
    run: () => { store.setState({ paletteOpen: false }, { persist: false }); askConfirm(store, 'Start completely fresh?', 'This clears every setting, message, log entry, saved code and toy lock this page put in your browser. It cannot be undone.', 'fresh', () => deps.wipe()) },
  })
  paletteExtraProviders.forEach((fn) => targets.push(...(fn(store) || [])))
  return targets
}

// ---------------------------------------------------------------------
// Confirm gate (type-the-word)
// ---------------------------------------------------------------------
export function askConfirm(store, title, body, word, run) {
  store.setState({ confirm: { title, body, word: String(word || 'yes').slice(0, 24), run }, confirmTyped: '' }, { persist: false })
}
export function confirmCancel(store) {
  store.setState({ confirm: null, confirmTyped: '' }, { persist: false })
}
export function confirmRun(store) {
  const s = store.state
  if (!s.confirm) return
  if (s.confirmTyped.trim().toLowerCase() !== s.confirm.word.toLowerCase()) {
    toast(store, '✋', 'Not yet', 'Type “' + s.confirm.word + '” exactly, then press it again.')
    return
  }
  const run = s.confirm.run
  store.setState({ confirm: null, confirmTyped: '' }, { persist: false })
  run()
}

// ---------------------------------------------------------------------
// TOTP (Code maker room)
// ---------------------------------------------------------------------
export async function refreshCodes(store) {
  const list = store.state.auth || []
  if (!list.length) return
  const out = {}
  for (let i = 0; i < list.length; i++) out[list[i].id] = await totp(list[i].secret)
  store.setState({ codes: out }, { persist: false })
}
export { totpSecondsLeft }

export function copyToClipboard(store, text) {
  try {
    navigator.clipboard.writeText(String(text))
    toast(store, '📋', 'Copied!', 'It is on your clipboard now.')
  } catch (_err) {
    toast(store, '😕', 'Could not copy', 'Your browser said no. Select the text by hand instead.')
  }
}

export function download(store, filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast(store, '📦', 'Saved', filename + ' went to your downloads.')
    log(store, 'Exported ' + filename)
    notify(store, 'A file was saved', filename + ' was written from data that never left this page.', 'export')
  } catch (_err) {
    toast(store, '😕', 'Could not save', 'Your browser blocked the download.')
  }
}

export const ATTRIBUTION_URL = REPO_URL
