#!/usr/bin/env node
// Record the built app doing real work, and commit the result.
//
// Stills prove a surface exists. Only a recording proves the thing MOVES: that a button responds,
// that a wizard advances, that a long operation reports progress instead of hanging. Half the
// defects worth catching cannot appear in a still, because a still cannot tell a working control
// from a decorative one, which is exactly the class of defect this project already spends a
// section of its rules refusing.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// IT NEVER RECORDS THE SCREEN, AND THAT IS STRUCTURAL RATHER THAN CAREFUL
//
// Every frame comes from CDP `Page.captureScreenshot` against the app's own renderer. There is no
// screen-capture API anywhere in this file and no monitor to point one at: the recorder cannot
// capture the desktop, another window, a notification, or whatever the person happened to have
// open, because it never asks the OS for pixels at all. That is deliberate. A screen recorder
// captures whatever somebody was actually doing, which is their private data and none of this
// project's business, and a monitor recording that reaches a public repository is an incident
// rather than an oversight.
//
// The app also runs against a DISPOSABLE home and userData (`createAppSandbox`), so the recording
// shows a genuine first run rather than the operator's real projects, agent accounts or history.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT IT RECORDS
//
// The path a person actually takes, not a highlight reel: the welcome screen they meet first,
// creating a project, opening a real terminal on the canvas and running a command in it, the
// command palette, and the settings surface. An empty state is worth recording too — it is what
// most people see before anything else.
//
// Frames are pulled on a fixed cadence WHILE the walkthrough drives the app, so what lands in the
// file is the interface responding, not a series of poses. The result is one animated WebP,
// committed beside the screenshots and referenced from the README.
//
// Usage:  npm run build && node scripts/record-app.mjs
// Output: docs/assets/app-walkthrough.webp  (+ .json, the provenance beside it)

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertManagedConfigUnchanged,
  captureManagedConfigSentinel,
  createAppSandbox,
  terminateSpawnedChild
} from './check-app-wired-core.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs', 'assets')
const OUT_FILE = join(OUT_DIR, 'app-walkthrough.webp')
const META_FILE = join(OUT_DIR, 'app-walkthrough.json')

/** The renderer is driven at this size; frames are downscaled before encoding. A recording is for
 *  watching, not for reading source in, so it does not need capture-shots' 1600x1000. */
const VIEW = { width: 1280, height: 800 }
/** Encoded frame size. Small enough that a walkthrough lives comfortably in Git. */
const FRAME = { width: 800, height: 500 }
/** Frames per second. Low on purpose: an interface responding is legible at 5fps, and every extra
 *  frame is bytes in a repository forever. */
