import { execFile as execFileCallback } from 'child_process'
import { realpathSync } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { describe, expect, it, vi } from 'vitest'
import type {
  WindowsTerminalCommandResult,
  WindowsTerminalExecutableLookup,
  WindowsTerminalPathKind,
  WindowsTerminalProfileRuntime
} from './windows-terminal-profiles'
import {
  WSL_LAUNCH_CWD_GUARD,
  WindowsTerminalProfileError,
  WindowsTerminalProfileService,
  findWindowsTerminalExecutable,
  windowsTerminalPathErrorKind
} from './windows-terminal-profiles'

const SYSTEM_ROOT = 'C:\\Windows'
const PROGRAM_FILES = 'C:\\Program Files'
const PROGRAM_W6432 = 'D:\\Program Files 64'
const PROGRAM_FILES_X86 = 'C:\\Program Files (x86)'
const LOCAL_APP_DATA = 'C:\\Users\\Tester\\AppData\\Local'
const PWSH = `${PROGRAM_FILES}\\PowerShell\\7\\pwsh.exe`
const WINDOWS_POWERSHELL = `${SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const CMD = `${SYSTEM_ROOT}\\System32\\cmd.exe`
const WSL = `${SYSTEM_ROOT}\\System32\\wsl.exe`
const CWD = 'C:\\Work Trees\\Unicode 開発'
const runFile = promisify(execFileCallback)

function success(stdout: Buffer | string = ''): WindowsTerminalCommandResult {
  return {
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8'),
    stderr: Buffer.alloc(0),
    exitCode: 0
  }
}

function failure(
  stdout: Buffer | string,
  error: Error = new Error('command failed'),
  stderr: Buffer | string = ''
): WindowsTerminalCommandResult {
  return {
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8'),
    stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr, 'utf8'),
    exitCode: 1,
    error
  }
}

function utf16(value: string, bom = false): Buffer {
  const body = Buffer.from(value, 'utf16le')
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body
}

interface HarnessOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  files?: readonly string[]
  directories?: readonly string[]
  commands?: Readonly<Record<string, string | null>>
  exec?: (file: string, args: readonly string[]) => Promise<WindowsTerminalCommandResult>
}

function harness(options: HarnessOptions = {}): {
  runtime: WindowsTerminalProfileRuntime
  kinds: Map<string, WindowsTerminalPathKind>
  commands: Map<string, string | null>
  execFile: ReturnType<typeof vi.fn>
} {
  const kinds = new Map<string, WindowsTerminalPathKind>()
  for (const file of options.files ?? []) kinds.set(file, 'file')
  for (const directory of options.directories ?? []) kinds.set(directory, 'directory')
  const commands = new Map(Object.entries(options.commands ?? {}))
  const execFile = vi.fn(options.exec ?? (async () => success()))

  const runtime: WindowsTerminalProfileRuntime = {
    platform: options.platform ?? 'win32',
    env: {
      SystemRoot: SYSTEM_ROOT,
      ProgramFiles: PROGRAM_FILES,
      ProgramW6432: PROGRAM_W6432,
      'ProgramFiles(x86)': PROGRAM_FILES_X86,
      LOCALAPPDATA: LOCAL_APP_DATA,
      ...options.env
    },
    findExecutable: vi.fn(async (command: string, fallbacks: readonly string[]) => {
      let resolved: string | null
      if (commands.has(command)) resolved = commands.get(command) ?? null
      else resolved = fallbacks.find((candidate) => kinds.get(candidate) === 'file') ?? null
      return {
        path: resolved,
        unknownProbe: false,
        nonFileProbe: false
      } satisfies WindowsTerminalExecutableLookup
    }),
    pathKind: vi.fn(async (candidate: string) => kinds.get(candidate) ?? 'missing'),
    execFile
  }
  return { runtime, kinds, commands, execFile }
}

async function rejected(
  promise: Promise<unknown>,
  code: WindowsTerminalProfileError['code']
): Promise<WindowsTerminalProfileError> {
  try {
    await promise
    throw new Error('expected promise to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(WindowsTerminalProfileError)
    expect(error).toMatchObject({ code })
    return error as WindowsTerminalProfileError
  }
}

function request(profileId: string, extra: Record<string, unknown> = {}): any {
  return { profileId, cwd: CWD, ...extra }
}

describe('Windows terminal filesystem evidence', () => {
  it.each(['ENOENT', 'ENOTDIR'])('treats only %s as evidence that a path is missing', (code) => {
    expect(windowsTerminalPathErrorKind(Object.assign(new Error(code), { code }))).toBe('missing')
  })

  it.each(['EACCES', 'EPERM', 'EIO', 'EBUSY', undefined])(
    'preserves a %s path probe failure as unknown',
    (code) => {
      expect(windowsTerminalPathErrorKind(Object.assign(new Error(String(code)), { code }))).toBe(
        'unknown'
      )
    }
  )

  it('keeps an uninspectable PATH candidate distinct from proven absence', async () => {
    const first = String.raw`C:\Blocked\pwsh`
    const result = await findWindowsTerminalExecutable(
      'pwsh',
      [],
      { PATH: String.raw`C:\Blocked;C:\Missing`, PATHEXT: '.EXE' },
      async (candidate) => (candidate === first ? 'unknown' : 'missing')
    )

    expect(result).toEqual({ path: null, unknownProbe: true, nonFileProbe: false })
  })

  it('skips an early PATH directory and continues to a later executable file', async () => {
    const directory = String.raw`C:\First\pwsh`
    const executable = String.raw`C:\Second\pwsh.EXE`
    const result = await findWindowsTerminalExecutable(
      'pwsh',
      [],
      { PATH: String.raw`C:\First;C:\Second`, PATHEXT: '.EXE' },
      async (candidate) => {
        if (candidate === directory) return 'directory'
        if (candidate === executable) return 'file'
        return 'missing'
      }
    )

    expect(result).toEqual({ path: executable, unknownProbe: false, nonFileProbe: true })
  })

  it('ignores relative PATH entries at the trusted executable boundary', async () => {
    const visited: string[] = []
    const result = await findWindowsTerminalExecutable(
      'pwsh',
      [],
      { PATH: String.raw`.;tools`, PATHEXT: '.EXE' },
      async (candidate) => {
        visited.push(candidate)
        return 'file'
      }
    )

    expect(result).toEqual({ path: null, unknownProbe: false, nonFileProbe: false })
    expect(visited).toEqual([])
  })
})

describe('WindowsTerminalProfileService built-in resolution', () => {
  it('resolves auto in PowerShell 7 → Windows PowerShell → COMSPEC/cmd order', async () => {
    const all = harness({ files: [PWSH, WINDOWS_POWERSHELL, CMD] })
    await expect(
      new WindowsTerminalProfileService({
        runtime: all.runtime
      }).resolveForSpawn(request('auto'))
    ).resolves.toMatchObject({ shell: PWSH, kind: 'pwsh', shellArgs: [] })

    const noPwsh = harness({ files: [WINDOWS_POWERSHELL, CMD] })
    await expect(
      new WindowsTerminalProfileService({
        runtime: noPwsh.runtime
      }).resolveForSpawn(request('auto'))
    ).resolves.toMatchObject({
      shell: WINDOWS_POWERSHELL,
      kind: 'windows-powershell'
    })

    const comspec = 'C:\\Command Interpreters\\cmd.exe'
    const cmdOnly = harness({
      files: [comspec, CMD],
      env: { COMSPEC: comspec }
    })
    await expect(
      new WindowsTerminalProfileService({
        runtime: cmdOnly.runtime
      }).resolveForSpawn(request('auto'))
    ).resolves.toMatchObject({ shell: comspec, kind: 'cmd' })
  })

  it('fails auto actionably when every automatic candidate is unavailable', async () => {
    const h = harness()
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(request('auto')),
      'profile-unavailable'
    )
    expect(error.message).toContain('No automatic Windows shell is available')
  })

  it('fails an explicit profile instead of opening another available shell', async () => {
    const h = harness({ files: [PWSH] })
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('git-bash')
      ),
      'profile-unavailable'
    )
    expect(error.message).toContain('Git Bash is unavailable')
  })

  it('prefers trusted System32 Windows PowerShell over an earlier PATH candidate', async () => {
    const hostile = 'C:\\Untrusted Path\\powershell.exe'
    const h = harness({
      files: [WINDOWS_POWERSHELL, hostile],
      commands: { powershell: hostile }
    })
    const result = await new WindowsTerminalProfileService({
      runtime: h.runtime
    }).resolveForSpawn(request('windows-powershell'))
    expect(result.shell).toBe(WINDOWS_POWERSHELL)
  })

  it('uses trusted System32 cmd after an invalid COMSPEC and never exposes COMSPEC in list reasons', async () => {
    const missing = 'C:\\Sensitive Folder\\missing cmd.exe'
    const h = harness({ files: [CMD], env: { COMSPEC: missing } })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })
    await expect(service.resolveForSpawn(request('cmd'))).resolves.toMatchObject({ shell: CMD })
    expect(JSON.stringify(await service.list())).not.toContain(missing)
  })

  it('accepts an apostrophe in an absolute COMSPEC path without exposing it in the catalog', async () => {
    const comspec = String.raw`C:\Users\O'Brien\Command Shell\cmd.exe`
    const h = harness({ files: [comspec], env: { COMSPEC: comspec } })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })

    await expect(service.resolveForSpawn(request('cmd'))).resolves.toMatchObject({
      shell: comspec,
      shellArgs: [],
      kind: 'cmd'
    })
    expect(JSON.stringify(await service.list())).not.toContain(comspec)
  })

  it('rejects an interior control character in COMSPEC and uses the independently verified cmd', async () => {
    const comspec = `C:\\Private\\bad${String.fromCharCode(1)}cmd.exe`
    const h = harness({ files: [comspec, CMD], env: { COMSPEC: comspec } })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })

    await expect(service.resolveForSpawn(request('cmd'))).resolves.toMatchObject({ shell: CMD })
    expect(JSON.stringify(await service.list())).not.toContain(comspec)
  })

  it('marks each fixed profile with an actionable availability reason', async () => {
    const profiles = await new WindowsTerminalProfileService({
      runtime: harness().runtime
    }).list()
    for (const id of ['auto', 'pwsh', 'windows-powershell', 'cmd', 'git-bash', 'wsl:', 'custom']) {
      expect(profiles.find((profile) => profile.id === id)).toMatchObject({
        available: false
      })
      expect(profiles.find((profile) => profile.id === id)?.unavailableReason).toBeTruthy()
    }
  })

  it('reports an uninspectable built-in candidate as unknown while accepting an independently verified one', async () => {
    const inaccessible = harness()
    inaccessible.kinds.set(PWSH, 'unknown')
    const unavailable = (
      await new WindowsTerminalProfileService({ runtime: inaccessible.runtime }).list()
    ).find((profile) => profile.id === 'pwsh')
    expect(unavailable).toMatchObject({ available: false })
    expect(unavailable?.unavailableReason).toMatch(/could not be verified/i)
    expect(unavailable?.unavailableReason).not.toMatch(/not found/i)

    const pathPwsh = 'D:\\Portable PowerShell\\pwsh.exe'
    const verified = harness({ files: [pathPwsh], commands: { pwsh: pathPwsh } })
    verified.kinds.set(PWSH, 'unknown')
    await expect(
      new WindowsTerminalProfileService({ runtime: verified.runtime }).resolveForSpawn(
        request('pwsh')
      )
    ).resolves.toMatchObject({ shell: pathPwsh })
  })

  it('revalidates an available catalog entry at spawn instead of trusting the cached snapshot', async () => {
    const h = harness({ files: [PWSH] })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })
    expect((await service.list()).find((profile) => profile.id === 'pwsh')).toMatchObject({
      available: true
    })

    h.kinds.delete(PWSH)
    await rejected(service.resolveForSpawn(request('pwsh')), 'profile-unavailable')
  })
})

