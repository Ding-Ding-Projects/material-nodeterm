import { describe, expect, it } from 'vitest'
import { modalSpawnFromNodeData } from './modal-spawn'

describe('kanban modal spawn mapping', () => {
  it('preserves the node-snapshotted Windows profile for modal co-attach', () => {
    expect(
      modalSpawnFromNodeData({
        terminalProfileId: 'wsl:Ubuntu Development',
        respawnNonce: 7,
        cwd: 'C:\\work tree',
        agentId: 'codex',
        agentLaunchIntent: {
          kind: 'agent',
          action: 'start',
          agentId: 'codex',
          prompt: "review O'Brien & report"
        },
        agentSessionId: 'thread-123'
      })
    ).toEqual({
      shell: undefined,
      terminalProfileId: 'wsl:Ubuntu Development',
      respawnNonce: 7,
      cwd: 'C:\\work tree',
      agentId: 'codex',
      agentLaunchIntent: {
        kind: 'agent',
        action: 'start',
        agentId: 'codex',
        prompt: "review O'Brien & report"
      },
      agentSessionId: 'thread-123',
      accountId: undefined,
      ssh: undefined,
      sshRemoteTmux: false
    })
  })

  it('changes the modal generation when a profile recycle bumps the node nonce', () => {
    const before = modalSpawnFromNodeData({
      terminalProfileId: 'pwsh',
      respawnNonce: 2
    })
    const after = modalSpawnFromNodeData({
      terminalProfileId: 'cmd',
      respawnNonce: 3
    })

    expect(after.respawnNonce).not.toBe(before.respawnNonce)
    expect(after).toMatchObject({ terminalProfileId: 'cmd', respawnNonce: 3 })
  })
})
