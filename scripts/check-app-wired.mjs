#!/usr/bin/env node
// scripts/check-app-wired.mjs
//
// Drive the BUILT app and prove its controls actually do something.
//
//   node scripts/check-app-wired.mjs            launch out/ and run every check
//   node scripts/check-app-wired.mjs --attach 9222
//   node scripts/check-app-wired.mjs --only palette,settings
//
// WHY THIS EXISTS, AND WHY THE CAPTURE HARNESS IS NOT ENOUGH
//
// `capture-shots.mjs` proves a surface OPENS — it sends a chord and verifies a selector appears.
// That is a real check and it caught real defects, but it cannot tell a working interface from a
// convincing mock-up. Every screenshot in this repo would look identical if every control were
// inert.
//
// This project's own contract says decorative-looking UI must be functional: anything presented
// as usable must perform its labelled action. That is not checkable by looking. So each case here
// does something and then asserts a CONSEQUENCE — a count that changed, a value that persisted, a
// token that moved — in the real renderer, over CDP, against the built bundle.
//
// THREE RULES, each of which this harness would be worthless without:
//
// 1. ASSERT A CONSEQUENCE, NEVER THE ACTION. "The click dispatched" is what the capture harness
//    already learned to distrust: its first version reported five successes while photographing
//    the same screen five times, because it had implemented "the chord was sent" as "the surface
//    opened". A check here must read state that only changes if the feature worked.
//
// 2. THE BEFORE-VALUE IS PART OF THE CHECK. Asserting `count > 0` passes on an app that ignored
//    the click and already had items. Every case captures state first, acts, and compares.
//
// 3. A CHECK THAT CANNOT RUN IS A FAILURE, NOT A PASS. If a selector is missing the surface has
//    changed or broken; either way somebody needs to look. Skips must be declared up front with a
//    reason, never inferred at runtime from something not being found.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertManagedConfigUnchanged,
  bootCreatedConfigTargets,
  captureManagedConfigSentinel,
  createAppSandbox,
  repoElectronPids,
} from './check-app-wired-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null
}
const attachPort = flag('attach')
const only = typeof flag('only') === 'string' ? String(flag('only')).split(',') : null

const { default: WebSocket } = await import('ws')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  // The HUD is a second page target with its own narrow preload; it intentionally has no
  // nodeTerminal bridge. Targeting "the first page" selected it on a real Windows run and made
  // the harness report that the main app had no bridge at all.
  const page = targets.find(
    (t) =>
      t.type === 'page' &&
      !t.url.startsWith('devtools://') &&
      !/(?:^|[\\/])hud\.html(?:[?#]|$)/i.test(t.url),
  )
  if (!page) throw new Error('no renderer target on the debugging port')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    }
  })
  await new Promise((r, j) => (ws.on('open', r), ws.on('error', j)))
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id
      pending.set(n, { res, rej })
      ws.send(JSON.stringify({ id: n, method, params }))
      setTimeout(
        () => pending.has(n) && (pending.delete(n), rej(new Error(`${method} timed out`))),
        30000,
      )
    })
  return { send, close: () => ws.close() }
}

const port = typeof attachPort === 'string' ? Number(attachPort) : 9223
const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const unix = join(ROOT, 'node_modules', '.bin', 'electron')
const bin = process.platform === 'win32' ? electron : unix
if (!attachPort && !existsSync(bin)) {
  console.error('✗ Electron binary not found — run `npm ci` (or `npm run rebuild`) first.')
  process.exit(1)
}
// A failed process inventory is not an empty inventory. Abort before launch: treating it as []
// makes every pre-existing matching process look new at cleanup and risks killing a Swiftie's app.
const pidsBefore = new Set(attachPort ? [] : repoElectronPids({ root: ROOT }))
const realHomeSentinelOptions = { home: homedir(), env: process.env }
const realHomeBefore = attachPort
  ? null
  : captureManagedConfigSentinel(realHomeSentinelOptions)
const sandbox = attachPort ? null : createAppSandbox()
let child = null
let close = null
let selected = []
let failed = 0
let skipped = 0
let runError = null
let cleanupError = null

