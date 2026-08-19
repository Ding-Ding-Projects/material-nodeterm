/**
 * Detecting a usable local Java runtime, for the Java-compatibility check `version-resolve.ts`
 * already has the pure half of (`checkJavaCompatibility`). This file supplies the other half:
 * which `java` this machine actually has, and what major version it reports.
 *
 * Two pieces, kept apart on purpose so the one worth unit-testing (parsing) never needs a real
 * process:
 *
 *  - `parseJavaMajorVersion` — pure. `java -version` (and the newer `--version`) print to STDERR,
 *    and the quoted version string has had two shapes in the wild: the pre-Java-9 scheme
 *    (`java version "1.8.0_301"`, major is the SECOND dotted component) and Java 9+
 *    (`openjdk version "17.0.2" 2022-01-18` or a bare `"21"`, major is the FIRST). Anything else
 *    returns `null` rather than a guess — a wrong major fed into `checkJavaCompatibility` would
 *    produce a confidently WRONG verdict, which is worse than an honestly unknown one.
 *  - `detectInstalledJava` — resolves an executable (PATH, then `JAVA_HOME`, via the same
 *    subprocess-free `findExecutableSync` GUI apps already use to find `git`/`code`/`ssh`) and
 *    verifies it the way `vscode-detect.ts` verifies VS Code: by actually running it, never by a
 *    path merely existing.
 *
 * DELIBERATELY NOT DONE HERE: scanning `Program Files\Java\*` / `/usr/lib/jvm/*` for an install
 * nothing put on PATH or JAVA_HOME. Every mainstream Java distribution's installer offers to set
 * one of those two, so this covers the common case honestly; a JDK installed with both declined is
 * reported as "no Java could be detected", not silently found by guessing at a version-numbered
 * directory name. See docs/minecraft-server-manager.md.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { findExecutableSync } from '../exec-path'

const execFileP = promisify(execFile)

export function parseJavaMajorVersion(output: string): number | null {
  const m = output.match(/version\s+"([^"]+)"/)
  if (!m) return null
  const v = m[1]
  const legacy = v.match(/^1\.(\d+)(?:[._].*)?$/)
  if (legacy) return Number(legacy[1])
  const modern = v.match(/^(\d+)/)
  return modern ? Number(modern[1]) : null
}

function javaHomeCandidate(): string | null {
  const home = process.env.JAVA_HOME
  if (!home) return null
  return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
}

/** Subprocess-free — a PATH/JAVA_HOME walk with an access check, same as every other executable
 *  lookup in this codebase. Never spawns, so it is safe to call from the main thread. */
export function resolveJavaExecutable(): string | null {
  const home = javaHomeCandidate()
  return findExecutableSync('java', home ? [home] : [])
}

export interface JavaProbe {
  path: string | null
  major: number | null
}

/** Injected so `detectInstalledJava` never needs a real process in a test. Production runs
 *  `<javaPath> -version` and reads BOTH streams: `-version`'s banner is on stderr for every
 *  distribution measured, but a stray ancient JVM or a shell wrapper writing to stdout should
 *  still parse rather than reporting "no Java" for a Java that is plainly right there. */
export type RunJavaVersion = (javaPath: string) => Promise<string>

const defaultRunJavaVersion: RunJavaVersion = async (javaPath) => {
  try {
    const { stderr, stdout } = await execFileP(javaPath, ['-version'], {
      timeout: 8000,
      windowsHide: true
    })
    return `${stderr}\n${stdout}`
  } catch (e) {
    // A nonzero exit (some antique or misconfigured JVMs) can still carry the version banner on
    // one of the streams — Node attaches both to the thrown error. Read them rather than treating
    // any nonzero exit as "no Java at all".
    const err = e as { stderr?: string; stdout?: string }
    return `${err.stderr ?? ''}\n${err.stdout ?? ''}`
  }
}

export async function detectInstalledJava(
  resolve: () => string | null = resolveJavaExecutable,
  run: RunJavaVersion = defaultRunJavaVersion
): Promise<JavaProbe> {
  const javaPath = resolve()
  if (!javaPath) return { path: null, major: null }
  const output = await run(javaPath)
  return { path: javaPath, major: parseJavaMajorVersion(output) }
}
