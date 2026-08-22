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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertManagedConfigUnchanged,
  captureManagedConfigSentinel,
  createAppSandbox,
  terminateSpawnedChild
} from './check-app-wired-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/assets/shots')
// GitHub Pages serves ONLY site/ (see .github/workflows/pages.yml: `path: site`), so a capture
// under docs/ is unreachable from the site. Rather than hand-copying — two copies of one picture
// are two pictures that disagree eventually — ONE run writes both, and
// scripts/check-site-shots.mjs asserts they stay byte-identical.
const SITE_OUT = join(ROOT, 'site/assets/shots')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null
}
const attachPort = flag('attach')
const doLaunch = flag('launch')
const only = typeof flag('only') === 'string' ? String(flag('only')).split(',') : null

// ---------------------------------------------------------------------
// Shared driver for the Kids surfaces (see their entries below for why they need one).
// ---------------------------------------------------------------------
// Written as one string so the steps compose: every driver opens with the same helpers and then
// appends only what its own surface needs. `until()` polls rather than sleeping, because a fixed
// wait is a guess about how long a state change takes and it guessed wrong here.
const KIDS_DRIVER = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (sel, ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (document.querySelector(sel)) return true; await wait(150) }
    return false
  }
  const byLabel = (needle) => [...document.querySelectorAll('button,[role=button]')].find((e) =>
    (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().toLowerCase().includes(needle))
  const pad = async (pin) => {
    for (const digit of pin) {
      const key = document.querySelector('[aria-label="Digit ' + digit + '"]')
      if (!key) return false
      key.click()
      await wait(150)
    }
    return true
  }
`

// Enter the mode from the rail. First run also gets the choose/confirm PIN dialog; a later run in
// the same profile skips straight through, so both paths are handled.
const KIDS_HOME_STEPS = `
  if (document.querySelector('.md3-kids-home')) return true
  const kidsBtn = byLabel('kids')
  if (!kidsBtn) return false
  kidsBtn.click()
  if (await until('[aria-label="Choose a 4-digit PIN"]', 5000)) {
    if (!(await pad('1234'))) return false
    if (!(await until('[aria-label="Confirm the 4-digit PIN"]', 5000))) return false
    if (!(await pad('1234'))) return false
  }
  return await until('.md3-kids-home', 15000)
})()`

const KIDS_GATE_STEPS = `
  if (document.querySelector('.md3-kids-pinpad')) return true
  if (!(await until('.md3-kids-home', 10000))) return false
  const gate = document.querySelector('[aria-label="Grown-up gate"]')
  if (!gate) return false
  gate.click()
  return await until('.md3-kids-pinpad', 10000)
})()`

const KIDS_PARENT_STEPS = `
  if (document.querySelector('.md3-kids-parent')) return true
  if (!(await until('.md3-kids-pinpad', 3000))) {
    const gate = document.querySelector('[aria-label="Grown-up gate"]')
    if (!gate) return false
    gate.click()
    if (!(await until('.md3-kids-pinpad', 10000))) return false
  }
  if (!(await pad('1234'))) return false
  return await until('.md3-kids-parent', 12000)
})()`

// ---------------------------------------------------------------------
// Shared driver for the Windows terminal-profile surfaces (see their entries below).
// ---------------------------------------------------------------------
// Same shape as KIDS_DRIVER, for the same reason: the picker is two clicks deep and profile
// detection is on demand (`useTerminalProfiles.ensureLoaded`, kicked off by Canvas on mount),
// so the menu can open a beat before it has anything to list. A fixed sleep here would be a
// guess about how long probing PATH for four shells and enumerating WSL takes on this machine.
const PROFILE_DRIVER = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) { const v = fn(); if (v) return v; await wait(150) }
    return null
  }
  const byText = (needle) => [...document.querySelectorAll('button,[role=menuitem]')].find((e) =>
    (e.textContent || '').trim() === needle)
  const picker = () =>
    document.querySelector('.md3-fab-menu[aria-label="Choose terminal profile"]')
  // What the picker LISTS, minus the drill-out button that is always its first child.
  const profileRows = () =>
    picker() ? [...picker().querySelectorAll('[role=menuitem]')].slice(1) : []
  const openPicker = async () => {
    if (picker()) return true
    const stale = document.querySelector('.md3-fab-backdrop')
    if (stale) { stale.click(); await wait(250) }
    const fab = document.querySelector('.md3-fab')
    if (!fab) return false
    fab.click()
    const drill = await until(() => byText('New terminal with profile…'), 6000)
    if (!drill) return false
    drill.click()
    return !!(await until(picker, 6000))
  }
`

