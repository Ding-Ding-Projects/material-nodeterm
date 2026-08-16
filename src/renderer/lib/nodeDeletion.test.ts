import { describe, expect, it, vi } from 'vitest'

import {
  NODE_DELETE_SURFACES,
  createNodeDeletionCommitBarrier,
  dispatchNodeDeletion,
  initialWorktreeDeleteFromDisk,
  managedDeletionRoots,
  nodeDeletionTargetIncarnation,
  orphanSessionRuntimeIdentity,
  performProjectOwnedNodeDeletion,
  planNodeDeletion,
  worktreeDeleteFromDiskAfterModeChange
} from './nodeDeletion'

describe('node deletion funnel', () => {
  it.each(NODE_DELETE_SURFACES)('%s requires the two-key gate while Kids mode is on', (surface) => {
    expect(
      planNodeDeletion({ surface, kidsModeOn: true, titles: ['Session'] }).confirmation
    ).toBe('destructive-gate')
  })

  it('preserves each surface’s ordinary-mode confirmation contract', () => {
    expect(planNodeDeletion({ surface: 'canvas', kidsModeOn: false, titles: ['A'] }).confirmation).toBe(
      'destructive-gate'
    )
    expect(planNodeDeletion({ surface: 'kanban', kidsModeOn: false, titles: ['A'] }).confirmation).toBe(
      'plain-confirm'
    )
    expect(
      planNodeDeletion({ surface: 'sessions-sidebar', kidsModeOn: false, titles: ['A'] }).confirmation
    ).toBe('plain-confirm')
    expect(
      planNodeDeletion({ surface: 'agent-control', kidsModeOn: false, titles: ['A'] }).confirmation
    ).toBe('plain-confirm')
    expect(
      planNodeDeletion({ surface: 'window-shortcut', kidsModeOn: false, titles: ['A'] }).confirmation
    ).toBe('immediate')
  })

  it('does not ask twice for login nodes already authorized by the account-removal gate', () => {
    expect(
      planNodeDeletion({
        surface: 'account-removal',
        kidsModeOn: true,
        titles: ['Account login'],
        authorizedBy: { action: 'remove-account', authorization: 'two-key' }
      }).confirmation
    ).toBe('immediate')
  })

  it('does not let account-removal authorization bypass another Kids-mode surface', () => {
    expect(
      planNodeDeletion({
        surface: 'canvas',
        kidsModeOn: true,
        titles: ['Ordinary terminal'],
        authorizedBy: { action: 'remove-account', authorization: 'two-key' }
      }).confirmation
    ).toBe('destructive-gate')
  })

  it('tells an owned-session caller that the canvas node is removed too', () => {
    const plan = planNodeDeletion({
      surface: 'sessions-sidebar',
      kidsModeOn: false,
      titles: ['Session']
    })
    expect(plan.message).toMatch(/canvas node will be removed/i)
  })

  it('does not invent a canvas node for an orphan session', () => {
    const plan = planNodeDeletion({
      surface: 'sessions-sidebar',
      kidsModeOn: true,
      titles: ['orphan session abc'],
      removesNode: false
    })
    expect(plan.title).toMatch(/^End /)
    expect(plan.description).toMatch(/terminal session ends immediately/i)
    expect(plan.description).not.toMatch(/canvas node/i)
  })

  it('counts blank-titled nodes without hiding them from a bulk deletion disclosure', () => {
    const plan = planNodeDeletion({
      surface: 'canvas',
      kidsModeOn: true,
      titles: ['', 'Named session']
    })
    expect(plan.title).toBe('Delete 2 nodes')
    expect(plan.affected).toEqual(['node', 'Named session'])
  })

  it('does not perform a gated deletion until the gate authorizes it', () => {
    const perform = vi.fn()
    const cancel = vi.fn()
    let request: Parameters<Parameters<typeof dispatchNodeDeletion>[1]['openGate']>[0] | undefined

    const accepted = dispatchNodeDeletion(
      planNodeDeletion({ surface: 'agent-control', kidsModeOn: true, titles: ['Agent node'] }),
      {
        perform,
        cancel,
        openGate(next) {
          request = next
          return true
        },
        openConfirm: vi.fn(() => true)
      }
    )

    expect(accepted).toBe(true)
    expect(perform).not.toHaveBeenCalled()
    request?.onCancel?.()
    expect(cancel).toHaveBeenCalledOnce()
    expect(perform).not.toHaveBeenCalled()
    request?.onConfirm()
    expect(perform).toHaveBeenCalledOnce()
  })

  it('does not perform a plain-confirm deletion until that dialog authorizes it', () => {
    const perform = vi.fn()
    let request: Parameters<Parameters<typeof dispatchNodeDeletion>[1]['openConfirm']>[0] | undefined

    dispatchNodeDeletion(
      planNodeDeletion({ surface: 'sessions-sidebar', kidsModeOn: false, titles: ['Session'] }),
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

  it('reports a refused gate without performing the deletion', () => {
    const perform = vi.fn()
    const accepted = dispatchNodeDeletion(
      planNodeDeletion({ surface: 'kanban', kidsModeOn: true, titles: ['Session'] }),
      {
        perform,
        openGate: () => false,
        openConfirm: () => true
      }
    )

    expect(accepted).toBe(false)
    expect(perform).not.toHaveBeenCalled()
  })

  it('turns React Flow’s expanded parent deletion back into the requested managed root', () => {
    expect(
      managedDeletionRoots(
        [
          { id: 'group' },
          { id: 'child', parentId: 'group' },
          { id: 'grandchild', parentId: 'child' },
          { id: 'ephemeral' }
        ],
        new Set(['group', 'child', 'grandchild'])
      )
    ).toEqual(['group'])
  })

  it('keeps an explicitly deleted child when its parent is not in the request', () => {
    expect(
      managedDeletionRoots([{ id: 'child', parentId: 'group' }], new Set(['group', 'child']))
    ).toEqual(['child'])
  })

  it('upgrades an open ordinary delete when Kids safety turns on', () => {
    const target = [{ id: 'node', projectId: 'project', type: 'terminal', title: 'Session' }]
    const perform = vi.fn()
    const upgrade = vi.fn()
    const commit = createNodeDeletionCommitBarrier({
      disclosedTargets: target,
      authorization: 'ordinary',
      readCurrent: () => target,
      kidsGateRequired: () => true,
      perform,
      upgradeToTwoKey: upgrade
    })

    expect(commit()).toBe('upgraded-to-two-key')
    expect(perform).not.toHaveBeenCalled()
    expect(upgrade).toHaveBeenCalledWith(target)
  })

  it('performs zero deletion when the disclosed id is replaced under the dialog', () => {
    const perform = vi.fn()
    const refuse = vi.fn()
    const commit = createNodeDeletionCommitBarrier({
      disclosedTargets: [
        { id: 'node', projectId: 'project', type: 'terminal', title: 'Original' }
      ],
      authorization: 'two-key',
      readCurrent: () => [
        { id: 'node', projectId: 'project', type: 'terminal', title: 'Replacement' }
      ],
      kidsGateRequired: () => true,
      perform,
      upgradeToTwoKey: vi.fn(),
      refuse
    })

    expect(commit()).toBe('target-changed')
    expect(perform).not.toHaveBeenCalled()
    expect(refuse).toHaveBeenCalledWith('target-changed')
  })

  it('distinguishes a same-id, same-label replacement node by live incarnation', () => {
    const disclosedNode = { id: 'node' }
    const replacementNode = { id: 'node' }
    const target = [
      {
        id: 'node',
        projectId: 'project',
        type: 'terminal',
        title: 'Same label',
        incarnation: nodeDeletionTargetIncarnation(disclosedNode)
      }
    ]
    const perform = vi.fn()
    const commit = createNodeDeletionCommitBarrier({
      disclosedTargets: target,
      authorization: 'two-key',
      readCurrent: () => [
        {
          ...target[0],
          incarnation: nodeDeletionTargetIncarnation(replacementNode)
        }
      ],
      kidsGateRequired: () => true,
      perform,
      upgradeToTwoKey: vi.fn()
    })

    expect(commit()).toBe('target-changed')
    expect(perform).not.toHaveBeenCalled()
  })

  it('distinguishes a reused orphan tmux id by its live pane generation', () => {
    const original = orphanSessionRuntimeIdentity({
      session: 'nt-node',
      nodeId: 'node',
      panePid: 101,
      command: 'pwsh'
    })
    const replacement = orphanSessionRuntimeIdentity({
      session: 'nt-node',
      nodeId: 'node',
      panePid: 202,
      command: 'pwsh'
    })

    expect(replacement).not.toBe(original)
  })

  it('uses the live project owner after a sidebar dialog outlives a project switch', () => {
    let activeProjectId: string | null = 'project-a'
    const deleteFromActiveProject = vi.fn()
    const deleteFromStoredProject = vi.fn()

    // The dialog was disclosed while A was active; B owns the canvas by commit time.
    activeProjectId = 'project-b'
    expect(
      performProjectOwnedNodeDeletion('project-a', {
        readActiveProjectId: () => activeProjectId,
        deleteFromActiveProject,
        deleteFromStoredProject
      })
    ).toBe('stored-project')
    expect(deleteFromActiveProject).not.toHaveBeenCalled()
    expect(deleteFromStoredProject).toHaveBeenCalledOnce()
  })
})

describe('worktree removal choice', () => {
  it('defaults app-created worktrees to deletion only outside Kids mode', () => {
    expect(initialWorktreeDeleteFromDisk(true, false)).toBe(true)
    expect(initialWorktreeDeleteFromDisk(true, true)).toBe(false)
    expect(initialWorktreeDeleteFromDisk(false, false)).toBe(false)
    expect(initialWorktreeDeleteFromDisk(false, true)).toBe(false)
  })

  it('clears an already-open deletion choice on the live OFF→ON transition', () => {
    expect(worktreeDeleteFromDiskAfterModeChange(true, false, true)).toBe(false)
  })

  it('does not erase a deliberate opt-in on every enabled render', () => {
    expect(worktreeDeleteFromDiskAfterModeChange(true, true, true)).toBe(true)
  })

  it('resets again after Kids mode is disabled and enabled a second time', () => {
    const afterDisable = worktreeDeleteFromDiskAfterModeChange(true, true, false)
    expect(afterDisable).toBe(true)
    expect(worktreeDeleteFromDiskAfterModeChange(afterDisable, false, true)).toBe(false)
  })
})
