// The remote Codex home is resolved by the HOST's shell, never by this desktop's environment: the
// system account keeps the host's own CODEX_HOME (relocated installs included), and a managed
// account gets its one validated private root. Executed under a real POSIX shell because the
// expression is generated shell.
import { spawnSync } from 'child_process'
import { describe, expect, it } from 'vitest'
import { isKnownRemoteCodexAccount, remoteCodexHomeExpression, remoteCodexLoginCommand } from './codex-home'
import { remoteCodexHome } from '../codex-accounts-core'

const evalHome = (expr: string, env: Record<string, string>): string =>
  spawnSync('/bin/sh', ['-c', `printf %s ${expr}`], { env, encoding: 'utf8' }).stdout

describe('remoteCodexHomeExpression', () => {
  it.skipIf(process.platform === 'win32')('the system account follows the host CODEX_HOME, else $HOME/.codex', () => {
    const expr = remoteCodexHomeExpression(undefined)
    expect(evalHome(expr, { HOME: '/home/u', CODEX_HOME: '/srv/codex' })).toBe('/srv/codex')
    expect(evalHome(expr, { HOME: '/home/u' })).toBe('/home/u/.codex')
  })

  it.skipIf(process.platform === 'win32')('a managed account is its one quoted private root, whatever the host env says', () => {
    const expr = remoteCodexHomeExpression("/home/o'neil", 'acct-1')
    expect(evalHome(expr, { HOME: '/elsewhere', CODEX_HOME: '/srv/codex' })).toBe(remoteCodexHome("/home/o'neil", 'acct-1'))
  })

  it('refuses a managed account without a safe remote home', () => {
    expect(() => remoteCodexHomeExpression(undefined, 'acct-1')).toThrow()
    expect(() => remoteCodexHomeExpression('relative/home', 'acct-1')).toThrow()
  })
})

describe('isKnownRemoteCodexAccount', () => {
  const accounts = [
    { id: 'a', label: 'A', host: 'me@h' },
    { id: 'b', label: 'B', host: 'me@h', pending: true },
    { id: 'c', label: 'C' }
  ]
  it('accepts only a finished account pinned to that host', () => {
    expect(isKnownRemoteCodexAccount(accounts, 'a', 'me@h')).toBe(true)
    expect(isKnownRemoteCodexAccount(accounts, 'a', 'me@other')).toBe(false)
    expect(isKnownRemoteCodexAccount(accounts, 'b', 'me@h')).toBe(false)
    expect(isKnownRemoteCodexAccount(accounts, 'c', 'me@h')).toBe(false)
  })
})

describe('remoteCodexLoginCommand', () => {
  it.skipIf(process.platform === 'win32')('runs the program through the host login shell, quoted as one argument', () => {
    const cmd = remoteCodexLoginCommand("printf '%s' \"$0\" ok")
    const out = spawnSync('/bin/sh', ['-c', cmd], { env: { SHELL: '/bin/sh', HOME: '/tmp' }, encoding: 'utf8' }).stdout
    expect(out).toContain('ok')
  })
})
