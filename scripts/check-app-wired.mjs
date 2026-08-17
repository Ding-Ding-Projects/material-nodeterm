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
  const installed = captureManagedConfigSentinel({ home: sandbox.home, env: sandbox.env })
  const missing = Object.entries(installed)
    .filter(([, value]) => value === 'absent')
    .map(([target]) => target)
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
    title: 'Appearance tokens are live CSS variables, not baked colours',
    async run() {
      const accent = await evaluate(
        `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`,
      )
      if (!accent) return { ok: false, why: '--accent is not defined on :root' }
      // Change it and confirm something actually reads it. A baked stylesheet would not move.
      const probe = await evaluate(`(function(){
        var d = document.createElement('div');
        d.style.color = 'var(--accent)';
        document.body.appendChild(d);
        var before = getComputedStyle(d).color;
        document.documentElement.style.setProperty('--accent', 'rgb(1, 2, 3)');
        var after = getComputedStyle(d).color;
        document.documentElement.style.removeProperty('--accent');
        d.remove();
        return { before: before, after: after };
      })()`)
      if (probe.before === probe.after) {
        return { ok: false, why: 'changing --accent moved nothing — the token is not live' }
      }
      return { ok: true, detail: `--accent = ${accent}, and consumers follow it` }
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
]

selected = only ? CHECKS.filter((c) => only.includes(c.id)) : CHECKS
console.log('')
for (const c of selected) {
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
console.log(`${selected.length - failed}/${selected.length} interaction checks passed at ${sha}`)
if (failed) {
  console.error(`\n${failed} FAILURE(S). A control that does not do its labelled thing is a defect, not a gap.`)
  process.exit(1)
}
process.exit(0)
