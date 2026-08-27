#!/usr/bin/env node
// scripts/check-build-preflight.mjs
//
// Refuse to start a build that cannot succeed, and say why in one second rather than three
// minutes. Two preconditions today, both Windows-only in practice:
//
//   1. no running process holds a binary under node_modules that a rebuild must delete;
//   2. the exact VCINSTALLDIR-selected default toolset has the Spectre-mitigated MSVC libraries
//      node-pty requires.
//
// It reports EVERY failed precondition in one run, deliberately. Discovering these one at a
// time cost three separate multi-minute builds: the locked DLL hid the missing Spectre libs
// completely, because the rebuild never got as far as compiling.
//
// WHY THE LOCK CHECK EXISTS
//
// `npm run dist:win` runs @electron/rebuild, which deletes and recompiles node-pty. On Windows you
// cannot delete a DLL that is mapped into a live process, so if ANY instance of the app is
// running — a dev window from `npm start`, a packaged build, a leftover process from a test run —
// the rebuild dies with:
//
//   ⨯ [Error: EPERM: operation not permitted, unlink '...\node-pty\build\Release\conpty.node']
//   ⨯ node-gyp failed to rebuild '...\node-pty'
//
// Nothing in that message says "close the app". It reads like a broken toolchain or a permissions
// problem, and the usual reactions — run the terminal as administrator, reinstall node_modules,
// blame antivirus — all fail, because none of them is the cause. It cost real time to trace an
// identical EPERM to a dev instance started hours earlier and forgotten.
//
// It cannot happen on macOS or Linux, where unlinking an open file is ordinary. So it is invisible
// to everyone not building on Windows, which is the platform this project ships.
//
// HOW IT DETECTS THE LOCK
//
// By opening each native module for WRITING (`r+`) and closing it immediately. That is
// non-destructive — no truncation, no modification — and on Windows a mapped DLL answers `EBUSY`.
//
// Three approaches were measured against a genuinely locked `conpty.node` before settling on it:
//
//   rename to a temp name and back  → succeeded. Does NOT detect the lock.
//   open for reading  ('r')         → succeeded. Does NOT detect the lock.
//   open for writing  ('r+')        → EBUSY. Detects it.
//
// The first is the tempting one, because "can I rename it" feels like the closest proxy for "can
// the rebuild replace it". It is not: Windows blocks DELETE on a mapped image, and a rename that
// stays in the same directory does not need it.

import { readdirSync, openSync, closeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { activeVisualStudioSpectreComplaints } from './ensure-windows-build-toolchain.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = join(REPO_ROOT, 'node_modules')

/**
 * Every binary under node_modules that a rebuild or reinstall has to DELETE, and that Windows
 * will therefore refuse to delete while a process has it mapped.
 *
 * `.node` was the whole list at first, because electron-rebuild recompiles addons. That missed
 * the most common failure of all: `npm ci` removes node_modules wholesale, so it dies on
 * `node_modules\electron\dist\electron.exe` — the Electron binary the running app IS. `build.bat`
 * hit exactly that and reported npm's opaque EPERM with "see the npm output above for the real
 * cause", which is the same unhelpful message this preflight was written to replace.
 *
 * `.dll` is included for the same reason: a native package that ships a sidecar DLL locks it the
 * moment the addon loading it is mapped.
 */
const LOCKABLE = /\.(node|exe|dll)$/i
function lockableBinaries(dir, out = [], depth = 0) {
  // Bounded: node_modules is deep and almost all of it is JavaScript. Binaries live near the top
  // of a package, under build/Release, prebuilds, or dist.
  if (depth > 6) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) lockableBinaries(p, out, depth + 1)
    else if (LOCKABLE.test(e.name)) out.push(p)
  }
  return out
}

/** Best-effort, Windows-only: which process has this file mapped. Never fatal — the check below
 *  stands on its own, and this only makes the message actionable. */
