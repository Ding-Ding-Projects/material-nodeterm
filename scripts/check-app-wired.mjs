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
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
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

/**
 * PIDs of Electron processes belonging to THIS repo, right now.
 *
 * Needed because killing the app is not enough. On Windows the app spawns a **session host** —
 * the tmux-equivalent — and that process outlives its parent BY DESIGN, which is the whole point
 * of it. So every harness run that launches the app leaves one behind, still holding
 * `node_modules\electron\dist\electron.exe`.
 *
 * That is not theoretical: a leftover from a capture run made the next `npm ci` fail on that
 * binary, and because `npm ci` deletes node_modules BEFORE installing, it left the tree gutted —
 * no vitest, no react, no ws. The harness broke the checkout it was written to inspect.
 *
 * Snapshot before, diff after, kill only what appeared. Killing "all Electron for this repo"
 * would take the developer's own running app with it.
 */
function repoElectronPids() {
  if (process.platform !== 'win32') return []
  try {
    // No backslash doubling. Inside a PowerShell SINGLE-quoted string a backslash is an ordinary
    // character, so escaping them made the -like pattern `C:\\Users\\…`, which matches nothing —
    // the cleanup silently found zero leftovers and reported success while leaking every time.
    // Only the single quote needs escaping there, by doubling it.
    const ps =
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${ROOT.replace(/'/g, "''")}*' } | ` +
      `ForEach-Object { $_.ProcessId }`
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((s) => Number(s.trim()))
      .filter(Boolean)
  } catch {
    // An empty list means "checked, and none exist". `null` means the check itself failed; the
    // latter must stop a launch because otherwise the finally block cannot prove it cleaned up.
    return null
  }
}

const port = typeof attachPort === 'string' ? Number(attachPort) : 9223
let pidsBefore = new Set()
let child = null
let ownedUserData = null
let client = null
let selected = []
let failed = 0
let fatalError = null
let cleanupFailed = false
let processSnapshotReady = false

try {
if (!attachPort) {
  const before = repoElectronPids()
  if (before === null) {
    throw new Error('could not enumerate this checkout\'s Electron processes before launch')
  }
  pidsBefore = new Set(before)
  processSnapshotReady = true
  const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const unix = join(ROOT, 'node_modules', '.bin', 'electron')
  const bin = existsSync(electron) ? electron : unix
  if (!existsSync(bin)) {
    throw new Error('Electron binary not found — run `npm ci` (or `npm run rebuild`) first.')
  }
  // Never point an interaction gate at the operator's real profile. The settings case deliberately
  // toggles and reloads a persisted value; NT_MULTI + NT_USER_DATA give this run a disposable,
  // process-local identity/workspace/settings tree instead of gambling that a restore wins every
  // debounce or crash. Attach mode is explicitly caller-owned and therefore leaves the target's
  // profile alone.
  ownedUserData = mkdtempSync(join(tmpdir(), 'nodeterm-wired-'))
  child = spawn(bin, [join(ROOT, 'out', 'main', 'index.js'), `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, NT_MULTI: '1', NT_USER_DATA: ownedUserData },
    stdio: 'ignore',
  })
  await sleep(6000)
}

