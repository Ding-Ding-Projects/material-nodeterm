// Resolves the standalone session-host bundle and spawns it DETACHED so it outlives this app —
// the exact same "system-first, bundled-as-floor" resolution shape `tmux-hint.ts`'s
// `bundledTmuxPath` already uses, one level over: there is no "system session-host" to prefer, so
// this only has the dev/packaged split.

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import {
  ensureStagedHostRuntime,
  type StageOptions,
  type StagedHostRuntime
} from './session-host-runtime'

export type PreparedSessionHostRuntime = {
  executablePath: string
  scriptPath: string
}

/** How long a host launch waits for the first staging of a new version (copy, hash and smoke run).
 *  A staging that has not finished in time keeps running in the background and serves the next
 *  launch; this launch is refused rather than run from the install directory. */
export const STAGED_RUNTIME_WAIT_MS = 45_000

/**
 * The executable and script to launch the host with.
 *
 * Dev (no `runtimeDir`): the running executable and the repo's bundle, as before.
 *
 * Packaged (`runtimeDir`, the staging root the desktop shell supplies): a private, verified copy
 * of the host runtime outside Squirrel's replaceable `app-*` directory (`session-host-runtime.ts`:
 * the Electron executable under its own image name, its DLLs, ICU data, resource paks and locales,
 * and the complete `resources/session-host` bundle with its own node-pty, hash-verified and
 * smoke-run before a marker makes it launchable). If no staged runtime can be produced, this
 * REFUSES: a packaged host is never run from the install directory, because a host mapping that
 * directory would pin the old `app-*` tree for as long as its sessions live. Existing hosts are
 * always connected before this is called, so staging never replaces a live owner.
 */
export async function prepareSessionHostRuntime(options: {
  scriptPath: string
  userDataDir: string
  runtimeDir?: string | null
  executablePath?: string
  resourcesPath?: string | null
  appVersion?: string
  platform?: NodeJS.Platform | string
  log?: (line: string) => void
  /** Test seam: the staging implementation (production: the memoized `ensureStagedHostRuntime`). */
  stage?: (opts: StageOptions) => Promise<StagedHostRuntime | null>
  waitMs?: number
}): Promise<PreparedSessionHostRuntime> {
  const sourceExecutable = path.resolve(options.executablePath ?? process.execPath)
  const sourceScript = path.resolve(options.scriptPath)
  if (!options.runtimeDir) return { executablePath: sourceExecutable, scriptPath: sourceScript }

  const runtimeRoot = path.resolve(options.runtimeDir)
  const sourceHostDir = path.dirname(sourceScript)
  for (const source of [path.dirname(sourceExecutable), sourceHostDir, path.resolve(options.userDataDir)]) {
    const relative = path.relative(source, runtimeRoot)
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('session-host runtime directory overlaps a replaceable or state directory')
    }
  }

  const stage = options.stage ?? ensureStagedHostRuntime
  let timer: ReturnType<typeof setTimeout> | undefined
  let staged: StagedHostRuntime | null
  try {
    staged = await Promise.race([
      stage({
        platform: options.platform ?? process.platform,
        execPath: sourceExecutable,
        resourcesPath: options.resourcesPath,
        script: sourceScript,
        appVersion: options.appVersion ?? 'unknown',
        runtimeRoot,
        log: options.log
      }).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), options.waitMs ?? STAGED_RUNTIME_WAIT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!staged) {
    throw new Error(
      'session-host staged runtime is unavailable; a packaged host is never launched from the ' +
        'replaceable install directory (see session-host.log for the staging step that failed)'
    )
  }
  return { executablePath: staged.exe, scriptPath: staged.script }
}

/**
 * Where `out/session-host/host.cjs` lives, in dev vs a packaged build.
 *
 * - Packaged: `electron-builder`'s `extraResources` copies `out/session-host` to
 *   `<resourcesPath>/session-host` (see package.json's `build.extraResources`).
 *   `<resourcesPath>/session-host` (see package.json's `build.extraResources`), mirroring how the
 *   bundled tmux binary lands under `<resourcesPath>/bin`.
 * - Dev (`electron-vite dev`): `process.cwd()` is the repo root, and `npm run build` /
 *   `npm run host:build` write straight to `<repoRoot>/out/session-host/host.cjs`.
 */
export function resolveSessionHostScript(opts: {
  resourcesPath?: string | null
  repoRoot?: string | null
  exists?: (p: string) => boolean
}): string | null {
  const exists = opts.exists ?? fs.existsSync
  const candidates: string[] = []
  if (opts.resourcesPath) candidates.push(path.join(opts.resourcesPath, 'session-host', 'host.cjs'))
  if (opts.repoRoot) candidates.push(path.join(opts.repoRoot, 'out', 'session-host', 'host.cjs'))
  for (const c of candidates) {
    try {
      if (exists(c)) return c
    } catch {
      /* unreadable — keep looking */
    }
  }
  return null
}

/**
 * Spawn the session host, detached, unref'd, with no attached stdio — so it survives this
 * process exiting (`app.quit()` never touches it; `PtyManager.killAll()` explicitly does not
 * either, matching how it never kills tmux sessions).
 *
 * `ELECTRON_RUN_AS_NODE=1` is what makes this work when `process.execPath` is the Electron
 * binary itself (a packaged app has no separate `node` executable to shell out to) — Electron
 * treats that env var as "run this as a plain Node process, skip the Chromium/BrowserWindow
 * machinery entirely". It is harmless to set when `process.execPath` already IS a real Node
 * binary (dev, or a CI box running the bundle directly): unrecognized by real Node, ignored.
 *
 * Never throws — a spawn failure here is reported by the CALLER failing to connect afterward,
 * exactly like `pty.spawn` failures elsewhere in this codebase degrade to an error the renderer
 * can show rather than crashing the main process.
 */
export function spawnSessionHost(
  executablePath: string,
  scriptPath: string,
  userDataDir: string,
  spawnImpl = spawn,
): SpawnSessionHostResult {
  try {
    const child = spawnImpl(executablePath, [scriptPath, userDataDir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    const result: { ok: true; asyncError?: Error } = { ok: true }
    // A spawn failure (ENOENT, a policy block) arrives ASYNCHRONOUSLY on 'error', which the
    // try/catch cannot see, and an unhandled 'error' on a ChildProcess takes the main process
    // down. Record it so the caller's startup timeout can name it.
    child.on('error', (error: Error) => {
      result.asyncError = error
    })
    child.unref()
    return result
  } catch (error) {
    // Still never throws — but the failure is RETURNED so the connect timeout that follows can
    // name it. A `catch {}` here meant a blocked or quarantined staged runtime surfaced as the
    // generic "did not come up in time" with nothing pointing at the cause.
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

/** `asyncError` is filled in later if the child's asynchronous 'error' event fires. */
export type SpawnSessionHostResult = { ok: true; asyncError?: Error } | { ok: false; error: Error }

const HOST_LOG_TAIL_BYTES = 8192

/**
 * The last `fatal:` line the host wrote to `<userDataDir>/session-host.log`, or null. Bounded to
 * the file's tail; a missing or unreadable log is null, never a throw — this only decorates a
 * timeout message and must not be able to replace it with a different failure.
 */
export async function readSessionHostFatalLine(userDataDir: string): Promise<string | null> {
  const logPath = path.join(userDataDir, 'session-host.log')
  let handle: fs.promises.FileHandle | null = null
  try {
    handle = await fs.promises.open(logPath, 'r')
    const { size } = await handle.stat()
    const length = Math.min(size, HOST_LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim()
      if (line.includes('fatal:')) return line
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