function holdersOf(file) {
  if (process.platform !== 'win32') return []
  try {
    const ps = `Get-Process | ForEach-Object { $p=$_; try { $p.Modules | Where-Object { $_.FileName -ieq '${file.replace(/'/g, "''")}' } | ForEach-Object { "$($p.Id) $($p.ProcessName)" } } catch {} }`
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * node-pty's own binding.gyp sets `'SpectreMitigation': 'Spectre'`, so building it on Windows
 * needs the Spectre-mitigated MSVC runtime libraries — a separate component in the Visual Studio
 * installer that a default C++ workload does NOT include.
 *
 * Without them the build runs for minutes and then dies with four copies of:
 *
 *   error MSB8040: Spectre-mitigated libraries are required for this project.
 *
 * which at least names itself, unlike the locked-DLL case above — but only after the compile has
 * already been attempted. Checking first turns three minutes into nothing.
 *
 * Deliberately NOT worked around by passing `/p:SpectreMitigation=false`. node-pty asks for the
 * mitigation on purpose; switching it off to make a build pass would ship an unmitigated native
 * module, which is a security decision disguised as a build fix.
 *
 * Returns a list of complaints, empty when fine or when the answer cannot be determined — an
 * unknown toolchain layout must not block a build that would have worked.
 */
const locked = []
for (const file of lockableBinaries(MODULES)) {
  try {
    closeSync(openSync(file, 'r+'))
  } catch (e) {
    // EBUSY/EPERM: something has it. EACCES: read-only on disk, which is a different problem and
    // not one this check is about. Anything else (a vanished file mid-scan) is not our business.
    if (e.code === 'EBUSY' || e.code === 'EPERM') locked.push(file)
  }
}

const problems = []

const spectreComplaints = activeVisualStudioSpectreComplaints()
if (spectreComplaints.length > 0) {
  problems.push({
    title: 'the Spectre-mitigated MSVC libraries are not installed',
    lines: [
      "node-pty's binding.gyp asks for Spectre mitigation, so building it needs those",
      'libraries. They are a separate component and are NOT part of a default C++ workload,',
      'so a machine that compiles everything else fine still fails here — several minutes in,',
      'with four copies of MSBuild error MSB8040.',
      '',
      ...spectreComplaints.map((l) => `  ${l}`),
      '',
      'Visual Studio Installer → Modify → Individual components → add',
      'Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre' +
        (process.arch === 'arm64'
          ? ' and Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre.'
          : '.'),
      '',
      'Not worked around with /p:SpectreMitigation=false: node-pty asks for the mitigation',
      'deliberately, and turning it off would ship an unmitigated native module.'
    ]
  })
}

if (locked.length > 0) {
  problems.push({
    title: "a running process holds a binary this build has to replace",
    lines: [
      'On Windows a binary mapped into a live process cannot be deleted. electron-rebuild would',
      'fail with an EPERM about a .node file, and `npm ci` — which removes node_modules wholesale',
      '— with one about electron.exe. Neither message mentions the app that is holding it.',
      '',
      ...locked.flatMap((file) => [
        `  ${relative(REPO_ROOT, file)}`,
        ...holdersOf(file).map((who) => `      held by PID ${who}`)
      ]),
      '',
      'Close every running instance of the app (including one started with `npm start`, and',
      'any left over from a test run) and try again.'
    ]
  })
}

if (problems.length === 0) {
  console.log('✓ build preflight: native modules unlocked, toolchain can build them')
  process.exit(0)
}

console.error('')
console.error(
  problems.length === 1
    ? '✗ Cannot build — 1 problem:'
    : `✗ Cannot build — ${problems.length} problems (all of them, so you can fix them in one go):`
)
for (const [i, p] of problems.entries()) {
  console.error('')
  console.error(`  ${i + 1}. ${p.title}`)
  console.error('')
  for (const line of p.lines) console.error(line ? `     ${line}` : '')
}
console.error('')
process.exit(1)
