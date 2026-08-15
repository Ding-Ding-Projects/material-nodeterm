#!/usr/bin/env node
// scripts/check-native-unlocked.mjs
//
// Refuse to start a Windows build while a running app has this repo's native modules loaded.
//
// WHY THIS EXISTS
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

import { readdirSync, statSync, openSync, closeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = join(REPO_ROOT, 'node_modules')

/** Every compiled addon under node_modules, which is what a rebuild replaces. */
function nativeModules(dir, out = [], depth = 0) {
  // Bounded: node_modules is deep and almost all of it is JavaScript. Addons live near the top of
  // a package, under build/Release or prebuilds.
  if (depth > 6) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) nativeModules(p, out, depth + 1)
    else if (e.name.endsWith('.node')) out.push(p)
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

const locked = []
for (const file of nativeModules(MODULES)) {
  try {
    closeSync(openSync(file, 'r+'))
  } catch (e) {
    // EBUSY/EPERM: something has it. EACCES: read-only on disk, which is a different problem and
    // not one this check is about. Anything else (a vanished file mid-scan) is not our business.
    if (e.code === 'EBUSY' || e.code === 'EPERM') locked.push(file)
  }
}

if (locked.length === 0) {
  console.log('✓ native modules are unlocked — safe to rebuild')
  process.exit(0)
}

console.error('')
console.error('✗ Cannot build: a running process has this repo\'s native modules loaded.')
console.error('')
console.error('  On Windows a DLL that is mapped into a live process cannot be deleted, so the')
console.error('  electron-rebuild step would fail with an EPERM about a .node file that says')
console.error('  nothing about the real cause.')
console.error('')
for (const file of locked) {
  console.error(`  ${relative(REPO_ROOT, file)}`)
  for (const who of holdersOf(file)) console.error(`      held by PID ${who}`)
}
console.error('')
console.error('  Close every running instance of the app (including one started with `npm start`,')
console.error('  and any left over from a test run) and try again.')
console.error('')
process.exit(1)
