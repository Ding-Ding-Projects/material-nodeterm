// Live main-window tracking. Everything in the main process that pushes IPC to the
// renderer must resolve the window at send time via getMainWindow()/sendToMain(). Never capture a
// BrowserWindow in an initialization closure because a renderer restart can replace it.

// Structural view of BrowserWindow (keeps this module electron-free and unit-testable).
export interface MainWindowLike {
  isDestroyed(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  on(event: 'closed', cb: () => void): void
  // `id` is Electron's webContents id — the same number CorePlatform addresses a UI by
  // (sendTo / the sender id of an ipcMain event). Optional so a test double may omit it.
  webContents: { id?: number; send(channel: string, ...args: unknown[]): void }
}

let current: MainWindowLike | null = null

export function setMainWindow(win: MainWindowLike): void {
  current = win
  win.on('closed', () => {
    // Guard: a late 'closed' from a replaced window must not clear its successor.
    if (current === win) current = null
  })
}

export function getMainWindow(): MainWindowLike | null {
  return current && !current.isDestroyed() ? current : null
}

export function sendToMain(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args)
}

/** The attached renderer client ids. Resolved at call time so a replacement window is picked up. */
export function mainWindowClientIds(): number[] {
  const id = getMainWindow()?.webContents.id
  return typeof id === 'number' ? [id] : []
}

export type MainWindowActivationResult =
  | 'queued-until-ready'
  | 'ready'
  | 'focused-existing'
  | 'created-main'

export interface MainWindowActivationController {
  request(): MainWindowActivationResult
  markReady(): MainWindowActivationResult
}

/**
 * Queue launch activation until desktop boot has created its first main window, then focus the
 * tracked main window on later activation requests. The aggregate BrowserWindow list is not an
 * authority here because helper windows can outlive the main window.
 */
export function createMainWindowActivationController(deps: {
  getMainWindow(): MainWindowLike | null
  createMainWindow(): MainWindowLike
}): MainWindowActivationController {
  let ready = false
  let pending = false

  const activate = (): MainWindowActivationResult => {
    const existing = deps.getMainWindow()
    if (!existing) {
      deps.createMainWindow()
      return 'created-main'
    }
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return 'focused-existing'
  }

  return {
    request() {
      if (!ready) {
        pending = true
        return 'queued-until-ready'
      }
      return activate()
    },
    markReady() {
      ready = true
      if (!pending) return 'ready'
      pending = false
      return activate()
    }
  }
}

/** Whether Planner continuity intentionally retains a non-macOS host after its last UI closes. */
export function plannerRetainsHostAfterWindowClose(
  platform: NodeJS.Platform | string,
  hasEnabledSchedules: boolean
): boolean {
  return platform !== 'darwin' && hasEnabledSchedules
}

export type CrashReloadAction = 'reload' | 'give-up' | 'ignore'

// A dead renderer leaves the (single) window a permanent blank page — nothing in Electron
// reloads it. Reload automatically, but bounded: a crash on the boot path would otherwise
// reload forever. 'clean-exit' is a deliberate teardown (window close, navigation), never
// reloaded; everything else — crashed, oom, abnormal-exit, launch-failed, and 'killed'
// deserves an attempt.
export function createCrashReloadPolicy(
  opts?: { maxReloads?: number; windowMs?: number }
): (reason: string, now: number) => CrashReloadAction {
  const maxReloads = opts?.maxReloads ?? 2
  const windowMs = opts?.windowMs ?? 60_000
  let granted: number[] = []
  return (reason, now) => {
    if (reason === 'clean-exit') return 'ignore'
    granted = granted.filter((t) => now - t < windowMs)
    if (granted.length >= maxReloads) return 'give-up'
    granted.push(now)
    return 'reload'
  }
}

// macOS convention: closing the window hides it (the app — and its tmux sessions,
// hook server, updater, license watchers — keeps running); a real close only happens
// on quit. Other platforms quit on window close, so never intercept there.
export function shouldHideOnClose(platform: NodeJS.Platform | string, quitting: boolean): boolean {
  return platform === 'darwin' && !quitting
}

/**
 * A normal Windows title-bar close must enter the application quit lifecycle directly. Waiting
 * for `window-all-closed` is insufficient because auxiliary BrowserWindows may intentionally
 * outlive the main window, leaving the process and single-instance lock behind. An enabled planner
 * schedule is the one explicit Windows background-host exception, and an in-progress quit must be
 * allowed to close its windows without recursively starting another quit.
 */
export function shouldQuitHostOnWindowClose(
  platform: NodeJS.Platform | string,
  quitting: boolean,
  hasEnabledPlannerSchedules: boolean
): boolean {
  return platform === 'win32' && !quitting && !hasEnabledPlannerSchedules
}

export type CloseAction = 'default' | 'hide' | 'leave-fullscreen-then-hide'

/** The Windows close button always follows the native close path. */
export function closeAction(
  _platform: NodeJS.Platform | string,
  _quitting: boolean,
  _isFullScreen: boolean
): CloseAction {
  return 'default'
}
