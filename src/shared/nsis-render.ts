/**
 * Thin adapter: NSIS installer-builder node form state -> the canonical `renderNsis`.
 *
 * This USED to be a second, independent renderer, written because the UI lane was developed in a
 * worktree where the canonical `src/core/nsis` implementation (typed spec + escape boundary +
 * pure renderer) did not exist. That implementation has since moved to `src/shared/nsis/` (see
 * that directory's `spec.ts` for why it lives here rather than in `src/core`: `src/shared` is
 * imported by main, the renderer AND core, so the canonical implementation has to live at that
 * lower layer for `src/core` to re-export it without inverting the dependency direction). There
 * is now exactly ONE NSIS renderer in this repo -- this file only translates shapes and calls it.
 *
 * WHY TWO SHAPES, NOT ONE:
 *  - `NsisSpec` (this module's sibling `nsis-form-types.ts`) is the GIT-SHARED half: app name,
 *    version, publisher, output filename, install root, shortcut/uninstaller/compression choices.
 *    None of it names anything on local disk, so it lives in `.nodeterm/project.json`.
 *  - `NsisLocalPaths` is the MACHINE-LOCAL half: absolute source/license/icon paths on THIS
 *    machine, round-tripped through `LocalNodeExec.nsisLocalPaths` instead, exactly like a
 *    service node's `serviceConnection` -- see that file's doc comment for the full reasoning.
 *  - The canonical `NsisInstallerSpec` (src/shared/nsis/spec.ts) has no such split; it is built
 *    for the ACTUAL render step, where both halves need to be present at once. This adapter is
 *    where they are combined -- only in memory, at render time -- and it is combined nowhere
 *    else: neither half is ever persisted in the other's shape.
 *
 * WHY THE PREVIEW CAN LEGITIMATELY SHOW A REFUSAL, NOT A SCRIPT:
 *  The canonical renderer REFUSES rather than sanitises anything it cannot make safe by escaping
 *  (see `src/shared/nsis/escape.ts`): an empty app name, an invalid version, an install root
 *  outside its closed vocabulary, and -- the one that matters most here -- any item/license/icon
 *  path that is absolute or contains a `..` segment. `NsisLocalPaths` fields are, by design,
 *  absolute paths a native file picker handed back. Passing them straight through as the
 *  canonical spec's `sourcePath`/`licenseFile`/`iconFile` (which the real build step expects
 *  relative to a project root it will pass as `cwd` to `buildLocal`) is therefore expected to
 *  refuse until a later change threads that project root through this node. That refusal is a
 *  FIRST-CLASS outcome, not an exception this module tries to route around: `renderNsisPreview`
 *  catches `NsisSpecError` and returns a readable "why this can't render yet" block instead of
 *  letting the error escape into a React render. It is deliberately NOT sanitised into a fake
 *  relative path here either -- doing that would silently disagree with what a real build of this
 *  spec would do, which is exactly the kind of drift the security boundary in escape.ts exists to
 *  prevent.
 */

import { NsisSpecError } from './nsis/escape'
import { renderNsis } from './nsis/render'
import type {
  NsisInstallerSpec,
  NsisInstallItem,
  NsisInstallRoot as CoreInstallRoot,
  NsisCompression as CoreCompression,
} from './nsis/spec'
import type {
  NsisCompression,
  NsisInstallRoot,
  NsisLocalPaths,
  NsisSpec,
} from './nsis-form-types'

const INSTALL_ROOT_MAP: Record<NsisInstallRoot, { root: CoreInstallRoot; subPrefix?: string }> = {
  'program-files-64': { root: 'programFiles64' },
  'program-files-32': { root: 'programFiles32' },
  'local-app-data': { root: 'localAppData' },
  // The canonical spec has no distinct "$LOCALAPPDATA\Programs" root -- it is a subfolder of
  // localAppData, so it is expressed as an install sub-path prefix under that same root rather
  // than inventing a fifth core root for one UI-side convenience option.
  'per-user-program-files': { root: 'localAppData', subPrefix: 'Programs' },
}

const COMPRESSION_MAP: Record<NsisCompression, CoreCompression> = {
  lzma: 'lzma',
  zlib: 'zlib',
  bzip2: 'bzip2',
  none: 'off',
}

function safeOutputFileName(spec: NsisSpec): string {
  const trimmed = spec.outputFileName.trim()
  if (trimmed) return trimmed
  const base = spec.appName.trim() || 'App'
  return base.replace(/[^A-Za-z0-9._-]+/g, '-') + '-Setup.exe'
}

/** Map the node's form state onto the canonical spec. Deliberately does NOT try to make
 *  `NsisLocalPaths`' absolute paths relative-safe -- see the file header for why that would be
 *  the wrong fix here. */
function toInstallerSpec(spec: NsisSpec, local: NsisLocalPaths): NsisInstallerSpec {
  const appName = spec.appName.trim() || 'Your App'
  const { root, subPrefix } = INSTALL_ROOT_MAP[spec.installRoot]
  const installSubPath = subPrefix ? `${subPrefix}\\${appName}` : appName

  const items: NsisInstallItem[] = local.sourcePaths.map((sourcePath) => ({
    sourcePath,
    // Every source path this adapter receives is opaque -- NsisLocalPaths carries no per-entry
    // file/directory flag -- so this defaults to the recursive form the pre-unification preview
    // always used. It is moot in practice today: absolute paths refuse before this distinction is
    // ever reached (see renderInstallItem in src/shared/nsis/render.ts).
    isDirectory: true,
  }))

  return {
    appName,
    version: spec.version.trim() || '0.0.0',
    publisher: spec.publisher.trim(),
    outFile: safeOutputFileName(spec),
    installRoot: root,
    installSubPath,
    items,
    licenseFile: local.licensePath,
    iconFile: local.iconPath,
    mainExecutable: `${appName}.exe`,
    startMenuShortcut: spec.createStartMenuShortcut ? { enabled: true } : undefined,
    desktopShortcut: spec.createDesktopShortcut ? { enabled: true } : undefined,
    generateUninstaller: spec.includeUninstaller,
    installScope: spec.perMachine ? 'perMachine' : 'perUser',
    compression: COMPRESSION_MAP[spec.compression],
  }
}

function refusalBlock(message: string): string {
  return [
    "; Can't render a full NSIS script yet:",
    `;   ${message}`,
    ';',
    '; This is a real refusal from the NSIS renderer\'s security boundary (src/shared/nsis/escape.ts),',
    '; not a bug in the preview -- it never silently substitutes or clips an unsafe value. Fix the',
    '; field(s) named above and the preview will render the real script.',
  ].join('\n')
}

/**
 * Renders a preview `.nsi` script from the node's form state, via the canonical `renderNsis`.
 * Always produces SOMETHING -- a real script, or (for anything the canonical renderer legitimately
 * refuses) a readable explanation of exactly what to fix -- never an empty box and never an
 * uncaught exception reaching the component that calls this.
 */
export function renderNsisPreview(spec: NsisSpec, local: NsisLocalPaths): string {
  const mapped = toInstallerSpec(spec, local)
  try {
    return renderNsis(mapped)
  } catch (err) {
    if (err instanceof NsisSpecError) {
      return refusalBlock(err.message)
    }
    throw err
  }
}
