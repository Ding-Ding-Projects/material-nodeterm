// Shared test fixtures for the WSL core package: real UTF-16LE, NUL-laden byte layouts, and an
// in-memory WslRuntime so every test drives real command-args and real parsers without ever
// spawning a real wsl.exe (which would be actively dangerous on a machine that has genuine
// distributions, docker-desktop and this user's own PBX distributions among them).

import type { WslCommandResult, WslExecOptions, WslRuntime } from './runtime'

/** Encodes text the way wsl.exe's native Windows-side subcommands typically do: UTF-16LE with a
 *  BOM. This is deliberately the noisier of the two real encodings this package must handle. */
export function utf16leFixture(text: string): Buffer {
  const bom = Buffer.from([0xff, 0xfe])
  return Buffer.concat([bom, Buffer.from(text, 'utf16le')])
}

/** Encodes text the way a command that execs into the Linux side typically does: plain UTF-8, no
 *  BOM. Used for `/proc/meminfo` and `wslpath`-shaped output. */
export function utf8Fixture(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

export interface FakeWslRuntimeOptions {
  platform?: NodeJS.Platform
  /** null = wsl.exe cannot be found at all. */
  wslExePath?: string | null
  /** Keyed by `${args.join(' ')}`. Missing entries fail closed with a nonzero exit code rather
   *  than throwing, so a test that forgot to stub a command sees an honest command failure
   *  instead of an unrelated crash. */
  responses?: Record<string, WslCommandResult>
}

export interface FakeWslRuntimeHandle extends WslRuntime {
  /** Every argv this fake runtime was actually asked to execute, in call order. Lets a test prove
   *  which exact command a high-level function issued, most importantly that a mutating action
   *  passed the target name as its own argv element rather than folding it into a shell string. */
  readonly calls: string[][]
}

function ok(stdout: Buffer, stderr: Buffer = Buffer.alloc(0)): WslCommandResult {
  return { stdout, stderr, exitCode: 0 }
}

export function fakeWslRuntime(options: FakeWslRuntimeOptions = {}): FakeWslRuntimeHandle {
  const calls: string[][] = []
  return {
    platform: options.platform ?? 'win32',
    calls,
    findWslExecutable: async () =>
      options.wslExePath === undefined ? 'C:\\Windows\\System32\\wsl.exe' : options.wslExePath,
    execFile: async (_wslExe: string, args: readonly string[], _execOptions?: WslExecOptions) => {
      const key = [...args].join(' ')
      calls.push([...args])
      const stubbed = options.responses?.[key]
      if (stubbed) return stubbed
      return {
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`no fake response registered for: ${key}`, 'utf8'),
        exitCode: 1
      }
    }
  }
}

export { ok as fixtureCommandOk }

/** A realistic `wsl --status` success, used by every test that needs `detectWsl` to report
 *  WSL as installed and usable. */
export const STATUS_OK: WslCommandResult = ok(utf16leFixture('Default Distribution: Ubuntu\r\nDefault Version: 2\r\n'))

/** A realistic three-row `wsl --list --verbose` table: one default running distribution, one
 *  stopped distribution with no clean WSL-version marker, and docker-desktop, standing in for the
 *  kind of real, user-owned distribution this app must never mutate. */
export const VERBOSE_LIST_FIXTURE: WslCommandResult = ok(
  utf16leFixture(
    [
      '  NAME                   STATE           VERSION',
      '* Ubuntu                 Running         2',
      '  docker-desktop         Stopped         2',
      '  my-old-distro          Stopped         1'
    ].join('\r\n') + '\r\n'
  )
)

/** A realistic `wsl --list --online` table with more than a hand-picked shortlist, matching what
 *  this machine's real answer looks like: several Ubuntu variants, Debian, kali-linux, and more. */
export const ONLINE_LIST_FIXTURE: WslCommandResult = ok(
  utf16leFixture(
    [
      "The following is a list of valid distributions that can be installed using 'wsl.exe --install <Distro>'.",
      '',
      'NAME                                   FRIENDLY NAME',
      'Ubuntu                                 Ubuntu',
      'Debian                                 Debian GNU/Linux',
      'kali-linux                             Kali Linux Rolling',
      'Ubuntu-18.04                           Ubuntu 18.04 LTS',
      'Ubuntu-20.04                           Ubuntu 20.04 LTS',
      'Ubuntu-22.04                           Ubuntu 22.04 LTS',
      'Ubuntu-24.04                           Ubuntu 24.04 LTS',
      'OracleLinux_7_9                        Oracle Linux 7.9',
      'OracleLinux_8_7                        Oracle Linux 8.7',
      'OracleLinux_9_1                        Oracle Linux 9.1',
      'openSUSE-Leap-15.6                     openSUSE Leap 15.6',
      'SUSE-Linux-Enterprise-15-SP6           SUSE Linux Enterprise 15 SP6',
      'openSUSE-Tumbleweed                    openSUSE Tumbleweed'
    ].join('\r\n') + '\r\n'
  )
)
