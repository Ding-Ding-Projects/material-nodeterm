import { posix, win32 } from 'path'

const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_ABSOLUTE = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/

/**
 * Take the leaf from a recorded absolute path using the path's own syntax, not the OS running
 * this process. Transcript and tool records can outlive or cross the machine that wrote them: a
 * native `basename` therefore parses a Windows record incorrectly on Linux and parses a legal
 * backslash in a POSIX filename incorrectly on Windows.
 *
 * Drive-absolute and UNC syntax are unambiguously Windows-shaped. Everything else uses POSIX
 * rules; in particular, an unqualified backslash remains filename text rather than guessed
 * Windows structure.
 */
export function basenameForPathSyntax(value: string): string {
  const dialect = WINDOWS_DRIVE_ABSOLUTE.test(value) || WINDOWS_UNC_ABSOLUTE.test(value)
    ? win32
    : posix
  return dialect.basename(value)
}