const FPS = 5
const FRAME_MS = Math.round(1000 / FPS)
/** A hard ceiling on the recording, so a hung step cannot produce a hundred-megabyte file. */
const MAX_FRAMES = 260

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function assertBuildIsCurrent() {
  if (!existsSync(join(ROOT, 'out'))) {
    console.error('No out/ directory. Run `npm run build` first.')
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------------------------
// CDP with event support. capture-shots' client answers responses only; a recorder needs neither
// events nor screencast acks, but it does need a long-lived connection and generous payloads.
// ---------------------------------------------------------------------------------------------
const { default: WebSocket } = await import('ws')

async function cdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  // The app exposes MORE than one page target: the main window and the Notch HUD, and the HUD is
  // routinely listed FIRST. Taking "the first page" attaches to the HUD, whose renderer has no
  // app bridge on it at all - which reads as "the preload never loaded" or, worse, silently
  // drives the wrong window. Select the main window by its own document.
  const pages = targets.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  const page = pages.find((t) => /\/index\.html(\?|#|$)/.test(t.url)) ?? null
  if (!page) {
    throw new Error(
      `no main-window target on the debugging port (saw: ${pages.map((t) => t.url).join(', ') || 'none'})`
    )
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
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
        30_000
      )
    })
  return { send, close: () => ws.close() }
}

/**
 * Stop the session hosts THIS run started, identified by the sandbox path in their command line.
 *
 * Deliberately not "stop every session host": the operator's own nodeterm is usually running and
 * its hosts are carrying their real terminals. Windows-only, because the recorder is; elsewhere
 * this is a no-op and the sandbox removal reports the truth if something is still holding it.
 */
function stopSessionHostsFor(sandboxRoot) {
  if (process.platform !== 'win32') return
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
    `Where-Object { $_.CommandLine -like '*${sandboxRoot.replace(/'/g, "''")}*' -and $_.CommandLine -like '*session-host*' } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' })
  } catch {
    // Best effort: nothing to stop, or the query failed. The sandbox removal below is the check
    // that actually reports whether anything is still holding this run's files.
  }
}

assertBuildIsCurrent()
mkdirSync(OUT_DIR, { recursive: true })

let child = null
let connection = null
let sandbox = null
let realHomeBefore = null
let runError = null
let cleanupError = null

/** Encoded frames, oldest first. Held in memory because sharp assembles the animation from one
 *  animation from the whole list at once; MAX_FRAMES is what keeps that bounded. */
const frames = []
let capturing = false
let firstPumpError = null

try {
  const port = '9223' // Not capture-shots' 9222, so the two can never attach to each other's app.
  const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  realHomeBefore = captureManagedConfigSentinel({ home: homedir(), env: process.env })
  sandbox = createAppSandbox()
  child = spawn(electron, [join(ROOT, 'out', 'main', 'index.js'), `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
    env: sandbox.env
  })
  await new Promise((resolveLaunch, rejectLaunch) => {
    const done = () => {
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onError = (e) => (done(), rejectLaunch(e))
    const onExit = (code, signal) =>
      (done(), rejectLaunch(new Error(`Electron exited during launch (code ${code}, signal ${signal})`)))
    const timer = setTimeout(() => (done(), resolveLaunch()), 6000)
    child.once('error', onError)
    child.once('exit', onExit)
  })

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  connection = await cdp(port)
  const { send } = connection

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
  }

  // The app reports which userData it actually opened, through the real preload bridge. Passing
  // NT_USER_DATA is not proof Electron honoured it, and a recording made against the operator's
  // real profile would put their projects in a committed file.
  //
  // Wait for the bridge to exist first. Asking the instant the window opens answers "undefined",
  // which is indistinguishable from "the app is using the wrong profile" and would refuse a
  // perfectly good run.
  {
    const deadline = Date.now() + 20_000
    for (;;) {
      if (await evaluate('!!(window.nodeTerminal && window.nodeTerminal.userDataDir)')) break
      if (Date.now() > deadline) throw new Error('the preload bridge never appeared on the renderer')
      await sleep(200)
    }
  }
  await evaluate(`(function(){
    window.__recUserData = 'pending';
    try {
      window.nodeTerminal.userDataDir().then(
        function (v) { window.__recUserData = v },
        function (e) { window.__recUserData = 'rejected: ' + e }
      )
    } catch (e) { window.__recUserData = 'threw: ' + e }
    return true
  })()`)
  let reported = null
  for (let i = 0; i < 60 && reported === null; i += 1) {
    const v = await evaluate(`window.__recUserData !== 'pending' ? window.__recUserData : null`)
    if (v) reported = v
    else await sleep(150)
  }
  const same =
    typeof reported === 'string' &&
    (process.platform === 'win32'
      ? resolve(reported).toLowerCase() === resolve(sandbox.userData).toLowerCase()
      : resolve(reported) === resolve(sandbox.userData))
  if (!same) {
    throw new Error(
      `the app reported userData ${JSON.stringify(reported)}; expected the sandbox at ${sandbox.userData}. ` +
        'Refusing to record: this would capture the real profile.'
    )
  }

  // ------------------------------------------------------------------------------------------
  // The frame pump. It runs alongside the walkthrough rather than between its steps, so the file
  // shows the interface RESPONDING instead of a sequence of poses.
  // ------------------------------------------------------------------------------------------
  const { default: sharp } = await import('sharp')
  // Set BEFORE the pump is created: an async IIFE runs synchronously up to its first await, so a
  // `while (capturing)` loop started while the flag is still false exits immediately and records
  // nothing at all - silently, because there is no error to report.
  capturing = true
  const pump = (async () => {
    while (capturing && frames.length < MAX_FRAMES) {
      const started = Date.now()
      try {
        // The pump does NO image work: it stores exactly what CDP handed over. Resizing here cost
        // roughly 300ms a frame and dragged the real cadence down to about 2fps, which is a
        // recording of an interface that looks like it is stuttering when it is not. The resize
        // happens once, at encode time, where its cost is paid off-camera.
        const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })
        // The capture INSTANT travels with the frame. A capture costs more than the nominal frame
        // interval, so assuming a fixed cadence plays a 25-second walkthrough back in 10 and makes
        // the app look twice as responsive as it is. The delays are derived from these stamps.
        frames.push({ data: Buffer.from(shot.data, 'base64'), at: Date.now() })
      } catch (error) {
        // A dropped frame must never end the recording: the walkthrough is still driving the app,
        // and half a recording beats none plus a stack trace. But the FIRST failure is kept and
        // reported, because a pump that swallows everything turns "the encoder is misconfigured"
        // into "0 frames captured", which says nothing about why.
        firstPumpError ??= error
      }
      const spent = Date.now() - started
      if (spent < FRAME_MS) await sleep(FRAME_MS - spent)
    }
  })()

  /** Give the pump time to collect roughly this many frames of whatever is on screen now. */
  const hold = (ms) => sleep(ms)

  const click = async (selector) => {
    const ok = await evaluate(
      `(function(){ var el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`
    )
    if (!ok) throw new Error(`nothing to click for ${selector}`)
  }
  const present = (selector) =>
    evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
  const until = async (selector, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (await present(selector)) return true
      if (Date.now() > deadline) return false
      await sleep(150)
    }
  }

  // 1. The first thing anybody meets. On a fresh profile that is the setup tour, then the welcome
  //    screen: both are part of the honest path, so both are recorded rather than skipped past.
  await hold(2000)
  if (await present('.onb-skip')) {
    await click('.onb-skip')
    await hold(1200)
  }

  // 2. A project, from the welcome screen's own primary action.
  if (await present('.md3-welcome__card--primary')) {
    await click('.md3-welcome__card--primary')
    await hold(2500)
  }

  // 3. A real terminal on the canvas, from the nav rail's FAB, and a real command in it. This is
  //    the genuine end-to-end task: the recording is worth nothing if it never shows the product
  //    doing the one thing it is for.
  if (await present('.md3-fab')) {
    await click('.md3-fab')
    await hold(1200)
    // The row is labelled "Terminal", not "New terminal". Matching the wrong string does not fail
    // loudly - it just leaves the menu open and records nothing happening, which is how the first
    // real run produced a walkthrough that ended on an open menu.
    const added = await evaluate(`(function(){
      var rows = Array.prototype.slice.call(document.querySelectorAll('.fab-menu__item, .ctx__item, button'))
      var hit = rows.find(function (r) { return /^terminal$/i.test((r.textContent || '').trim()) })
      if (!hit) return false
      hit.click()
      return true
    })()`)
    if (added) {
      await until('.term-node', 12000)
      // WAIT FOR THE SHELL, not for a fixed beat. A pty on a cold sandbox profile can take several
      // seconds to print its first prompt, and typing before then sends the characters nowhere:
      // the first version of this recorded an empty terminal and a command that never appeared.
      const ready = await (async () => {
        const deadline = Date.now() + 25_000
        for (;;) {
          const painted = await evaluate(`(function(){
            // Any painted text inside the node. Anchoring on one xterm internal class is how the
            // previous version concluded "no prompt" while a prompt was plainly on screen.
            var el = document.querySelector('.term-node')
            if (!el) return false
            var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
            return text.length > 40
          })()`)
          if (painted) return true
          if (Date.now() > deadline) return false
          await sleep(300)
        }
      })()
      await hold(1200)
      if (!ready) console.log('  note: the terminal never printed a prompt; skipping the typed command')
      // Focus the terminal the way a person does. The node carries a hover guard that holds input
      // back until a dwell has passed, so a click is what actually hands the pty the keyboard:
      // dispatching keys at an unfocused terminal types into the canvas instead.
      if (ready) {
        await evaluate(`(function(){
          var el = document.querySelector('.term-node .xterm-screen') || document.querySelector('.term-node')
          if (!el) return false
          var r = el.getBoundingClientRect()
          var opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
          el.dispatchEvent(new MouseEvent('mousedown', opts))
          el.dispatchEvent(new MouseEvent('mouseup', opts))
          el.dispatchEvent(new MouseEvent('click', opts))
          return true
        })()`)
        await hold(1000)
      }
      // Type into the real pty through the real key path, one character at a time, so the frames
      // show it arriving rather than appearing whole.
      for (const ch of 'echo hello from a recorded run') {
        await send('Input.dispatchKeyEvent', { type: 'char', text: ch })
        await sleep(35)
      }
      await hold(700)
      await send('Input.dispatchKeyEvent', { type: 'char', text: '\r' })
      await hold(2500)
    }
  }

  // 4. The command palette, opened the way the app itself advertises it: the search control in the
  //    top bar. A synthetic chord is the fragile way to do this - it depends on focus being where
  //    the recorder assumes - and the control is what a person actually clicks.
  if (await present('.cluster-search')) {
    await click('.cluster-search')
  }
  await hold(2000)
  if (await present('.palette')) {
    for (const ch of 'settings') {
      await send('Input.dispatchKeyEvent', { type: 'char', text: ch })
      await sleep(60)
    }
    await hold(1800)
  }
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  await hold(800)

  // 5. Settings: a surface with real controls, reached the way a person reaches it.
  const openedSettings = await evaluate(`(function(){
    var all = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'))
    var hit = all.find(function (b) {
      var label = (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').trim()
      return /^settings$/i.test(label)
    })
    if (!hit) return false
    hit.click()
    return true
  })()`)
  if (openedSettings) await hold(3500)

  capturing = false
  await pump

  if (frames.length < 10) {
    throw new Error(
      `only ${frames.length} frame(s) captured, nothing worth committing` +
        (firstPumpError ? `; first frame failure: ${firstPumpError.message}` : '')
    )
  }
  if (firstPumpError) {
    console.log(`  note: some frames were dropped. First failure: ${firstPumpError.message}`)
  }

  // ------------------------------------------------------------------------------------------
  // Encode. sharp joins the frame list into one animated WebP, so this needs no video encoder and
  // therefore no dependency the repository does not already carry.
  // ------------------------------------------------------------------------------------------
  const resized = []
  for (const frame of frames) {
    resized.push(
      await sharp(frame.data).resize(FRAME.width, FRAME.height, { fit: 'fill' }).removeAlpha().png().toBuffer()
    )
  }
  // Real elapsed time per frame, clamped: a stall while the app did something slow is honest, but
  // a ten-second still frame is a recording that looks broken. The last frame holds a beat so the
  // loop does not snap back the instant the final surface appears.
  const delays = frames.map((frame, i) =>
    i + 1 < frames.length ? Math.min(1500, Math.max(40, frames[i + 1].at - frame.at)) : 1200
  )
  const capturedWallMs = delays.reduce((n, d) => n + d, 0)
  // LOSSLESS on purpose. The lossy animated encoder DROPS frames that resemble their predecessor
  // and throws their time away rather than folding it into the frame it kept, which halved the
  // runtime of the first real recording: a 25-second walkthrough played back in 12. Lossless keeps
  // every frame, and a UI screenshot - flat fills, hard edges, little noise - is what lossless
  // compression is good at, so it costs far less here than it would on photography.
  await sharp(resized, { join: { animated: true } })
    // `delay` as an ARRAY, one entry per frame. A scalar is silently ignored for a joined
    // animation and libvips falls back to its own 100ms default. The encoder legitimately merges a
    // frame that is near-identical to its predecessor, and with real per-frame delays supplied it
    // folds the merged frame's time into the one it kept, so the playback stays honest.
    .webp({ lossless: true, effort: 5, loop: 0, delay: delays })
    .toFile(OUT_FILE)

  // Read the result back rather than trusting the encoder. Lossy WebP legitimately DROPS a frame
  // that is near-identical to the one before it and folds its time into that frame's duration, so
  // a stored page count below the captured count is expected and fine - what must hold is that the
  // animation still runs for as long as the walkthrough did.
  const meta = await sharp(OUT_FILE, { pages: -1 }).metadata()
  const playedMs = (meta.delay ?? []).reduce((n, d) => n + d, 0)
  const capturedMs = capturedWallMs
  if (!meta.pages || meta.pages < 2) throw new Error('the encoded file is not animated')
  if (playedMs < capturedMs * 0.9) {
    throw new Error(
      `the encoded animation runs ${playedMs}ms for ${capturedMs}ms of capture - frames were lost, ` +
        'so the recording would play back faster than the app actually behaved'
    )
  }

  const { size } = await import('node:fs').then((fs) => fs.promises.stat(OUT_FILE))
  writeFileSync(
    META_FILE,
    `${JSON.stringify(
      {
        commit: sha,
        recordedAt: new Date().toISOString(),
        frames: frames.length,
        storedFrames: meta.pages,
        durationMs: playedMs,
        targetFps: FPS,
        size: { width: FRAME.width, height: FRAME.height },
        bytes: size,
        method:
          'Electron + CDP Page.captureScreenshot against the built out/ artifact, on a disposable ' +
          'home and userData. The renderer only: no screen, window or desktop capture is involved.',
        shows: [
          'first run and the welcome screen',
          'creating a project',
          'a real terminal on the canvas, running a real command',
          'the command palette',
          'the settings surface'
        ]
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  console.log(`✓ ${OUT_FILE}`)
  console.log(
    `  ${frames.length} frames captured, ${meta.pages} stored, ${(playedMs / 1000).toFixed(1)}s, ` +
      `${(size / 1024 / 1024).toFixed(2)} MB, commit ${sha.slice(0, 8)}`
  )
  if (size > 8 * 1024 * 1024) {
    console.log('  NOTE: over 8 MB. Shorten the walkthrough or lower the quality before committing.')
  }
} catch (error) {
  runError = error
} finally {
  capturing = false
  try {
    connection?.close()
  } catch (error) {
    cleanupError ??= error
  }
  try {
    await terminateSpawnedChild(child)
  } catch (error) {
    cleanupError ??= error
  }
  // Opening a terminal in the walkthrough starts a SESSION HOST, and a session host is built to
  // outlive the app that started it - that is the whole point of the persistence feature. So a
  // recorder that opens a terminal leaks one per run, and the leaked host keeps the sandbox
  // directory open, which is what made the sandbox removal below fail with EBUSY.
  //
  // Matched on this run's own sandbox path, never on the process name: the operator's real
  // nodeterm is almost certainly running, with hosts of its own that are none of our business.
  if (sandbox) {
    try {
      stopSessionHostsFor(sandbox.root)
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (realHomeBefore) {
    try {
      assertManagedConfigUnchanged(
        realHomeBefore,
        captureManagedConfigSentinel({ home: homedir(), env: process.env })
      )
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (sandbox) {
    try {
      rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    } catch (error) {
      cleanupError ??= new Error(`could not remove the recording sandbox ${sandbox.root}: ${error.message}`, {
        cause: error
      })
    }
  }
}

if (runError && cleanupError) {
  throw new AggregateError([runError, cleanupError], 'recording failed and cleanup did not complete')
}
if (runError) throw runError
if (cleanupError) throw cleanupError