describe('Git Bash trust and standard locations', () => {
  it('does not accept an arbitrary bash.exe found on PATH', async () => {
    const hostileBash = 'C:\\Windows\\System32\\bash.exe'
    const h = harness({
      files: [hostileBash],
      commands: { bash: hostileBash }
    })
    await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('git-bash')
      ),
      'profile-unavailable'
    )
    expect(h.runtime.findExecutable).not.toHaveBeenCalledWith('bash', expect.anything())
  })

  it('derives a Git for Windows root from PATH git.exe before accepting bash.exe', async () => {
    const git = 'E:\\Portable Git\\cmd\\git.exe'
    const bash = 'E:\\Portable Git\\bin\\bash.exe'
    const h = harness({ files: [git, bash], commands: { git } })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(request('git-bash'))
    ).resolves.toMatchObject({
      shell: bash,
      shellArgs: ['--login', '-i'],
      kind: 'git-bash'
    })
  })

  it('derives a Git root from PATH git-bash.exe but launches bin/bash.exe instead of MinTTY', async () => {
    const gitBashLauncher = 'E:\\Portable Git\\git-bash.exe'
    const bash = 'E:\\Portable Git\\bin\\bash.exe'
    const h = harness({
      files: [gitBashLauncher, bash],
      commands: { 'git-bash': gitBashLauncher }
    })
    const result = await new WindowsTerminalProfileService({
      runtime: h.runtime
    }).resolveForSpawn(request('git-bash'))
    expect(result).toMatchObject({ shell: bash, shellArgs: ['--login', '-i'] })
    expect(result.shell).not.toBe(gitBashLauncher)
  })

  it('derives the portable Git root from mingw64/bin/git.exe', async () => {
    const git = 'E:\\Portable Git\\mingw64\\bin\\git.exe'
    const bash = 'E:\\Portable Git\\bin\\bash.exe'
    const h = harness({ files: [bash], commands: { git } })

    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(request('git-bash'))
    ).resolves.toMatchObject({ shell: bash, shellArgs: ['--login', '-i'] })
  })

  it.each([
    ['ProgramFiles', PROGRAM_FILES, `${PROGRAM_FILES}\\Git\\bin\\bash.exe`],
    ['ProgramW6432', PROGRAM_W6432, `${PROGRAM_W6432}\\Git\\bin\\bash.exe`],
    ['ProgramFiles(x86)', PROGRAM_FILES_X86, `${PROGRAM_FILES_X86}\\Git\\bin\\bash.exe`],
    ['LOCALAPPDATA', LOCAL_APP_DATA, `${LOCAL_APP_DATA}\\Programs\\Git\\bin\\bash.exe`]
  ])('detects the standard %s Git for Windows location', async (_name, _root, bash) => {
    const h = harness({ files: [bash] })
    await expect(
      new WindowsTerminalProfileService({
        runtime: h.runtime
      }).resolveForSpawn(request('git-bash'))
    ).resolves.toMatchObject({ shell: bash })
  })

  it('uses the standard system Git location when ProgramFiles variables are unavailable', async () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const h = harness({
      files: [bash],
      env: { ProgramFiles: undefined, ProgramW6432: undefined }
    })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(request('git-bash'))
    ).resolves.toMatchObject({ shell: bash })
  })

  it('derives the standard per-user Git location when LOCALAPPDATA is unavailable', async () => {
    const bash = 'C:\\Users\\Tester\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
    const h = harness({
      files: [bash],
      env: { LOCALAPPDATA: undefined, USERPROFILE: 'C:\\Users\\Tester' }
    })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(request('git-bash'))
    ).resolves.toMatchObject({ shell: bash })
  })

  it('accepts Git for Windows usr/bin/bash.exe when bin/bash.exe is absent', async () => {
    const bash = `${PROGRAM_FILES}\\Git\\usr\\bin\\bash.exe`
    const h = harness({ files: [bash] })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(request('git-bash'))
    ).resolves.toMatchObject({ shell: bash })
  })
})

