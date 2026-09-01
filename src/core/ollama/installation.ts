// Best-effort detection of whether the Ollama BINARY is present on this machine — the missing half
// of "Ollama is not reachable". A refused TCP connection on the loopback port is produced by BOTH
// "Ollama was never installed" and "Ollama is installed but its service is not started right now",
// and those two need different words and a different next action (download it vs. just start it —
// see docs/ollama-manager.md "Distinguishing failure modes"). This module answers the SEPARATE
// question "does the binary exist anywhere on disk", combined in classifyOllamaHealth() below with
// the connection-refusal signal from client.ts to pick between the two.
//
// This never spawns Ollama, never spawns a shell, and never touches the network — it only looks
// for real evidence on disk: PATH entries plus well-known per-platform install locations (a
// packaged GUI app's PATH is routinely narrower than an interactive shell's — the same reasoning
// tmux-hint.ts's findCommand/findFixedTmux use for tmux, and deliberately subprocess-free for the
// same reason findFixedTmux is: this runs on the status-check path, not once at startup). Not
// finding it in any inspected location is not proof of absence beyond "not in an inspected
// location" — the health copy says "does not appear to be installed", never a flat "is not
// installed", for exactly that reason.

import { existsSync } from 'node:fs'
import type { OllamaHealth } from '../../shared/ollama'

export interface OllamaInstallEvidence {
  found: boolean
  /** Which check found it — an honest "how do we know" trail. Null when not found. */
  via: 'path' | 'known-location' | null
}

interface DetectDeps {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Injected so the walk stays pure and testable — fs.existsSync in production. A throwing
   *  `exists` reads as "not here", never as a failed probe (same contract as findFixedTmux). */
  exists?: (path: string) => boolean
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const sep = platform === 'win32' ? ';' : ':'
  // Windows environment variable lookups are case-insensitive at the OS level, but Node exposes
  // whatever casing the process actually received ("Path" is the common Windows spelling; "PATH"
  // is what POSIX and some Windows shells use) — check both rather than assuming one.
  const raw = env.PATH ?? env.Path ?? ''
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Absolute directories Ollama installs itself into that a packaged GUI app's PATH often does not
 *  include, per platform. Order does not matter — the first hit stops the walk. */
function knownInstallDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const dirs: string[] = []
    // The official Windows installer places ollama.exe under the per-user LOCALAPPDATA, not
    // Program Files — https://ollama.com/download/windows.
    if (env.LOCALAPPDATA) dirs.push(`${env.LOCALAPPDATA}\\Programs\\Ollama`)
    if (env.ProgramFiles) dirs.push(`${env.ProgramFiles}\\Ollama`)
    if (env['ProgramFiles(x86)']) dirs.push(`${env['ProgramFiles(x86)']}\\Ollama`)
    return dirs
  }
  if (platform === 'linux') return ['/usr/local/bin', '/usr/bin', '/snap/bin', '/opt/ollama/bin']
  return []
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ollama.exe' : 'ollama'
}

function joinPath(dir: string, name: string, platform: NodeJS.Platform): string {
  const sep = platform === 'win32' ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/** Best-effort, synchronous, no subprocess spawn. Checks the process PATH first (respects
 *  whatever the user actually configured), then the fixed per-platform install locations. */
export function detectOllamaInstalled(deps: DetectDeps = {}): OllamaInstallEvidence {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const exists = deps.exists ?? existsSync
  const name = binaryName(platform)

  for (const dir of pathEntries(env, platform)) {
    try {
      if (exists(joinPath(dir, name, platform))) return { found: true, via: 'path' }
    } catch {
      // unreadable — keep looking
    }
  }
  for (const dir of knownInstallDirs(platform, env)) {
    try {
      if (exists(joinPath(dir, name, platform))) return { found: true, via: 'known-location' }
    } catch {
      // unreadable — keep looking
    }
  }
  return { found: false, via: null }
}

/**
 * Turns a failed ping into one of the four non-'ok' OllamaHealth values.
 *
 * Node's own `fetch` collapses every network-level failure's `.message` to the generic string
 * "fetch failed" — the actual OS error code (e.g. "ECONNREFUSED") lives on `.cause.code`, one
 * level down, which is why `code` is a separate parameter rather than something parsed out of
 * `detail`. Measured against a real Node 24 fetch to a refused port: `message` is "fetch failed",
 * `cause.code` is "ECONNREFUSED" — text-matching `detail` alone (the previous implementation,
 * before this file existed) never fired, so a stopped/never-installed Ollama was silently
 * misreported as 'unhealthy' ("Ollama answered but reported a problem: fetch failed") even though
 * Ollama never answered at all. client.ts now preserves `cause.code` onto OllamaUnreachableError
 * so it can be passed in here as `code`; the `detail` text match stays as a second, redundant
 * signal in case a future runtime ever puts the code back into `.message` directly.
 *
 * `checkInstalled` is called ONLY on a connection refusal — the one case where "was this ever
 * installed" is the actual open question. It is never called for a timeout/abort or a non-2xx
 * response, where Ollama plainly IS there and answering (just slow, or unwell).
 */
export function classifyOllamaHealth(
  code: string | null,
  detail: string | null,
  checkInstalled: () => OllamaInstallEvidence
): OllamaHealth {
  const lower = (detail ?? '').toLowerCase()
  const refused = code === 'ECONNREFUSED' || lower.includes('econnrefused')
  if (refused) {
    let evidence: OllamaInstallEvidence
    try {
      evidence = checkInstalled()
    } catch {
      // The install check itself failed (should not happen — it is a pure fs/env read) — fail
      // toward the more common case rather than crashing the whole status check.
      evidence = { found: false, via: null }
    }
    return evidence.found ? 'stopped' : 'not-installed'
  }
  if (lower.includes('abort') || lower.includes('timeout')) return 'unreachable'
  if (!detail) return 'unreachable'
  return 'unhealthy'
}
