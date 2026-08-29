import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Report Visual Studio C++ installations whose effective toolset cannot link the native modules
 * this repository builds. The helper is separate from the executable preflight so the decision
 * can be exercised without importing a script whose success/failure contract calls process.exit.
 *
 * An unknown layout stays non-blocking: a failed probe is not proof that the libraries are absent.
 */
export function spectreLibComplaints(options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const execFile = options.execFile
  const fs = options.fs ?? { readdir: readdirSync }
  const programFilesX86 =
    options.programFilesX86 ?? process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  if (platform !== 'win32') return []
  if (typeof execFile !== 'function') {
    throw new TypeError('spectreLibComplaints requires an execFile implementation')
  }

  // ARM64 builds native npm dependencies for the host and this repository also packages x64.
  const requiredArchitectures = arch === 'arm64' ? ['x86', 'x64', 'arm64'] : ['x86', 'x64']
  let installs
  try {
    const vswhere = join(
      programFilesX86,
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    )
    installs = JSON.parse(
      execFile(vswhere, ['-products', '*', '-format', 'json'], {
        encoding: 'utf8',
        timeout: 20_000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    )
  } catch {
    return [] // no vswhere, or it refused — cannot tell, so do not block
  }
  if (!Array.isArray(installs)) return []

  const supportedInstalls = installs
    .filter(
      (inst) =>
        inst &&
        typeof inst === 'object' &&
        typeof inst.installationPath === 'string' &&
        /^17(?:\.|$)/.test(String(inst.installationVersion ?? ''))
    )
    .sort((a, b) =>
      String(b.installationVersion).localeCompare(String(a.installationVersion), 'en', {
        numeric: true,
        sensitivity: 'base'
      })
    )

  // Match the helper/node-gyp choice: inspect the newest supported VS 2022 instance that actually
  // has a C++ toolset. VS 2019 or an older complete instance must not hide a broken VS 2022.
  for (const inst of supportedInstalls) {
    const msvc = join(inst.installationPath, 'VC', 'Tools', 'MSVC')
    let toolsets
    try {
      toolsets = fs.readdir(msvc, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    } catch (error) {
      if (error?.code === 'ENOENT') continue // not a C++ install; nothing to say about it
      return [] // failed read is unknown, never evidence of absence
    }
    if (toolsets.length === 0) continue

    // MSBuild selects the latest/default toolset. An older mitigated directory (or an empty one
    // left by an interrupted install) cannot make that effective toolset usable.
    const selected = [...toolsets].sort((a, b) =>
      b.name.localeCompare(a.name, 'en', { numeric: true, sensitivity: 'base' })
    )[0]
    const missing = []
    for (const libraryArch of requiredArchitectures) {
      try {
        const entries = fs.readdir(join(msvc, selected.name, 'lib', 'spectre', libraryArch), {
          withFileTypes: true
        })
        if (!entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.lib'))) {
          missing.push(libraryArch)
        }
      } catch (error) {
        if (error?.code === 'ENOENT') missing.push(libraryArch)
        else return [] // unreadable is unknown; do not turn it into a false missing-libs claim
      }
    }
    if (missing.length > 0) {
      return [
        `${inst.displayName ?? inst.installationPath} — toolset ${selected.name} has no real ` +
          `Spectre .lib files for ${missing.join(', ')}`
      ]
    }
    return []
  }
  return []
}
