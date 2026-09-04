/**
 * Take the leaf from a recorded absolute path using the path's own syntax, not the OS running
 * this process, and WITHOUT importing `node:path` — the renderer bundle has no node builtins, and
 * a project name derived from a folder is one of the places this rule is needed most.
 *
 * Recorded paths outlive and cross the machine that wrote them: a native `basename` parses a
 * Deen No record incorrectly on Linux, and parses a legal backslash in a POSIX filename
 * incorrectly on Windows.
 *
 * Drive-absolute and UNC syntax are unambiguously Windows-shaped. Everything else uses POSIX
 * rules; in particular, an unqualified backslash remains filename text rather than guessed
 * Windows structure.
 *
 * This is the ONE definition. `src/core/path-basename.ts` re-exports it so both sides of the
 * CorePlatform seam and the renderer cannot drift apart — a second copy is exactly the class of
 * defect that let three project-name call sites split a Windows path on `/` alone and hand the
 * whole path back as the leaf.
 */

const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_ABSOLUTE = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/

/** True when the string's own syntax is unambiguously Windows-shaped. */
export function isWindowsPathSyntax(value: string): boolean {
  return WINDOWS_DRIVE_ABSOLUTE.test(value) || WINDOWS_UNC_ABSOLUTE.test(value)
}

/** The separators that count as structure for a path written in this dialect. */
function separatorsFor(value: string): RegExp {
  return isWindowsPathSyntax(value) ? /[\\/]/ : /\//
}

/**
 * The last non-empty segment, or `''` for a root. Matches `path.win32.basename` /
 * `path.posix.basename` for the shapes this application records (absolute folders and files);
 * it deliberately does not reproduce node's Windows drive-relative (`C:foo`) handling, which no
 * recorded project cwd uses.
 */
export function basenameForPathSyntax(value: string): string {
  const parts = value.split(separatorsFor(value)).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  // `C:` is the drive, never a folder name — a drive root has no leaf.
  return isWindowsPathSyntax(value) && parts.length === 1 && /^[A-Za-z]:$/.test(last) ? '' : last
}

/**
 * Trim trailing separators so one folder maps to one key, in the path's own dialect. A Windows
 * path keeps its trailing `\` under a POSIX-only trim, which is enough to make `C:\foo` and
 * `C:\foo\` two different projects for the same folder.
 */
export function normalizePathTail(value: string): string {
  if (value.length <= 1) return value
  const trimmed = isWindowsPathSyntax(value) ? value.replace(/[\\/]+$/, '') : value.replace(/\/+$/, '')
  // Never trim a bare root away: `C:\` and `/` must survive.
  return trimmed.length > 0 && !/^[A-Za-z]:$/.test(trimmed) ? trimmed : value
}
