import { describe, expect, it, vi } from 'vitest'

import {
  ACCOUNT_REMOVAL_COMMITTED_EVENT,
  accountRemovalTargetIdentity,
  dispatchAccountRemoval,
  handleAccountRemovalCommitted,
  handleAccountRemovalTeardown,
  planAccountRemoval,
  requestAccountRemovalTeardown,
  type AccountRemovalTeardownDetail,
  type AuthorizedAccountLoginDeletion
} from './accountRemoval'
import {
  createNodeDeletionCommitBarrier,
  dispatchNodeDeletion,
  planNodeDeletion,
  type NodeDeletionTarget
} from './nodeDeletion'

describe('account-removal transaction gate', () => {
  it('binds account metadata and the exact serialized affected-node set', () => {
    const account = {
      id: 'account-1',
      label: 'Family',
      email: 'family@example.test',
      host: 'example.test',
      pending: true,
      createdAt: 1
    }
    const original = accountRemovalTargetIdentity(account, ['project-a/node-1'])
    const variants = [
      accountRemovalTargetIdentity({ ...account, label: 'Replacement' }, ['project-a/node-1']),
      accountRemovalTargetIdentity(account, ['project-a/node-2']),
      accountRemovalTargetIdentity(account, ['project-a/node-1', 'project-b/node-3'])
    ]
    for (const variant of variants) expect(variant).not.toBe(original)
  })

  it('keeps the account transaction untouched when the Kids-mode gate is cancelled', () => {
    let accountPresent = true
    let loginSessionOpen = true
    let request:
      | Parameters<Parameters<typeof dispatchAccountRemoval>[1]['openGate']>[0]
      | undefined

    dispatchAccountRemoval(
      planAccountRemoval({ label: 'Child account', affectedNodeCount: 2, kidsModeOn: true }),
      {
        perform() {
          accountPresent = false
          loginSessionOpen = false
        },
        openGate(next) {
          request = next
          return true
        },
        openConfirm: vi.fn(() => true)
      }
    )

    expect(request?.title).toMatch(/Remove account/)
    expect(accountPresent).toBe(true)
    expect(loginSessionOpen).toBe(true)
    request?.onCancel?.()
    expect(accountPresent).toBe(true)
    expect(loginSessionOpen).toBe(true)
  })

  it('runs the whole account transaction exactly once after the gate approves it', () => {
    let accountPresent = true
    let loginSessionOpen = true
    const secondGate = vi.fn(() => true)
    const loginTarget: NodeDeletionTarget[] = [
      { id: 'login', projectId: 'project', type: 'terminal', title: 'Account login' }
    ]
    const perform = vi.fn((accountAuthorization: 'ordinary' | 'two-key') => {
      accountPresent = false
      dispatchNodeDeletion(
        planNodeDeletion({
          surface: 'account-removal',
          kidsModeOn: true,
          titles: ['Account login'],
          authorizedBy: {
            action: 'remove-account',
            authorization: accountAuthorization
          }
        }),
        {
          perform: (nodeAuthorization) => {
            createNodeDeletionCommitBarrier({
              disclosedTargets: loginTarget,
              authorization: nodeAuthorization,
              readCurrent: () => loginTarget,
              kidsGateRequired: () => true,
              perform: () => {
                loginSessionOpen = false
              },
              upgradeToTwoKey: secondGate
            })()
          },
          openGate: secondGate,
          openConfirm: vi.fn(() => true)
        }
      )
    })
    let request:
      | Parameters<Parameters<typeof dispatchAccountRemoval>[1]['openGate']>[0]
      | undefined

    dispatchAccountRemoval(
      planAccountRemoval({ label: 'Child account', affectedNodeCount: 1, kidsModeOn: true }),
      {
        perform,
        openGate(next) {
          request = next
          return true
        },
        openConfirm: vi.fn(() => true)
      }
    )

    expect(perform).not.toHaveBeenCalled()
    request?.onConfirm()
    expect(perform).toHaveBeenCalledOnce()
    expect(accountPresent).toBe(false)
    expect(loginSessionOpen).toBe(false)
    expect(secondGate).not.toHaveBeenCalled()
  })

  it('closes live login nodes through the authorized funnel before continuing removal', () => {
    const deleteNodes = vi.fn()
    const continueRemoval = vi.fn()
    let captured:
      | { ids: string[]; request: AuthorizedAccountLoginDeletion }
      | undefined

    const handled = requestAccountRemovalTeardown('account-1', 'two-key', continueRemoval, (detail) => {
      handleAccountRemovalTeardown(
        detail,
        [
          {
            id: 'login',
            data: { accountId: 'account-1', accountLogin: true, title: 'Renamed login' }
          },
          {
            id: 'ordinary',
            data: { accountId: 'account-1', accountLogin: false, title: 'Claude login' }
          },
          { id: 'other', data: { accountId: 'account-2', accountLogin: true } }
        ],
        {
          isLoginNode: (node) => node.data.accountLogin === true,
          requestDeleteNodes(ids, request) {
            captured = { ids, request }
            return true
          },
          deleteNodes
        }
      )
    })

    expect(handled).toBe(true)
    expect(captured?.ids).toEqual(['login'])
    expect(captured?.request).toMatchObject({
      surface: 'account-removal',
      authorizedBy: { action: 'remove-account', authorization: 'two-key' }
    })
    expect(deleteNodes).not.toHaveBeenCalled()
    expect(continueRemoval).not.toHaveBeenCalled()

    captured?.request.perform()
    expect(deleteNodes).toHaveBeenCalledOnce()
    expect(deleteNodes).toHaveBeenCalledWith(['login'])
    expect(continueRemoval).toHaveBeenCalledOnce()

    // A buggy/duplicate close acknowledgement cannot re-run an irreversible account transaction.
    captured?.request.perform()
    expect(deleteNodes).toHaveBeenCalledOnce()
    expect(continueRemoval).toHaveBeenCalledOnce()
  })

  it('does not start the account transaction when no Canvas accepts the teardown', () => {
    const continueRemoval = vi.fn()

    expect(
      requestAccountRemovalTeardown('account-1', 'ordinary', continueRemoval, () => {})
    ).toBe(false)
    expect(continueRemoval).not.toHaveBeenCalled()
  })

  it('continues synchronously after reconciling when no live login node exists', () => {
    const order: string[] = []
    const detail: AccountRemovalTeardownDetail = {
      accountId: 'account-1',
      authorization: 'ordinary',
      handled: false,
      continueRemoval: () => order.push('continue')
    }

    expect(
      handleAccountRemovalTeardown(
        detail,
        [{ id: 'ordinary', data: { accountId: 'account-1', accountLogin: false } }],
        {
          isLoginNode: (node) => node.data.accountLogin === true,
          requestDeleteNodes: vi.fn(() => true),
          deleteNodes: vi.fn()
        }
      )
    ).toBe(true)
    expect(order).toEqual(['continue'])
  })

  it('clears live bindings only after the committed notification', () => {
    const clearLiveBindings = vi.fn()
    const markDirty = vi.fn()

    expect(
      handleAccountRemovalCommitted(
        { accountId: 'account-1' },
        { clearLiveBindings, markDirty }
      )
    ).toBe(true)
    expect(clearLiveBindings).toHaveBeenCalledWith('account-1')
    expect(markDirty).toHaveBeenCalledOnce()
    expect(ACCOUNT_REMOVAL_COMMITTED_EVENT).toBe('nodeterm:account-removal-committed')
  })

  it('keeps the ordinary one-confirm contract while Kids mode is off', () => {
    const perform = vi.fn()
    let request:
      | Parameters<Parameters<typeof dispatchAccountRemoval>[1]['openConfirm']>[0]
      | undefined

    dispatchAccountRemoval(
      planAccountRemoval({ label: 'Work', affectedNodeCount: 0, kidsModeOn: false }),
      {
        perform,
        openGate: vi.fn(() => true),
        openConfirm(next) {
          request = next
          return true
        }
      }
    )

    expect(perform).not.toHaveBeenCalled()
    request?.onConfirm()
    expect(perform).toHaveBeenCalledOnce()
  })

  it('discloses credentials, transcripts, login closure, and fallback before approval', () => {
    const plan = planAccountRemoval({
      label: 'Family',
      affectedNodeCount: 3,
      kidsModeOn: true
    })
    expect(plan.description).toMatch(/credentials.*transcripts/i)
    expect(plan.description).toMatch(/login sessions close/i)
    expect(plan.description).toMatch(/fall back to the system account/i)
    expect(plan.affected).toEqual(['Family', '3 nodes'])
  })
})