const PROFILE_PICKER_STEPS = `
  if (!(await openPicker())) return false
  // A picker showing its empty state is not a picker "listing detected profiles" — filing that
  // screen under this id would be a confidently-wrong caption for one that says the opposite.
  if (picker().querySelector('#fab-terminal-profile-empty-reason')) return false
  return profileRows().length > 0
})()`

// ---------------------------------------------------------------------
// Shared driver for the ADHD node-surfaces — the elapsed-time chip and the momentum note (see
// docs/adhd-modes.md and src/renderer/components/AdhdNodeSurfaces.tsx).
// ---------------------------------------------------------------------
// Both surfaces are decisions made by `lib/adhdModes.ts` and `lib/nodeActivity.ts` from real
// clock time, not a flag the harness can flip from outside — there is no test-only backdoor that
// backdates a node's `lastActivityAt`, and adding one here would mean these captures show a state
// the app can never actually reach on its own. So this driver does what a person does: opens
// Settings, flips the real switch, creates a real terminal node through the real FAB, and (for
// momentum) waits out the real idle window. Every step operates the app's own controls; nothing
// reaches past the UI into store or module state.
const ADHD_DRIVER = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) { const v = fn(); if (v) return v; await wait(150) }
    return null
  }
  const byLabel = (needle) => [...document.querySelectorAll('button,a,[role=button],li')].find((e) =>
    (e.textContent || '').trim() === needle)
  // A React-controlled <input> ignores a plain \`.value = x\` assignment (React's own value
  // setter shadows it), so the number field for "after how long" needs the native setter — the
  // same trick a real browser extension or automation tool uses to drive a controlled input.
  const setControlledValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const openAdhdModesSection = async () => {
    const settingsBtn = document.querySelector('[title*="Settings" i],[aria-label*="Settings" i]')
    if (!settingsBtn) return false
    settingsBtn.click()
    const sectionBtn = await until(() => byLabel('ADHD modes'), 6000)
    if (!sectionBtn) return false
    sectionBtn.click()
    return !!(await until(() => document.querySelector('[aria-label="Time awareness mode"]'), 6000))
  }
  const closeSettings = async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await wait(500)
  }
  // Creates one plain terminal node through the nav rail's FAB (the same "+" a person uses) and
  // returns its node id, discovered by diffing the canvas before/after — the same technique the
  // profile driver above uses for the same reason: a freshly created node has no id known in
  // advance.
  const createTerminalNode = async () => {
    const liveTerminalIds = () => [...document.querySelectorAll('.react-flow__node[data-id]')]
      .filter((n) => n.querySelector('.term-node')).map((n) => n.dataset.id)
    const before = new Set(liveTerminalIds())
    const fab = document.querySelector('.md3-fab')
    if (!fab) return null
    fab.click()
    const item = await until(() => byLabel('Terminal'), 4000)
    if (!item) return null
    item.click()
    return await until(() => liveTerminalIds().find((id) => !before.has(id)) || null, 8000)
  }
  // Every node this driver creates is a real tmux/session-host session that OUTLIVES the app by
  // design (see the terminal session continuity section of CLAUDE.md) — it must be destroyed
  // before the sandbox is torn down, or cleanup fails with EPERM while every capture already sits
  // on disk. Tracked here so the harness can find and destroy them after this surface is done,
  // regardless of whether the capture itself succeeded.
  window.__adhdCreatedNodeIds = window.__adhdCreatedNodeIds || []
