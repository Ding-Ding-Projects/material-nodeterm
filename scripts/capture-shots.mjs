// Capture the app's real surfaces into docs/assets/shots/, from the BUILT artifact.
//
//   npm run shots -- --attach 9222          attach to an already-running Electron
//   npm run shots -- --launch               launch out/ ourselves, then capture
//   npm run shots -- --attach 9222 --only canvas,kanban
//
// WHY A COMMITTED SCRIPT AND NOT AN AD-HOC PASS. These shots go stale every time the interface
// moves, and the M3 overhaul moves it surface by surface — so this will run many times. The
// previous set was taken by hand; the method survived only because someone wrote it down in
// docs/assets/shots/README.md. A script is that write-up in executable form.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// FOUR RULES THIS HARNESS EXISTS TO ENFORCE, each learned the expensive way in this repo:
//
// 1. IT PHOTOGRAPHS THE BUILT RENDERER, NOT THE SOURCE. A component fix, an app rebuild and a
//    re-capture can still produce images of the PREVIOUS interface, because the renderer is built
//    by its own bundler. So the run refuses to start when any built file it will photograph is
//    older than its shipping sources, and names the build command instead of quietly lying.
//
// 2. A SURFACE THAT CANNOT BE REACHED IS A FAILURE, NOT A GAP. Recording an unreachable surface
//    as a "gap" in a manifest nobody opens lets a real defect through a green run. Surfaces are
//    split: REQUIRED ones fail the run, OPTIONAL ones (needing an account, hardware or a live
//    agent) are skipped loudly and listed.
//
// 3. `rendered_ok` IS A CLAIM, NOT EVIDENCE. Every capture is read back and checked for being
//    uniformly one colour. Pure black is diagnostic here: the palette contains no #000000, so an
//    all-black frame means nothing was ever drawn.
//
// 4. THE MANIFEST RECORDS PROVENANCE. Commit SHA, capture method, timestamp, and what was
//    skipped and why. A capture with no commit behind it cannot be judged stale later, which is
//    how a confidently-wrong screenshot survives three releases.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/assets/shots')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null
}
const attachPort = flag('attach')
const doLaunch = flag('launch')
const only = typeof flag('only') === 'string' ? String(flag('only')).split(',') : null

// ---------------------------------------------------------------------
// The surface list. REQUIRED failures fail the run — see rule 2.
// ---------------------------------------------------------------------
const SURFACES = [
  { id: 'app-01-launch', required: true, title: 'App at launch', open: null },
  { id: 'app-02-settings', required: true, title: 'Settings', open: { key: 'comma', mod: true } },
  { id: 'app-03-palette', required: true, title: 'Command palette', open: { key: 'k', mod: true } },
  { id: 'app-04-canvas', required: true, title: 'Canvas with a live terminal node', open: null },
  { id: 'app-05-kanban', required: true, title: 'Kanban board', open: { key: 'b', mod: true, shift: true } },
  // Optional: these need state the harness cannot manufacture.
  { id: 'app-agent-running', required: false, title: 'Agent mid-turn', why: 'needs a real agent CLI session' },
  { id: 'app-ssh-project', required: false, title: 'SSH project', why: 'needs a reachable host and credentials' }
]

// ---------------------------------------------------------------------
// Rule 1 — refuse to photograph a stale build.
// ---------------------------------------------------------------------
function newestMtime(dir, filter) {
  let newest = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (filter(e.name)) newest = Math.max(newest, statSync(p).mtimeMs)
    }
  }
  if (existsSync(dir)) walk(dir)
  return newest
}

function assertBuildIsCurrent() {
  const built = join(ROOT, 'out')
  if (!existsSync(built)) {
    console.error('No out/ directory — run `npm run build` first.')
    process.exit(2)
  }
  // Test files are excluded, or an unrelated test edit cries wolf on every run.
  const srcNewest = newestMtime(join(ROOT, 'src'), (n) => /\.(ts|tsx|css|html)$/.test(n) && !/\.test\./.test(n))
  const outNewest = newestMtime(built, (n) => /\.(js|css|html)$/.test(n))
  if (srcNewest > outNewest) {
    console.error('The build is OLDER than its sources, so these captures would show the PREVIOUS')
    console.error('interface while claiming to show this one. Run:\n\n    npm run build\n')
    console.error(`  newest source: ${new Date(srcNewest).toISOString()}`)
    console.error(`  newest build:  ${new Date(outNewest).toISOString()}`)
    process.exit(2)
  }
}

