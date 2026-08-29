/**
 * Local form-state shape for the NSIS installer-builder node.
 *
 * This is a RENDERER-OWNED type, deliberately not imported from `src/core/nsis` (a sibling lane
 * owns a typed `NsisInstallerSpec` + pure `renderNsis(spec)` there, in a separate worktree that
 * does not exist in this checkout). Keeping this file self-contained means this branch typechecks
 * and tests standalone; reconciling the two shapes is integration work for whoever merges both
 * lanes. See the file-level comment split below for exactly which fields that reconciliation must
 * treat as GIT-SHARED spec vs MACHINE-LOCAL paths — that split is the one part of this shape that
 * is load-bearing rather than cosmetic (see `@shared/node-exec` for the general rule it follows).
 *
 * Two halves, and they persist completely differently:
 *
 *  - `NsisSpec` — the installer's *description*: app name, version, publisher, output filename,
 *    which well-known root it installs under, shortcut/uninstaller/compression choices. None of
 *    this names anything on the local disk, so it is safe to write into `.nodeterm/project.json`
 *    (git-shared, hand-editable, mirrored to every clone) exactly like a sticky note's text.
 *
 *  - `NsisLocalPaths` — absolute paths on THIS machine: which files/folders to package, and
 *    optional license/icon files. These are exactly the hazard `@shared/node-exec`'s doc comment
 *    describes for `shell` and `ssh.extraArgs`: a value that names something on disk is one
 *    person's environment, and a project file that could set it would be one person's filesystem
 *    layout leaking into (or worse, being read by) everybody else's checkout. So these never touch
 *    the shared document — they round-trip through the machine-local `LocalNodeExec` overlay the
 *    same way `serviceConnection` does. See `@shared/node-exec`'s `NsisLocalPaths` field.
 */

/** Closed union of installer roots — never a free string, so a shared project file cannot smuggle
 *  an install location nobody chose from a real picker. */
export type NsisInstallRoot =
  | 'program-files-64'
  | 'program-files-32'
  | 'local-app-data'
  | 'per-user-program-files'

export const NSIS_INSTALL_ROOTS: readonly NsisInstallRoot[] = [
  'program-files-64',
  'program-files-32',
  'local-app-data',
  'per-user-program-files'
]

export const NSIS_INSTALL_ROOT_LABELS: Record<NsisInstallRoot, string> = {
  'program-files-64': 'Program Files (64-bit) — $PROGRAMFILES64',
  'program-files-32': 'Program Files (32-bit) — $PROGRAMFILES',
  'local-app-data': "This user's AppData\Local — $LOCALAPPDATA",
  'per-user-program-files': "This user's own Program Files — $LOCALAPPDATA\Programs"
}

/** NSIS's own compressor choices. `'none'` is a real, useful option (fastest build, for testing a
 *  script) and is listed as such rather than omitted as if it were an oversight. */
export type NsisCompression = 'lzma' | 'zlib' | 'bzip2' | 'none'

export const NSIS_COMPRESSIONS: readonly NsisCompression[] = ['lzma', 'zlib', 'bzip2', 'none']

export const NSIS_COMPRESSION_LABELS: Record<NsisCompression, string> = {
  lzma: 'LZMA (smallest, slowest to build)',
  zlib: 'Zlib (balanced)',
  bzip2: 'BZip2 (good for already-compressed assets)',
  none: 'None (fastest build, largest installer)'
}

/**
 * The GIT-SHARED half. Every field here is descriptive text or a closed enum — nothing that names
 * a location on the local disk. Safe to persist directly on `CanvasNodeState.nsisSpec`.
 */
export interface NsisSpec {
  appName: string
  version: string
  publisher: string
  /** Defaults to `<appName>-Setup.exe`-shaped when blank; the user may override it. */
  outputFileName: string
  installRoot: NsisInstallRoot
  compression: NsisCompression
  /** Per-machine (needs elevation, installs for every account) vs per-user (no elevation). */
  perMachine: boolean
  createDesktopShortcut: boolean
  createStartMenuShortcut: boolean
  includeUninstaller: boolean
}

export function defaultNsisSpec(): NsisSpec {
  return {
    appName: '',
    version: '1.0.0',
    publisher: '',
    outputFileName: '',
    installRoot: 'per-user-program-files',
    compression: 'lzma',
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    includeUninstaller: true
  }
}

/**
 * The MACHINE-LOCAL half — absolute filesystem paths on the machine that built this node. Never
 * written into `.nodeterm/project.json`; round-tripped through `LocalNodeExec.nsisLocalPaths` in
 * `@shared/node-exec` exactly as `serviceConnection` is, and for the identical reason.
 */
export interface NsisLocalPaths {
  /** Absolute file/folder paths to package into the installer. */
  sourcePaths: string[]
  /** Absolute path to an optional `.txt`/`.rtf` license file shown before install. */
  licensePath?: string
  /** Absolute path to an optional `.ico` file for the installer/uninstaller/shortcuts. */
  iconPath?: string
}

export function defaultNsisLocalPaths(): NsisLocalPaths {
  return { sourcePaths: [] }
}

/** True when the spec has enough to render a script a real `makensis` run could act on. This is
 *  advisory-only: the preview renders regardless, with inline placeholders for what is missing,
 *  because a guided form should always show its user *something*, never an empty box, while still
 *  saying plainly what remains to fill in. */
export function nsisSpecIsComplete(spec: NsisSpec, local: NsisLocalPaths): boolean {
  return (
    spec.appName.trim().length > 0 &&
    spec.version.trim().length > 0 &&
    local.sourcePaths.length > 0
  )
}
