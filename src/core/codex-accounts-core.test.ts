import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  codexAccountHome,
  codexHomeForAccount,
  codexSessionEnv,
  codexTmuxEnvArgs,
  codexSocketForAccount
} from './codex-accounts-core'

describe('managed Codex account paths', () => {
  it('isolates two accounts under distinct homes and shared-server sockets', () => {
    const userData = '/isolated/nodeterm'
    expect(codexAccountHome(userData, 'account-a')).toBe(
      path.join(userData, 'codex-accounts', 'account-a')
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
    expect(codexSessionEnv('/isolated/nodeterm')).toMatchObject({
      NODETERM_CODEX_ACCOUNT_ID: ''
    })
    expect(codexSessionEnv('/isolated/nodeterm', 'account-a')).toEqual({
      CODEX_HOME: path.join('/isolated/nodeterm', 'codex-accounts', 'account-a'),
      NODETERM_CODEX_ACCOUNT_ID: 'account-a'
    })
    expect(codexTmuxEnvArgs('/isolated/nodeterm', 'account-a')).toEqual([
      '-e',
      `CODEX_HOME=${path.join('/isolated/nodeterm', 'codex-accounts', 'account-a')}`,
      '-e',
      'NODETERM_CODEX_ACCOUNT_ID=account-a'
    ])
  })
})