describe('custom executable validation and live list availability', () => {
  it('preserves an absolute executable path containing spaces as one shell value', async () => {
    const custom = 'C:\\Tools With Spaces\\Custom Shell.exe'
    const h = harness({ files: [custom] })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('custom', { customExecutable: custom })
      )
    ).resolves.toMatchObject({
      shell: custom,
      shellArgs: [],
      kind: 'custom'
    })
  })

  it('preserves an apostrophe in an absolute path only in the private launch plan', async () => {
    const custom = String.raw`C:\Program Files\User's Shell\shell.exe`
    const h = harness({ files: [custom] })
    const service = new WindowsTerminalProfileService({
      runtime: h.runtime,
      getCustomExecutable: () => custom
    })

    const listed = (await service.list()).find((profile) => profile.id === 'custom')
    expect(listed).toEqual({
      id: 'custom',
      label: 'Custom executable',
      kind: 'custom',
      available: true
    })
    expect(JSON.stringify(await service.list())).not.toContain(custom)

    await expect(
      service.resolveForSpawn(request('custom', { customExecutable: custom }))
    ).resolves.toMatchObject({
      shell: custom,
      shellArgs: [],
      kind: 'custom'
    })
  })

  it('resolves a safe bare custom executable through PATH', async () => {
    const custom = 'D:\\Portable\\nu.exe'
    const h = harness({ files: [custom], commands: { 'nu.exe': custom } })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('custom', { customExecutable: 'nu.exe' })
      )
    ).resolves.toMatchObject({ shell: custom, shellArgs: [] })
  })

  it('reports a bare custom name that resolves only to a directory as a non-file', async () => {
    const directory = 'D:\\Portable\\nu.exe'
    const h = harness({ directories: [directory], commands: { 'nu.exe': directory } })
    const service = new WindowsTerminalProfileService({
      runtime: h.runtime,
      getCustomExecutable: () => 'nu.exe'
    })

    const listed = (await service.list()).find((profile) => profile.id === 'custom')
    expect(listed).toMatchObject({ available: false })
    expect(listed?.unavailableReason).toMatch(/directory|not an executable file/i)

    const error = await rejected(
      service.resolveForSpawn(request('custom', { customExecutable: 'nu.exe' })),
      'custom-invalid'
    )
    expect(error.message).toMatch(/directory|not an executable file/i)
  })

  it.each([
    ['quoted path', '"C:\\Tools\\pwsh.exe"'],
    ['relative path', '.\\pwsh.exe'],
    ['bare command line', 'pwsh.exe -NoLogo'],
    ['absolute command line', 'C:\\Tools\\pwsh.exe -NoLogo']
  ])('rejects a custom %s instead of parsing a command line', async (_name, customExecutable) => {
    const error = await rejected(
      new WindowsTerminalProfileService({
        runtime: harness().runtime
      }).resolveForSpawn(request('custom', { customExecutable })),
      'custom-invalid'
    )
    expect(error.message).toMatch(/executable|arguments/i)
  })

  it('rejects an existing absolute custom path containing an interior control character', async () => {
    const custom = `C:\\Private\\bad${String.fromCharCode(1)}shell.exe`
    const h = harness({ files: [custom] })
    const service = new WindowsTerminalProfileService({
      runtime: h.runtime,
      getCustomExecutable: () => custom
    })

    const listed = (await service.list()).find((profile) => profile.id === 'custom')
    expect(listed).toMatchObject({ available: false })
    expect(JSON.stringify(listed)).not.toContain('C:\\Private')
    await rejected(
      service.resolveForSpawn(request('custom', { customExecutable: custom })),
      'custom-invalid'
    )
  })

  it('rejects non-string hand-edited custom settings without throwing a raw TypeError', async () => {
    await rejected(
      new WindowsTerminalProfileService({
        runtime: harness().runtime
      }).resolveForSpawn(request('custom', { customExecutable: 42 })),
      'custom-invalid'
    )
  })

  it('rejects a directory selected as the custom executable', async () => {
    const directory = 'C:\\Tools\\Shell Folder'
    const h = harness({ directories: [directory] })
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('custom', { customExecutable: directory })
      ),
      'custom-invalid'
    )
    expect(error.message).toMatch(/directory/i)
  })

  it('keeps an unreadable custom executable distinct from a missing one in list and spawn errors', async () => {
    const custom = 'C:\\Private User Folder\\Unreadable Shell.exe'
    const h = harness()
    h.kinds.set(custom, 'unknown')
    const service = new WindowsTerminalProfileService({
      runtime: h.runtime,
      getCustomExecutable: () => custom
    })

    const listed = (await service.list()).find((profile) => profile.id === 'custom')
    expect(listed).toMatchObject({ available: false })
    expect(listed?.unavailableReason).toMatch(/could not be inspected/i)
    expect(listed?.unavailableReason).not.toMatch(/does not exist|not found/i)
    expect(JSON.stringify(listed)).not.toContain(custom)

    const error = await rejected(
      service.resolveForSpawn(request('custom', { customExecutable: custom })),
      'custom-invalid'
    )
    expect(error.message).toMatch(/could not be inspected/i)
    expect(error.message).not.toMatch(/does not exist|not found/i)
    expect(error.message).not.toContain(custom)
  })

  it('revalidates the machine-local custom getter on every cached list call without exposing its path', async () => {
    const custom = 'C:\\Private User Folder\\Custom Shell.exe'
    const h = harness()
    let configured: unknown = ''
    const service = new WindowsTerminalProfileService({
      runtime: h.runtime,
      getCustomExecutable: () => configured
    })

    expect((await service.list()).find((profile) => profile.id === 'custom')).toMatchObject({
      available: false,
      unavailableReason: 'No custom executable is configured.'
    })

    h.kinds.set(custom, 'file')
    configured = custom
    expect((await service.list()).find((profile) => profile.id === 'custom')).toMatchObject({
      available: true
    })

    h.kinds.delete(custom)
    const unavailable = (await service.list()).find((profile) => profile.id === 'custom')
    expect(unavailable).toMatchObject({
      available: false,
      unavailableReason: 'The configured custom executable does not exist.'
    })
    expect(JSON.stringify(unavailable)).not.toContain(custom)

    configured = { executable: custom }
    expect((await service.list()).find((profile) => profile.id === 'custom')).toMatchObject({
      available: false,
      unavailableReason: 'The configured custom executable is not a string.'
    })
  })
})

