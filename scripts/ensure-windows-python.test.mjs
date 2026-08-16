import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureWindowsPython } from './ensure-windows-python.mjs'

const INSTALLER_BYTES = Buffer.from('Python installer fixture\n')
const CONFIG = {
  version: '3.13.15',
  wingetPackageId: 'Python.Python.3.13',
  installerUrl: 'https://www.python.org/ftp/python/3.13.15/python-3.13.15-amd64.exe',
  installerSha256: createHash('sha256').update(INSTALLER_BYTES).digest('hex')
}

const describeWindows = process.platform === 'win32' ? describe : describe.skip

describeWindows('Windows Python bootstrap for node-gyp', () => {
  let root = ''
  let localAppData = ''
  let target = ''
  let targetPython = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nodeterm Python ! O'Brien "))
    localAppData = join(root, 'local app data !')
    target = join(localAppData, 'nodeterm', 'toolchain', 'python-3.13.15-x64')
    targetPython = join(target, 'python.exe')
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function probeResult(executable, version = [3, 13, 15]) {
    return {
      status: 0,
      stdout: JSON.stringify({
        executable,
        major: version[0],
        minor: version[1],
        micro: version[2],
        bits: 64,
        machine: 'amd64'
      }),
      stderr: ''
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

  it('reuses a supported 64-bit interpreter and exports its absolute executable', () => {
    const existing = "C:\\Users\\O'Brien !\\Python313\\python.exe"
    const calls = []
    const output = quietReporter()
    const run = (program, args, options) => {
      calls.push({ program, args: [...args], options })
      return probeResult(existing)
    }

    const result = ensureWindowsPython({
      platform: 'win32',
      arch: 'x64',
      localAppData,
      config: CONFIG,
      administratorStatus: 'standard',
      pythonCandidates: [{ program: existing, prefixArgs: [] }],
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: false, pythonPath: existing })
    expect(calls).toHaveLength(1)
    expect(calls[0].program).toBe(existing)
    expect(calls[0].args.slice(0, 3)).toEqual(['-I', '-B', '-c'])
    expect(calls[0].options.env.PYTHON_MANAGER_AUTOMATIC_INSTALL).toBe('false')
    expect(calls[0].options.timeout).toBe(15_000)
    expect(output.logs.join('\n')).toContain('nothing to install')
  })

  it('installs the pinned per-user Python package through canonical winget', () => {
    const output = quietReporter()
    const calls = []
    let installed = false
    const run = (program, args) => {
      calls.push({ program, args: [...args] })
      if (program === targetPython && !installed) {
        return { status: null, error: { code: 'ENOENT' }, stdout: '', stderr: '' }
      }
      if (program === 'winget.exe') {
        mkdirSync(target, { recursive: true })
        writeFileSync(targetPython, '')
        installed = true
        return { status: 0, stdout: '', stderr: '' }
      }
      if (program === targetPython) return probeResult(targetPython)
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsPython({
      platform: 'win32',
      arch: 'x64',
      localAppData,
      config: CONFIG,
      administratorStatus: 'standard',
      // Store/Python Manager aliases must never be launched as a supposedly read-only probe.
      environment: {
        PYTHON: 'C:\\Users\\fixture\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe'
      },
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: true, pythonPath: targetPython })
    expect(calls.map((call) => call.program)).toEqual([
      targetPython,
      'winget.exe',
      targetPython
    ])
    expect(calls.some((call) => ['py.exe', 'python.exe'].includes(call.program))).toBe(false)
    expect(calls[1].args).toEqual([
      'install',
      '--id',
      CONFIG.wingetPackageId,
      '--exact',
      '--version',
      CONFIG.version,
      '--source',
      'winget',
      '--architecture',
      'x64',
      '--scope',
      'user',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity',
      '--override',
      expect.stringContaining(`TargetDir="${target}"`)
    ])
    expect(calls[1].args.at(-1)).toContain('InstallAllUsers=0')
    expect(calls[1].args.at(-1)).toContain('Include_launcher=0')
  })

  it('falls back to the official SHA-pinned installer when winget is unavailable', () => {
    const output = quietReporter()
    let stagedInstaller = ''
    let installerArgs = []
    const run = (program, args, options = {}) => {
      if (program === 'winget.exe') {
        return { status: null, error: Object.assign(new Error('spawn winget ENOENT'), { code: 'ENOENT' }) }
      }
      if (program === 'powershell.exe') {
        expect(args.join(' ')).toContain('$env:NODETERM_PYTHON_INSTALLER_URL')
        expect(args.join(' ')).not.toContain(CONFIG.installerUrl)
        expect(options.env.NODETERM_PYTHON_INSTALLER_URL).toBe(CONFIG.installerUrl)
        stagedInstaller = options.env.NODETERM_PYTHON_INSTALLER_FILE
        writeFileSync(stagedInstaller, INSTALLER_BYTES)
        return { status: 0, stdout: '', stderr: '' }
      }
      if (program.toLowerCase().endsWith('.exe') && program !== targetPython) {
        installerArgs = [...args]
        expect(existsSync(program)).toBe(true)
        mkdirSync(target, { recursive: true })
        writeFileSync(targetPython, '')
        return { status: 0, stdout: '', stderr: '' }
      }
      if (program === targetPython) return probeResult(targetPython)
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsPython({
      platform: 'win32',
      arch: 'x64',
      localAppData,
      config: CONFIG,
      administratorStatus: 'standard',
      pythonCandidates: [],
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 0, changed: true, pythonPath: targetPython })
    expect(installerArgs).toContain('/quiet')
    expect(installerArgs).toContain('InstallAllUsers=0')
    expect(installerArgs).toContain(`TargetDir=${target}`)
    expect(stagedInstaller).not.toBe('')
    expect(existsSync(stagedInstaller)).toBe(false)
    expect(output.logs.join('\n')).toContain(`Python installer SHA-256 verified: ${CONFIG.installerSha256}`)
  })

  it('rejects and removes a fallback installer whose SHA-256 is wrong', () => {
    const output = quietReporter()
    let stagedInstaller = ''
    const run = (program, _args, options = {}) => {
      if (program === 'winget.exe') return { status: 1, stderr: 'winget fixture failure' }
      if (program === 'powershell.exe') {
        stagedInstaller = options.env.NODETERM_PYTHON_INSTALLER_FILE
        writeFileSync(stagedInstaller, 'tampered Python installer')
        return { status: 0, stdout: '', stderr: '' }
      }
      throw new Error(`unverified installer must not run: ${program}`)
    }

    const result = ensureWindowsPython({
      platform: 'win32',
      arch: 'x64',
      localAppData,
      config: CONFIG,
      administratorStatus: 'standard',
      pythonCandidates: [],
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 1, changed: false, pythonPath: '' })
    expect(stagedInstaller).not.toBe('')
    expect(existsSync(stagedInstaller)).toBe(false)
    expect(output.errors.join('\n')).toContain('expected')
  })

  it('does not install Python or continue toward npm from an elevated root prompt', () => {
    const output = quietReporter()
    const result = ensureWindowsPython({
      platform: 'win32',
      arch: 'x64',
      localAppData,
      config: CONFIG,
      administratorStatus: 'elevated',
      run: (program) => {
        throw new Error(`must not run while elevated: ${program}`)
      },
      report: output.report
    })

    expect(result).toEqual({ code: 5, changed: false, pythonPath: '' })
    expect(output.errors.join('\n')).toContain('normal user')
  })

  it('rejects installer exit zero when the pinned target is the wrong patch version', () => {
    const output = quietReporter()
    const run = (program) => {
      if (program === 'winget.exe') {
        mkdirSync(target, { recursive: true })
        writeFileSync(targetPython, '')
        return { status: 0, stdout: '', stderr: '' }
      }
      if (program === targetPython) return probeResult(targetPython, [3, 13, 14])
      throw new Error(`unexpected program: ${program}`)
    }

    const result = ensureWindowsPython({
      platform: 'win32',
      arch: 'x64',
      localAppData,
      config: CONFIG,
      administratorStatus: 'standard',
      pythonCandidates: [],
      run,
      report: output.report
    })

    expect(result).toEqual({ code: 1, changed: false, pythonPath: '' })
    expect(output.errors.join('\n')).toContain('did not pass its probe')
  })
})
