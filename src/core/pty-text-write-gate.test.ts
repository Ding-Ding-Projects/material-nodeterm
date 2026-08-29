import { describe, expect, it } from 'vitest'
import { PtyManager } from './pty-manager'

/**
 * The sendText write gate — the core half of node-lock enforcement.
 *
 * The renderer refuses input into a locked node, but sendText addresses the session by NAME
 * (dictation, note pushes, canvas-control) and never crosses the renderer, so pty-manager asks the
 * injected gate first. These tests pin the ORDER as much as the answer: a refusing or failing gate
 * must return before the manager even looks the session up, because everything past that lookup
 * talks to a real backend.
 */
function managerWithProbe(): { manager: PtyManager; lookedUp: () => boolean } {
  const manager = new PtyManager()
  let looked = false
  // The lookup is the first thing sendText does AFTER the gate; observing it is how a unit test
  // can tell "refused up front" apart from "proceeded and failed later in a backend-less env"
  // without standing up tmux.
  const original = (manager as unknown as { liveSessionForPersistKey: (k: string) => unknown })
    .liveSessionForPersistKey
  ;(manager as unknown as { liveSessionForPersistKey: (k: string) => unknown }).liveSessionForPersistKey = function (
    this: unknown,
    k: string
  ) {
    looked = true
    return original.call(this, k)
  }
  return { manager, lookedUp: () => looked }
}

describe('sendText write gate', () => {
  it('a refusing gate blocks the write before the session is even looked up', async () => {
    const { manager, lookedUp } = managerWithProbe()
    manager.setTextWriteGate(async () => false)
    expect(await manager.sendText('nt-locked-node', 'echo hi')).toBe(false)
    expect(lookedUp()).toBe(false)
  })

  it('a THROWING gate blocks too — an unanswerable lock question must not default to writing', async () => {
    const { manager, lookedUp } = managerWithProbe()
    manager.setTextWriteGate(async () => {
      throw new Error('store unreadable')
    })
    expect(await manager.sendText('nt-locked-node', 'echo hi')).toBe(false)
    expect(lookedUp()).toBe(false)
  })

  it('an approving gate lets the write proceed into the normal dispatch', async () => {
    const { manager, lookedUp } = managerWithProbe()
    manager.setTextWriteGate(async () => true)
    // The result itself is environment-dependent (no tmux/session-host in a unit test); what the
    // gate must NOT do is short-circuit the dispatch.
    await manager.sendText('nt-free-node', 'echo hi')
    expect(lookedUp()).toBe(true)
  })

  it('no gate installed = the pre-lock behavior, dispatch proceeds', async () => {
    const { manager, lookedUp } = managerWithProbe()
    await manager.sendText('nt-any-node', 'echo hi')
    expect(lookedUp()).toBe(true)
  })
})