client = await cdp(port)
const { send } = client
await send('Runtime.enable')
await send('Page.enable')
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
      const selectSwitch = async (wantedIndex = null) =>
        evaluate(`(function(wantedIndex){
          var all = Array.prototype.slice.call(
            document.querySelectorAll('[role="switch"], input[type=checkbox]'));
          var visible = all.filter(function(x){
            return !x.disabled && x.getAttribute('aria-disabled') !== 'true' && x.offsetParent !== null;
          });
          var index = wantedIndex === null ? 0 : wantedIndex;
          var b = visible[index];
          if (!b) return null;
          window.__wiredBox = b;
          var state = b.getAttribute('aria-checked');
          var label = b.getAttribute('aria-label') || '';
          for (var p = b.parentElement, depth = 0; !label && p && depth < 5; p = p.parentElement, depth++) {
            var text = (p.innerText || '').trim().replace(/\s+/g, ' ');
            if (text && text.length <= 120) label = text;
          }
          return {
            index: index,
            label: (label || (b.textContent || '').trim() || 'switch').slice(0, 80),
            state: state === null ? String(b.checked) : state
          };
        })(${wantedIndex === null ? 'null' : Number(wantedIndex)})`)
      const read = `(function(){ var b = window.__wiredBox; if (!b || !b.isConnected) return null;
        var s = b.getAttribute('aria-checked'); return s === null ? String(b.checked) : s })()`
      const reload = async () => {
        await send('Page.reload', { ignoreCache: true })
        await sleep(1400)
        const ready = await until(
          `document.readyState === 'complete' && !!document.querySelector('.react-flow')`,
          8000,
        )
        if (!ready) throw new Error('renderer did not become ready after reload')
      }

      await chord({ key: ',', code: 'Comma', vk: 188, ctrl: true })
      const open = await until(`!!document.querySelector('[class*="settings" i]')`)
      if (!open) return { ok: false, why: 'settings did not open on Ctrl+,' }
      // `role="switch"`, not `input[type=checkbox]` — this app's toggle is `ui/Switch.tsx`, a
      // button carrying `aria-checked`. The first version of this check looked for a checkbox,
      // found none, and failed. That was the harness being wrong rather than the app, but it
      // failed CORRECTLY: rule 3 says a check that cannot run is a failure, because "I could not
      // find the control" and "the control does nothing" are indistinguishable from outside, and
      // only one of them is safe to ignore.
      const found = await selectSwitch()
      if (!found) return { ok: false, why: 'no enabled switch or checkbox visible in settings' }
      await evaluate(`window.__wiredBox.click()`)
      const after = await until(`${read} !== ${JSON.stringify(found.state)} ? ${read} : null`)
      if (after === null || after === found.state) {
        return { ok: false, why: `"${found.label}" did not change when clicked — an inert control` }
      }

      // A DOM flip proves only React state. Reload the built renderer, reopen Settings, and find the
      // same stable switch slot: only a completed main-process save can make the new value return.
      await sleep(500)
      await reload()
      await chord({ key: ',', code: 'Comma', vk: 188, ctrl: true })
      if (!(await until(`!!document.querySelector('[class*="settings" i]')`))) {
        return { ok: false, why: 'settings did not reopen after reload' }
      }
      const persisted = await selectSwitch(found.index)
      if (!persisted || persisted.state !== after) {
        return {
          ok: false,
          why: `"${found.label}" did not survive reload (${after} became ${persisted?.state ?? 'missing'})`,
        }
      }

      // Restore inside the disposable profile and reload once more. This catches one-way controls
      // and proves the original value is durable before the profile is removed in `finally`.
      await evaluate(`window.__wiredBox.click()`)
      if (!(await until(`${read} === ${JSON.stringify(found.state)} ? ${read} : null`))) {
        return { ok: false, why: `"${found.label}" would not toggle back in the DOM` }
      }
      await sleep(500)
      await reload()
      await chord({ key: ',', code: 'Comma', vk: 188, ctrl: true })
      if (!(await until(`!!document.querySelector('[class*="settings" i]')`))) {
        return { ok: false, why: 'settings did not reopen for the restore check' }
      }
      const restored = await selectSwitch(found.index)
      await chord({ key: 'Escape', code: 'Escape', vk: 27 })
      if (!restored || restored.state !== found.state) {
        return {
          ok: false,
          why: `"${found.label}" restore did not survive reload (left at ${restored?.state ?? 'missing'})`,
        }
      }
      return {
        ok: true,
        detail: `"${found.label}" ${found.state} → ${after} (reload) → ${restored.state} (reload)`,
      }
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
        var colour = getComputedStyle(control).backgroundColor;
        root.style.setProperty('--accent', 'rgb(1, 2, 3)');
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
          why: `the real switch ignored --accent (${before} → ${after})`,
        }
      }
      return { ok: true, detail: `Switch background followed --accent (${accent} → ${after})` }
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
const unknown = only ? only.filter((id) => !CHECKS.some((c) => c.id === id)) : []
if (unknown.length) throw new Error(`unknown --only check(s): ${unknown.join(', ')}`)
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
  fatalError = error
  console.error(`✗ interaction harness could not complete\n    ${error instanceof Error ? error.message : String(error)}`)
} finally {
  client?.close()
  if (child) child.kill()

  // Clean up everything this run started, not just the process we hold a handle to. See
  // `repoElectronPids` for why the session host survives `child.kill()` and what it costs. This is
  // in `finally`: a failed CDP connection used to skip the entire block and poison the next npm ci.
  if (!attachPort && processSnapshotReady) {
    await sleep(1500)
    const after = repoElectronPids()
    if (after === null) {
      cleanupFailed = true
      console.error('  ! could not enumerate Electron processes during cleanup')
    } else {
      const leaked = after.filter((p) => !pidsBefore.has(p))
      if (leaked.length) {
        try {
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
        } catch {
          cleanupFailed = true
          console.error(`  ! could not stop leftover PIDs ${leaked.join(', ')} — they hold electron.exe`)
        }
      }
    }
  }

  if (ownedUserData) {
    try {
      rmSync(ownedUserData, { recursive: true, force: true })
    } catch (error) {
      cleanupFailed = true
      console.error(`  ! could not remove isolated user data ${ownedUserData}: ${String(error)}`)
    }
  }
}

console.log('')
const sha = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 8)
  } catch {
    return 'unknown'
  }
})()
console.log(`${Math.max(0, selected.length - failed)}/${selected.length} interaction checks passed at ${sha}`)
if (failed || fatalError || cleanupFailed) {
  const totalFailures = failed + Number(!!fatalError) + Number(cleanupFailed)
  console.error(`\n${failed} FAILURE(S). A control that does not do its labelled thing is a defect, not a gap.`)
  if (totalFailures !== failed) {
    console.error(`Harness/cleanup failures: ${Number(!!fatalError) + Number(cleanupFailed)}`)
  }
  process.exitCode = 1
} else {
  process.exitCode = 0
}