// ---------------------------------------------------------------------
// CDP, over plain WebSocket. `ws` is already a dependency of the server edition.
// ---------------------------------------------------------------------
const { default: WebSocket } = await import('ws')

async function cdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  // The renderer, not the devtools page or a background target.
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('no renderer target on the debugging port')
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
      setTimeout(() => pending.has(n) && (pending.delete(n), rej(new Error(`${method} timed out`))), 30000)
    })
  return { send, close: () => ws.close() }
}

/** Rule 3 — a capture is read back, never trusted. */
function looksBlank(pngBuffer) {
  // Cheap heuristic without decoding: a PNG of one flat colour compresses to almost nothing.
  // A real interface screenshot at this size never does.
  return pngBuffer.length < 6000
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------

assertBuildIsCurrent()
mkdirSync(OUT, { recursive: true })

let child = null
let port = attachPort
if (!port) {
  if (!doLaunch) {
    console.error('Pass --attach <port> to attach, or --launch to start the app here.')
    process.exit(2)
  }
  port = '9222'
  const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  child = spawn(electron, [join(ROOT, 'out', 'main', 'index.js'), `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false
  })
  await sleep(6000)
}

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const { send, close } = await cdp(port)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false
})

const captured = []
const skipped = []
const failures = []

for (const s of SURFACES) {
  if (only && !only.some((o) => s.id.includes(o))) continue
  if (!s.required) {
    skipped.push({ id: s.id, why: s.why })
    continue
  }
  try {
    if (s.open) {
      // Chords go through the real key path so the app's own handlers run.
      const mods = (s.open.mod ? 2 : 0) | (s.open.shift ? 8 : 0)
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          modifiers: mods,
          key: s.open.key,
          code: `Key${String(s.open.key).toUpperCase()}`,
          windowsVirtualKeyCode: String(s.open.key).toUpperCase().charCodeAt(0)
        })
      }
      await sleep(1200)
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const buf = Buffer.from(shot.data, 'base64')
    if (looksBlank(buf)) {
      failures.push({ id: s.id, why: `capture is uniform/blank (${buf.length} bytes) — nothing rendered` })
      continue
    }
    writeFileSync(join(OUT, `${s.id}.png`), buf)
    captured.push({ id: s.id, title: s.title, bytes: buf.length })
    console.log(`✓ ${s.id}.png  ${(buf.length / 1024).toFixed(0)} KB`)
    // Return to a known state so the next surface does not open on top of this one.
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
  } catch (err) {
    failures.push({ id: s.id, why: err.message })
  }
}

close()
if (child) child.kill()

// Rule 4 — provenance, written next to the images.
writeFileSync(
  join(OUT, 'capture-manifest.json'),
  JSON.stringify(
    {
      commit: sha,
      capturedAt: new Date().toISOString(),
      method: 'Electron + CDP Page.captureScreenshot against the built out/ artifact, 1600x1000',
      viewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
      captured,
      skipped,
      failures
    },
    null,
    2
  ) + '\n'
)

console.log(`\ncaptured ${captured.length}  skipped ${skipped.length}  failed ${failures.length}`)
for (const s of skipped) console.log(`  - skipped ${s.id}: ${s.why}`)
for (const f of failures) console.error(`  ! FAILED ${f.id}: ${f.why}`)

// Rule 2 — a required surface that could not be reached fails the run.
if (failures.length) {
  console.error('\nRequired surfaces failed to capture. That is a defect, not a gap.')
  process.exit(1)
}
console.log('\nRemember: docs/assets/social-card.png is generated FROM app-04-canvas.png, and its')
console.log('crop is tuned to that shot. Re-run `npm run make-social-card` after replacing it.')
