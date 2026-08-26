// Typed spec for an NSIS installer, and the closed vocabulary the renderer accepts.
//
// This describes an installer for SOME OTHER application — nodeterm itself ships as
// Squirrel.Windows and this module changes nothing about that (see the packaging section of the
// root CLAUDE.md). Nothing here touches package.json's build block or electron-builder config.
//
// Every free-text field on this spec is something a user typed into a form. An .nsi script is
// executable, so the render boundary (render.ts / escape.ts) treats every one of these strings as
// hostile until it has been escaped — this file only shapes the data, it does not sanitize it.

/** The install-directory root, as a CLOSED union rather than a free string. A free string here
 *  would let a caller hand the renderer an arbitrary NSIS variable/macro name to interpolate
 *  unescaped into `InstallDir`. Only these four roots are ever emitted. */
export type NsisInstallRoot =
  | 'programFiles64' // $PROGRAMFILES64
  | 'programFiles32' // $PROGRAMFILES
  | 'localAppData' // $LOCALAPPDATA (per-user installs)
  | 'appData' // $APPDATA (per-user installs)

/** NSIS's built-in compressors. `off` disables compression entirely (`SetCompress off`). */
export type NsisCompression = 'zlib' | 'bzip2' | 'lzma' | 'off'

/** Whether the installer runs `RequestExecutionLevel admin` (per-machine) or `user`
 *  (per-user — no UAC prompt, installs under a per-user root). */
export type NsisInstallScope = 'perMachine' | 'perUser'

/** One file or folder to install, relative to a project root the caller controls. `dest` is the
 *  path fragment appended under `$INSTDIR` (empty string / omitted = install at the root). */
export interface NsisInstallItem {
  /** Path to the source file or directory, relative to the project the spec was built for.
   *  Must not be absolute and must not contain a `..` segment that would escape that project
   *  directory — the renderer refuses those rather than trying to clip them (see escape.ts). */
  readonly sourcePath: string
  /** Destination sub-path under `$INSTDIR`. Omit or use '' for the install root. Same traversal
   *  rule as sourcePath: no leading `/` or `\`, no `..` segment. */
  readonly destSubPath?: string
  /** True if sourcePath is a directory (`File /r`) rather than a single file (`File`). */
  readonly isDirectory?: boolean
}

/** An optional Start Menu shortcut. */
export interface NsisStartMenuShortcut {
  readonly enabled: boolean
  /** Folder name under the Start Menu Programs group. Defaults to the app name when omitted. */
  readonly folderName?: string
}

export interface NsisDesktopShortcut {
  readonly enabled: boolean
}

/** The complete typed description of one NSIS installer. Nothing in this shape implies trust —
 *  every string field is re-validated and escaped at render time regardless of what TypeScript
 *  believes about it (the type system is compile-time only). */
export interface NsisInstallerSpec {
  /** Human-readable application name. Used for the installer window title, the default install
   *  folder leaf, and the Start Menu / uninstall registry display name. Must be non-empty. */
  readonly appName: string
  /** Version string. Must match a plain dotted-numeric shape (see escape.ts `isValidVersion`) —
   *  NSIS's VIProductVersion needs exactly four dot-separated integer fields, but we accept the
   *  common 2-4 field forms and pad on render. */
  readonly version: string
  /** Publisher / company name, shown in the installer UI and uninstall registry entry. */
  readonly publisher: string
  /** Output installer filename, e.g. "MyAppSetup.exe". Must end in .exe and contain no path
   *  separators (it is a filename, not a path). */
  readonly outFile: string
  /** Where the app installs to. */
  readonly installRoot: NsisInstallRoot
  /** Sub-path under the chosen root, e.g. "MyApp" -> $PROGRAMFILES64\MyApp. Defaults to appName
   *  when omitted. Same traversal rule as NsisInstallItem paths. */
  readonly installSubPath?: string
  /** Files/folders to bundle into the installer. */
  readonly items: readonly NsisInstallItem[]
  /** Optional path (relative to the project root, same traversal rule) to a license text/RTF
   *  file shown in a license page before install proceeds. */
  readonly licenseFile?: string
  /** Optional path to a .ico file used for the installer executable and uninstaller. */
  readonly iconFile?: string
  /** Name of the executable (relative to installSubPath) launched by the Start Menu / desktop
   *  shortcuts and by an optional "run after install" checkbox. Required if either shortcut kind
   *  is enabled. */
  readonly mainExecutable?: string
  readonly startMenuShortcut?: NsisStartMenuShortcut
  readonly desktopShortcut?: NsisDesktopShortcut
  /** Whether to emit an uninstaller (Uninstall.exe + uninstall registry key). Defaults to true. */
  readonly generateUninstaller?: boolean
  readonly installScope: NsisInstallScope
  readonly compression: NsisCompression
}

export const NSIS_INSTALL_ROOTS: readonly NsisInstallRoot[] = [
  'programFiles64',
  'programFiles32',
  'localAppData',
  'appData'
]

export const NSIS_COMPRESSIONS: readonly NsisCompression[] = ['zlib', 'bzip2', 'lzma', 'off']

export const NSIS_INSTALL_SCOPES: readonly NsisInstallScope[] = ['perMachine', 'perUser']

export function isNsisInstallRoot(value: unknown): value is NsisInstallRoot {
  return typeof value === 'string' && (NSIS_INSTALL_ROOTS as readonly string[]).includes(value)
}

export function isNsisCompression(value: unknown): value is NsisCompression {
  return typeof value === 'string' && (NSIS_COMPRESSIONS as readonly string[]).includes(value)
}

export function isNsisInstallScope(value: unknown): value is NsisInstallScope {
  return typeof value === 'string' && (NSIS_INSTALL_SCOPES as readonly string[]).includes(value)
}
