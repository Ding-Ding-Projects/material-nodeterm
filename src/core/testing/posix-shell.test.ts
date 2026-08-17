import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  environmentForPosixShell,
  REAL_POSIX_SHELL,
  REAL_SHELL_TEST_TIMEOUT_MS,
  pathForPosixShell,
  pathsForPosixShellEnv,
  posixShellScriptArgs,
  quotePathForPosixShell
} from './posix-shell'

describe('POSIX-shell test fixture paths', () => {
  it('converts drive paths without mangling POSIX or UNC paths', () => {
    expect(pathForPosixShell(String.raw`C:\Users\Example\a b`, 'win32')).toBe('/c/Users/Example/a b')
    expect(pathForPosixShell(String.raw`z:\tmp\x`, 'win32')).toBe('/z/tmp/x')
    expect(pathForPosixShell(String.raw`\\server\share\x`, 'win32')).toBe('//server/share/x')
    expect(pathForPosixShell('/tmp/x', 'linux')).toBe('/tmp/x')
  })

  it('quotes a converted path as one shell word', () => {
    expect(quotePathForPosixShell(String.raw`C:\Users\O'Brien\a b`, 'win32')).toBe(
      String.raw`'/c/Users/O'"'"'Brien/a b'`
    )
  })

  it('converts only declared path-shaped environment values', () => {
    expect(
      pathsForPosixShellEnv(
        { HOME: String.raw`C:\Users\Example`, TOKEN: String.raw`C:\not-a-path-contract` },
        ['HOME'],
        'win32'
      )
    ).toEqual({ HOME: '/c/Users/Example', TOKEN: String.raw`C:\not-a-path-contract` })
  })
})

const shProbe = (() => {
  try {
    execFileSync(REAL_POSIX_SHELL, ['-c', 'exit 0'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!shProbe)('POSIX-shell adapter under the real shell', { timeout: REAL_SHELL_TEST_TIMEOUT_MS }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt shell fixture '))
  const bin = join(dir, 'fake bin')
  const log = join(dir, 'proof.log')
  const script = join(dir, 'invoke-curl.sh')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/sh\nprintf '%s' "$1" > ${quotePathForPosixShell(log)}\n`,
    'utf8'
  )
  chmodSync(join(bin, 'curl'), 0o755)
  writeFileSync(script, '#!/bin/sh\ncurl reached\n', 'utf8')
  chmodSync(script, 0o755)

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('puts a fake curl ahead of Git Bash system curl, from a temp path containing spaces', () => {
    execFileSync(REAL_POSIX_SHELL, posixShellScriptArgs(script, [], bin), {
      env: environmentForPosixShell(),
      stdio: 'ignore'
    })
    expect(readFileSync(log, 'utf8')).toBe('reached')
  })
})
