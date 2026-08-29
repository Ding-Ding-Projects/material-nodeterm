import { describe, expect, it } from 'vitest'
import {
  parseRemoteClaudeSkillsOutput,
  remoteClaudeSkillEntries
} from './claude-skills'

describe('Claude skill metadata boundary', () => {
  it('keeps missing, unavailable, and available remote states distinct', () => {
    expect(parseRemoteClaudeSkillsOutput('MISSING\n')).toMatchObject({ state: 'missing', names: [] })
    expect(parseRemoteClaudeSkillsOutput('UNAVAILABLE\n')).toMatchObject({ state: 'unavailable', names: [] })
    expect(parseRemoteClaudeSkillsOutput('OK\nmanage-nodeterm-canvas\nunsafe name\ncustom_skill\n')).toMatchObject({
      state: 'available',
      names: ['custom_skill', 'manage-nodeterm-canvas']
    })
  })

  it('shows product-owned skills as missing when the remote response omits them', () => {
    const parsed = parseRemoteClaudeSkillsOutput('OK\nother-skill\n')
    expect(remoteClaudeSkillEntries(parsed)).toEqual([
      { name: 'get-linked-context', state: 'missing', reason: undefined },
      { name: 'manage-nodeterm-canvas', state: 'missing', reason: undefined },
      { name: 'other-skill', state: 'available' }
    ])
  })
})
