import { describe, expect, it } from 'vitest'
import { sameTerminalCoState, type ComparableTerminalCoState } from './co-state-equality'

const base = (): ComparableTerminalCoState => ({
  letterbox: false,
  closed: null,
  ended: false,
  offline: false,
  spawnError: null,
  agentRelaunchError: null
})

describe('sameTerminalCoState', () => {
  it('treats spawn and agent-relaunch errors as visible state changes', () => {
    const previous = base()
    expect(
      sameTerminalCoState(previous, {
        ...previous,
        spawnError: 'spawn failed'
      })
    ).toBe(false)
    expect(
      sameTerminalCoState(previous, {
        ...previous,
        agentRelaunchError: { code: 'custom-agent-not-configured' }
      })
    ).toBe(false)
  })

  it('keeps identical visible state as a no-op', () => {
    const state = base()
    expect(sameTerminalCoState(state, state)).toBe(true)
  })
})
