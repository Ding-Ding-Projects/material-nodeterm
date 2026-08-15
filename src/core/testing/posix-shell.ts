import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

/**
 * Test-fixture adapter for generated POSIX shell.
 *
 * Native Node on Windows launches Git for Windows' `sh.exe`, but Node and that shell do not see
 * paths in the same spelling. Keep the boundary explicit: command lookup receives a native PATH,
 * while path values consumed by the shell use MSYS' `/c/...` spelling. Mixing the two is how a
 * fake executable silently falls off PATH and a test exercises the real executable instead.
 */
interface PosixShellResolution {
  executable: string
  runtimeBins: string[]
}

function resolveRealPosixShell(): PosixShellResolution {
  if (process.platform !== 'win32') return { executable: '/bin/sh', runtimeBins: [] }
  try {
    // `git` is already a project prerequisite and Git for Windows exposes it through Git\cmd even
    // when Git\usr\bin is absent from PATH. Walk up from its own exec path instead of assuming an
    // installation directory.
    let cursor = resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim())
    for (let depth = 0; depth < 6; depth++) {
      for (const candidate of [join(cursor, 'usr', 'bin', 'sh.exe'), join(cursor, 'bin', 'sh.exe')]) {
        if (existsSync(candidate)) {
          return {
            executable: candidate,
            runtimeBins: [join(cursor, 'usr', 'bin'), join(cursor, 'mingw64', 'bin')]
              .filter(existsSync)
          }
        }
      }
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
  } catch {
    // Fall through to PATH: another POSIX-compatible sh may still be installed.
  }
  return { executable: 'sh', runtimeBins: [] }
}

const shellResolution = resolveRealPosixShell()
export const REAL_POSIX_SHELL = shellResolution.executable
export const REAL_SHELL_TEST_TIMEOUT_MS = 20_000

/** Supply the runtime tools next to the resolved Git Bash without mutating process.env. */
export function environmentForPosixShell(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform !== 'win32' || shellResolution.runtimeBins.length === 0) return { ...env }
  const inherited = env.PATH ?? process.env.PATH ?? ''
  return {
    ...env,
    PATH: [...shellResolution.runtimeBins, inherited].filter(Boolean).join(delimiter)
  }
}

/** Translate a host path into the spelling a real POSIX shell on that host can open. */
export function pathForPosixShell(nativePath: string, host = process.platform): string {
  if (host !== 'win32') return nativePath
  const slashed = nativePath.replace(/\\/g, '/')
  return slashed.replace(/^([A-Za-z]):(?=\/|$)/, (_, drive: string) => `/${drive.toLowerCase()}`)
}

/** Single-quote a host path after converting it for the shell. */
export function quotePathForPosixShell(nativePath: string, host = process.platform): string {
  const shellPath = pathForPosixShell(nativePath, host)
  return `'${shellPath.replace(/'/g, `'"'"'`)}'`
}

/** Convert only the environment values the generated script will consume as filesystem paths. */
export function pathsForPosixShellEnv(
  env: Record<string, string>,
  keys: readonly string[],
  host = process.platform
): Record<string, string> {
  const out = { ...env }
  for (const key of keys) {
    if (out[key]) out[key] = pathForPosixShell(out[key], host)
  }
  return out
}

/**
 * Arguments for running a generated script under the real shell. Git Bash prepends its own
 * `/mingw64/bin:/usr/bin` after native process creation, so a fake tool cannot reliably win by
 * editing the native PATH environment. Put the fixture directory first after the shell starts.
 */
export function posixShellScriptArgs(
  script: string,
  args: string[] = [],
  fixtureBin?: string
): string[] {
  const shellScript = pathForPosixShell(script)
  if (!fixtureBin) return [shellScript, ...args]
  return [
    '-c',
    'PATH="$1:$PATH"; shift; exec sh "$@"',
    'nodeterm-test-shell',
    pathForPosixShell(fixtureBin),
    shellScript,
    ...args
  ]
}
