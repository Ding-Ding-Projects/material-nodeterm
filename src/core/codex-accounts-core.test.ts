import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  codexAccountHome,
  codexHomeForAccount,
  codexSessionEnv,
  ensureSharedCodexDaemon,
  legacyCodexAccountHome,
  migrateLegacyCodexAccountHome,
  codexTmuxEnvArgs,
  codexSocketForAccount
} from './codex-accounts-core'

describe('managed Codex account paths', () => {
  it('isolates two accounts under distinct homes and shared-server sockets', () => {
    const userData = '/isolated/nodeterm'
    expect(codexAccountHome(userData, 'account-a')).not.toBe(
      legacyCodexAccountHome(userData, 'account-a')
    )
    expect(codexHomeForAccount(userData, 'account-a')).not.toBe(
      codexHomeForAccount(userData, 'account-b')
    )
    expect(codexSocketForAccount(userData, 'account-a')).not.toBe(
      codexSocketForAccount(userData, 'account-b')
    )
  })

  it.each(['', '../escape', 'space name', '/absolute'])('rejects unsafe account id %s', (id) => {
    expect(() => codexAccountHome('/isolated/nodeterm', id)).toThrow('Invalid Codex account id')
  })

  it('overwrites inherited account scope for system and managed sessions', () => {
    const accountHome = codexAccountHome('/isolated/nodeterm', 'account-a')
    expect(codexSessionEnv('/isolated/nodeterm')).toMatchObject({
      NODETERM_CODEX_ACCOUNT_ID: ''
    })
    expect(codexSessionEnv('/isolated/nodeterm', 'account-a')).toEqual({
      CODEX_HOME: accountHome,
      NODETERM_CODEX_ACCOUNT_ID: 'account-a'
    })
    expect(codexTmuxEnvArgs('/isolated/nodeterm', 'account-a')).toEqual([
      '-e',
      `CODEX_HOME=${accountHome}`,
      '-e',
      'NODETERM_CODEX_ACCOUNT_ID=account-a'
    ])
  })

  it('keeps the managed daemon socket below macOS SUN_LEN', () => {
    const userData = '/Users/example/Library/Application Support/node-terminal'
    const accountId = 'be28d3d4-c18c-430c-a257-ae550d3dd7ed'
    expect(Buffer.byteLength(codexSocketForAccount(userData, accountId))).toBeLessThan(104)
  })

  it('moves an existing long managed home to its deterministic short home', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-home-'))
    const userData = path.join(fixture, 'Library', 'Application Support', 'node-terminal')
    const shortRoot = path.join(fixture, 'cx')
    const legacy = legacyCodexAccountHome(userData, 'account-a')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(path.join(legacy, 'auth.json'), 'fixture')

    const target = migrateLegacyCodexAccountHome(userData, 'account-a', shortRoot)

    expect(target).toBe(codexAccountHome(userData, 'account-a', shortRoot))
    expect(readFileSync(path.join(target, 'auth.json'), 'utf8')).toBe('fixture')
    expect(() => readFileSync(path.join(legacy, 'auth.json'))).toThrow()
    rmSync(fixture, { recursive: true, force: true })
  })
})

describe('shared Codex daemon readiness', () => {
  it('reuses a reachable daemon without starting another process', async () => {
    const start = vi.fn(async () => {})

    await ensureSharedCodexDaemon(async () => true, start)

    expect(start).not.toHaveBeenCalled()
  })

  it('starts exactly once when the account daemon is unavailable', async () => {
    const start = vi.fn(async () => {})

    await ensureSharedCodexDaemon(async () => false, start)

    expect(start).toHaveBeenCalledTimes(1)
  })
})
