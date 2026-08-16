import { describe, expect, it, vi } from 'vitest'
import type { CanvasNodeState, CanvasState } from '../../shared/types'
import {
  CANVAS_STATE_METHOD,
  createHostCanvasSync,
  type CanvasNotifySocket
} from './host-service'

function localNode(): CanvasNodeState {
  return {
    id: 'term-1',
    kind: 'terminal',
    position: { x: 11, y: 22 },
    size: { width: 640, height: 360 },
    title: 'Host terminal',
    color: '#123456',
    group: null,
    cwd: 'C:\\work\\project',
    shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    terminalProfileId: 'wsl:Ubuntu 24.04',
    pendingLaunch: {
      after: ['term-dep-1'],
      launchId: '123e4567-e89b-42d3-a456-426614174000',
      launch: { kind: 'shell-command', command: 'local secret command' }
    },
    ssh: {
      host: 'example.internal',
      user: 'alice',
      port: 2222,
      extraArgs: '-o ProxyCommand=corp-proxy %h',
      execTrusted: true
    }
  }
}

describe('host canvas snapshot egress', () => {
  it('strips machine-local execution state while retaining ordinary canvas data', () => {
    const notices: Array<{ method: string; params: unknown }> = []
    const socket: CanvasNotifySocket = {
      notify: (method, params) => {
        notices.push({ method, params })
        return true
      }
    }
    const state: CanvasState = { nodes: [localNode()] }
    const sync = createHostCanvasSync(socket, vi.fn())

    sync.setState(state)

    expect(notices).toHaveLength(1)
    expect(notices[0].method).toBe(CANVAS_STATE_METHOD)
    const sent = notices[0].params as CanvasState
    expect(sent.nodes[0]).toMatchObject({
      id: 'term-1',
      title: 'Host terminal',
      position: { x: 11, y: 22 },
      size: { width: 640, height: 360 },
      cwd: 'C:\\work\\project',
      ssh: { host: 'example.internal', user: 'alice', port: 2222 }
    })
    expect(sent.nodes[0].shell).toBeUndefined()
    expect(sent.nodes[0].terminalProfileId).toBeUndefined()
    expect(sent.nodes[0].pendingLaunch).toBeUndefined()
    expect(sent.nodes[0].ssh?.extraArgs).toBeUndefined()
    expect(sent.nodes[0].ssh?.execTrusted).toBeUndefined()
  })

  it('does not mutate the renderer-owned snapshot and sanitizes every re-broadcast', () => {
    const sent: CanvasState[] = []
    const socket: CanvasNotifySocket = {
      notify: (_method, params) => {
        sent.push(params as CanvasState)
        return true
      }
    }
    const node = localNode()
    const state: CanvasState = { nodes: [node] }
    const sync = createHostCanvasSync(socket, vi.fn())

    sync.setState(state)
    sync.broadcastCurrent()

    expect(sent).toHaveLength(2)
    expect(sent[0]).not.toBe(state)
    expect(sent[0].nodes[0]).not.toBe(node)
    for (const snapshot of sent) {
      expect(snapshot.nodes[0].shell).toBeUndefined()
      expect(snapshot.nodes[0].terminalProfileId).toBeUndefined()
      expect(snapshot.nodes[0].pendingLaunch).toBeUndefined()
      expect(snapshot.nodes[0].ssh?.extraArgs).toBeUndefined()
      expect(snapshot.nodes[0].ssh?.execTrusted).toBeUndefined()
    }
    expect(node.shell).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    expect(node.terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(node.pendingLaunch?.launch.kind).toBe('shell-command')
    expect(node.ssh?.extraArgs).toBe('-o ProxyCommand=corp-proxy %h')
    expect(node.ssh?.execTrusted).toBe(true)
  })
})