`

const ADHD_ELAPSED_STEPS = `
  if (!(await openAdhdModesSection())) return false
  const sw = document.querySelector('[aria-label="Time awareness mode"]')
  if (sw.getAttribute('aria-checked') !== 'true') sw.click()
  await closeSettings()
  const nodeId = await createTerminalNode()
  if (!nodeId) return false
  window.__adhdCreatedNodeIds.push(nodeId)
  const nodeEl = await until(() => document.querySelector('.react-flow__node[data-id="' + nodeId + '"]'), 8000)
  if (!nodeEl) return false
  // "just now" renders the instant the node's own mount records its opened time — no wait needed.
  return !!(await until(() => nodeEl.querySelector('.adhd-elapsed'), 8000))
})()`

// Momentum cannot fire before real idle time has genuinely passed — `momentumMinutes` is clamped
// to a 5-minute floor (`MOMENTUM_MIN_MINUTES`, lib/adhdModes.ts) precisely so a person cannot be
// nagged sooner than that, and there is no way to shorten it from outside the app. So this driver
// sets the field to that floor, spawns one idle terminal, and returns immediately — the multi-
// minute wait happens on the NODE side (see MOMENTUM_POLL_MS below), never inside one
// `Runtime.evaluate` call, which times out at 30s (see cdp()'s send()).
const ADHD_MOMENTUM_STEPS = `
  if (!(await openAdhdModesSection())) return false
  const momentumSw = document.querySelector('[aria-label="Momentum mode"]')
  if (!momentumSw) return false
  if (momentumSw.getAttribute('aria-checked') !== 'true') momentumSw.click()
  const minutesInput = await until(
    () => document.querySelector('[aria-label="Minutes untouched before the momentum note appears"]'),
    4000
  )
  if (!minutesInput) return false
  setControlledValue(minutesInput, 5)
  await closeSettings()
  const nodeId = await createTerminalNode()
  if (!nodeId) return false
  window.__adhdCreatedNodeIds.push(nodeId)
  // The node is created and left untouched from here — the harness polls for the note from Node
  // side while genuine idle time elapses. Nothing further happens in this script.
  return true
})()`
// Real wait: 5 minutes (the clamped floor) plus one full activity tick (60s, ACTIVITY_TICK_MS —
// the momentum readout only re-evaluates when the shared minute clock wakes it) plus a margin for
// the poll's own 150ms step and process scheduling jitter.
const MOMENTUM_POLL_MS = 5 * 60_000 + 90_000 + 30_000

const slowShots = process.env.NT_SHOTS_SLOW === '1'

// Always reachable and fast — no gating needed.
const ADHD_ELAPSED_SURFACE = {
  id: 'app-adhd-elapsed-chip',
  required: true,
  title: 'ADHD modes — the time-awareness elapsed chip',
  open: { script: ADHD_DRIVER + ADHD_ELAPSED_STEPS },
  verify: '.adhd-elapsed'
}

// Gated behind NT_SHOTS_SLOW=1: genuinely takes several real minutes (the momentum window cannot
// be shortened — see ADHD_MOMENTUM_STEPS above), so it must not block an ordinary run. Skipped
// (not failed) otherwise, with an honest reason, per rule 2 — this is a real, reachable surface,
// just an expensive one to prove, so it is optional rather than required.
const ADHD_MOMENTUM_SURFACE = slowShots
  ? {
      id: 'app-adhd-momentum-note',
      required: true,
      title: 'ADHD modes — the momentum note',
      open: { script: ADHD_DRIVER + ADHD_MOMENTUM_STEPS },
      verify: '.adhd-momentum[role="status"]',
      pollMs: MOMENTUM_POLL_MS
    }
  : {
      id: 'app-adhd-momentum-note',
      required: false,
      title: 'ADHD modes — the momentum note',
      why: 'the momentum window has a real 5-minute floor that cannot be shortened from outside the app; run with NT_SHOTS_SLOW=1 to capture it (adds several real minutes to the run)'
    }

// ---------------------------------------------------------------------
// The surface list. REQUIRED failures fail the run — see rule 2.
// ---------------------------------------------------------------------
// `verify` is the load-bearing field, and its absence was a real defect in the first version of
// this harness: it sent a chord, captured whatever was on screen, and reported success. Five
// surfaces "captured", all of them the same wrong screen, zero failures reported — because
// "the chord was dispatched" is not "the surface opened". Every entry now names a selector that
// exists ONLY on that surface, and a capture whose selector is absent FAILS.
const SURFACES = [
  {
    id: 'app-01-launch',
    required: true,
    title: 'App at launch',
    open: null,
    verify: '.md3-app-bar',
    // The tab bar is present underneath the kanban overlay too, so without this a re-run that
    // started with the board open photographed the BOARD under this name. Observed, not feared.
    verifyAbsent: '[class*="kanban"]'
  },
  {
    id: 'app-02-settings',
    required: true,
    title: 'Settings',
    open: { key: ',', code: 'Comma', vk: 188, ctrl: true },
    verify: '[class*="settings"]'
  },
  {
    id: 'app-03-palette',
    required: true,
    title: 'Command palette',
    open: { key: 'k', code: 'KeyK', vk: 75, ctrl: true },
    verify: '[class*="palette"]'
  },
  {
    id: 'app-04-canvas',
    required: true,
    title: 'Canvas',
    open: null,
    // NOT just '.react-flow'. The canvas stays MOUNTED underneath the kanban overlay by design —
    // unmounting it would 0x0-resize every terminal and SIGWINCH the ptys — so its presence says
    // nothing about what is on screen. This run photographed the BOARD under the canvas's name
    // until the absence of the overlay was asserted too.
    verify: '.react-flow',
    verifyAbsent: '[class*="kanban"]'
  },
  {
    id: 'app-05-kanban',
    required: true,
    title: 'Kanban board',
    // Clicked, not chorded. The Ctrl+Shift+B chord does not survive CDP key dispatch here, and
    // the toggle on the active project tab is the real user path anyway — a capture taken the
    // way a person opens the surface is worth more than one taken through a synthetic chord.
    open: { click: '.tab__board-toggle' },
    verify: '[class*="kanban"]'
  },
  {
    // Two clicks deep: open Settings, then its Kids mode section. Captured because the mode's
    // whole defensibility rests on the disclosure being ON SCREEN rather than merely in the
    // source — a screenshot is the only artefact that shows that stayed true.
    id: 'app-settings-kids-mode',
    required: true,
    title: 'Settings — Kids mode',
    open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'Kids mode'] },
    verify: '[class*="settings"]'
  },
    {
      // The History destination existed as a fully-built screen that nothing imported — reachable
      // only by reading the source. REQUIRED here so an unreachable screen fails the run rather
      // than quietly going missing again.
      id: 'app-06-history',
      required: true,
      title: 'History — session memory, settings history, changelog',
      open: { click: '[aria-label*="History" i],[title*="History" i]' },
      verify: '.md3-history-screen'
    },
    {
      // The Status destination is what feat/status-hub-surface owed and never had: a capture
      // of the real screen from the built artifact. Its host is imported, stated and
      // reachable, and during integration the render site was dropped while typecheck stayed
      // green — so REQUIRED here, because a screen whose button opens nothing must fail this
      // run rather than go missing quietly a second time.
      id: 'app-status-surface',
      required: true,
      title: 'Status surface',
      open: { click: '.md3-rail-item[title="Status" i]' },
      // .md3-status-screen exists ONLY inside StatusSurface. The host div alone would not do:
      // it is rendered by Canvas, so it would be present even if the component drew nothing.
      verify: '.md3-status-screen'
    },
    // These five were last taken 2026-08-15 — BEFORE the Material 3 rewrite — and the README
    // embedded them as current, so it published the old blue-accent interface. Required now so a
    // stale settings shot fails the run instead of quietly outliving the design it shows.
    {
      id: 'app-settings-language',
      required: true,
      title: 'Settings — Language',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'Language'] },
      verify: '[class*="settings"]'
    },
    {
      id: 'app-settings-narrator',
      required: true,
      title: 'Settings — Narrator',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'Narrator'] },
      verify: '[class*="settings"]'
    },
    {
      id: 'app-settings-schedule',
      required: true,
      title: 'Settings — Schedule',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'Schedule'] },
      verify: '[class*="settings"]'
    },
    {
      id: 'app-settings-app-identity',
      required: true,
      title: 'Settings — App name & logo',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'App name & logo'] },
      verify: '[class*="settings"]'
    },
    {
      id: 'app-settings-appearance-editor',
      required: true,
      title: 'Settings — Appearance editor',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'Appearance editor'] },
      verify: '[class*="settings"]'
    },
    {
      // The README has always described this app as built for scattered workflows; until these
      // modes existed it shipped nothing a person could switch on. Required so the settings
      // surface cannot quietly regress into an unreachable one.
      id: 'app-adhd-modes',
      required: true,
      title: 'Settings — ADHD modes',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'ADHD modes'] },
      verify: '[class*="settings"]'
    },
    // ── Windows terminal profiles ───────────────────────────────────────────────────────────────
    // The `app-` prefix is load-bearing twice over. scripts/check-site-shots.mjs mirrors and
    // byte-compares only `app-*.png`, so a capture outside it ships to the site with nothing
    // asserting the two copies still agree. And the bare `windows-terminal-profile-*` ids belong
    // to scripts/windows-profile-packaged-driver.mjs, which produces PACKAGED evidence over the
    // cheap Lowlevel headless route for the contract row of the same name — writing those ids
    // from here would half-satisfy that row with unpackaged out/ screenshots.
    // Placed BEFORE the Kids block on purpose: Kids mode does not hide the canvas, it unmounts
    // it (App.tsx routes to <KidsShell/>), so the rail FAB and the settings page are simply gone
    // for every surface that follows it.
    {
      id: 'app-windows-terminal-profiles',
      required: true,
      title: 'Windows terminal profiles — the picker',
      open: { script: PROFILE_DRIVER + PROFILE_PICKER_STEPS },
      verify: '.md3-fab-menu[aria-label="Choose terminal profile"]',
      // The settings overlay is `fixed inset-0`, and a programmatic click reaches the FAB straight
      // through it, so without this a settings screen could be photographed under this name.
      verifyAbsent: '.nt-settings'
    },
    {
      id: 'app-windows-terminal-profile-availability',
      required: true,
      title: 'Windows terminal profiles — detected availability',
      open: { clicks: ['[title*="Settings" i],[aria-label*="Settings" i]', 'Shell'] },
      // Not merely the availability list. The reason span exists ONLY on a row that is both
      // unavailable and says why, so a machine where every profile resolved fails the run rather
      // than filing an all-Available screenshot under a name promising the opposite.
      verify: '#terminal-profile-availability li span.block'
    },
    // ── ADHD node-surfaces ──────────────────────────────────────────────────────────────────────
    // Placed before the Kids block for the same reason the profile entries above are: Kids mode
    // unmounts the canvas (App.tsx routes to <KidsShell/>), so the FAB and Settings are gone once
    // it is entered. See ADHD_DRIVER above for why these are driven rather than asserted from
    // source, and docs/adhd-modes.md for the three surfaces the feature owes captures of.
    ADHD_ELAPSED_SURFACE,
    ADHD_MOMENTUM_SURFACE,
    // ── The Kids screens ────────────────────────────────────────────────────────────────────────
    // These had no captures because they had no way in: `components/kids/entry.ts` has always
    // documented the rail's Kids destination as the caller of `enterKidsModeFromRail()`, but the
    // rail was built by a different lane and shipped a placeholder that opened a settings page, so
    // that function had zero callers and the whole shell was unreachable. Wired now, so it can be
    // both driven and photographed.
    //
    // The PIN is 1234 and lives only inside the disposable sandbox profile this harness creates and
    // deletes (see createAppSandbox — HOME and every agent config root are redirected too). It is
    // not a credential and never touches a real home directory.
    //
    // Each driver POLLS for its target rather than sleeping a fixed time. Fixed sleeps failed here
    // in a way worth remembering: the enable→shell swap outran a 1.5s wait, so `kids-home` reported
    // failure while `kids-gate`, running afterwards, passed — the flow had worked and only the
    // verification was early.
    {
      id: 'app-kids-home',
      required: true,
      title: 'Kids mode — Home',
      open: { script: KIDS_DRIVER + KIDS_HOME_STEPS },
      verify: '.md3-kids-home'
    },
    {
      id: 'app-kids-gate',
      required: true,
      title: 'Kids mode — the grown-up gate',
      open: { script: KIDS_DRIVER + KIDS_GATE_STEPS },
      verify: '.md3-kids-pinpad'
    },
    {
      id: 'app-kids-parent',
      required: true,
      title: 'Kids mode — the grown-up screen',
      open: { script: KIDS_DRIVER + KIDS_PARENT_STEPS },
      verify: '.md3-kids-parent'
    },
  // Optional: these need state the harness cannot manufacture.
  // Measured, not assumed: driving the picker through to a real node spawns a Windows session
  // host, and a session host OUTLIVES the app on purpose — that is the persistence contract. It
  // then holds the disposable sandbox open, so `rmSync` fails with EPERM and the run exits
  // non-zero with every capture already on disk. Reaching it needs either a scoped teardown of
  // the exact host this run started, or driving the destructive-delete gate and waiting out the
  // host's 30s empty-exit grace; neither is worth a flaky REQUIRED surface.
  { id: 'app-windows-terminal-profile-node', required: false, title: 'Windows terminal profiles — a terminal opened with an explicit profile', why: 'the spawned Windows session host outlives the app by design and holds the disposable capture sandbox open' },
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
      setTimeout(() => pending.has(n) && (pending.delete(n), rej(new Error(`${method} timed out`))), 30000)
    })
  const close = async () => {
    if (ws.readyState === WebSocket.CLOSED) return
    await new Promise((resolveClose, rejectClose) => {
      let settled = false
      let timer = null
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ws.off('close', onClose)
        error ? rejectClose(error) : resolveClose()
      }
      const onClose = () => finish()
      timer = setTimeout(() => {
        try {
          ws.terminate()
          finish()
        } catch (error) {
          finish(error)
        }
      }, 2000)
      ws.once('close', onClose)
      try {
        ws.close()
      } catch (error) {
        finish(error)
      }
    })
  }
  return { send, close }
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
let connection = null
let sandbox = null
let realHomeBefore = null
let runError = null
let cleanupError = null
const captured = []
const skipped = []
const failures = []

try {
let port = attachPort
if (!port) {
  if (!doLaunch) {
    throw new Error('Pass --attach <port> to attach, or --launch to start the app here.')
  }
  port = '9222'
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

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
connection = await cdp(port)
const { send } = connection

await send('Runtime.enable')

/** Evaluate in the renderer and return the value while preserving live-app exceptions. */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
}

/** Poll a synchronous expression until it returns a truthy value, or the deadline expires. */
async function until(expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await evaluate(expression)
    if (value) return value
    if (Date.now() > deadline) return null
    await sleep(150)
  }
}

if (sandbox) {
  // Passing NT_USER_DATA is not proof Electron honoured it. Ask the running main process through
  // the real preload bridge before the harness clicks anything or invokes a mutating app API.
  await evaluate(`(function(){
    window.__shotsUserData = 'pending';
    try {
      window.nodeTerminal.userDataDir().then(
        function(v){ window.__shotsUserData = v },
        function(e){ window.__shotsUserData = 'rejected: ' + e }
      );
    } catch (e) { window.__shotsUserData = 'threw: ' + e }
    return true;
  })()`)
  const actualUserData = await until(
    `window.__shotsUserData !== 'pending' ? window.__shotsUserData : null`,
    8000
  )
  const actualPath = typeof actualUserData === 'string' ? resolve(actualUserData) : ''
  const expectedPath = resolve(sandbox.userData)
  const samePath = process.platform === 'win32'
    ? actualPath.toLowerCase() === expectedPath.toLowerCase()
    : actualPath === expectedPath
  if (!samePath) {
    throw new Error(`app reported userData ${JSON.stringify(actualUserData)}; expected ${expectedPath}`)
  }
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false
})

// Dismiss the first-run setup tour before anything else. A fresh Electron profile opens on it,
// and every subsequent chord is swallowed by the overlay — which is how the first run of this
// harness photographed the onboarding cover five times and reported five successes.
{
  const onb = await send('Runtime.evaluate', { returnByValue: true, expression: `(function(){
    var skip = document.querySelector('.onb-skip');
    if (skip) { skip.click(); return 'dismissed'; }
    return document.querySelector('.onb') ? 'present-but-no-skip' : 'absent';
  })()` })
  console.log(`  setup tour: ${onb.result.value}`)
  await sleep(1500)
}

// `--launch` always boots a genuinely fresh, isolated sandbox (createAppSandbox — no prior
// projects), so `.md3-welcome__card--primary` ("New project") is on screen at this point. Several
// required surfaces — the kanban toggle chief among them — render ONLY once a project exists
// (ProjectSwitcher's `{activeProject && <button className="tab__board-toggle">}`), so a run that
// never creates one can NEVER capture them: not a stale selector, a state the harness never
// reaches. (`--attach` is unaffected — it drives an already-open, already-populated dev profile,
// which is how earlier committed captures show a real "Project 1" with a terminal on it.) Create
// one empty project so `--launch` reaches the same reachable state on its own.
{
  const created = await send('Runtime.evaluate', { returnByValue: true, expression: `(function(){
    var card = document.querySelector('.md3-welcome__card--primary');
    if (card) { card.click(); return 'created'; }
    return 'already have a project';
  })()` })
  console.log(`  starter project: ${created.result.value}`)
  await sleep(1200)
}

// Return to a KNOWN BASE STATE before photographing anything. The previous run ends on the
// kanban board (it is the last surface), and a board left open made the next run capture it
// under two other surfaces' names. A harness whose output depends on how the last run finished
// is not a harness. Close any overlay, then confirm.
{
  const closed = await send('Runtime.evaluate', { returnByValue: true, expression: `(function(){
    var t = document.querySelector('.tab__board-toggle');
    if (t && document.querySelector('[class*="kanban"]')) { t.click(); return 'board closed'; }
    return 'already on the canvas';
  })()` })
  console.log(`  base state: ${closed.result.value}`)
  await sleep(1200)
}

for (const s of SURFACES) {
  if (only && !only.some((o) => s.id.includes(o))) continue
  if (!s.required) {
    skipped.push({ id: s.id, why: s.why })
    continue
  }
  try {
    // Is it already open? The board toggle is a TOGGLE: clicking it when the surface is already
    // showing CLOSES it, which is exactly how a previously-successful run left the next one
    // failing. Ensure the state; do not flip it.
    let alreadyOpen = false
    if (s.verify) {
      const pre = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `!!document.querySelector(${JSON.stringify(s.verify)})${s.verifyAbsent ? ` && !document.querySelector(${JSON.stringify(s.verifyAbsent)})` : ''}`
      })
      alreadyOpen = pre.result.value === true
    }

    if (!alreadyOpen && s.open?.clicks) {
      // A SEQUENCE, for surfaces more than one click deep — a settings section, a sub-tab. Each
      // step must land, or the run fails rather than photographing wherever it stopped.
      for (const sel of s.open.clicks) {
        // Each step is either a CSS selector or a visible label. Falling back to the label is
        // what makes a settings section addressable at all: its sidebar entry has no id, no test
        // hook and no stable class — only the words a user reads.
        const target = JSON.stringify(sel)
        const hit = await send('Runtime.evaluate', {
          returnByValue: true,
          expression:
            '(function(){' +
            `  var sel = ${target};` +
            '  var el = null;' +
            '  try { el = document.querySelector(sel) } catch (e) { el = null }' +
            '  if (!el) {' +
            "    var all = [].slice.call(document.querySelectorAll('button,a,[role=button],li'));" +
            '    el = all.filter(function (e) { return (e.textContent || "").trim() === sel })[0];' +
            '  }' +
            '  if (!el) return false; el.click(); return true;' +
            '})()'
        })
        if (hit.result.value !== true) {
          failures.push({ id: s.id, why: `opener step "${sel}" was not found` })
          break
        }
        await sleep(1200)
      }
      if (failures.some((f) => f.id === s.id)) continue
    } else if (!alreadyOpen && s.open?.click) {
      const clicked = await send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(function(){var el=document.querySelector(${JSON.stringify(s.open.click)});if(!el)return false;el.click();return true})()`
      })
      if (clicked.result.value !== true) {
        failures.push({ id: s.id, why: `opener "${s.open.click}" is not in the DOM` })
        continue
      }
      await sleep(1500)
    } else if (!alreadyOpen && s.open?.script) {
      // A SCRIPTED DRIVER, for a surface no click sequence can reach. The Kids flow has to enter
      // the mode, choose a PIN on a pad, confirm the same PIN, then unlock the grown-up screen with
      // it — a sequence that must remember a value between steps. This still drives the app's OWN
      // controls (it clicks real buttons and polls for the real result); it is not a way to reach
      // past the UI into state. It must resolve `true`, or the run fails rather than photographing
      // wherever it stopped — the same rule every other opener here obeys.
      const drove = await send('Runtime.evaluate', {
        returnByValue: true,
        awaitPromise: true,
        expression: s.open.script
      })
      if (drove.result.value !== true) {
        failures.push({ id: s.id, why: `scripted opener did not reach its surface (returned ${JSON.stringify(drove.result.value)})` })
        continue
      }
      await sleep(900)
    } else if (!alreadyOpen && s.open) {
      // Chords go through the real key path so the app's own handlers run. The code/vk pair is
      // spelled out per surface rather than derived from the key — deriving it produced
      // `code: 'KeyCOMMA'` and a virtual key code from a character, neither of which any handler
      // recognises, so every chord silently did nothing.
      const mods = (s.open.ctrl ? 2 : 0) | (s.open.shift ? 8 : 0)
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          modifiers: mods,
          key: s.open.key,
          code: s.open.code,
          windowsVirtualKeyCode: s.open.vk,
          nativeVirtualKeyCode: s.open.vk
        })
      }
      await sleep(1500)
    }

    // THE CHECK THAT MAKES THIS HARNESS WORTH ANYTHING. Without it a chord that did nothing
    // still yields a screenshot of the previous screen, filed under the new surface's name.
    if (s.verify) {
      const verifyExpr = `!!document.querySelector(${JSON.stringify(s.verify)})${s.verifyAbsent ? ` && !document.querySelector(${JSON.stringify(s.verifyAbsent)})` : ''}`
      // `pollMs` is for a surface whose real state takes minutes to arrive (the ADHD momentum
      // note) — the opener already returned, and this polls repeatedly from the NODE side
      // (`until`, defined above) rather than inside one `Runtime.evaluate` call, which times out
      // at 30s regardless of `awaitPromise`.
      const ok = s.pollMs ? await until(verifyExpr, s.pollMs) : (await evaluate(verifyExpr))
      if (ok !== true) {
        failures.push({
          id: s.id,
          why: `surface never opened — "${s.verify}" is not in the DOM, so any capture here would be the previous screen under this name`
        })
        continue
      }
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const buf = Buffer.from(shot.data, 'base64')
    if (looksBlank(buf)) {
      failures.push({ id: s.id, why: `capture is uniform/blank (${buf.length} bytes) — nothing rendered` })
      continue
    }
    writeFileSync(join(OUT, `${s.id}.png`), buf)
    mkdirSync(SITE_OUT, { recursive: true })
    writeFileSync(join(SITE_OUT, `${s.id}.png`), buf)
    captured.push({ id: s.id, title: s.title, bytes: buf.length, hadOpener: !!s.open })
    console.log(`✓ ${s.id}.png  ${(buf.length / 1024).toFixed(0)} KB`)
    // Return to a known state so the next surface does not open on top of this one.
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
  } catch (err) {
    failures.push({ id: s.id, why: err.message })
  }
}

