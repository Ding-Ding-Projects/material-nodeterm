import { win32 as path } from 'node:path'

export const SQUIRREL_STARTUP_QUIT_DEADLINE_MS = 1_000
export const SQUIRREL_FIRST_RUN_UPDATE_DELAY_MS = 10_000

export type SquirrelStartupPlan =
  | { kind: 'quit-now'; reason: 'obsolete' }
  | {
      kind: 'shortcut'
      reason: 'install' | 'updated' | 'uninstall'
      command: string
      args: [operation: '--createShortcut' | '--removeShortcut', executableName: string]
    }

export interface SquirrelChildProcess {
  once(event: 'close' | 'error', listener: () => void): this
  unref(): void
}

export interface SquirrelStartupDependencies {
  argv: readonly string[]
  platform: NodeJS.Platform
  execPath: string
  quit: () => void
  spawn: (
    command: string,
    args: readonly string[],
    options: { detached: true; stdio: 'ignore' }
  ) => SquirrelChildProcess
  schedule?: (callback: () => void, delayMs: number) => unknown
}

export type DesktopStartupResult = 'squirrel-lifecycle' | 'application'

/**
 * Squirrel invokes the installed executable with one of these lifecycle flags while it owns the
 * application directory. The normal application graph must not load in that short-lived process:
 * native modules and single-instance wiring can keep files locked until Squirrel times out.
 */
export function planSquirrelStartup(
  argv: readonly string[],
  platform: NodeJS.Platform,
  execPath: string
): SquirrelStartupPlan | null {
  if (platform !== 'win32') return null

  if (argv.includes('--squirrel-obsolete')) {
    return { kind: 'quit-now', reason: 'obsolete' }
  }

  let reason: 'install' | 'updated' | 'uninstall' | null = null
  if (argv.includes('--squirrel-uninstall')) reason = 'uninstall'
  else if (argv.includes('--squirrel-updated')) reason = 'updated'
  else if (argv.includes('--squirrel-install')) reason = 'install'
  if (reason === null) return null

  const executableName = path.basename(execPath)
  const appDirectory = path.dirname(execPath)
  const updateExecutable = path.resolve(appDirectory, '..', 'Update.exe')
  const operation = reason === 'uninstall' ? '--removeShortcut' : '--createShortcut'

  return {
    kind: 'shortcut',
    reason,
    command: updateExecutable,
    args: [operation, executableName]
  }
}

/** Squirrel's first-run lock lasts a few seconds; delay only the automatic update check. */
export function initialAutomaticUpdateDelayMs(
  argv: readonly string[],
  platform: NodeJS.Platform
): number {
  return platform === 'win32' && argv.includes('--squirrel-firstrun')
    ? SQUIRREL_FIRST_RUN_UPDATE_DELAY_MS
    : 0
}

/**
 * Handle a Squirrel lifecycle process and report whether normal application startup must stop.
 * Both child completion and a short deadline can request quit; the once guard makes that safe.
 */
export function handleSquirrelStartup(deps: SquirrelStartupDependencies): boolean {
  const plan = planSquirrelStartup(deps.argv, deps.platform, deps.execPath)
  if (plan === null) return false

  if (plan.kind === 'quit-now') {
    deps.quit()
    return true
  }

  let didQuit = false
  const quitOnce = (): void => {
    if (didQuit) return
    didQuit = true
    deps.quit()
  }

  try {
    const child = deps.spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' })
    child.once('close', quitOnce)
    child.once('error', quitOnce)
    child.unref()
  } catch {
    // A synchronous spawn failure still must not enter normal startup while Squirrel owns files.
  }

  const schedule = deps.schedule ?? setTimeout
  schedule(quitOnce, SQUIRREL_STARTUP_QUIT_DEADLINE_MS)
  return true
}

/** Keep the production bootstrap decision behavior-testable without importing Electron in Chuts. */
export function beginDesktopStartup(
  deps: SquirrelStartupDependencies,
  loadApplication: () => void
): DesktopStartupResult {
  if (handleSquirrelStartup(deps)) return 'squirrel-lifecycle'
  loadApplication()
  return 'application'
}
