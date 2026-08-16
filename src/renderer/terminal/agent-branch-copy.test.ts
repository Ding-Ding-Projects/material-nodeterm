import { describe, expect, it } from 'vitest'
import { createAgentNode, type CanvasNode } from '../state/workspace'
import { createClaudeBranchCopy } from './agent-branch-copy'

const OLD_LAUNCH_ID = '123e4567-e89b-42d3-a456-426614174000'

describe('createClaudeBranchCopy', () => {
  it('replaces every inherited launch identity with exactly one trusted resume intent', () => {
    const source = createAgentNode('claude', 0, undefined, undefined, 'source prompt')
    source.data = {
      ...source.data,
      title: 'Investigation',
      agentSessionId: 'stale-source-id',
      initialCommand: 'stale already-consumed command',
      agentLaunchIntent: {
        kind: 'agent', action: 'start', agentId: 'claude', prompt: 'stale prompt'
      },
      pendingLaunch: {
        after: ['dependency'],
        launchId: OLD_LAUNCH_ID,
        launch: { kind: 'shell-command', command: 'stale queued command' }
      },
      pendingLaunchError: 'stale failure',
      pendingLaunchErrorKind: 'confirmed'
    }
    const before = structuredClone(source)

    const copy = createClaudeBranchCopy(source, 'trusted-original-id', 'plan')

    expect(copy.id).not.toBe(source.id)
    expect(copy.data).toMatchObject({
      title: 'Investigation (original)',
      agentSessionId: 'trusted-original-id',
      agentLaunchIntent: {
        kind: 'agent',
        action: 'resume',
        agentId: 'claude',
        sessionId: 'trusted-original-id',
        permissionMode: 'plan'
      }
    })
    expect(copy.data.initialCommand).toContain('-r trusted-original-id')
    expect(copy.data.initialCommand).toContain('--permission-mode plan')
    expect(copy.data.pendingLaunch).toBeUndefined()
    expect(copy.data.pendingLaunchError).toBeUndefined()
    expect(copy.data.pendingLaunchErrorKind).toBeUndefined()
    expect(source).toEqual(before)
  })
})
