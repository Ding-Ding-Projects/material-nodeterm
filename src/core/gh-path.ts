import os from 'node:os'
import path from 'node:path'
import { findExecutableSync } from './exec-path'

const COMMON_GH_BIN_DIRS = [
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  '/usr/bin/gh'
]

/**
 * Well-known `gh` install locations walked after the PATH lookup misses. Pure over its inputs so
 * the Windows list is testable from any host.
 *
 * Windows keeps the two locations the GitHub CLI installer uses (machine-wide under Program Files,
 * per-user under `%LOCALAPPDATA%\Programs`): a desktop app launched from Explorer or a shortcut
 * does not necessarily inherit the PATH entry the installer added, so a PATH-only lookup would
 * report a signed-in machine as having no GitHub CLI at all.
 */
export function ghFallbacks(
  platform: NodeJS.Platform | string = os.platform(),
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): string[] {
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files'
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
    return [
      path.win32.join(programFiles, 'GitHub CLI', 'gh.exe'),
      path.win32.join(localAppData, 'Programs', 'GitHub CLI', 'gh.exe')
    ]
  }
  return COMMON_GH_BIN_DIRS
}

/**
 * Resolves the path to the `gh` executable.
 *
 * Windows resolves a bare command against PATHEXT (`gh.EXE`, typically under
 * `C:\Program Files\GitHub CLI\`), then the installer locations above.
 * On macOS, GUI apps don't inherit the shell PATH, so the shared resolver checks
 * the login-shell PATH first, followed by well-known POSIX locations.
 *
 * MEMOIZED-ON-HIT rather than computed at import: a miss is re-probed so a gh
 * installed while the app is running is picked up, and the async login-shell PATH
 * probe that lands after module load is no longer raced.
 */
let cachedGh: string | null | undefined

export function ghPath(): string | null {
  if (cachedGh) return cachedGh
  const found = findExecutableSync('gh', ghFallbacks())
  // Only a HIT is cached. Caching a miss here would freeze the answer for the process lifetime.
  if (found) cachedGh = found
  return found
}

/** Reset the cached path (for testing). */
export function _resetGhPathForTest(): void {
  cachedGh = undefined
}
