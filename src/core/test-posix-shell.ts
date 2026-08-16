import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve the real POSIX shell used by behavioral shell-script tests.
 *
 * Windows does not normally put Git for Windows' `sh.exe` on PATH. Requiring a developer to
 * mutate their global PATH made `npm test` fail before it exercised any generated script, while
 * falling back to cmd/PowerShell would test a different language. Keep using a real POSIX shell;
 * locate the installed Git shell explicitly and fail with an actionable error when none exists.
 */
function resolveWindowsPosixShell(): string {
  const candidates: Array<string | undefined> = [
    process.env.SHELL,
    ...(process.env.PATH ?? '').split(path.delimiter).flatMap((entry) =>
      entry ? [path.join(entry, 'sh.exe'), path.join(entry, 'sh')] : []
    ),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'sh.exe'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'sh.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'sh.exe'),
    process.env.USERPROFILE &&
      path.join(process.env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'sh.exe')
  ]

  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue
    if (!/^sh(?:\.exe)?$/iu.test(path.basename(candidate))) continue
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate)
    } catch {
      // An unreadable candidate is not evidence that another standard location is unavailable.
    }
  }

  throw new Error(
    'The behavioral POSIX-shell tests require Git for Windows sh.exe. Install Git for Windows ' +
      'or set SHELL to its absolute sh.exe path.'
  )
}

export const POSIX_TEST_SHELL =
  process.platform === 'win32' ? resolveWindowsPosixShell() : '/bin/sh'

/** Convert a native Windows path to the MSYS mount spelling used inside Git sh. */
export function posixTestPath(nativePath: string): string {
  if (process.platform !== 'win32') return nativePath
  return nativePath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`)
}

/**
 * Build PATH as the spawned POSIX shell parses it. `path.delimiter` is `;` on Windows, but once
 * the value reaches Git sh it must be colon-separated and every native entry must be MSYS-shaped.
 */
export function posixTestEnvPath(prepend: string[] = []): string {
  if (process.platform !== 'win32') {
    return [...prepend, process.env.PATH ?? ''].filter(Boolean).join(':')
  }

  const inherited = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(posixTestPath)

  // Git sh supplies these virtual mount points even when Git's native folders were not inherited
  // through PATH. Naming them explicitly keeps curl, cat, sleep, and tee available to fixtures.
  return [...prepend.map(posixTestPath), '/usr/bin', '/mingw64/bin', ...inherited].join(':')
}

/**
 * Run one generated script after resetting PATH inside the already-started Git shell. Git's
 * startup prepends its own `/mingw64/bin` (including real curl) ahead of the inherited value, so
 * an inherited fixture directory alone cannot shadow a command. The tiny wrapper changes only
 * PATH, then `exec`s the real script with every argv element preserved as a distinct shell word.
 */
export function posixTestScriptArgs(
  script: string,
  args: string[] = [],
  prepend: string[] = []
): string[] {
  return [
    '-c',
    'PATH=$1; export PATH; shift; exec "$@"',
    'nodeterm-test-shell',
    posixTestEnvPath(prepend),
    script,
    ...args
  ]
}