// The ADHD surfaces above each create a real terminal node, which is a real tmux/session-host
// session that OUTLIVES THE APP BY DESIGN (see the terminal session continuity section of
// CLAUDE.md). On Windows that is a standalone session host process — it must be destroyed here,
// before the disposable sandbox is torn down in the `finally` block, or `rmSync` fails with EPERM
// while every capture already sits safely on disk (measured with the near-identical Windows
// terminal-profile node, which this same trap is why that one is optional rather than required).
// Destruction happens whether or not the surfaces above succeeded — a failed capture must not
// leave an orphaned session behind either.
{
  const createdIds = await evaluate(`window.__adhdCreatedNodeIds || []`)
  for (const nodeId of Array.isArray(createdIds) ? createdIds : []) {
    try {
      await evaluate(
        `window.nodeTerminal.pty.destroy(${JSON.stringify(nodeId)}, {everySocket: true}); true`
      )
      // `destroy` is a one-way renderer cast; its CONSEQUENCE is the trustworthy boundary, not the
      // cast's own return value — poll for the session actually being gone (three consecutive
      // negative reads), the same discipline scripts/windows-profile-packaged-driver.mjs uses for
      // the identical cleanup. Each check is its own `awaitPromise: true` call rather than a
      // single long-lived one, because `send()` hard-times-out at 30s regardless.
      const deadline = Date.now() + 30000
      let consecutiveAbsent = 0
      let destroyed = false
      while (Date.now() < deadline) {
        try {
          const result = await send('Runtime.evaluate', {
            returnByValue: true,
            awaitPromise: true,
            expression: `Promise.all([
              window.nodeTerminal.pty.sendText(${JSON.stringify(nodeId)}, '', {enter: false}),
              window.nodeTerminal.pty.capture(${JSON.stringify(nodeId)}, true)
            ]).then((values) => ({ writable: values[0], screen: String(values[1] || '') }))`
          })
          const { writable, screen } = result.result.value || {}
          if (writable === false && screen === '') {
            consecutiveAbsent += 1
            if (consecutiveAbsent >= 3) {
              destroyed = true
              break
            }
          } else {
            consecutiveAbsent = 0
          }
        } catch {
          // A transport error is not proof of absence — keep polling for explicit negatives.
          consecutiveAbsent = 0
        }
        await sleep(150)
      }
      if (!destroyed) {
        console.warn(`  ! ADHD capture session ${nodeId} did not report destroyed within 30s`)
      }
    } catch (err) {
      console.warn(`  ! could not destroy ADHD capture session ${nodeId}: ${err.message}`)
    }
  }
}

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

