// Route 1: build a generated NSIS script locally, via a real makensis.exe.
//
// Deliberately takes the RENDERED SCRIPT as a plain string. A sibling pig owns the typed spec
// and `renderNsis(spec)` under `src/core/nsis/` -- this module never imports from it, so it
// has no compile-time dependency on work that doesn't exist in this worktree yet.
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { findMakensis, type FindMakensisDeps, type MakensisResult } from './find-makensis'

const execFileP = promisify(execFile)

export interface LocalBuildInput {
  /** The complete, already-rendered .nsi script text. */
  script: string
  /** Absolute path the compiled installer is expected to appear at (an `OutFile` target). */
  outputPath: string
  /** Working directory makensis should compile from (so relative `File` directives resolve). */
  cwd: string
}

export interface LocalBuildResult {
  ok: boolean
  /** Why it failed, when it did. */
  reason?: 'makensis-not-found' | 'compile-failed' | 'no-output'
  exitCode: number | null
  stdout: string
  stderr: string
  outputPath: string
  outputBytes: number | null
  makensis: MakensisResult
}

/** Runs the actual compile step. Injected in tests; never a shell string -- always an argv array. */
type RunCompile = (
  file: string,
  args: string[],
  cwd: string
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface LocalBuildDeps {
  /** Deps forwarded to findMakensis (its own `run`/`exists`/`platform` seam). */
  find?: FindMakensisDeps
  /** Runs the compile step. Separate from findMakensis's probe `run` (different signature). */
  run?: RunCompile
  writeFile?: (p: string, data: string) => Promise<void>
  statSize?: (p: string) => number | null
  tmpDir?: () => string
}

/**
 * Compile a rendered NSIS script locally. Never claims success from a zero exit code alone:
 * a script with no `OutFile` (or one that lands somewhere unexpected) exits 0 and produces
 * nothing, so the output file is verified to exist and be non-empty before this reports ok.
 */
export async function buildLocal(
  input: LocalBuildInput,
  deps: LocalBuildDeps = {}
): Promise<LocalBuildResult> {
  const makensis = await findMakensis(deps.find)
  if (!makensis.found) {
    return {
      ok: false,
      reason: 'makensis-not-found',
      exitCode: null,
      stdout: '',
      stderr: '',
      outputPath: input.outputPath,
      outputBytes: null,
      makensis,
    }
  }

  const writeFile =
    deps.writeFile ?? (async (p, data) => fs.promises.writeFile(p, data, 'utf8'))
  const statSize =
    deps.statSize ??
    ((p: string): number | null => {
      try {
        const st = fs.statSync(p)
        return st.isFile() ? st.size : null
      } catch {
        return null
      }
    })
  const tmpDir = deps.tmpDir ?? (() => os.tmpdir())
  const run: RunCompile =
    deps.run ??
    (async (file, args, cwd) => {
      try {
        const { stdout, stderr } = await execFileP(file, args, { cwd, timeout: 300_000 })
        return { exitCode: 0, stdout, stderr }
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string }
        return {
          exitCode: typeof e.code === 'number' ? e.code : 1,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? String(err),
        }
      }
    })

  // Write the rendered script to a scratch file so makensis can compile it as an ARGUMENT
  // ARRAY entry, never interpolated into a shell string.
  const scriptPath = path.join(
    tmpDir(),
    `nsis-build-${Date.now()}-${Math.random().toString(36).slice(2)}.nsi`
  )
  await writeFile(scriptPath, input.script)

  const { exitCode, stdout, stderr } = await run(makensis.execPath, [scriptPath], input.cwd)

  if (exitCode !== 0) {
    return {
      ok: false,
      reason: 'compile-failed',
      exitCode,
      stdout,
      stderr,
      outputPath: input.outputPath,
      outputBytes: null,
      makensis,
    }
  }

  const outputBytes = statSize(input.outputPath)
  if (outputBytes === null || outputBytes <= 0) {
    return {
      ok: false,
      reason: 'no-output',
      exitCode,
      stdout,
      stderr,
      outputPath: input.outputPath,
      outputBytes,
      makensis,
    }
  }

  return {
    ok: true,
    exitCode,
    stdout,
    stderr,
    outputPath: input.outputPath,
    outputBytes,
    makensis,
  }
}
