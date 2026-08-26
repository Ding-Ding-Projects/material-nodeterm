import { describe, expect, it } from 'vitest'
import { quitWouldLoseWork } from './quit-risk'

describe('quitWouldLoseWork', () => {
  it('is false with no sessions at all', () => {
    expect(quitWouldLoseWork([])).toBe(false)
  })

  it('is false when every session is tmux/session-host backed', () => {
    expect(quitWouldLoseWork([{ tmuxBacked: true }, { tmuxBacked: true }])).toBe(false)
  })

  it('is true when even one session has no persistent backend', () => {
    expect(quitWouldLoseWork([{ tmuxBacked: true }, { tmuxBacked: false }])).toBe(true)
  })

  it('is true for a lone plain-shell session', () => {
    expect(quitWouldLoseWork([{ tmuxBacked: false }])).toBe(true)
  })
})
