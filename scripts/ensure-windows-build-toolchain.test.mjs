import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultRun, ensureWindowsBuildToolchain } from './ensure-windows-build-toolchain.mjs'

const BOOTSTRAPPER_BYTES = Buffer.from('Visual Studio Build Tools bootstrapper fixture\n')
const CONFIG = {
  workloadId: 'Microsoft.VisualStudio.Workload.VCTools',
  componentIds: ['Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre'],
  libraryArchitectures: ['x86', 'x64'],
  bootstrapperUrl:
    'https://download.visualstudio.microsoft.com/download/pr/fixture/vs_BuildTools.exe',
  bootstrapperSha256: createHash('sha256').update(BOOTSTRAPPER_BYTES).digest('hex')
}
const ARM64_CONFIG = {
  ...CONFIG,
  componentIds: [
    ...CONFIG.componentIds,
    'Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre'
  ],
  libraryArchitectures: ['x86', 'x64', 'arm64']
}
const VSWHERE_ARGS = ['-products', '*', '-format', 'json', '-utf8']
const VSWHERE_REQUIRE_ARGS = [...VSWHERE_ARGS, '-requires', CONFIG.workloadId]

const describeWindows = process.platform === 'win32' ? describe : describe.skip

describeWindows('Windows C++ build-toolchain bootstrap', () => {
  let root = ''
  let programFilesX86 = ''
  let installationPath = ''
  let vswhere = ''
  let setup = ''
  let toolset = ''

  beforeEach(() => {
    // The exclamation mark is deliberate: cmd delayed expansion used to eat everything after it.
    // Installer paths stay argv entries all the way through this helper and must survive unchanged.
    root = mkdtempSync(join(tmpdir(), 'nodeterm VS ! bootstrap '))
    programFilesX86 = join(root, 'Program Files (x86) !')
    installationPath = join(root, 'Visual Studio ! Build Tools')
    vswhere = join(
      programFilesX86,
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    )
    setup = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'setup.exe')
    toolset = join(installationPath, 'VC', 'Tools', 'MSVC', '14.44.35207')
    mkdirSync(toolset, { recursive: true })
    mkdirSync(join(programFilesX86, 'Microsoft Visual Studio', 'Installer'), { recursive: true })
    writeFileSync(vswhere, '')
    writeFileSync(setup, '')
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  function instanceJson() {
    return JSON.stringify([
      {
        installationPath,
        installationVersion: '17.14.37516.0',
        displayName: 'Visual Studio Build Tools 2022'
      }
    ])
  }

  function installSpectreLibraries(
    targetToolset = toolset,
    libraryArchitectures = CONFIG.libraryArchitectures
  ) {
    for (const arch of libraryArchitectures) {
      const dir = join(targetToolset, 'lib', 'spectre', arch)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'vcruntime.lib'), `${arch} fixture`)
    }
  }

  function quietReporter() {
    const logs = []
    const errors = []
    return {
      logs,
      errors,
      report: {
        log: (line) => logs.push(String(line)),
        error: (line) => errors.push(String(line))
      }
    }
  }

  it('quietly adds the channel-current Spectre component and verifies its files', () => {
    // Empty directories are a plausible interrupted-install residue and must not satisfy the probe.
    mkdirSync(join(toolset, 'lib', 'spectre', 'x86'), { recursive: true })
    mkdirSync(join(toolset, 'lib', 'spectre', 'x64'), { recursive: true })
    const invocations = []
    const output = quietReporter()
    const expectedArgs = [
      'modify',
      '--installPath',
      installationPath,
      '--add',
      CONFIG.workloadId,
      '--includeRecommended',
      '--add',
      CONFIG.componentIds[0],
      '--quiet',
      '--norestart'
    ]
    const run = (program, args) => {
      if (program === vswhere) {
        expect([VSWHERE_ARGS, VSWHERE_REQUIRE_ARGS]).toContainEqual(args)
        return { status: 0, stdout: instanceJson(), stderr: '' }
      }
      if (program === setup) {
        invocations.push({ program, args: [...args] })
        // This stub behaves like the real installer only for the exact safe invocation. Removing
        // --add, changing its component, losing --quiet, or inserting the setup-invalid --wait
        // leaves the filesystem unchanged and makes the independent verification fail.
        if (JSON.stringify(args) === JSON.stringify(expectedArgs)) installSpectreLibraries()
        return { status: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: true })
    expect(invocations).toEqual([{ program: setup, args: expectedArgs }])
    expect(expectedArgs).not.toContain('--wait')
    expect(expectedArgs[2]).toBe(installationPath)
    expect(output.logs.at(-1)).toContain('Installed and verified')
  })

  it('preserves spaces and exclamation marks across the real Windows spawn boundary', () => {
    const recorder = join(root, 'argv recorder !.mjs')
    const recorded = join(root, 'recorded argv !.json')
    writeFileSync(
      recorder,
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.ARGV_RECORD, JSON.stringify(process.argv.slice(2)))\n"
    )
    const expected = ['modify', '--installPath', installationPath, '--quiet', '--norestart']

    const result = defaultRun(process.execPath, [recorder, ...expected], {
      env: { ...process.env, ARGV_RECORD: recorded }
    })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(readFileSync(recorded, 'utf8'))).toEqual(expected)
  })

  it('adds and verifies ARM64 Spectre libraries without dropping the x64 packaging tools', () => {
    installSpectreLibraries(toolset, ['x86', 'x64'])
    mkdirSync(join(toolset, 'lib', 'spectre', 'arm64'), { recursive: true })
    const output = quietReporter()
    const setupCalls = []
    const expectedArgs = [
      'modify',
      '--installPath',
      installationPath,
      '--add',
      ARM64_CONFIG.workloadId,
      '--includeRecommended',
      '--add',
      ARM64_CONFIG.componentIds[0],
      '--add',
      ARM64_CONFIG.componentIds[1],
      '--quiet',
      '--norestart'
    ]
    const run = (program, args) => {
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      if (program === setup) {
        setupCalls.push([...args])
        if (JSON.stringify(args) === JSON.stringify(expectedArgs)) {
          installSpectreLibraries(toolset, ['arm64'])
        }
        return { status: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      arch: 'arm64',
      silent: true,
      programFilesX86,
      config: ARM64_CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: true })
    expect(setupCalls).toEqual([expectedArgs])
  })

  it('does not start an installer when the libraries already exist in a normal prompt', () => {
    installSpectreLibraries()
    const output = quietReporter()
    const run = (program) => {
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      throw new Error(`installer must not run: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'standard',
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: false })
    expect(output.logs.join('\n')).toContain('nothing to install')
  })

  it('refuses to continue toward npm when the root bootstrap itself is elevated', () => {
    installSpectreLibraries()
    const output = quietReporter()
    const run = (program) => {
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      throw new Error(`installer must not run: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'elevated',
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 5, changed: false })
    expect(output.errors.join('\n')).toContain('lifecycle scripts must run as the normal user')
  })

  it('does not repair a missing component when the whole root bootstrap was started elevated', () => {
    const output = quietReporter()
    const programs = []
    const run = (program) => {
      programs.push(program)
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      throw new Error(`installer must not run: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'elevated',
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 5, changed: false })
    expect(programs).toEqual([vswhere, vswhere])
    expect(output.errors.join('\n')).toContain('no installer was started')
    expect(output.errors.join('\n')).toContain('--elevated-toolchain-only')
  })

  it('exits access-denied without invoking setup or prompting UAC when unelevated', () => {
    const programs = []
    const output = quietReporter()
    const run = (program) => {
      programs.push(program)
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      throw new Error(`installer must not run: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'standard',
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 5, changed: false })
    expect(programs).toEqual([vswhere, vswhere])
    expect(output.errors.join('\n')).toContain('Administrator Command Prompt')
    expect(output.errors.join('\n')).toContain('No installer was started')
    expect(output.errors.join('\n')).toContain('--elevated-toolchain-only')
    expect(output.errors.join('\n')).toContain('npm and repository lifecycle scripts must never run')
  })

  it('rejects a successful installer exit when the Spectre directory is still absent', () => {
    // An older mitigated toolset is not enough: MSBuild selects the latest/default toolset. This
    // makes the fixture discriminate an incorrect "any Spectre directory anywhere" recheck.
    installSpectreLibraries(
      join(installationPath, 'VC', 'Tools', 'MSVC', '14.43.34808')
    )
    const output = quietReporter()
    let setupCalls = 0
    const run = (program) => {
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      if (program === setup) {
        setupCalls += 1
        return { status: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 1, changed: false })
    expect(setupCalls).toBe(1)
    expect(output.errors.join('\n')).toContain('lib\\spectre is still missing')
  })

  it('repairs an instance whose Spectre files exist but whose C++ workload is incomplete', () => {
    installSpectreLibraries()
    const output = quietReporter()
    let workloadInstalled = false
    let setupCalls = 0
    const run = (program, args) => {
      if (program === vswhere) {
        const hasRequirementFilter = args.includes('-requires')
        return {
          status: 0,
          stdout: hasRequirementFilter && !workloadInstalled ? '[]' : instanceJson(),
          stderr: ''
        }
      }
      if (program === setup) {
        setupCalls += 1
        expect(args).toContain(CONFIG.workloadId)
        workloadInstalled = true
        return { status: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: true })
    expect(setupCalls).toBe(1)
  })

  it('uses a pinned Microsoft bootstrapper from protected staging on a fresh machine', () => {
    rmSync(vswhere, { force: true })
    rmSync(setup, { force: true })
    rmSync(installationPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    const output = quietReporter()
    const invocations = []
    let stagedBootstrapper = ''
    const windowsDirectory = join(root, 'Windows !')
    const systemPowerShell = join(
      windowsDirectory,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const expectedBootstrapperArgs = [
      '--wait',
      '--quiet',
      '--norestart',
      '--add',
      CONFIG.workloadId,
      '--includeRecommended',
      '--add',
      CONFIG.componentIds[0]
    ]
    const run = (program, args, options = {}) => {
      if (program === systemPowerShell) {
        expect(args.join(' ')).toContain('$env:NODETERM_VS_BOOTSTRAPPER_URL')
        expect(args.join(' ')).toContain('$env:NODETERM_VS_BOOTSTRAPPER_FILE')
        expect(args.join(' ')).not.toContain(CONFIG.bootstrapperUrl)
        expect(options.env.NODETERM_VS_BOOTSTRAPPER_URL).toBe(CONFIG.bootstrapperUrl)
        stagedBootstrapper = options.env.NODETERM_VS_BOOTSTRAPPER_FILE
        writeFileSync(stagedBootstrapper, BOOTSTRAPPER_BYTES)
        return { status: 0, stdout: '', stderr: '' }
      }
      if (program.toLowerCase().endsWith('vs_buildtools.exe')) {
        invocations.push({ program, args: [...args] })
        expect(existsSync(program)).toBe(true)
        mkdirSync(toolset, { recursive: true })
        installSpectreLibraries()
        writeFileSync(vswhere, '')
        return { status: 0, stdout: '', stderr: '' }
      }
      if (program === vswhere) return { status: 0, stdout: instanceJson(), stderr: '' }
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      windowsDirectory,
      config: CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: true })
    expect(invocations).toEqual([{ program: stagedBootstrapper, args: expectedBootstrapperArgs }])
    expect(stagedBootstrapper).not.toBe('')
    expect(stagedBootstrapper.toLowerCase().startsWith(programFilesX86.toLowerCase())).toBe(true)
    expect(existsSync(stagedBootstrapper)).toBe(false)
    expect(output.logs.join('\n')).toContain(`Bootstrapper SHA-256 verified: ${CONFIG.bootstrapperSha256}`)
  })

  it('rejects and removes a fresh-machine bootstrapper whose SHA-256 does not match', () => {
    rmSync(vswhere, { force: true })
    rmSync(setup, { force: true })
    rmSync(installationPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    const output = quietReporter()
    let stagedBootstrapper = ''
    const windowsDirectory = join(root, 'Windows !')
    const systemPowerShell = join(
      windowsDirectory,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const run = (program, _args, options = {}) => {
      if (program === systemPowerShell) {
        stagedBootstrapper = options.env.NODETERM_VS_BOOTSTRAPPER_FILE
        writeFileSync(stagedBootstrapper, 'tampered bootstrapper')
        return { status: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unverified bootstrapper must not run: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      windowsDirectory,
      config: CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 1, changed: false })
    expect(stagedBootstrapper).not.toBe('')
    expect(existsSync(stagedBootstrapper)).toBe(false)
    expect(output.errors.join('\n')).toContain('expected')
  })

  it('propagates reboot-required instead of building immediately after installer exit 3010', () => {
    const output = quietReporter()
    let vswhereCalls = 0
    const run = (program) => {
      if (program === vswhere) {
        vswhereCalls += 1
        return { status: 0, stdout: instanceJson(), stderr: '' }
      }
      if (program === setup) {
        installSpectreLibraries()
        return { status: 3010, stdout: '', stderr: '' }
      }
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsBuildToolchain({
      platform: 'win32',
      silent: true,
      programFilesX86,
      config: CONFIG,
      administratorStatus: 'elevated',
      elevatedToolchainOnly: true,
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 3010, changed: true })
    expect(vswhereCalls).toBe(2)
    expect(output.errors.join('\n')).toContain('restart Windows')
  })
})
