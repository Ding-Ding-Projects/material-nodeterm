// The destructive gate is reachable from every surface, and the runtime GuardedAction registry
// has an executable policy path for each member. This file used to scan source strings for a call
// containing each action. Commented-out or dead code satisfied that Chut, so it proved presence,
// not behavior. The planners below are the functions production dispatchers consume.

import { describe, expect, it, beforeEach } from 'vitest'

import { useDestructiveGate, openDestructiveGate } from './destructiveGate'
import {
  GUARDED_ACTIONS,
  requiresDestructiveGate,
  type GuardedAction
} from '@shared/kids-mode-policy'
import { planNodeDeletion } from '../lib/nodeDeletion'
import { planAccountRemoval } from '../lib/accountRemoval'
import { planAuthenticatorRemoval } from '../lib/authenticatorRemoval'
import { worktreeDiskRemovalNeedsTwoKey } from '../lib/worktreeRemoval'

describe('the gate is reachable from anywhere', () => {
  beforeEach(() => useDestructiveGate.setState({ request: null }))

  it('opens', () => {
    expect(openDestructiveGate({ title: 't', description: 'd', onConfirm: () => {} })).toBe(true)
    expect(useDestructiveGate.getState().request?.title).toBe('t')
  })

  it('REFUSES a second gate while one is open, rather than stacking or replacing', () => {
    // Two sliders for two different irreversible actions, with nothing on screen saying which key
    // belongs to which. Replacing the first would be worse still: the user finishes a slider that
    // now belongs to an action they never saw.
    const first = { title: 'first', description: 'd', onConfirm: () => {} }
    openDestructiveGate(first)
    expect(openDestructiveGate({ title: 'second', description: 'd', onConfirm: () => {} })).toBe(
      false
    )
    expect(useDestructiveGate.getState().request?.title).toBe('first')
  })

  it('a refused open reports it, so the caller does not report a delete that never ran', () => {
    openDestructiveGate({ title: 'first', description: 'd', onConfirm: () => {} })
    const accepted = openDestructiveGate({ title: 'x', description: 'd', onConfirm: () => {} })
    expect(accepted).toBe(false)
  })

  it('closes back to empty, so the next action is not refused forever', () => {
    openDestructiveGate({ title: 't', description: 'd', onConfirm: () => {} })
    useDestructiveGate.getState().close()
    expect(useDestructiveGate.getState().request).toBeNull()
    expect(openDestructiveGate({ title: 'next', description: 'd', onConfirm: () => {} })).toBe(true)
  })
})

describe('every GuardedAction is actually wired to something', () => {
  const entry = {
    id: 'totp',
    issuer: 'Example',
    account: 'child',
    algorithm: 'SHA1' as const,
    digits: 6,
    period: 30,
    createdAt: 1,
    updatedAt: 1
  }
  const plans: Record<GuardedAction, () => boolean> = {
    'delete-project': () => requiresDestructiveGate('delete-project', true).required,
    'delete-node': () =>
      planNodeDeletion({ surface: 'kanban', kidsModeOn: true, titles: ['Session'] }).confirmation ===
      'destructive-gate',
    'discard-changes': () => requiresDestructiveGate('discard-changes', true).required,
    'remove-worktree': () => worktreeDiskRemovalNeedsTwoKey(true, true),
    'remove-account': () =>
      planAccountRemoval({ label: 'Child', affectedNodeCount: 1, kidsModeOn: true }).confirmation ===
      'destructive-gate',
    'remove-authenticator': () =>
      planAuthenticatorRemoval(entry, true).confirmation === 'destructive-gate',
    'revoke-device': () => requiresDestructiveGate('revoke-device', true).required
  }

  it('has one executable planner for every runtime registry member, in both directions', () => {
    expect(Object.keys(plans).sort()).toEqual([...GUARDED_ACTIONS].sort())
    for (const action of GUARDED_ACTIONS) {
      expect(plans[action](), `${action} must produce the two-key route`).toBe(true)
    }
  })
})