try {
if (!attachPort) {
  child = spawn(bin, [join(ROOT, 'out', 'main', 'index.js'), `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    stdio: 'ignore',
    env: sandbox.env,
  })
  await new Promise((resolveLaunch, rejectLaunch) => {
    const cleanupListeners = () => {
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onError = (error) => {
      cleanupListeners()
      rejectLaunch(error)
    }
    const onExit = (code, signal) => {
      cleanupListeners()
      rejectLaunch(new Error(`Electron exited during launch (code ${code}, signal ${signal})`))
    }
    const timer = setTimeout(() => {
      cleanupListeners()
      resolveLaunch()
    }, 6000)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}
const connection = await cdp(port)
const { send } = connection
close = connection.close
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})

/** Evaluate in the renderer and return the value. Synchronous expressions only — `awaitPromise`
 *  hangs on this Electron/Node pairing, a dead end already recorded in the shared notes. */
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  }
  return r.result.value
}

/** Poll a synchronous expression until it is truthy, or give up. Returns the value or null. */
async function until(expression, ms = 4000) {
  const deadline = Date.now() + ms
  for (;;) {
    const v = await evaluate(expression)
    if (v) return v
    if (Date.now() > deadline) return null
    await sleep(150)
  }
}

/** Send a real key chord through the input pipeline, not a synthesised DOM event — a listener
 *  bound at the document level with `preventDefault` behaves differently for the two. */
async function chord({ key: k, code, vk, ctrl = false, shift = false }) {
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0)
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    })
  }
  await sleep(400)
}

if (sandbox) {
  // NT_USER_DATA is not trusted merely because it was passed. Ask the running main process what
  // Electron actually chose before touching any control, using the same real preload round-trip
  // as the product. A missing NT_MULTI or NT_USER_DATA override turns this red.
  await evaluate(`(function(){
    window.__wiredUserData = 'pending';
    try {
      window.nodeTerminal.userDataDir().then(
        function(v){ window.__wiredUserData = v },
        function(e){ window.__wiredUserData = 'rejected: ' + e }
      );
    } catch (e) { window.__wiredUserData = 'threw: ' + e }
    return true;
  })()`)
  const actualUserData = await until(
    `window.__wiredUserData !== 'pending' ? window.__wiredUserData : null`,
    8000,
  )
  const actualPath = typeof actualUserData === 'string' ? resolve(actualUserData) : ''
  const expectedPath = resolve(sandbox.userData)
  const samePath = process.platform === 'win32'
    ? actualPath.toLowerCase() === expectedPath.toLowerCase()
    : actualPath === expectedPath
  if (!samePath) {
    throw new Error(`app reported userData ${JSON.stringify(actualUserData)}; expected ${expectedPath}`)
  }

  // These are consequences of the real boot installers. Checking all of them proves HOME,
  // USERPROFILE, XDG_CONFIG_HOME, and GROK_HOME converged on the disposable root; a test that
  // only inspected the env object could stay green while Electron ignored it.
  // bootCreatedConfigTargets, NOT the full managed-config allowlist. The allowlist answers
  // "what may bootstrap touch in the real home" and legitimately contains files boot never
  // writes; deriving "must exist" from it made this gate red on the four shared School/Kids
  // records, which are absent by design until a mode is first set.
  const missing = bootCreatedConfigTargets({ home: sandbox.home, env: sandbox.env })
    .filter((target) => !existsSync(target))
  for (const target of [
    join(sandbox.userData, 'hook-endpoint.env'),
    join(sandbox.userData, 'context-links', 'context.sh'),
    join(sandbox.userData, 'canvas-control', 'nodeterm.sh'),
  ]) {
    if (!existsSync(target)) missing.push(target)
  }
  if (missing.length) {
    throw new Error(`isolated boot did not create its managed artefacts:\n${missing.map((p) => `  - ${p}`).join('\n')}`)
  }
}

// ---- Windows terminal profiles -------------------------------------------------------------
//
// The feature's whole claim is that a stable profile ID — never an executable path — crosses the
// bridge, and that the trusted core resolves it into a real program immediately before spawn. The
// unit suites prove the resolver in isolation; only the built app can prove that the picker a user
// actually operates is wired to that resolver, that a spawn honours the chosen ID, and that a
// profile this machine does not have is REFUSED rather than quietly becoming some other shell.

/** Declared up front, per rule 3, so a skip can never be inferred at runtime from a control that
 *  was not found. `terminalProfiles` is deliberately absent from the preload bridge off win32 (see
 *  src/preload/index.ts), so on any other host there is no picker to drive and no defect to find. */
const windowsProfilesSkip =
  process.platform === 'win32'
    ? null
    : `Windows terminal profiles exist only in the win32 desktop app; this host is ${process.platform}`

/** Settle a promise-returning bridge call and hand back its outcome. `Runtime.evaluate` cannot
 *  await on this Electron/Node pairing (the dead end recorded at `evaluate` above), so the renderer
 *  parks the settled value on `window` and we poll for it — the same shape the `terminal-spawns`
 *  and `ipc-bridge` cases write out by hand, factored out because the profile cases make eight of
 *  these calls between them. A rejection is a VALUE here, not a throw: refusing a bad profile is
 *  the behaviour one of these checks is asserting. */
async function settle(slot, expression, ms = 20000) {
  await evaluate(`(function(){
    window.${slot} = 'pending';
    try {
      (${expression}).then(
        function (v) { window.${slot} = { ok: true, value: v } },
        function (e) { window.${slot} = { ok: false, error: String((e && e.message) || e) } }
      );
    } catch (e) { window.${slot} = { ok: false, error: 'threw: ' + e } }
    return true;
  })()`)
  const settled = await until(`window.${slot} !== 'pending' ? window.${slot} : null`, ms)
  return settled || { ok: false, error: 'never settled — main did not answer' }
}

/** Wait for the shell the profile cases drive, and leave no overlay behind from an earlier one.
 *  Checks share a single app instance and run in table order, so a case that returned early with
 *  Settings still up would hand the next one a canvas it cannot reach. This makes each profile case
 *  independently runnable under `--only`, which is the whole point of having ids. */
async function readyCanvas() {
  if (!(await until(`!!document.querySelector('.react-flow__pane')`, 30000))) {
    return { ok: false, why: 'the canvas never mounted — nothing to drive' }
  }
  const overlays = `'.nt-settings, .ctx-menu, .destgate, .nt-palette, [class*="palette" i] input'`
  for (let i = 0; i < 4; i += 1) {
    if (!(await evaluate(`!!document.querySelector(${overlays})`))) return { ok: true }
    await chord({ key: 'Escape', code: 'Escape', vk: 27 })
  }
  if (await evaluate(`!!document.querySelector(${overlays})`)) {
    return { ok: false, why: 'an overlay from an earlier case would not close on Escape' }
  }
  return { ok: true }
}

/** The live catalog, read through the real preload bridge rather than by importing the detector: a
 *  catalog the built app cannot fetch is exactly the defect worth catching here. */
async function profileCatalog() {
  const bridged = await evaluate(`typeof (window.nodeTerminal.terminalProfiles || {}).list`)
  if (bridged !== 'function') {
    return { ok: false, why: `window.nodeTerminal.terminalProfiles.list is ${bridged} on win32` }
  }
  const listed = await settle('__wiredProfileList', 'window.nodeTerminal.terminalProfiles.list()')
  if (!listed.ok) return { ok: false, why: `terminalProfiles.list() → ${listed.error}` }
  if (!Array.isArray(listed.value) || listed.value.length === 0) {
    return {
      ok: false,
      why: `terminalProfiles.list() returned ${JSON.stringify(listed.value).slice(0, 140)}`,
    }
  }
  return { ok: true, list: listed.value }
}

/** Read one settings field back out of MAIN. The renderer store would report the optimistic value
 *  it just set whether or not anything reached disk, so it cannot answer "did the choice stick". */
async function settingFromMain(key, want, ms = 8000) {
  const deadline = Date.now() + ms
  let last
  for (;;) {
    const loaded = await settle('__wiredProfileSettings', 'window.nodeTerminal.settings.load()')
    if (!loaded.ok) return { ok: false, why: `settings.load() → ${loaded.error}` }
    last = loaded.value ? loaded.value[key] : undefined
    if (last === want) return { ok: true, value: last }
    if (Date.now() > deadline) {
      return {
        ok: false,
        why: `main still reports ${key}=${JSON.stringify(last)} after ${ms}ms (wanted ${JSON.stringify(want)})`,
      }
    }
    await sleep(200)
  }
}

/** The disposable profile starts with no project, so the canvas has nowhere to put a node until the
 *  welcome screen's own primary action has run. It creates an empty, folder-less canvas — no native
 *  picker, nothing outside the sandbox. */
async function ensureProject() {
  if (!(await evaluate(`!!document.querySelector('.md3-welcome__card--primary')`))) {
    return { ok: true }
  }
  await evaluate(`(document.querySelector('.md3-welcome__card--primary').click(), true)`)
  const dismissed = await until(
    `document.querySelector('.md3-welcome__card--primary') ? null : 'gone'`,
    10000,
  )
  if (!dismissed) return { ok: false, why: 'the welcome screen stayed up after New project' }
  return { ok: true }
}

/** Open a context menu with a real bubbling `contextmenu` event, which is what React's delegated
 *  onContextMenu listens for — CDP's own mouse events do not synthesize one here. `target` is a JS
 *  expression evaluated in the page so a caller can aim at a node's header rather than its xterm. */
async function openContextMenu(what, target) {
  const dispatched = await evaluate(`(function(){
    var el = ${target};
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var x = Math.round(r.left + Math.min(Math.max(r.width / 2, 8), 120));
    var y = Math.round(r.top + Math.min(Math.max(r.height / 2, 8), 60));
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y
    }));
    return true;
  })()`)
  if (!dispatched) return { ok: false, why: `there is no ${what} on screen to right-click` }
  if (!(await until(`!!document.querySelector('.ctx-menu')`, 8000))) {
    return { ok: false, why: `right-clicking the ${what} opened no context menu` }
  }
  return { ok: true }
}

/** Open a submenu by its exact visible label and return its child rows. The trigger's own onClick
 *  opens the flyout, so no hover simulation is needed. Exact match, never `includes`: "New terminal
 *  with profile…" and "Restart with profile…" end in the same words. */
async function openMenuSubmenu(label) {
  const opened = await evaluate(`(function(){
    var triggers = Array.prototype.slice.call(document.querySelectorAll('.ctx-item--submenu'));
    var hit = triggers.filter(function (t) {
      return ((t.querySelector('.ctx-item__label') || t).textContent || '').trim() === ${JSON.stringify(label)};
    })[0];
    if (!hit) return false;
    hit.click();
    return true;
  })()`)
  if (!opened) {
    const seen = await evaluate(`Array.prototype.slice.call(
      document.querySelectorAll('.ctx-item--submenu .ctx-item__label')
    ).map(function (n) { return (n.textContent || '').trim() })`)
    return { ok: false, why: `no “${label}” submenu in the menu (saw: ${JSON.stringify(seen)})` }
  }
  const items = await until(
    `(function(){
      var flyout = document.querySelector('.ctx-submenu');
      if (!flyout) return null;
      var rows = Array.prototype.slice.call(flyout.querySelectorAll('[role="menuitem"]'));
      if (rows.length === 0) return null;
      return rows.map(function (r) {
        return {
          label: ((r.querySelector('.ctx-item__label') || r).textContent || '').trim(),
          enabled: r.getAttribute('aria-disabled') !== 'true'
        };
      });
    })()`,
    6000,
  )
  if (!items) {
    const state = await evaluate(`(function(){
      var flyout = document.querySelector('.ctx-submenu');
      var menu = document.querySelector('.ctx-menu');
      return {
        flyout: !!flyout,
        rows: flyout ? flyout.querySelectorAll('[role="menuitem"]').length : 0,
        expanded: Array.prototype.slice.call(document.querySelectorAll('.ctx-item--submenu'))
          .map(function (t) {
            return ((t.querySelector('.ctx-item__label') || t).textContent || '').trim()
              + '=' + t.getAttribute('aria-expanded');
          }),
        menu: menu ? (menu.textContent || '').slice(0, 220) : null
      };
    })()`)
    return { ok: false, why: `the “${label}” flyout rendered nothing (${JSON.stringify(state)})` }
  }
  return { ok: true, items }
}

/** Click one flyout row by its exact label. Returns false when the row is not there any more, which
 *  a caller must treat as a failure rather than as "nothing to do". */
async function clickSubmenuItem(label) {
  return await evaluate(`(function(){
    var flyout = document.querySelector('.ctx-submenu');
    if (!flyout) return false;
    var rows = Array.prototype.slice.call(flyout.querySelectorAll('[role="menuitem"]'));
    var hit = rows.filter(function (r) {
      return ((r.querySelector('.ctx-item__label') || r).textContent || '').trim() === ${JSON.stringify(label)}
        && r.getAttribute('aria-disabled') !== 'true';
    })[0];
    if (!hit) return false;
    hit.click();
    return true;
  })()`)
}

/** Every terminal node on the canvas, with the profile label its header is currently showing. */
async function terminalNodes() {
  return await evaluate(`Array.prototype.slice.call(
    document.querySelectorAll('.react-flow__node[data-id]')
  ).filter(function (n) { return !!n.querySelector('.term-node') })
   .map(function (n) {
     var chip = n.querySelector('.term-profile-chip');
     return {
       id: n.getAttribute('data-id'),
       profile: chip ? (chip.textContent || '').trim() : null,
       failed: !!n.querySelector('.term-node__closed')
     };
   })`)
}

/** Drive the two-key destructive gate all the way through: arm both keys, then run the slider to
 *  the end exactly as a full drag does. Nothing here shortcuts the gate — the app's own one-shot
 *  latch and its completion animation still decide when `onConfirm` fires. */
async function completeDestructiveGate() {
  if (!(await until(`!!document.querySelector('.destgate')`, 8000))) {
    return { ok: false, why: 'the destructive confirmation gate never opened' }
  }
  const armed = await evaluate(`(function(){
    var keys = Array.prototype.slice.call(document.querySelectorAll('.destgate__key'));
    if (keys.length !== 2) return keys.length;
    keys.forEach(function (k) { if (k.getAttribute('aria-pressed') !== 'true') k.click() });
    return 2;
  })()`)
  if (armed !== 2) return { ok: false, why: `the gate offered ${armed} keys, not two` }
  const unlocked = await until(
    `(function(){
      var s = document.querySelector('.destgate__slider');
      return s && !s.disabled ? true : null;
    })()`,
    4000,
  )
  if (!unlocked) return { ok: false, why: 'both keys were armed but the slider stayed locked' }
  await evaluate(`(function(){
    var s = document.querySelector('.destgate__slider');
    var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(s, '100');
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
  // The gate plays a short completion animation before it calls back, then its host unmounts it.
  const closed = await until(`document.querySelector('.destgate') ? null : 'closed'`, 10000)
  if (!closed) return { ok: false, why: 'the gate never closed after a full slide with both keys' }
  return { ok: true }
}

/** End every terminal session this run started. A persistent session deliberately OUTLIVES the app,
 *  so leaving one behind would leak a real session-host process onto the machine — the same reason
 *  the `terminal-spawns` case destroys its probe. */
async function destroyCanvasTerminals() {
  const nodes = await terminalNodes()
  for (const node of nodes) {
    await evaluate(
      `(function(){ try { window.nodeTerminal.pty.destroy(${JSON.stringify(node.id)}) } catch (e) {} return true })()`,
    )
  }
  return nodes.length
}

const CHECKS = [
  {
    id: 'palette',
    title: 'Command palette filters as you type',
    async run() {
      await chord({ key: 'k', code: 'KeyK', vk: 75, ctrl: true })
      const opened = await until(
        `!!document.querySelector('[class*="palette" i] input, [class*="palette" i] [role="textbox"]')`,
      )
      if (!opened) return { ok: false, why: 'the palette did not open on Ctrl+K' }
      // RULE 2: read the unfiltered count first. `> 0` alone would pass on a palette that
      // ignored every keystroke and simply listed everything.
      const before = await evaluate(
        `document.querySelectorAll('[class*="palette" i] [role="option"], [class*="palette" i] li').length`,
      )
      await evaluate(`(function(){
        var i = document.querySelector('[class*="palette" i] input');
        if (!i) return false;
        var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        set.call(i, 'zzzqqqxx');
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`)
      await sleep(500)
      const after = await evaluate(
        `document.querySelectorAll('[class*="palette" i] [role="option"], [class*="palette" i] li').length`,
      )
      await chord({ key: 'Escape', code: 'Escape', vk: 27 })
      if (before === 0) return { ok: false, why: 'the palette listed nothing to filter' }
      if (after >= before) {
        return { ok: false, why: `a nonsense query did not narrow the list (${before} → ${after})` }
      }
      return { ok: true, detail: `${before} results → ${after} for a nonsense query` }
    },
  },
  {
    id: 'settings-persist',
    title: 'A settings toggle changes state and survives a reload',
    async run() {
      await chord({ key: ',', code: 'Comma', vk: 188, ctrl: true })
      const open = await until(`!!document.querySelector('[class*="settings" i]')`)
      if (!open) return { ok: false, why: 'settings did not open on Ctrl+,' }
      // `role="switch"`, not `input[type=checkbox]` — this app's toggle is `ui/Switch.tsx`, a
      // button carrying `aria-checked`. The first version of this check looked for a checkbox,
      // found none, and failed. That was the harness being wrong rather than the app, but it
      // failed CORRECTLY: rule 3 says a check that cannot run is a failure, because "I could not
      // find the control" and "the control does nothing" are indistinguishable from outside, and
      // only one of them is safe to ignore.
      const found = await evaluate(`(function(){
        var all = Array.prototype.slice.call(
          document.querySelectorAll('[role="switch"], input[type=checkbox]'));
        var b = all.filter(function(x){
          return !x.disabled && x.getAttribute('aria-disabled') !== 'true' && x.offsetParent !== null;
        })[0];
        if (!b) return null;
        window.__wiredBox = b;
        var state = b.getAttribute('aria-checked');
        return {
          label: (b.getAttribute('aria-label') || (b.textContent || '').trim() || 'switch').slice(0, 48),
          state: state === null ? String(b.checked) : state
        };
      })()`)
      if (!found) return { ok: false, why: 'no enabled switch or checkbox visible in settings' }
      const read = `(function(){ var b = window.__wiredBox; var s = b.getAttribute('aria-checked');
        return s === null ? String(b.checked) : s })()`
      await evaluate(`window.__wiredBox.click()`)
      await sleep(500)
      const after = await evaluate(read)
      if (after === found.state) {
        return { ok: false, why: `"${found.label}" did not change when clicked — an inert control` }
      }
      // Put it back, and confirm the restore also takes: a control that only moves one way is
      // half-wired, and leaving the app mutated would poison later checks and the user's config.
      await evaluate(`window.__wiredBox.click()`)
      await sleep(500)
      const restored = await evaluate(read)
      await chord({ key: 'Escape', code: 'Escape', vk: 27 })
      if (restored !== found.state) {
        return { ok: false, why: `"${found.label}" would not toggle back (left at ${restored})` }
      }
      return { ok: true, detail: `"${found.label}" ${found.state} → ${after} → ${restored}` }
    },
  },
  {
    id: 'canvas-nodes',
    title: 'The canvas renders real nodes, not a picture of nodes',
    async run() {
      const flow = await until(`!!document.querySelector('.react-flow')`)
      if (!flow) return { ok: false, why: 'no react-flow root — the canvas did not mount' }
      // A pane that reports a live viewport transform is a real canvas; a screenshot cannot.
      const vp = await evaluate(
        `(document.querySelector('.react-flow__viewport') || {}).style ? document.querySelector('.react-flow__viewport').style.transform : ''`,
      )
      if (!vp || !/matrix|translate/.test(vp)) {
        return { ok: false, why: `viewport has no transform (${JSON.stringify(vp)})` }
      }
      return { ok: true, detail: `viewport transform present: ${vp.slice(0, 40)}` }
    },
  },
  {
    id: 'theme-token',
    title: 'A real app control consumes the live accent token',
    async run() {
      await chord({ key: ',', code: 'Comma', vk: 188, ctrl: true })
      if (!(await until(`!!document.querySelector('[class*="settings" i]')`))) {
        return { ok: false, why: 'settings did not open for the accent-consumer check' }
      }
      const accent = await evaluate(
        `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`,
      )
      if (!accent) return { ok: false, why: '--accent is not defined on :root' }

      // Use the production Switch component as the consumer. Creating our own div with
      // `color:var(--accent)` proves only that Chromium implements CSS variables — it stays green
      // if every app rule stops consuming the token. Ensure one real, visible switch is ON, move
      // the token, then restore both the exact prior inline declaration and the switch state.
      //
      // Post-M3 (`.md3-switch[aria-checked='true']`, styles.md3.css), the Switch's ON background
      // is `var(--md-primary)`, not `var(--accent)` directly — `styles.md3.css` never references
      // `--accent` at all (grep it). The two stay in sync only because a REAL accent change runs
      // through `accentTokens.ts`'s `applyAccentTokens()`, which republishes the whole derived
      // family (`--md-primary` included) in one call — see `CUSTOM_PROPERTIES` there. Moving
      // `--accent` alone, as this check did pre-M3 when every rule read `var(--accent)` straight,
      // now proves nothing: the CSS has no fallback chain back to it any more. Move both, exactly
      // as `applyAccentTokens` does for a real user-picked colour, so this still exercises the
      // actual consequence (a rendered control's paint) rather than an implementation detail that
      // moved when the redesign landed.
      const target = await evaluate(`(function(){
        var switches = Array.prototype.slice.call(document.querySelectorAll('[role="switch"]'))
          .filter(function(x){ return !x.disabled && x.offsetParent !== null; });
        var control = switches[0];
        if (!control) return null;
        window.__wiredAccentSwitch = control;
        var wasOn = control.getAttribute('aria-checked') === 'true';
        if (!wasOn) control.click();
        return { wasOn: wasOn };
      })()`)
      if (!target) return { ok: false, why: 'no enabled app switch was visible in settings' }
      if (!(await until(`window.__wiredAccentSwitch?.getAttribute('aria-checked') === 'true'`))) {
        return { ok: false, why: 'the real switch did not enter its accent-backed ON state' }
      }
      const before = await evaluate(`(function(){
        var control = window.__wiredAccentSwitch;
        var root = document.documentElement;
        window.__wiredAccentPrior = root.style.getPropertyValue('--accent');
        window.__wiredAccentPriority = root.style.getPropertyPriority('--accent');
        window.__wiredPrimaryPrior = root.style.getPropertyValue('--md-primary');
        window.__wiredPrimaryPriority = root.style.getPropertyPriority('--md-primary');
        var colour = getComputedStyle(control).backgroundColor;
        root.style.setProperty('--accent', 'rgb(1, 2, 3)');
        root.style.setProperty('--md-primary', 'rgb(1, 2, 3)');
        return colour;
      })()`)
      // Switch has a deliberate 200 ms colour transition. Reading in the same JS turn measures its
      // starting colour and falsely calls the live token baked; cross the authored transition.
      await sleep(300)
      const after = await evaluate(`(function(){
        var control = window.__wiredAccentSwitch;
        var root = document.documentElement;
        var colour = getComputedStyle(control).backgroundColor;
        if (window.__wiredAccentPrior) {
          root.style.setProperty('--accent', window.__wiredAccentPrior, window.__wiredAccentPriority);
        } else {
          root.style.removeProperty('--accent');
        }
        if (window.__wiredPrimaryPrior) {
          root.style.setProperty('--md-primary', window.__wiredPrimaryPrior, window.__wiredPrimaryPriority);
        } else {
          root.style.removeProperty('--md-primary');
        }
        return colour;
      })()`)
      if (!target.wasOn) {
        await evaluate(`window.__wiredAccentSwitch.click()`)
        if (!(await until(`window.__wiredAccentSwitch?.getAttribute('aria-checked') === 'false'`))) {
          return { ok: false, why: 'the accent probe did not restore the switch' }
        }
      }
      await chord({ key: 'Escape', code: 'Escape', vk: 27 })
      if (before === after || !/rgb\(1, 2, 3\)/.test(after)) {
        return {
          ok: false,
          why: `the real switch ignored --accent/--md-primary (${before} → ${after})`,
        }
      }
      return { ok: true, detail: `Switch background followed --accent/--md-primary (${accent} → ${after})` }
    },
  },
  {
    id: 'terminal-spawns',
    title: 'A terminal actually spawns — the thing this app is for',
    async run() {
      // The most important check here, and the one most easily faked by the others passing. Every
      // case above would still pass on an app that renders a beautiful canvas and cannot open a
      // single shell, because node-pty is a NATIVE module: it must be compiled against Electron's
      // ABI, and `electron-vite build` does not do that — electron-rebuild does, at install time.
      // So a checkout whose postinstall failed boots, paints, and answers IPC while being unable
      // to do the one thing it exists for.
      await evaluate(`(function(){
        window.__ptyProbe = 'pending';
        try {
          var key = 'wired-probe-' + Date.now();
          // persistKey is the node id, and destroying by it is what ends the session for good —
          // leaving one behind would leak a real tmux/session-host process onto this machine.
          window.nodeTerminal.pty.create({ cols: 80, rows: 24, persistKey: key }).then(
            function (r) {
              window.__ptyProbe =
                r && r.sessionId ? 'created' :
                r && r.unavailable ? 'unavailable: ' + r.unavailable :
                'no session id: ' + JSON.stringify(r).slice(0, 120);
              try { window.nodeTerminal.pty.destroy(key) } catch (e) {}
            },
            function (e) { window.__ptyProbe = 'threw: ' + e }
          );
        } catch (e) { window.__ptyProbe = 'threw: ' + e }
        return true;
      })()`)
      const r = await until(`window.__ptyProbe !== 'pending' ? window.__ptyProbe : null`, 15000)
      if (r === null) return { ok: false, why: 'pty.create never settled — main did not answer' }
      if (r !== 'created') {
        return { ok: false, why: `pty.create → ${r} (node-pty is probably not built for Electron's ABI)` }
      }
      return { ok: true, detail: 'pty.create round-tripped and a real session came back' }
    },
  },
  {
    id: 'ipc-bridge',
    title: 'The preload bridge is present and answers a real main-process call',
    async run() {
      const api = await evaluate(`typeof window.nodeTerminal`)
      if (api !== 'object') return { ok: false, why: `window.nodeTerminal is ${api}` }
      // Count the surface, then make a REAL round trip. A contextBridge object full of stubs
      // would pass the first assertion and fail the second.
      const members = await evaluate(`Object.keys(window.nodeTerminal).length`)
      await evaluate(`(function(){
        window.__wiredSettings = 'pending';
        try {
          window.nodeTerminal.settings.load().then(
            function(v){ window.__wiredSettings = v && typeof v === 'object' ? 'object' : typeof v },
            function(e){ window.__wiredSettings = 'rejected: ' + e }
          );
        } catch (e) { window.__wiredSettings = 'threw: ' + e }
        return true;
      })()`)
      const settled = await until(`window.__wiredSettings !== 'pending' ? window.__wiredSettings : null`, 8000)
      if (settled === null) return { ok: false, why: 'settings.load() never settled — main did not answer' }
      if (settled !== 'object') return { ok: false, why: `settings.load() gave ${settled}` }
      return { ok: true, detail: `${members} bridge namespaces; settings.load() round-tripped` }
    },
  },
  {
    id: 'terminal-profile-picker',
    title: 'The Windows profile picker offers this machine’s real catalog and the choice reaches main',
    skip: windowsProfilesSkip,
    async run() {
      const ready = await readyCanvas()
      if (!ready.ok) return ready
      const catalog = await profileCatalog()
      if (!catalog.ok) return catalog

      await chord({ key: ',', code: 'Comma', vk: 188, ctrl: true })
      // Generously, because Settings is a lazily-loaded chunk: on a cold profile this is the first
      // time it is fetched and parsed, and a slow load is not the defect this case is looking for.
      if (!(await until(`!!document.querySelector('.nt-settings')`, 20000))) {
        return { ok: false, why: 'settings did not open on Ctrl+,' }
      }
      // Global mode, explicitly. `settings.load()` below reads the app-wide store, and a project
      // scope would route the same edit into that project's sparse overlay instead — a green
      // assertion about a file the picker never wrote.
      await evaluate(`(function(){
        var group = document.querySelector('[aria-label="Choose settings mode"]');
        if (!group) return false;
        var globalButton = Array.prototype.slice.call(group.querySelectorAll('button'))
          .filter(function (b) { return (b.textContent || '').indexOf('Global') >= 0 })[0];
        if (globalButton && globalButton.getAttribute('aria-pressed') !== 'true') globalButton.click();
        return true;
      })()`)

      // The section list carries no stable per-section attribute, so ask the DOM the one question
      // that cannot go stale: keep opening sections until the picker itself is on screen. The named
      // row is tried first only because it is one click instead of a dozen.
      const jumped = await evaluate(`(function(){
        if (document.getElementById('terminal-profile-select')) return 'already';
        var rows = Array.prototype.slice.call(document.querySelectorAll('.md3-settings-nav-row'));
        window.__wiredSettingsNav = rows;
        var shell = rows.filter(function (r) {
          return ((r.querySelector('.md3-settings-nav-row__label') || {}).textContent || '').trim() === 'Shell';
        })[0];
        if (shell) { shell.click(); return 'named'; }
        return 'scan';
      })()`)
      if (jumped === 'scan' || !(await until(`!!document.getElementById('terminal-profile-select')`, 2500))) {
        const rows = await evaluate(`(window.__wiredSettingsNav || []).length`)
        for (let i = 0; i < rows; i += 1) {
          await evaluate(`(window.__wiredSettingsNav[${i}].click(), true)`)
          if (await until(`!!document.getElementById('terminal-profile-select')`, 600)) break
        }
      }
      if (!(await until(`!!document.getElementById('terminal-profile-select')`, 4000))) {
        return { ok: false, why: 'no settings section rendered #terminal-profile-select' }
      }

      const picker = await evaluate(`(function(){
        var select = document.getElementById('terminal-profile-select');
        return {
          value: select.value,
          options: Array.prototype.slice.call(select.options).map(function (o) {
            return { value: o.value, enabled: !o.disabled, text: (o.textContent || '').trim() };
          })
        };
      })()`)

      // Two assertions, in the direction that matters. The picker must offer exactly the detected
      // catalog — a row it invented would be a profile nothing can spawn — and every row it leaves
      // ENABLED must be a profile this machine actually has. The reverse is deliberately not
      // asserted: the Shell section legitimately disables `custom` on top of the catalog while no
      // custom executable is configured.
      const detected = catalog.list.map((profile) => profile.id)
      const offered = picker.options
        .map((option) => option.value)
        .filter((value) => value !== '__configured-profile-unavailable__')
      if (offered.join('|') !== detected.join('|')) {
        return {
          ok: false,
          why: `picker offers ${JSON.stringify(offered)} but core detected ${JSON.stringify(detected)}`,
        }
      }
      const availableIds = new Set(
        catalog.list.filter((profile) => profile.available).map((profile) => profile.id),
      )
      const offeredButMissing = picker.options
        .filter((option) => option.enabled && !availableIds.has(option.value))
        .map((option) => option.value)
      if (offeredButMissing.length) {
        return {
          ok: false,
          why: `picker left ${JSON.stringify(offeredButMissing)} selectable, but core reports them unavailable`,
        }
      }
      // A detection that cannot say WHY is how an unavailable profile becomes a mystery instead of
      // an instruction — the same honesty the real-Windows suite asserts against the live machine.
      const silent = catalog.list
        .filter((profile) => !profile.available && !String(profile.unavailableReason || '').trim())
        .map((profile) => profile.id)
      if (silent.length) {
        return { ok: false, why: `unavailable without a reason: ${JSON.stringify(silent)}` }
      }

      const selectable = picker.options.filter((option) => option.enabled)
      if (selectable.length < 2) {
        return {
          ok: false,
          why: `only ${selectable.length} selectable profile(s) — the picker cannot be shown to move`,
        }
      }
      const chosen = (selectable.find((option) => option.value !== picker.value) || selectable[0]).value
      await evaluate(`(function(){
        var select = document.getElementById('terminal-profile-select');
        var set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        set.call(select, ${JSON.stringify(chosen)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
      const stuck = await settingFromMain('defaultTerminalProfileId', chosen)
      if (!stuck.ok) {
        await chord({ key: 'Escape', code: 'Escape', vk: 27 })
        return stuck
      }
      // Put it back and confirm the restore also takes: a picker that only moves one way is half
      // wired, and the later cases read this same default. Restored to the value the picker was
      // SHOWING, which is the resolved default — an implicit default therefore comes back explicit,
      // harmless in a sandbox this run deletes on the way out.
      await evaluate(`(function(){
        var select = document.getElementById('terminal-profile-select');
        var set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        set.call(select, ${JSON.stringify(picker.value)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
      const restored = await settingFromMain('defaultTerminalProfileId', picker.value)
      await chord({ key: 'Escape', code: 'Escape', vk: 27 })
      if (!restored.ok) return restored
      return {
        ok: true,
        detail:
          `picker offered all ${detected.length} detected profile(s), ${selectable.length} selectable; ` +
          `default ${picker.value} → ${chosen} → ${picker.value} through main`,
      }
    },
  },
  {
    id: 'terminal-profile-spawn',
    title: 'Creating a terminal with an explicit profile spawns under it, and a missing profile is refused',
    skip: windowsProfilesSkip,
    async run() {
      const ready = await readyCanvas()
      if (!ready.ok) return ready
      const catalog = await profileCatalog()
      if (!catalog.ok) return catalog
      const project = await ensureProject()
      if (!project.ok) return project

      // Prefer a named shell over Automatic: its label cannot coincide with the one a node that
      // merely inherited the default would show, so the chip below actually discriminates.
      const available = catalog.list.filter((profile) => profile.available)
      const pick = available.find((profile) => profile.id !== 'auto') || available[0]
      if (!pick) {
        return { ok: false, why: 'core detected no available profile — nothing could spawn here' }
      }

      const before = (await terminalNodes()).map((node) => node.id)
      const menu = await openContextMenu('canvas', `document.querySelector('.react-flow__pane')`)
      if (!menu.ok) return menu
      const submenu = await openMenuSubmenu('New terminal with profile…')
      if (!submenu.ok) return submenu
      const offered = submenu.items.find((item) => item.label === pick.label)
      if (!offered || !offered.enabled) {
        return {
          ok: false,
          why: `“${pick.label}” is available to core but ${offered ? 'disabled' : 'absent'} in the create menu`,
        }
      }
      if (!(await clickSubmenuItem(pick.label))) {
        return { ok: false, why: `the “${pick.label}” row vanished before it could be clicked` }
      }

      const spawned = await until(
        `(function(){
          var known = ${JSON.stringify(before)};
          var nodes = Array.prototype.slice.call(document.querySelectorAll('.react-flow__node[data-id]'));
          var fresh = nodes.filter(function (n) {
            return !!n.querySelector('.term-node') && known.indexOf(n.getAttribute('data-id')) < 0;
          })[0];
          if (!fresh) return null;
          var chip = fresh.querySelector('.term-profile-chip');
          return chip ? { id: fresh.getAttribute('data-id'), profile: (chip.textContent || '').trim() } : null;
        })()`,
        15000,
      )
      if (!spawned) return { ok: false, why: 'no new terminal node with a profile chip appeared' }
      if (spawned.profile !== pick.label) {
        return {
          ok: false,
          why: `the new node reports profile “${spawned.profile}”, not the chosen “${pick.label}”`,
        }
      }
      // A profile chip is a label; a running shell is the consequence. Give the real spawn a moment,
      // then insist the node is showing a terminal rather than its ended/failed plate.
      await sleep(2500)
      const live = await evaluate(`(function(){
        var nodes = Array.prototype.slice.call(document.querySelectorAll('.react-flow__node[data-id]'));
        var node = nodes.filter(function (n) {
          return n.getAttribute('data-id') === ${JSON.stringify(spawned.id)};
        })[0];
        if (!node) return null;
        return {
          failed: !!node.querySelector('.term-node__closed'),
          xterm: !!node.querySelector('.xterm')
        };
      })()`)
      if (!live) return { ok: false, why: 'the new node disappeared while its shell was starting' }
      if (live.failed || !live.xterm) {
        return {
          ok: false,
          why: `the node under “${pick.label}” did not reach a running terminal (failed=${live.failed}, xterm=${live.xterm})`,
        }
      }

      // The trust boundary, from the renderer's side of the bridge. A profile ID is the ONLY launch
      // choice that crosses it, so core must resolve a real one and refuse one it cannot — never
      // fall through to whatever shell happens to be lying around. An `unavailable` result would be
      // just as wrong an answer as a session: the request named a profile that does not exist.
      const key = `wired-profile-probe-${Date.now()}`
      const good = await settle(
        '__wiredProfileSpawn',
        `window.nodeTerminal.pty.create({ cols: 80, rows: 24, persistKey: ${JSON.stringify(key)}, profileId: ${JSON.stringify(pick.id)} })`,
      )
      await evaluate(
        `(function(){ try { window.nodeTerminal.pty.destroy(${JSON.stringify(key)}) } catch (e) {} return true })()`,
      )
      if (!good.ok) return { ok: false, why: `pty.create under ${pick.id} → ${good.error}` }
      if (!good.value || !good.value.sessionId) {
        return { ok: false, why: `pty.create under ${pick.id} gave ${JSON.stringify(good.value).slice(0, 140)}` }
      }
      const bogusKey = `wired-profile-bogus-${Date.now()}`
      const bogus = await settle(
        '__wiredProfileBogus',
        `window.nodeTerminal.pty.create({ cols: 80, rows: 24, persistKey: ${JSON.stringify(bogusKey)}, profileId: 'nodeterm-wired-not-a-profile' })`,
      )
      await evaluate(
        `(function(){ try { window.nodeTerminal.pty.destroy(${JSON.stringify(bogusKey)}) } catch (e) {} return true })()`,
      )
      if (bogus.ok) {
        return {
          ok: false,
          why: `an unknown profile ID still produced a session (${JSON.stringify(bogus.value).slice(0, 140)}) — the spawn boundary is open`,
        }
      }
      return {
        ok: true,
        detail:
          `created a node under “${pick.label}” (${pick.id}) and it reached a live terminal; ` +
          `an unknown profile ID was refused: ${String(bogus.error).slice(0, 90)}`,
      }
    },
  },
  {
    id: 'terminal-profile-restart',
    title: 'Restart with profile… ends the old session and relaunches the node under the new profile',
    skip: windowsProfilesSkip,
    async run() {
      const ready = await readyCanvas()
      if (!ready.ok) return ready
      const catalog = await profileCatalog()
      if (!catalog.ok) return catalog
      const project = await ensureProject()
      if (!project.ok) return project

      // Reuse the node the spawn case left behind when it is there, but never depend on it: a check
      // that only works after its neighbour passed reports its neighbour's failure twice. The
      // fallback deliberately creates the node through the same menu the spawn case drives rather
      // than through ⌘T, so this case starts from a node whose profile was chosen explicitly.
      let nodes = await terminalNodes()
      if (nodes.length === 0) {
        const seed = catalog.list.find((profile) => profile.available && profile.id !== 'auto')
          || catalog.list.find((profile) => profile.available)
        if (!seed) return { ok: false, why: 'core detected no available profile to open a node with' }
        const seedMenu = await openContextMenu('canvas', `document.querySelector('.react-flow__pane')`)
        if (!seedMenu.ok) return seedMenu
        const seedSubmenu = await openMenuSubmenu('New terminal with profile…')
        if (!seedSubmenu.ok) return seedSubmenu
        if (!(await clickSubmenuItem(seed.label))) {
          return { ok: false, why: `could not open a terminal under “${seed.label}” to restart` }
        }
        if (!(await until(`!!document.querySelector('.term-profile-chip')`, 15000))) {
          return { ok: false, why: `no terminal node appeared under “${seed.label}” to restart` }
        }
        await sleep(2000)
        nodes = await terminalNodes()
      }
      const node = nodes[0]
      if (!node || !node.profile) {
        return { ok: false, why: 'the terminal node on the canvas shows no profile chip to change' }
      }

      const target = catalog.list.find(
        (profile) => profile.available && profile.label !== node.profile,
      )
      if (!target) {
        return {
          ok: false,
          why: `no second available profile to switch to (node is on “${node.profile}”)`,
        }
      }

      const header = `(function(){
        var nodes = Array.prototype.slice.call(document.querySelectorAll('.react-flow__node[data-id]'));
        var el = nodes.filter(function (n) { return n.getAttribute('data-id') === ${JSON.stringify(node.id)} })[0];
        return el ? (el.querySelector('.term-node__header') || el) : null;
      })()`
      const menu = await openContextMenu('terminal node', header)
      if (!menu.ok) return menu
      const submenu = await openMenuSubmenu('Restart with profile…')
      if (!submenu.ok) return submenu
      const offered = submenu.items.find((item) => item.label === target.label)
      if (!offered || !offered.enabled) {
        return {
          ok: false,
          why: `“${target.label}” is available to core but ${offered ? 'disabled' : 'absent'} in the restart menu`,
        }
      }
      if (!(await clickSubmenuItem(target.label))) {
        return { ok: false, why: `the “${target.label}” restart row vanished before it could be clicked` }
      }

      // Ending a live session is destructive, so it goes through the app's own two-key gate. Driving
      // that gate is part of the check: a restart reachable without it would be a defect in the
      // other direction.
      const gate = await completeDestructiveGate()
      if (!gate.ok) return gate

      const relaunched = await until(
        `(function(){
          var nodes = Array.prototype.slice.call(document.querySelectorAll('.react-flow__node[data-id]'));
          var el = nodes.filter(function (n) { return n.getAttribute('data-id') === ${JSON.stringify(node.id)} })[0];
          if (!el) return null;
          var chip = el.querySelector('.term-profile-chip');
          var label = chip ? (chip.textContent || '').trim() : '';
          return label === ${JSON.stringify(target.label)} ? label : null;
        })()`,
        25000,
      )
      if (!relaunched) {
        const now = await terminalNodes()
        return {
          ok: false,
          why: `the node never came back under “${target.label}” (canvas now: ${JSON.stringify(now)})`,
        }
      }
      // The chip proves the renderer relaunched it. This proves the decision LEFT the renderer: the
      // same node id, carrying the new profile, read back out of main's workspace store after the
      // canvas's debounced save.
      const persisted = await (async () => {
        const deadline = Date.now() + 15000
        let seen
        for (;;) {
          const loaded = await settle('__wiredProfileWorkspace', 'window.nodeTerminal.workspace.load()')
          if (!loaded.ok) return { ok: false, why: `workspace.load() → ${loaded.error}` }
          seen = ((loaded.value || {}).projects || [])
            .flatMap((entry) => entry.nodes || [])
            .filter((state) => state.id === node.id)
            .map((state) => state.terminalProfileId)[0]
          if (seen === target.id) return { ok: true }
          if (Date.now() > deadline) {
            return {
              ok: false,
              why: `main's workspace still reports terminalProfileId=${JSON.stringify(seen)} for the restarted node (wanted ${target.id})`,
            }
          }
          await sleep(300)
        }
      })()
      if (!persisted.ok) return persisted

      // A persistent session outlives the app by design, so nothing this run started may be left
      // behind. Best effort — the run's own process sweep is the backstop when a case returns early.
      const ended = await destroyCanvasTerminals()
      return {
        ok: true,
        detail:
          `“${node.profile}” → “${target.label}” (${target.id}) through the two-key gate; ` +
          `main's workspace agrees; ended ${ended} session(s)`,
      }
    },
  },
  {
    id: 'wsl-bridge',
    title: 'The WSL bridge answers from the real machine, and never invents an empty one',
    async run() {
      // READ-ONLY on purpose. Creating, sleeping or deleting a distribution here would touch this
      // machine's real WSL, and the whole safety property of the feature is that nodeterm never
      // touches one it did not create. Enumeration is the honest thing to exercise.
      const present = await evaluate(`!!(window.nodeTerminal && window.nodeTerminal.wsl)`)
      if (!present) return { ok: false, why: 'window.nodeTerminal.wsl is absent — the bridge is unwired' }

      const listed = await settle('__wiredWslList', 'window.nodeTerminal.wsl.list()')

      // A REJECTION is a pass, and this is the point of the check. On a machine where WSL cannot
      // be enumerated the honest answer is a refusal carrying a reason; an empty array would be
      // the app claiming this machine has no distributions, which is a different and much worse
      // sentence. Either shape proves the round trip reached main and came back truthfully.
      if (!listed.ok) {
        const why = String(listed.error || '')
        if (!why.trim()) return { ok: false, why: 'the bridge rejected with no reason at all' }
        return { ok: true, detail: `refused with a reason rather than faking an empty machine: ${why}` }
      }

      if (!Array.isArray(listed.value)) {
        return { ok: false, why: `list() resolved with ${typeof listed.value}, not an array` }
      }
      const rows = listed.value
      // Ownership must come from the app's own ledger, so on a machine nodeterm has never created
      // a distribution on, every row must say "not ours" — including any whose NAME looks like it
      // could be ours. A prefix is not provenance.
      const claimed = rows.filter((r) => r && r.ownedByApp === true).map((r) => r.name)
      const shaped = rows.every((r) => r && typeof r.name === 'string' && typeof r.ownedByApp === 'boolean')
      if (!shaped) return { ok: false, why: 'a row arrived without a name or an ownership verdict' }
      return {
        ok: true,
        detail:
          `enumerated ${rows.length} real distribution(s); ` +
          (claimed.length ? `app-owned per the ledger: ${claimed.join(', ')}` : 'none claimed as app-owned'),
      }
    },
  },
  {
    id: 'nsis-node',
    title: 'The NSIS installer node can actually be created from the canvas',
    async run() {
      // It was registered in the canvas node map for a while with no way to reach it, which is
      // indistinguishable from working until somebody looks for the menu row. So: open the pane
      // menu the way a person does, find the row by its label, click it, and require a real node.
      //
      // A project first: a fresh profile opens on the welcome screen, and a canvas with no project
      // behind it has nowhere to persist a node to -- which surfaces as an empty workspace and
      // reads as "the node did not save" rather than "there was nothing to save it into".
      const project = await ensureProject()
      if (!project.ok) return project

      const before = await evaluate(`document.querySelectorAll('.react-flow__node').length`)
      const opened = await evaluate(`(function(){
        var pane = document.querySelector('.react-flow__pane');
        if (!pane) return false;
        var r = pane.getBoundingClientRect();
        pane.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
        }));
        return true;
      })()`)
      if (!opened) return { ok: false, why: 'no canvas pane to right-click' }
      const menu = await until(`!!document.querySelector('[class*="context-menu" i], [class*="ctx-menu" i]')`)
      if (!menu) return { ok: false, why: 'the pane context menu did not open' }

      // The row sits inside a submenu, and the flyout renders on a later tick -- so hovering and
      // re-querying inside one evaluate finds nothing and reports the app as broken. The first
      // version of this check did exactly that. Open each trigger, wait, then look.
      const rowLabels = `Array.from(document.querySelectorAll('[class*="menu" i] button, [class*="menu" i] [role="menuitem"]')).map(function (b) { return (b.textContent || '').trim() })`
      const findAndClick = `(function(){
        var rows = Array.from(document.querySelectorAll('[class*="menu" i] button, [class*="menu" i] [role="menuitem"]'));
        var hit = rows.find(function (b) { return /nsis/i.test(b.textContent || '') });
        if (!hit) return { ok: false };
        hit.click();
        return { ok: true, label: (hit.textContent || '').trim() };
      })()`
      let clicked = await evaluate(findAndClick)
      if (!clicked || !clicked.ok) {
        const triggers = await evaluate(rowLabels)
        for (const label of triggers || []) {
          await evaluate(`(function(){
            var rows = Array.from(document.querySelectorAll('[class*="menu" i] button, [class*="menu" i] [role="menuitem"]'));
            var t = rows.find(function (b) { return (b.textContent || '').trim() === ${JSON.stringify(label)} });
            if (!t) return false;
            t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            return true;
          })()`)
          await sleep(250)
          clicked = await evaluate(findAndClick)
          if (clicked && clicked.ok) break
        }
      }
      if (!clicked || !clicked.ok) {
        const labels = await evaluate(rowLabels)
        return { ok: false, why: `no NSIS row anywhere in the pane menu; saw: ${JSON.stringify(labels || [])}` }
      }
      const grew = await until(`document.querySelectorAll('.react-flow__node').length > ${before} ? document.querySelectorAll('.react-flow__node').length : null`)
      if (!grew) return { ok: false, why: `clicking “${clicked.label}” created no node` }

      // And it must be the NSIS node rather than merely A node: read main's own workspace back,
      // which is also the proof the kind persisted rather than living only in the renderer.
      //
      // Polled rather than read once, because the canvas save is debounced. The first version
      // asked immediately and got an empty node list, which reads exactly like "the node did not
      // persist" when the truth was "nobody has written yet" -- the same class of mistake this
      // whole harness exists to catch, made by the harness.
      const deadline = Date.now() + 15000
      let kinds = []
      for (;;) {
        const loaded = await settle('__wiredNsisWorkspace', 'window.nodeTerminal.workspace.load()')
        if (!loaded.ok) return { ok: false, why: `workspace.load() → ${loaded.error}` }
        kinds = ((loaded.value || {}).projects || []).flatMap((p) => p.nodes || []).map((n) => n.kind)
        if (kinds.includes('nsis')) break
        if (Date.now() > deadline) {
          return {
            ok: false,
            why: `a node appeared but main's workspace never recorded an nsis node (kinds seen: ${JSON.stringify([...new Set(kinds)])})`,
          }
        }
        await sleep(500)
      }
      return { ok: true, detail: `“${clicked.label}” created a real nsis node and main's workspace agrees` }
    },
  },
]

selected = only ? CHECKS.filter((c) => only.includes(c.id)) : CHECKS
const unknown = only ? only.filter((id) => !CHECKS.some((c) => c.id === id)) : []
if (unknown.length) throw new Error(`unknown --only check(s): ${unknown.join(', ')}`)
console.log('')
for (const c of selected) {
  // A DECLARED skip (rule 3): its reason is decided before the run, never inferred at runtime
  // from a control that was not found. Counted apart from passes so it can never read as one.
  if (c.skip) {
    skipped += 1
    console.log(`⊘ ${c.title}\n    declared skip: ${c.skip}`)
    continue
  }
  let r
  try {
    r = await c.run()
  } catch (e) {
    r = { ok: false, why: `threw: ${e.message}` }
  }
  if (r.ok) console.log(`✓ ${c.title}\n    ${r.detail}`)
  else {
    failed += 1
    console.error(`✗ ${c.title}\n    ${r.why}`)
  }
}
} catch (error) {
  runError = error
} finally {
  try {
    close?.()
  } catch (error) {
    cleanupError ??= error
  }
  if (child) {
    try {
      child.kill()
    } catch (error) {
      cleanupError ??= error
    }
  }

  // Killing the app is not enough: on Windows its session host outlives the parent by design.
  // Snapshot/diff means an already-running developer instance is never ours to stop. Re-query
  // immediately before Stop-Process too, so a PID that exited and was reused cannot cross the
  // literal repo-command-line boundary between discovery and termination.
  if (!attachPort) {
    await sleep(1500)
    try {
      const candidates = repoElectronPids({ root: ROOT }).filter((pid) => !pidsBefore.has(pid))
      const stillOwned = new Set(repoElectronPids({ root: ROOT }))
      const leaked = candidates.filter((pid) => stillOwned.has(pid))
      if (leaked.length) {
        execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Stop-Process -Id ${leaked.join(',')} -Force -ErrorAction Stop`,
          ],
          { timeout: 20000, stdio: 'ignore' },
        )
        console.log(`  (cleaned up ${leaked.length} process(es) this run started: ${leaked.join(', ')})`)
      }
    } catch (error) {
      cleanupError ??= new Error(`could not inventory or stop this run's Electron processes: ${error.message}`, {
        cause: error,
      })
    }

    try {
      const realHomeAfter = captureManagedConfigSentinel(realHomeSentinelOptions)
      assertManagedConfigUnchanged(realHomeBefore, realHomeAfter)
    } catch (error) {
      cleanupError ??= error
    }
    if (sandbox) {
      try {
        rmSync(sandbox.root, { recursive: true, force: true })
      } catch (error) {
        cleanupError ??= new Error(`could not remove wiring sandbox ${sandbox.root}: ${error.message}`, {
          cause: error,
        })
      }
    }
  }
}

if (runError) throw runError
if (cleanupError) throw cleanupError

console.log('')
const sha = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 8)
  } catch {
    return 'unknown'
  }
})()
const ran = selected.length - skipped
console.log(
  `${ran - failed}/${ran} interaction checks passed at ${sha}` +
    (skipped ? ` (${skipped} declared skip(s))` : ''),
)
if (failed) {
  console.error(`\n${failed} FAILURE(S). A control that does not do its labelled thing is a defect, not a gap.`)
  process.exit(1)
}
process.exit(0)