// Two required surfaces that produce IDENTICAL bytes are not two surfaces. Either a chord did
// nothing and the previous screen was filed under a second name, or the two entries genuinely
// show the same view and one of them is misnamed. Both are worth knowing; neither is visible
// from a success count. This is a warning rather than a failure, because there are legitimate
// cases (the app at launch really is the canvas once a project is open).
// Only surfaces that were SUPPOSED to differ. Two entries with no opening step photograph
// whatever is on screen at that moment, so of course they match — `app-01-launch` and
// `app-04-canvas` are legitimately one view once a project is open, and warning about that every
// run is noise that teaches people to ignore the warning that matters.
const byBytes = new Map()
for (const c of captured.filter((x) => x.hadOpener)) {
  const same = byBytes.get(c.bytes)
  if (same) {
    console.warn(
      `\n  ! ${c.id} and ${same} are byte-identical (${c.bytes} bytes) — they are the same view.\n` +
        `    Either one is misnamed, or its opening step did nothing.`
    )
  } else byBytes.set(c.bytes, c.id)
}
// Seed with the openerless ones too: a chorded surface whose chord did nothing lands on the
// canvas, and matching THAT is the real signal this check exists for.
for (const c of captured.filter((x) => !x.hadOpener)) {
  const same = byBytes.get(c.bytes)
  if (same && captured.find((x) => x.id === same)?.hadOpener) {
    console.warn(`
  ! ${same} is byte-identical to ${c.id} — its opening step did nothing.`)
  }
}