describe('WSL detection and resolution', () => {
  it('decodes BOM-less UTF-16LE/NUL bytes and preserves Unicode and names containing spaces', async () => {
    const output = utf16('Ubuntu\r\nUbuntu 24.04 Dev\r\n開発環境\r\n')
    expect(output.includes(0)).toBe(true)
    const h = harness({ files: [WSL], exec: async () => success(output) })
    const profiles = await new WindowsTerminalProfileService({
      runtime: h.runtime
    }).list()
    expect(profiles.filter((profile) => profile.kind === 'wsl' && profile.available)).toEqual([
      { id: 'wsl:Ubuntu', label: 'WSL: Ubuntu', kind: 'wsl', available: true },
      {
        id: 'wsl:Ubuntu 24.04 Dev',
        label: 'WSL: Ubuntu 24.04 Dev',
        kind: 'wsl',
        available: true
      },
      {
        id: 'wsl:開発環境',
        label: 'WSL: 開発環境',
        kind: 'wsl',
        available: true
      }
    ])
  })

  it('decodes UTF-16LE with a BOM', async () => {
    const h = harness({
      files: [WSL],
      exec: async () => success(utf16('Debian\r\n', true))
    })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).list()
    ).resolves.toContainEqual({
      id: 'wsl:Debian',
      label: 'WSL: Debian',
      kind: 'wsl',
      available: true
    })
  })

  it('rejects case-insensitive duplicate distro names and surfaces a disabled WSL reason', async () => {
    const h = harness({
      files: [WSL],
      exec: async () => success(utf16('Ubuntu\r\nubuntu\r\n'))
    })
    const profile = (await new WindowsTerminalProfileService({ runtime: h.runtime }).list()).find(
      (item) => item.id === 'wsl:'
    )
    expect(profile).toMatchObject({ available: false })
    expect(profile?.unavailableReason).toMatch(/malformed distribution data/i)
  })

  it('prefers trusted System32 wsl.exe over an earlier PATH candidate', async () => {
    const hostile = 'C:\\Untrusted Path\\wsl.exe'
    const h = harness({
      files: [WSL, hostile, CWD],
      directories: [CWD],
      commands: { wsl: hostile },
      exec: async (file, args) => {
        expect(file).toBe(WSL)
        return args[0] === '--list' ? success(utf16('Ubuntu\r\n')) : success('/mnt/c/Work Trees\n')
      }
    })
    await expect(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:Ubuntu')
      )
    ).resolves.toMatchObject({ shell: WSL })
  })

  it('exact-matches a selected distro and emits argv-safe wslpath and launch arguments', async () => {
    const h = harness({
      files: [WSL],
      directories: [CWD],
      exec: async (_file, args) =>
        args[0] === '--list'
          ? success(utf16('Ubuntu\r\nUbuntu 24.04 Dev\r\n'))
          : success('/mnt/c/Work Trees/Unicode 開発\n')
    })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })
    const resolved = await service.resolveForSpawn(request('wsl:Ubuntu 24.04 Dev'))
    expect(resolved).toEqual({
      profileId: 'wsl:Ubuntu 24.04 Dev',
      label: 'WSL: Ubuntu 24.04 Dev',
      kind: 'wsl',
      shell: WSL,
      shellArgs: [
        '-d',
        'Ubuntu 24.04 Dev',
        '--cd',
        '/mnt/c/Work Trees/Unicode 開発',
        '--exec',
        '/bin/sh',
        '-c',
        WSL_LAUNCH_CWD_GUARD,
        'nodeterm-wsl',
        '/mnt/c/Work Trees/Unicode 開発'
      ],
      cwd: CWD
    })
    expect(WSL_LAUNCH_CWD_GUARD).toContain('cd "$1"')
    expect(WSL_LAUNCH_CWD_GUARD).toContain('exit 125')
    expect(WSL_LAUNCH_CWD_GUARD).toContain('[ -z "${SHELL:-}" ]')
    expect(WSL_LAUNCH_CWD_GUARD).toContain('exit 126')
    expect(WSL_LAUNCH_CWD_GUARD).toContain('exec "$SHELL"')
    expect(WSL_LAUNCH_CWD_GUARD).not.toContain('Ubuntu 24.04 Dev')
    expect(WSL_LAUNCH_CWD_GUARD).not.toContain('/mnt/c/Work Trees/Unicode 開発')
    expect(JSON.stringify(await service.list())).not.toContain('/mnt/c/Work Trees/Unicode 開発')
    expect(h.execFile).toHaveBeenNthCalledWith(1, WSL, ['--list', '--quiet'])
    expect(h.execFile).toHaveBeenNthCalledWith(2, WSL, [
      '-d',
      'Ubuntu 24.04 Dev',
      '--exec',
      'wslpath',
      '-a',
      '-u',
      CWD
    ])
  })

  it.skipIf(process.platform === 'win32')(
    'executes the fixed WSL cwd guard fail-closed under a real POSIX shell',
    async () => {
      const target = realpathSync(os.tmpdir())
      const good = await runFile('/bin/sh', ['-c', WSL_LAUNCH_CWD_GUARD, 'nodeterm-wsl', target], {
        encoding: 'utf8',
        env: { ...process.env, SHELL: '/bin/pwd' }
      })
      expect(good.stdout.trim()).toBe(target)

      const missing = path.join(target, `nodeterm-wsl-guard-missing-${process.pid}-${Date.now()}`)
      const cwdFailure = await runFile(
        '/bin/sh',
        ['-c', WSL_LAUNCH_CWD_GUARD, 'nodeterm-wsl', missing],
        { encoding: 'utf8', env: { ...process.env, SHELL: '/bin/pwd' } }
      ).catch((error: unknown) => error as NodeJS.ErrnoException & { stderr?: string })
      expect(cwdFailure).toMatchObject({ code: 125 })
      expect(cwdFailure.stderr?.trim()).toBe(
        'nodeterm: WSL working directory became unavailable; choose another directory.'
      )
      expect(cwdFailure.stderr).not.toContain(missing)

      const shellFailure = await runFile(
        '/bin/sh',
        ['-c', WSL_LAUNCH_CWD_GUARD, 'nodeterm-wsl', target],
        { encoding: 'utf8', env: { ...process.env, SHELL: '' } }
      ).catch((error: unknown) => error as NodeJS.ErrnoException & { stderr?: string })
      expect(shellFailure).toMatchObject({ code: 126 })
      expect(shellFailure.stderr?.trim()).toBe(
        'nodeterm: WSL default shell is unavailable; choose another profile.'
      )
    }
  )

  it('does not case-fold an explicit distro selection or fall back to another shell', async () => {
    const h = harness({
      files: [WSL, PWSH],
      exec: async () => success(utf16('Ubuntu\r\n'))
    })
    await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:ubuntu')
      ),
      'wsl-distro-missing'
    )
    expect(h.execFile).toHaveBeenCalledTimes(1)
  })

  it('surfaces enumeration diagnostics from stdout and exposes a path-free disabled list row', async () => {
    const diagnostics = utf16(
      'There is no distribution with the supplied name.\r\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\r\n'
    )
    const h = harness({
      files: [WSL, PWSH],
      exec: async () => failure(diagnostics, new Error(`spawn ${WSL} failed`))
    })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })
    const error = await rejected(
      service.resolveForSpawn(request('wsl:Ubuntu')),
      'wsl-enumeration-failed'
    )
    expect(error.message).toContain('WSL_E_DISTRO_NOT_FOUND')

    const publicProfile = (await service.list()).find((profile) => profile.id === 'wsl:')
    expect(publicProfile).toMatchObject({ available: false })
    expect(publicProfile?.unavailableReason).toContain('WSL_E_DISTRO_NOT_FOUND')
    expect(publicProfile?.unavailableReason).not.toContain('Wsl/Service')
    expect(JSON.stringify(publicProfile)).not.toContain(WSL)
  })

  it('turns a thrown enumeration process error into a structured fail-closed error', async () => {
    const h = harness({
      files: [WSL, PWSH],
      exec: async () => {
        throw new Error(`spawn ${WSL} EACCES`)
      }
    })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })
    const error = await rejected(
      service.resolveForSpawn(request('wsl:Ubuntu')),
      'wsl-enumeration-failed'
    )
    expect(error.message).not.toContain(WSL)
    expect(error.message).toMatch(/could not be started/i)
  })

  it('rejects a missing or non-string Windows cwd before invoking wslpath', async () => {
    for (const cwd of ['relative\\project', 42]) {
      const h = harness({
        files: [WSL],
        exec: async () => success(utf16('Ubuntu\r\n'))
      })
      await rejected(
        new WindowsTerminalProfileService({
          runtime: h.runtime
        }).resolveForSpawn(request('wsl:Ubuntu', { cwd })),
        'wsl-cwd-invalid'
      )
      expect(h.execFile).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps an unreadable WSL cwd distinct from a missing directory and does not invoke wslpath', async () => {
    const h = harness({
      files: [WSL],
      exec: async () => success(utf16('Ubuntu\r\n'))
    })
    h.kinds.set(CWD, 'unknown')
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:Ubuntu')
      ),
      'wsl-cwd-invalid'
    )
    expect(error.message).toMatch(/could not verify|directory access/i)
    expect(error.message).not.toMatch(/not an existing/i)
    expect(h.execFile).toHaveBeenCalledTimes(1)
  })

  it('surfaces wslpath failure and never returns auto or another distro', async () => {
    const h = harness({
      files: [WSL, PWSH],
      directories: [CWD],
      exec: async (_file, args) =>
        args[0] === '--list'
          ? success(utf16('Ubuntu\r\n'))
          : failure(utf16('Error code: Wsl/Service/E_FAIL\r\n'))
    })
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:Ubuntu')
      ),
      'wsl-cwd-translation-failed'
    )
    expect(error.message).toMatch(/No fallback shell was opened/)
    expect(error.message).not.toMatch(/could not be started|timed out/i)
  })

  it('extracts stable WSL error codes without echoing executable paths or command argv', async () => {
    const privateDiagnostic = `${WSL} -d Ubuntu --exec wslpath -a -u "${CWD}"`
    const processError = Object.assign(new Error(`spawn ${privateDiagnostic} failed`), {
      code: 'EACCES'
    })
    const h = harness({
      files: [WSL],
      directories: [CWD],
      exec: async (_file, args) =>
        args[0] === '--list'
          ? success(utf16('Ubuntu\r\n'))
          : failure(
              utf16(`Error code: Wsl/Service/E_FAIL\r\nCommand: ${privateDiagnostic}\r\n`),
              processError,
              utf16(
                `Could not run ${privateDiagnostic}\r\nMapped paths: /mnt/c/Wsl/PrivateFolder/SecretProject /mnt/c/Wsl/PrivateFolder/E_SECRET\r\n`
              )
            )
    })
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:Ubuntu')
      ),
      'wsl-cwd-translation-failed'
    )
    expect(error.message).toContain('WSL error E_FAIL')
    expect(error.message).not.toContain('Wsl/Service')
    expect(error.message).toContain('process error EACCES')
    for (const privateValue of [WSL, CWD, '--exec', 'wslpath', '-a', '-u']) {
      expect(error.message).not.toContain(privateValue)
    }
    expect(error.message).not.toContain('Wsl/PrivateFolder/SecretProject')
    expect(error.message).not.toContain('Wsl/PrivateFolder/E_SECRET')
    expect(error.message).not.toContain('E_SECRET')
  })

  it('drops a path-shaped child-process error code from public WSL failures', async () => {
    const privateCode = 'Wsl/PrivateFolder/E_SECRET'
    const processError = Object.assign(new Error('translation failed'), { code: privateCode })
    const h = harness({
      files: [WSL],
      directories: [CWD],
      exec: async (_file, args) =>
        args[0] === '--list' ? success(utf16('Ubuntu\r\n')) : failure(Buffer.alloc(0), processError)
    })

    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:Ubuntu')
      ),
      'wsl-cwd-translation-failed'
    )
    expect(error.message).not.toContain(privateCode)
    expect(error.message).not.toContain('PrivateFolder')
    expect(error.message).not.toContain('E_SECRET')
  })

  it('reports a distro removed between enumeration and wslpath without falling back', async () => {
    const h = harness({
      files: [WSL, PWSH],
      directories: [CWD],
      exec: async (_file, args) =>
        args[0] === '--list'
          ? success(utf16('Ubuntu\r\n'))
          : failure(
              utf16(
                'There is no distribution with the supplied name.\r\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\r\n'
              )
            )
    })
    const error = await rejected(
      new WindowsTerminalProfileService({ runtime: h.runtime }).resolveForSpawn(
        request('wsl:Ubuntu')
      ),
      'wsl-distro-missing'
    )
    expect(error.message).toMatch(/removed/i)
    expect(h.execFile).toHaveBeenCalledTimes(2)
  })

  it.each(['', 'relative/path\n', '/one\n/two\n'])(
    'rejects invalid wslpath output %j',
    async (translated) => {
      const h = harness({
        files: [WSL],
        directories: [CWD],
        exec: async (_file, args) =>
          args[0] === '--list' ? success(utf16('Ubuntu\r\n')) : success(translated)
      })
      await rejected(
        new WindowsTerminalProfileService({
          runtime: h.runtime
        }).resolveForSpawn(request('wsl:Ubuntu')),
        'wsl-cwd-output-invalid'
      )
    }
  )

  it('caches list detection and refreshes it on demand', async () => {
    let output = utf16('Ubuntu\r\n')
    const h = harness({ files: [WSL], exec: async () => success(output) })
    const service = new WindowsTerminalProfileService({ runtime: h.runtime })

    expect(await service.list()).toContainEqual({
      id: 'wsl:Ubuntu',
      label: 'WSL: Ubuntu',
      kind: 'wsl',
      available: true
    })
    expect(await service.list()).toContainEqual(expect.objectContaining({ id: 'wsl:Ubuntu' }))
    expect(h.execFile).toHaveBeenCalledTimes(1)

    output = utf16('Debian\r\n')
    expect(await service.refresh()).toContainEqual(expect.objectContaining({ id: 'wsl:Debian' }))
    expect(h.execFile).toHaveBeenCalledTimes(2)
    expect(await service.list()).not.toContainEqual(expect.objectContaining({ id: 'wsl:Ubuntu' }))
    expect(h.execFile).toHaveBeenCalledTimes(2)
  })
})

