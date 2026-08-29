// Locate the makensis(.exe) binary that actually compiles an NSIS script.
//
// Electron-free (src/core), so the Server Edition boots the same detection through
// CorePlatform. Never assume the tool is on PATH -- on this machine, as of writing, it is
// NOT -- so the "not found" branch is the one that actually runs in practice and must
// report something a user can act on rather than a bare boolean.
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileP = promisify(execFile)

export interface MakensisLocation {
  found: true
  /** Absolute path to the resolved makensis executable. */
  execPath: string
  /** Version string reported by `makensis /VERSION`, when it could be read. */
  version: string | null
}

export interface MakensisNotFound {
  found: false
  /** Every location that was checked and did not yield a usable makensis, in check order. */
  checked: string[]
}

export type MakensisResult = MakensisLocation | MakensisNotFound

/**
 * Windows install locations NSIS's own installer uses, newest-looking first. NSIS does not
 * publish a stable env var, so these are the well-known defaults rather than anything derived.
 */
function candidateInstallPaths(): string[] {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return [
    path.join(programFilesX86, 'NSIS', 'makensis.exe'),
    path.join(programFiles, 'NSIS', 'makensis.exe'),
  ]
}

async function tryVersion(execPath: string, run: RunExecFile): Promise<string | null> {
  try {
    const { stdout } = await run(execPath, ['/VERSION'])
    const v = stdout.trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

async function isExecutable(p: string, exists: (p: string) => boolean): Promise<boolean> {
  return exists(p)
}

type RunExecFile = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

export interface FindMakensisDeps {
  /** Defaults to a real child_process.execFile call. Inject a fake in tests. */
  run?: RunExecFile
  /** Defaults to fs.existsSync. Inject a fake in tests. */
  exists?: (p: string) => boolean
  platform?: NodeJS.Platform
}

/**
 * Resolution order: PATH first (respects an operator's own install/shim), then the usual
 * Windows install directories. Returns an exact list of everywhere we looked so a "not
 * found" result is something a user can act on.
 */
export async function findMakensis(deps: FindMakensisDeps = {}): Promise<MakensisResult> {
  const run = deps.run ?? (async (file, args) => execFileP(file, args, { timeout: 10_000 }))
  const exists = deps.exists ?? fs.existsSync
  const plat = deps.platform ?? process.platform

  const checked: string[] = []
  const binName = plat === 'win32' ? 'makensis.exe' : 'makensis'

  // 1. PATH.
  checked.push(`PATH (${binName})`)
  const pathVersion = await tryVersion(binName, run)
  if (pathVersion !== null) {
    return { found: true, execPath: binName, version: pathVersion }
  }

  // 2. Well-known Windows install locations.
  if (plat === 'win32') {
    for (const candidate of candidateInstallPaths()) {
      checked.push(candidate)
      if (!(await isExecutable(candidate, exists))) continue
      const version = await tryVersion(candidate, run)
      return { found: true, execPath: candidate, version }
    }
  }

  return { found: false, checked }
}
