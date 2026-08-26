// The security half of NSIS generation.
//
// An .nsi script is executable: NSIS's compiler (makensis) interprets it as a program, not data.
// Every string in NsisInstallerSpec came from a form a user typed into, so every one of them is
// hostile input at this boundary — exactly the same posture this repo takes everywhere a value can
// reach a command line or an interpreted script (see approval-mode.ts's isPermissionMode
// re-validation, or the shell-quoting rules for remote ssh commands).
//
// Two separate defenses, and they answer different questions:
//   1. `nsisString()` — ESCAPE. Any text NSIS will treat as a *string literal* (a window title, an
//      app name, a publisher) is escaped so it cannot close the string early. NSIS string escapes
//      (double-quoted strings only) are backslash-based: $\" for a literal quote, $\r / $\n / $\t
//      for control chars, and $$ for a literal `$` — because unescaped `$` starts a variable
//      reference ($INSTDIR, $\{...} for constants) or an NSIS `!define`-style substitution.
//      Escaping a literal is *always safe*: it changes what the string contains, never what the
//      script does structurally.
//   2. REFUSAL — some values can NEVER be made safe by escaping, because escaping only protects a
//      string *literal*, and these values are used in positions where NSIS syntax itself (not a
//      string) is what's unsafe: an install root that selects which top-level macro gets emitted,
//      a file path that is spliced into `File` / `SetOutPath` directives where `..` can walk the
//      generated build out of the project directory, a version that must satisfy
//      VIProductVersion's four-integer grammar. These are refused outright rather than
//      "sanitised and continued" — silently substituting a default for a bad install root, or
//      silently clipping a `..` out of a path, hides a bug (or an attack) from the caller instead
//      of surfacing it.
//
// The type system (NsisInstallRoot, NsisCompression, ...) only proves this at COMPILE time. A
// value can arrive here from JSON, from a form, from a spec built by code that doesn't go through
// the TypeScript surface at all — so every one of these is re-checked against its real, narrow
// vocabulary at render time, the same discipline `permissionModeFlag` uses for permission modes
// before they reach a `tmux send-keys` command line.

import { isNsisCompression, isNsisInstallRoot, isNsisInstallScope } from './spec'
import type { NsisCompression, NsisInstallRoot, NsisInstallScope } from './spec'

/** Thrown for anything this module refuses to render. Never caught-and-defaulted by the renderer —
 *  a refusal here is meant to reach the caller, not be swallowed into a sanitised guess. */
export class NsisSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NsisSpecError'
  }
}

function refuse(message: string): never {
  throw new NsisSpecError(message)
}

/** Escape a value for interpolation *inside* a double-quoted NSIS string literal, without adding
 *  the surrounding quotes itself. This is the piece both `nsisString()` and `nsisQuoted()` share:
 *  every character NSIS treats specially inside a quoted string is neutralised —
 *    "  -> $\"      (closes the string)
 *    $  -> $$       (starts a variable reference like $INSTDIR, or a ${...} constant expansion)
 *    \n -> $\n      (a raw newline would break the script's own line structure)
 *    \r -> $\r
 *    \t -> $\t
 *  A bare `\` is NOT special in NSIS string literals (unlike C or shell strings — NSIS has no
 *  general backslash-escaping outside the `$\x` forms above), so it is passed through unchanged.
 *  Order matters: `$` must be escaped BEFORE the control-character escapes are introduced, or the
 *  literal `$` inside the `$\"`/`$\n`/etc. this function emits would get re-escaped into `$$\"`. */
export function nsisEscapeFragment(value: string): string {
  let out = ''
  for (const ch of value) {
    switch (ch) {
      case '$':
        out += '$$'
        break
      case '"':
        out += '$\\"'
        break
      case '\r':
        out += '$\\r'
        break
      case '\n':
        out += '$\\n'
        break
      case '\t':
        out += '$\\t'
        break
      default:
        out += ch
    }
  }
  return out
}

/** Escape a string for a full double-quoted NSIS string literal — the boundary for any value
 *  that is ENTIRELY untrusted text (an app name, a publisher, a folder name typed into a form).
 *  See `nsisEscapeFragment()` for exactly what is neutralised and why. */
export function nsisString(value: string): string {
  return `"${nsisEscapeFragment(value)}"`
}

/** One piece of a mixed string literal: either `raw` NSIS syntax that must reach the output
 *  UNESCAPED — an `$INSTDIR`-style built-in variable reference, always drawn from a closed,
 *  code-controlled table rather than user text — or `text` that is untrusted and must be escaped
 *  like any other free-text field. Never construct a `raw` part from anything a user typed. */
export type NsisQuotedPart = { readonly raw: string } | { readonly text: string }