describe('malformed inputs, public sanitization, and platform scope', () => {
  it.each([
    ['unknown', 'powershell-please'],
    ['empty WSL suffix', 'wsl:'],
    ['outer whitespace', 'wsl: Ubuntu'],
    ['control character', 'wsl:Ubuntu\n--exec']
  ])('rejects a malformed profile ID: %s', async (_name, profileId) => {
    await rejected(
      new WindowsTerminalProfileService({
        runtime: harness().runtime
      }).resolveForSpawn(request(profileId)),
      'malformed-profile-id'
    )
  })

  it('rejects a non-string profile ID at runtime', async () => {
    await rejected(
      new WindowsTerminalProfileService({
        runtime: harness().runtime
      }).resolveForSpawn(request(42 as any)),
      'malformed-profile-id'
    )
  })

  it('returns renderer-safe descriptors with no executable or argv keys and no discovered paths in reasons', async () => {
    const secretPwsh = 'C:\\Users\\Private\\pwsh.exe'
    const h = harness({
      directories: [secretPwsh],
      commands: { pwsh: secretPwsh },
      env: { COMSPEC: 'C:\\Users\\Private\\cmd.exe' }
    })
    const profiles = await new WindowsTerminalProfileService({
      runtime: h.runtime
    }).list()
    for (const profile of profiles) {
      expect(
        Object.keys(profile).every((key) =>
          ['id', 'label', 'kind', 'available', 'unavailableReason'].includes(key)
        )
      ).toBe(true)
    }
    const serialized = JSON.stringify(profiles)
    expect(serialized).not.toContain('C:\\Users\\Private')
    expect(serialized).not.toMatch(/"shell"|"shellArgs"|"args"|"executable"/)
  })

  it('lists every profile unavailable and refuses resolution outside Windows', async () => {
    const service = new WindowsTerminalProfileService({
      runtime: harness({ platform: 'linux' }).runtime
    })
    expect((await service.list()).every((profile) => !profile.available)).toBe(true)
    await rejected(service.resolveForSpawn(request('auto')), 'unsupported-platform')
  })
})
