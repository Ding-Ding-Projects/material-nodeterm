import { execFile } from 'node:child_process'
import { win32 } from 'node:path'

/**
 * The installed executable name is a packaging contract, not PE metadata. In particular, builds
 * made with `signAndEditExecutable: false` retain Electron's upstream version-resource strings;
 * deriving a shortcut target from those strings could create or remove an Electron shortcut.
 */
export const SQUIRREL_SHORTCUT_EXECUTABLE = 'nodeterm.exe'

// Squirrel may terminate an uninstall hook at roughly ten seconds. Leave a two-second margin so
// our own timeout callback can report failure and exit deterministically first.
export const SQUIRREL_LIFECYCLE_TIMEOUT_MS = 8_000

export type SquirrelLifecycleEvent =
  | 'install'
  | 'updated'
  | 'uninstall'
  | 'obsolete'

export interface SquirrelCommand {
  file: string
  args: string[]
}

export type SquirrelLifecycleDecision =
  | { handled: false }
  | {
      handled: true
      event: SquirrelLifecycleEvent
      command?: SquirrelCommand
      invalidExecutablePath?: true
    }

const SQUIRREL_EVENTS = new Map<string, SquirrelLifecycleEvent>([
  ['--squirrel-install', 'install'],
  ['--squirrel-updated', 'updated'],
  ['--squirrel-uninstall', 'uninstall'],
  ['--squirrel-obsolete', 'obsolete']
])

const PUBLIC_BOOTSTRAP_CODES = new Set([
  'ERR_DLOPEN_FAILED',
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'MODULE_NOT_FOUND'
])
const PUBLIC_BOOTSTRAP_ERROR_NAMES = new Set([
  'Error',
  'RangeError',
  'SyntaxError',
  'TypeError'
])
const ELECTRON_DUPLICATE_HANDLER_MESSAGE =
  /^Attempted to register a second handler for '[^'\r\n]+'$/u

function isElectronDuplicateHandlerFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : undefined
  return typeof message === 'string' && ELECTRON_DUPLICATE_HANDLER_MESSAGE.test(message)
}

/**
 * Decide whether this invocation belongs to Squirrel.Windows. Only argv[1] is considered: that is
 * the documented lifecycle position, and refusing lookalike flags later in an ordinary launch
 * prevents user-supplied terminal arguments from accidentally suppressing the application.
 */
export function decideSquirrelLifecycle(
  platform: NodeJS.Platform,
  argv: readonly string[],
  executablePath: string
): SquirrelLifecycleDecision {
  if (platform !== 'win32') return { handled: false }

  const event = SQUIRREL_EVENTS.get(argv[1] ?? '')
  if (!event) return { handled: false }
  if (event === 'obsolete') return { handled: true, event }

  // Squirrel starts the app from an absolute app-<version> path under its packaged executable
  // name. Fail closed rather than running a cwd-relative or another product's Update.exe if an
  // unexpected launcher supplies a malformed or publisher-owned executable path.
  if (
    !win32.isAbsolute(executablePath) ||
    win32.basename(executablePath).toLocaleLowerCase('en-US') !==
      SQUIRREL_SHORTCUT_EXECUTABLE
  ) {
    return { handled: true, event, invalidExecutablePath: true }
  }

  const updateExecutable = win32.normalize(
    win32.join(win32.dirname(executablePath), '..', 'Update.exe')
  )
  const shortcutAction = event === 'uninstall' ? '--removeShortcut' : '--createShortcut'

  return {
    handled: true,
    event,
    command: {
      file: updateExecutable,
      args: [shortcutAction, SQUIRREL_SHORTCUT_EXECUTABLE]
    }
  }
}

interface ExecFileOptions {
  windowsHide: boolean
  timeout: number
  killSignal: NodeJS.Signals
  maxBuffer: number
}

export type SquirrelExecFile = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  callback: (error: Error | null) => void
) => unknown

/** Run the already-validated command without constructing a shell command string. */
export function executeSquirrelCommand(
  command: SquirrelCommand,
  execFileImpl: SquirrelExecFile = execFile as unknown as SquirrelExecFile
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rejectSanitized = (): void => {
      // Do not retain a child-process error containing local paths or command details. The caller
      // reports only the lifecycle event and exits with a deterministic failure code.
      reject(new Error('Squirrel lifecycle command failed.'))
    }
    try {
      execFileImpl(
        command.file,
        [...command.args],
        {
          windowsHide: true,
          timeout: SQUIRREL_LIFECYCLE_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024
        },
        (error) => {
          if (error) rejectSanitized()
          else resolve()
        }
      )
    } catch {
      rejectSanitized()
    }
  })
}

