import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import {
  directExecutableInvocation,
  execCandidates,
  findInPathString,
  unquotePathEntry
} from './exec-path'

describe('execCandidates', () => {
  it('leaves a bare name alone off win32, where there is no PATHEXT', () => {
    expect(execCandidates('gh', 'darwin', undefined)).toEqual(['gh'])
    expect(execCandidates('gh', 'linux', '.EXE')).toEqual(['gh'])
  })

  it('maps a bare name through PATHEXT on win32, in PATHEXT order', () => {
    // `gh` on Windows is `gh.exe` and an npm shim is `<name>.cmd`; a bare-name-only walk finds
    // neither, and every caller then falls through to fallbacks that do not exist there either.
    expect(execCandidates('gh', 'win32', '.COM;.EXE;.CMD')).toEqual(['gh.COM', 'gh.EXE', 'gh.CMD'])
  })

  it('never offers the extensionless name on win32', () => {
    // npm installs a global CLI as BOTH `<name>` (a POSIX shell shim for Git Bash) and
    // `<name>.cmd` in the same directory. CreateProcess cannot run the shim, so it is never a
    // candidate: a hit on it would be a path that exists and cannot be spawned.
    expect(execCandidates('mytool', 'win32', '.EXE;.CMD')).not.toContain('mytool')
  })

  it('falls back to the stock PATHEXT when the variable is missing or empty', () => {
    expect(execCandidates('ssh', 'win32', undefined)).toEqual(['ssh.COM', 'ssh.EXE', 'ssh.BAT', 'ssh.CMD'])
    expect(execCandidates('ssh', 'win32', '')).toEqual(execCandidates('ssh', 'win32', undefined))
  })

  it('tolerates whitespace and empty entries in PATHEXT', () => {
    expect(execCandidates('gh', 'win32', ' .EXE ; ; .CMD ')).toEqual(['gh.EXE', 'gh.CMD'])
  })

  it('does not double up on a name that already carries an extension', () => {
    expect(execCandidates('gh.exe', 'win32', '.COM;.EXE')).toEqual(['gh.exe'])
    expect(execCandidates('claude.CMD', 'win32', '.EXE;.cmd')).toEqual(['claude.CMD'])
  })
})

describe('unquotePathEntry', () => {
  it('strips the quotes Windows tolerates around a PATH entry', () => {
    expect(unquotePathEntry('"C:\\Program Files\\GitHub CLI"')).toBe('C:\\Program Files\\GitHub CLI')
  })

  it('leaves an unquoted entry and a lone quote untouched', () => {
    expect(unquotePathEntry('/usr/bin')).toBe('/usr/bin')
    expect(unquotePathEntry('"C:\\half')).toBe('"C:\\half')
  })
})

describe('directExecutableInvocation', () => {
  const systemRoot = 'C:\\Windows'
  const cmd = `${systemRoot}\\System32\\cmd.exe`

  it('leaves native and non-Windows executables unchanged', () => {
    expect(
      directExecutableInvocation('C:\\Tools\\agent.exe', ['--version'], {
        platform: 'win32',
        systemRoot,
        exists: () => false
      })
    ).toEqual({ executable: 'C:\\Tools\\agent.exe', args: ['--version'] })
    expect(
      directExecutableInvocation('/usr/bin/agent.cmd', ['--version'], { platform: 'linux' })
    ).toEqual({ executable: '/usr/bin/agent.cmd', args: ['--version'] })
  })

  it('runs a Windows cmd shim through hidden cmd.exe with escaped verbatim arguments', () => {
    expect(
      directExecutableInvocation('C:\\Tools\\agent.CMD', ['--flag', 'value & untouched'], {
        platform: 'win32',
        systemRoot,
        exists: (candidate) => candidate.toLowerCase() === cmd.toLowerCase()
      })
    ).toEqual({
      executable: cmd,
      args: [
        '/d',
        '/s',
        '/v:off',
        '/c',
        '"C:\\Tools\\agent.CMD ^^^"--flag^^^" ^^^"value^^^ ^^^&^^^ untouched^^^""'
      ],
      options: { windowsHide: true, windowsVerbatimArguments: true }
    })
  })

  it('fails closed without cmd.exe and for unsupported Windows script kinds', () => {
    expect(
      directExecutableInvocation('C:\\Tools\\agent.cmd', [], {
        platform: 'win32',
        systemRoot,
        exists: () => false
      })
    ).toBeNull()
    expect(
      directExecutableInvocation('C:\\Tools\\agent.bat', [], {
        platform: 'win32',
        systemRoot,
        exists: () => true
      })
    ).toBeNull()
    expect(
      directExecutableInvocation('C:\\Tools\\agent.ps1', [], {
        platform: 'win32',
        systemRoot,
        exists: () => true
      })
    ).toBeNull()
  })

  it('fails closed when cmd.exe cannot preserve argv or the command exceeds its limit', () => {
    const options = { platform: 'win32' as const, systemRoot, exists: () => true }
    expect(directExecutableInvocation('C:\\Tools\\agent.cmd', ['line 1\nline 2'], options)).toBeNull()
    expect(directExecutableInvocation('C:\\Tools\\agent.cmd', ['line 1\rline 2'], options)).toBeNull()
    expect(directExecutableInvocation('C:\\Tools\\agent.cmd', ['nul\0byte'], options)).toBeNull()
    expect(directExecutableInvocation('C:\\Tools\\agent.cmd', ['x'.repeat(8100)], options)).toBeNull()
  })
})

