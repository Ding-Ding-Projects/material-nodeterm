// "Open in Visual Studio Code" — detect an installed VS Code on THIS machine and open a file or
// folder in it. Electron-free (only node:child_process/fs/os/path), so it runs identically from
// the Electron main process and from the Server Edition (a plain Node process) — whichever
// machine is actually running the shell is the one VS Code opens on. See docs/exports.md.
//
// Detection order: 1) `code`/`code-insiders` resolvable on PATH (this also catches a portable
// build the user has added to PATH themselves — there is no reliable way to enumerate an
// unregistered portable install otherwise); 2) the well-known per-user/machine install paths for
// the current platform. Each candidate is VERIFIED by actually running `--version`, not merely
// by the path existing, so a stale shortcut or a half-uninstalled app is never reported as usable.

import { execFile } from 'node:child_process'
import { existsSync as fsExistsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { VsCodeInstall, VsCodeKind, VsCodeOpenResult } from '../shared/vscode'

export type { VsCodeInstall, VsCodeKind, VsCodeOpenResult } from '../shared/vscode'

const execFileP = promisify(execFile)

/** The subprocess/filesystem/host seam, injectable so the detection LOGIC is testable on any
 *  machine (vscode-detect.test.ts) without depending on what happens to be installed there.
 *  Every member defaults to the real environment, so production callers pass nothing and the
 *  behavior is exactly what it always was. */
export interface VsCodeDeps {
  /** execFile-shaped runner: resolves when the command ran and exited 0, rejects on a spawn
   *  failure, non-zero exit, or timeout — the same contract as promisified execFile. */
  exec?: (
    cmd: string,
    args: string[],
    opts: { timeout: number; windowsHide: boolean; shell: boolean }
  ) => Promise<unknown>
  existsSync?: (p: string) => boolean
  platform?: NodeJS.Platform
  homedir?: () => string
  env?: Record<string, string | undefined>
}

interface ResolvedDeps {
  exec: NonNullable<VsCodeDeps['exec']>
  existsSync: (p: string) => boolean
  platform: NodeJS.Platform
  homedir: () => string
  env: Record<string, string | undefined>
}

function resolveDeps(deps: VsCodeDeps): ResolvedDeps {
  return {
    exec: deps.exec ?? ((cmd, args, opts) => execFileP(cmd, args, opts)),
    existsSync: deps.existsSync ?? fsExistsSync,
    platform: deps.platform ?? process.platform,
    homedir: deps.homedir ?? (() => os.homedir()),
    env: deps.env ?? process.env
  }
}

// VS Code's launcher on Windows is `code.cmd`/`code-insiders.cmd` — a batch file, which
// `child_process.execFile` cannot invoke directly without a shell (Windows' CreateProcess has no
// notion of running a `.cmd` file; only `cmd.exe` does). `shell: true` on the other platforms is a
// harmless no-op here since none of the candidates on those platforms are batch files.
function windowsShell(d: ResolvedDeps): boolean {
  return d.platform === 'win32'
}

async function verify(cmd: string, d: ResolvedDeps): Promise<boolean> {
  try {
    await d.exec(cmd, ['--version'], { timeout: 4000, windowsHide: true, shell: windowsShell(d) })
    return true
  } catch {
    return false
  }
}

function wellKnownPaths(d: ResolvedDeps): { cmd: string; kind: VsCodeKind }[] {
  const home = d.homedir()
  const plat = d.platform
  if (plat === 'darwin') {
    return [
      { cmd: '/usr/local/bin/code', kind: 'code' },
      { cmd: '/opt/homebrew/bin/code', kind: 'code' },
      { cmd: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', kind: 'code' },
      { cmd: '/usr/local/bin/code-insiders', kind: 'code-insiders' },
      {
        cmd: '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
        kind: 'code-insiders'
      }
    ]
  }
  if (plat === 'win32') {
    const localAppData = d.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    const programFiles = d.env.ProgramFiles ?? 'C:\\Program Files'
    return [
      { cmd: path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'), kind: 'code' },
      { cmd: path.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'), kind: 'code' },
      {
        cmd: path.join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
        kind: 'code-insiders'
      },
      {
        cmd: path.join(programFiles, 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
        kind: 'code-insiders'
      }
    ]
  }
  // Linux and everything else POSIX.
  return [
    { cmd: '/usr/bin/code', kind: 'code' },
    { cmd: '/snap/bin/code', kind: 'code' },
    { cmd: '/usr/share/code/bin/code', kind: 'code' },
    { cmd: path.join(home, '.local/bin/code'), kind: 'code' },
    { cmd: '/usr/bin/code-insiders', kind: 'code-insiders' }
  ]
}

/** Every verified VS Code install on this machine, PATH results first. Never throws — a machine
 *  with none installed simply returns an empty array. */
export async function detectVsCode(deps: VsCodeDeps = {}): Promise<VsCodeInstall[]> {
  const d = resolveDeps(deps)
  const found: VsCodeInstall[] = []
  const seen = new Set<string>()

  const pathCandidates: { cmd: string; kind: VsCodeKind }[] =
    d.platform === 'win32'
      ? [
          { cmd: 'code.cmd', kind: 'code' },
          { cmd: 'code', kind: 'code' },
          { cmd: 'code-insiders.cmd', kind: 'code-insiders' },
          { cmd: 'code-insiders', kind: 'code-insiders' }
        ]
      : [
          { cmd: 'code', kind: 'code' },
          { cmd: 'code-insiders', kind: 'code-insiders' }
        ]

  for (const c of pathCandidates) {
    if (seen.has(c.kind)) continue // one PATH hit per kind is enough
    if (await verify(c.cmd, d)) {
      found.push({ command: c.cmd, kind: c.kind, fromPath: true })
      seen.add(c.kind)
    }
  }

  for (const c of wellKnownPaths(d)) {
    if (seen.has(c.kind)) continue
    if (d.existsSync(c.cmd) && (await verify(c.cmd, d))) {
      found.push({ command: c.cmd, kind: c.kind, fromPath: false })
      seen.add(c.kind)
    }
  }

  return found
}

/** Open `targetPath` in VS Code. A folder path opens as the WORKSPACE ROOT (VS Code's own
 *  contract when given a directory) so the file tree is usable, not a single-file editor with no
 *  context; a file path opens the file directly. `-n` opens a fresh window rather than reusing
 *  whatever window VS Code last had open, so this never steals focus from unrelated work. */
export async function openInVsCode(
  targetPath: string,
  install?: VsCodeInstall,
  deps: VsCodeDeps = {}
): Promise<VsCodeOpenResult> {
  const d = resolveDeps(deps)
  const chosen = install ?? (await detectVsCode(deps))[0]
  if (!chosen) {
    return {
      ok: false,
      error: 'Visual Studio Code was not found on this machine. Install it from code.visualstudio.com, or add it to your PATH.'
    }
  }
  try {
    await d.exec(chosen.command, ['-n', targetPath], {
      timeout: 8000,
      windowsHide: true,
      shell: windowsShell(d)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
