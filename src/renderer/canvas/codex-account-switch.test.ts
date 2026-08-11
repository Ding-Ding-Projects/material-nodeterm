import { describe, expect, it } from 'vitest'
import { codexAccountSwitchStillEligible } from './codex-account-switch'

const expected = {
  accountId: 'account-a',
  agentId: 'codex',
  cwd: '/repo',
  sessionId: 'thread-a',
  ssh: false
}

describe('codexAccountSwitchStillEligible', () => {
  it('accepts only the unchanged idle source conversation', () => {
    expect(codexAccountSwitchStillEligible(expected, { ...expected, state: 'done' })).toBe(true)
  })

  it('accepts an unchanged remote source without pretending it is local', () => {
    const remote = { ...expected, ssh: true }
    expect(codexAccountSwitchStillEligible(remote, { ...remote, state: 'done' })).toBe(true)
  })

  it.each([
    { ...expected, state: 'working' },
    { ...expected, sessionId: 'thread-new', state: 'done' },
    { ...expected, accountId: 'account-b', state: 'done' },
    { ...expected, cwd: '/other', state: 'done' },
    { ...expected, ssh: true, state: 'done' }
  ])('rejects state drift before recycle: %o', (current) => {
    expect(codexAccountSwitchStillEligible(expected, current)).toBe(false)
  })
})