/** Build one double-quoted NSIS string literal out of a mix of trusted raw NSIS syntax (an
 *  `$INSTDIR`/`$SMPROGRAMS`/`$DESKTOP` variable reference) and untrusted text (a user-typed
 *  sub-path segment). This exists because `nsisString()` alone cannot express "$INSTDIR should
 *  expand at install time, but the folder name appended after it should not be able to close the
 *  string or reference a variable of its own" — running the WHOLE mixed value through
 *  `nsisString()` would escape the `$` in `$INSTDIR` too, turning a live variable reference into
 *  the literal four characters `$INSTDIR`. Each `raw` part must come only from this module's own
 *  closed tables (nsisInstallRootVar, or a literal like '$INSTDIR\\'), never from a spec field. */
export function nsisQuoted(parts: readonly NsisQuotedPart[]): string {
  const inner = parts.map((part) => ('raw' in part ? part.raw : nsisEscapeFragment(part.text))).join('')
  return `"${inner}"`
}

const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/

/** True for a plain dotted-numeric version with 1-4 integer fields (each 0-65535, NSIS's own
 *  VIProductVersion field limit) — "1.2.3", "2.0", "0.4.0.1". Anything else (pre-release tags,
 *  build metadata, non-numeric fields) is refused rather than coerced, because there is no single
 *  correct way to fold "1.2.3-beta.1" into NSIS's four-integer scheme without silently discarding
 *  information the caller might care about. */
export function isValidNsisVersion(value: string): boolean {
  if (!VERSION_RE.test(value)) return false
  return value.split('.').every((part) => Number(part) <= 65535)
}

/** Pad a validated version to exactly four dot-separated fields, as VIProductVersion requires. */
export function padVersionToFour(value: string): string {
  const parts = value.split('.')
  while (parts.length < 4) parts.push('0')
  return parts.join('.')
}

function isTraversalSafe(candidate: string): boolean {
  if (candidate.length === 0) return true
  if (candidate.startsWith('/') || candidate.startsWith('\\')) return false
  // A Windows drive-letter absolute path ("C:\...") or a UNC path ("\\host\share").
  if (/^[A-Za-z]:[\\/]/.test(candidate)) return false
  if (candidate.startsWith('\\\\')) return false
  const segments = candidate.split(/[\\/]+/)
  return segments.every((segment) => segment !== '..')
}

/** Refuse an absolute path or one containing a `..` segment. Used for every path field on the
 *  spec (source files, license, icon, dest sub-paths, install sub-path): the generated script
 *  places these under a project directory the caller controls, and a `..` segment — or an
 *  absolute path outright — could walk `File` / `SetOutPath` directives out of that directory
 *  and package (or overwrite, on install) something the caller never intended. Refused, not
 *  clipped: silently stripping the `..` segments out of "../../etc/passwd" still leaves behind a
 *  path nobody asked for, and hides that the input was hostile. */
export function assertSafeRelativePath(value: string, fieldName: string): string {
  if (!isTraversalSafe(value)) {
    refuse(
      `${fieldName} must be a relative path inside the project directory ` +
        `(no absolute path, no ".." segment); got ${JSON.stringify(value)}`
    )
  }
  return value
}

/** Re-validate an install root against its real closed vocabulary rather than trusting the
 *  compile-time type. Refuses rather than substitutes a default: silently falling back to
 *  $PROGRAMFILES64 for an unrecognised root would install to a location the caller never chose. */
export function assertNsisInstallRoot(value: unknown): NsisInstallRoot {
  if (!isNsisInstallRoot(value)) {
    refuse(`Unrecognised NSIS install root: ${JSON.stringify(value)}`)
  }
  return value
}

export function assertNsisCompression(value: unknown): NsisCompression {
  if (!isNsisCompression(value)) {
    refuse(`Unrecognised NSIS compression: ${JSON.stringify(value)}`)
  }
  return value
}

export function assertNsisInstallScope(value: unknown): NsisInstallScope {
  if (!isNsisInstallScope(value)) {
    refuse(`Unrecognised NSIS install scope: ${JSON.stringify(value)}`)
  }
  return value
}

const INSTALL_ROOT_VARS: Record<NsisInstallRoot, string> = {
  programFiles64: '$PROGRAMFILES64',
  programFiles32: '$PROGRAMFILES',
  localAppData: '$LOCALAPPDATA',
  appData: '$APPDATA'
}

/** Map a validated install root to the NSIS built-in variable that expands to it. This is NOT a
 *  string-literal boundary — the result is emitted as raw NSIS source (`InstallDir "$PROGRAMFILES64\..."`),
 *  so it must come only from this closed table, never from user text. */
export function nsisInstallRootVar(root: NsisInstallRoot): string {
  return INSTALL_ROOT_VARS[assertNsisInstallRoot(root)]
}

const COMPRESSION_DIRECTIVES: Record<NsisCompression, string> = {
  zlib: 'SetCompressor zlib',
  bzip2: 'SetCompressor bzip2',
  lzma: 'SetCompressor lzma',
  off: 'SetCompress off'
}

export function nsisCompressionDirective(compression: NsisCompression): string {
  return COMPRESSION_DIRECTIVES[assertNsisCompression(compression)]
}