/** Preserve a useful failure category without serializing an import error's local file path. */
export function publicDesktopBootstrapFailure(error: unknown): string {
  if (isElectronDuplicateHandlerFailure(error)) {
    return '[startup] Desktop bootstrap failed (DUPLICATE_HANDLER).'
  }
  const candidate = error as { code?: unknown; name?: unknown } | null
  const code = candidate?.code
  if (typeof code === 'string' && PUBLIC_BOOTSTRAP_CODES.has(code)) {
    return `[startup] Desktop bootstrap failed (${code}).`
  }
  const name = candidate?.name
  if (typeof name === 'string' && PUBLIC_BOOTSTRAP_ERROR_NAMES.has(name)) {
    return `[startup] Desktop bootstrap failed (${name}).`
  }
  return '[startup] Desktop bootstrap failed.'
}

export interface DesktopBootstrapFailureDialog {
  title: string
  content: string
}

export function desktopBootstrapFailureDialog(error: unknown): DesktopBootstrapFailureDialog {
  const publicFailure = publicDesktopBootstrapFailure(error)
  const category = /\(([^)]+)\)/u.exec(publicFailure)?.[1]
  const missingModule = category === 'MODULE_NOT_FOUND' || category === 'ERR_MODULE_NOT_FOUND'
  if (category === 'DUPLICATE_HANDLER') {
    return {
      title: 'nodeterm could not start',
      content: [
        'nodeterm stopped because it detected a duplicate startup handler while registering its startup handlers.',
        '',
        'Error category: DUPLICATE_HANDLER',
        '',
        'Install a newer repaired release and try again. Your nodeterm settings and projects were not removed.'
      ].join('\n')
    }
  }
  return {
    title: 'nodeterm could not start',
    content: missingModule
      ? [
          'A required component is missing from this nodeterm package, so the app stopped before opening a window.',
          '',
          `Error category: ${category}`,
          '',
          'Reinstalling the same release will not repair an incomplete package. Download a newer release that includes the startup repair.',
          'Your nodeterm settings and projects were not removed.'
        ].join('\n')
      : [
          'nodeterm encountered an early startup problem and stopped before opening a window.',
          '',
          ...(category ? [`Error category: ${category}`, ''] : []),
          'Install a newer repaired release and try again. Your nodeterm settings and projects were not removed.'
        ].join('\n')
  }
}

export interface DesktopBootstrapFailureReporter {
  log(message: string): void
  showErrorBox(title: string, content: string): void
  exit(code: number): void
}

/** Report a normal-bootstrap failure through one sanitized, testable recovery seam. */
export function reportDesktopBootstrapFailure(
  error: unknown,
  reporter: DesktopBootstrapFailureReporter
): void {
  reporter.log(publicDesktopBootstrapFailure(error))
  const failure = desktopBootstrapFailureDialog(error)
  try {
    reporter.showErrorBox(failure.title, failure.content)
  } catch {
    // The sanitized log remains available when the operating system cannot show UI.
  }
  reporter.exit(1)
}

export interface DesktopStartupDependencies {
  platform: NodeJS.Platform
  argv: readonly string[]
  executablePath: string
  loadNormalBootstrap(): Promise<unknown>
  exit(code: number): void
  reportLifecycleFailure(event: SquirrelLifecycleEvent): void
  runSquirrelCommand?(command: SquirrelCommand): Promise<void>
}

/**
 * The only router the packaged desktop entry invokes. A handled lifecycle event exits from this
 * function and never imports the normal bootstrap, so userData, settings, sessions and windows are
 * untouched during install/update/uninstall maintenance.
 */
export async function runDesktopStartup(deps: DesktopStartupDependencies): Promise<void> {
  const decision = decideSquirrelLifecycle(deps.platform, deps.argv, deps.executablePath)
  if (!decision.handled) {
    await deps.loadNormalBootstrap()
    return
  }

  if (decision.invalidExecutablePath) {
    deps.reportLifecycleFailure(decision.event)
    deps.exit(1)
    return
  }

  if (decision.command) {
    try {
      await (deps.runSquirrelCommand ?? executeSquirrelCommand)(decision.command)
    } catch {
      deps.reportLifecycleFailure(decision.event)
      deps.exit(1)
      return
    }
  }

  deps.exit(0)
}