describe.skipIf(process.platform !== 'win32')('directExecutableInvocation - real cmd shim', () => {
  it('preserves npm-shim argv boundaries and cmd metacharacters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-exec-shim-'))
    try {
      const shimDir = path.join(dir, 'shims & !tools!')
      fs.mkdirSync(shimDir)
      const script = path.join(shimDir, 'capture.js')
      const cmd = path.join(shimDir, 'capture args.cmd')
      fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
      fs.writeFileSync(cmd, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
      const args = [
        '',
        'plain',
        'space value',
        'embedded "quote"',
        'trailing\\',
        'before\\"after',
        '&|<>()@^',
        '%PATH%',
        '!delayed!',
        'café 日本語'
      ]
      const invocation = directExecutableInvocation(cmd, args)
      expect(invocation).not.toBeNull()

      const output = execFileSync(invocation!.executable, invocation!.args, {
        ...invocation!.options,
        encoding: 'utf8'
      })
      expect(JSON.parse(output)).toEqual(args)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// End-to-end over the real filesystem: the unit tests above prove the NAME mapping, these prove the
// walk actually resolves those names. Split by platform because the mapping only exists on one.
describe('findInPathString (real filesystem)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-exec-path-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** POSIX needs the exec bit for X_OK; Node degrades X_OK to F_OK on Windows. */
  const writeBin = (name: string): string => {
    const p = path.join(dir, name)
    fs.writeFileSync(p, '', { mode: 0o755 })
    return p
  }

  /** A win32 hit carries PATHEXT's casing (`.EXE`), not the file's own: the same path, since
   *  Windows is case-insensitive. Compare the way the platform does. */
  const expectPath = (got: string | null, want: string): void => {
    expect(process.platform === 'win32' ? got?.toLowerCase() : got).toBe(
      process.platform === 'win32' ? want.toLowerCase() : want
    )
  }

  const probeFile = process.platform === 'win32' ? 'nt-probe.exe' : 'nt-probe'

  it('finds an executable that is on the PATH, and answers null for one that is not', () => {
    writeBin(probeFile)
    expectPath(findInPathString('nt-probe', dir), path.join(dir, probeFile))
    expect(findInPathString('nt-absent', dir)).toBeNull()
  })

  it('skips empty entries and searches later ones', () => {
    writeBin(probeFile)
    const pathStr = ['', path.join(dir, 'nope'), dir].join(path.delimiter)
    expectPath(findInPathString('nt-probe', pathStr), path.join(dir, probeFile))
  })

  it('tolerates a quoted PATH entry', () => {
    writeBin(probeFile)
    expectPath(findInPathString('nt-probe', `"${dir}"`), path.join(dir, probeFile))
  })

  describe.skipIf(process.platform !== 'win32')('win32 PATHEXT', () => {
    it('resolves a bare name to its .exe and .cmd on disk', () => {
      writeBin('nt-exe-only.exe')
      writeBin('nt-cmd-only.cmd')
      expectPath(findInPathString('nt-exe-only', dir), path.join(dir, 'nt-exe-only.exe'))
      expectPath(findInPathString('nt-cmd-only', dir), path.join(dir, 'nt-cmd-only.cmd'))
    })

    it('prefers the PATHEXT match over an extensionless shim in the same directory', () => {
      writeBin('nt-shim')
      writeBin('nt-shim.cmd')
      expectPath(findInPathString('nt-shim', dir), path.join(dir, 'nt-shim.cmd'))
    })

    it('does not return an extensionless file for a bare name', () => {
      writeBin('nt-bare-only')
      expect(findInPathString('nt-bare-only', dir)).toBeNull()
    })

    it('still finds a name given in full', () => {
      writeBin('nt-full.exe')
      expectPath(findInPathString('nt-full.exe', dir), path.join(dir, 'nt-full.exe'))
    })
  })
})