console.log(`\ncaptured ${captured.length}  skipped ${skipped.length}  failed ${failures.length}`)
for (const s of skipped) console.log(`  - skipped ${s.id}: ${s.why}`)
for (const f of failures) console.error(`  ! FAILED ${f.id}: ${f.why}`)

// Rule 2 — a required surface that could not be reached fails the run.
if (failures.length) {
  console.error('\nRequired surfaces failed to capture. That is a defect, not a gap.')
}
} catch (error) {
  runError = error
} finally {
  try {
    await connection?.close()
  } catch (error) {
    cleanupError ??= error
  }
  try {
    await terminateSpawnedChild(child)
  } catch (error) {
    cleanupError ??= error
  }
  if (realHomeBefore) {
    try {
      const realHomeAfter = captureManagedConfigSentinel({ home: homedir(), env: process.env })
      assertManagedConfigUnchanged(realHomeBefore, realHomeAfter)
    } catch (error) {
      cleanupError ??= error
    }
  }
  if (sandbox) {
    try {
      rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    } catch (error) {
      cleanupError ??= new Error(`could not remove capture sandbox ${sandbox.root}: ${error.message}`, {
        cause: error
      })
    }
  }
}

if (runError && cleanupError) {
  throw new AggregateError([runError, cleanupError], 'capture failed and cleanup did not complete')
}
if (runError) throw runError
if (cleanupError) throw cleanupError
if (failures.length) process.exit(1)

console.log('\nRemember: docs/assets/social-card.png is generated FROM app-04-canvas.png, and its')
console.log('crop is tuned to that shot. Re-run `npm run make-social-card` after replacing it.')
