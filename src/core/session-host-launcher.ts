// Resolves the standalone session-host bundle and spawns it DETACHED so it outlives this app.
// There is no "system session-host" to prefer over ours, so the resolution is only the
// packaged/dev split below.
// Resolves the standalone session-host bundle and spawns it DETACHED so it outlives this app —
// the exact same "system-first, bundled-as-floor" resolution shape `tmux-hint.ts`'s
// `bundledTmuxPath` already uses, one level over: there is no "system session-host" to prefer, so
// this only has the dev/packaged split.

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { renameAtomic } from './fs-atomic'

const RUNTIME_MARKER = 'session-host-runtime.json'
const RUNTIME_EXECUTABLE = process.platform === 'win32' ? 'session-host-runtime.exe' : 'session-host-runtime'

export type PreparedSessionHostRuntime = {
  executablePath: string
  scriptPath: string
}

type RuntimeMarker = {
  schemaVersion: 1
  executableBytes: number
  hostScriptSha256: string
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readMarker(runtimeDir: string): Promise<RuntimeMarker | null> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(path.join(runtimeDir, RUNTIME_MARKER), 'utf8'))
    if (
      parsed?.schemaVersion !== 1 ||
      !Number.isSafeInteger(parsed.executableBytes) ||
      parsed.executableBytes <= 0 ||
      typeof parsed.hostScriptSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(parsed.hostScriptSha256)
    ) {
      return null
    }
    return parsed as RuntimeMarker
  } catch {
    return null
  }
}

async function preparedRuntime(runtimeDir: string): Promise<PreparedSessionHostRuntime | null> {
  const executablePath = path.join(runtimeDir, RUNTIME_EXECUTABLE)
  const scriptPath = path.join(runtimeDir, 'session-host', 'host.cjs')
  const nativePackage = path.join(runtimeDir, 'session-host', 'node_modules', 'node-pty', 'package.json')
  const marker = await readMarker(runtimeDir)
  if (!marker) return null
  try {
    const executable = await fs.promises.stat(executablePath)
    if (!executable.isFile() || executable.size !== marker.executableBytes) return null
    const hostScript = await fs.promises.readFile(scriptPath)
    if (sha256(hostScript) !== marker.hostScriptSha256) return null
    const native = await fs.promises.stat(nativePackage)
    if (!native.isFile()) return null
    return { executablePath, scriptPath }
  } catch {
    return null
  }
}

/**
 * Copy the packaged Electron-as-Node executable and complete session-host bundle into a stable,
 * versioned local runtime outside Squirrel's replaceable app-* tree. Publication is a directory
 * rename, so another process sees either no runtime or a complete one. Existing hosts are always
 * connected before this function is called, so staging never replaces a live owner.
 */
export async function prepareSessionHostRuntime(options: {
  scriptPath: string
  userDataDir: string
  runtimeDir?: string | null
  executablePath?: string
}): Promise<PreparedSessionHostRuntime> {
  const sourceExecutable = path.resolve(options.executablePath ?? process.execPath)
  const sourceScript = path.resolve(options.scriptPath)
  if (!options.runtimeDir) return { executablePath: sourceExecutable, scriptPath: sourceScript }

  const runtimeDir = path.resolve(options.runtimeDir)
  const sourceHostDir = path.dirname(sourceScript)
  for (const source of [path.dirname(sourceExecutable), sourceHostDir, path.resolve(options.userDataDir)]) {
    const relative = path.relative(source, runtimeDir)
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('session-host runtime directory overlaps a replaceable or state directory')
    }
  }

  const existing = await preparedRuntime(runtimeDir)
  if (existing) return existing
  if (fs.existsSync(runtimeDir)) {
    throw new Error('session-host stable runtime exists but failed validation')
  }

  const parent = path.dirname(runtimeDir)
  await fs.promises.mkdir(parent, { recursive: true })
  const stage = path.join(parent, `.${path.basename(runtimeDir)}.stage-${process.pid}-${randomUUID()}`)
  try {
    await fs.promises.mkdir(stage, { recursive: false })
    const stagedExecutable = path.join(stage, RUNTIME_EXECUTABLE)
    const stagedHostDir = path.join(stage, 'session-host')
    await fs.promises.copyFile(sourceExecutable, stagedExecutable, fs.constants.COPYFILE_EXCL)
    await fs.promises.cp(sourceHostDir, stagedHostDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    const [executable, hostScript] = await Promise.all([
      fs.promises.stat(stagedExecutable),
      fs.promises.readFile(path.join(stagedHostDir, 'host.cjs')),
    ])
    const marker: RuntimeMarker = {
      schemaVersion: 1,
      executableBytes: executable.size,
      hostScriptSha256: sha256(hostScript),
    }
    await fs.promises.writeFile(path.join(stage, RUNTIME_MARKER), `${JSON.stringify(marker)}\n`, {
      flag: 'wx',
    })
    await renameAtomic(stage, runtimeDir)
  } catch (error) {
    await fs.promises.rm(stage, { recursive: true, force: true })
    const wonRace = await preparedRuntime(runtimeDir)
    if (wonRace) return wonRace
    throw error
  }

  const prepared = await preparedRuntime(runtimeDir)
  if (!prepared) throw new Error('session-host stable runtime publication failed validation')
  return prepared
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
): void {
  try {
    const child = spawnImpl(executablePath, [scriptPath, userDataDir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    child.unref()
  } catch {
    /* the caller's subsequent connect attempt will fail and surface the real error */
  }
}
