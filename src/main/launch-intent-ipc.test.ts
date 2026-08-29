import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { TerminalLaunchIntent } from '../shared/types'
import { registerLaunchIntentIpc } from './launch-intent-ipc'

function harness() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const removed: string[] = []
  return {
    ipcMain: {
      handle: (channel: string, listener: (...args: any[]) => unknown) => {
        handlers.set(channel, listener)
      },
      removeHandler: (channel: string) => {
        removed.push(channel)
        handlers.delete(channel)
      }
    },
    handlers,
    removed
  }
}

const intent: TerminalLaunchIntent = {
  kind: 'agent',
  action: 'start',
  agentId: 'claude',
  prompt: 'hello'
}

describe('registerLaunchIntentIpc', () => {
  it('attributes the semantic intent to the exact local Electron sender', async () => {
    const h = harness()
    const executeLaunchIntent = vi.fn(async () => ({
      ok: true as const,
      status: 'submitted' as const,
      verified: true
    }))
    registerLaunchIntentIpc(h.ipcMain, { executeLaunchIntent })

    const result = await h.handlers.get(IPC.ptyExecuteLaunchIntent)!(
      { sender: { id: 73 } },
      'session-1',
      'launch-1',
      intent
    )

    expect(executeLaunchIntent).toHaveBeenCalledWith(
      73,
      'session-1',
      'launch-1',
      intent
    )
    expect(result).toEqual({ ok: true, status: 'submitted', verified: true })
  })

  it('propagates manager refusal and never turns it into a false success', async () => {
    const h = harness()
    const refusal = new Error('not subscribed to this live generation')
    const executeLaunchIntent = vi.fn(async () => {
      throw refusal
    })
    registerLaunchIntentIpc(h.ipcMain, { executeLaunchIntent })

    await expect(h.handlers.get(IPC.ptyExecuteLaunchIntent)!(
      { sender: { id: 74 } },
      'session-2',
      'launch-2',
      intent
    )).rejects.toBe(refusal)
  })

  it('removes only its native handler and cleanup is idempotent', () => {
    const h = harness()
    const dispose = registerLaunchIntentIpc(h.ipcMain, {
      executeLaunchIntent: vi.fn()
    })

    dispose()
    dispose()

    expect(h.removed).toEqual([IPC.ptyExecuteLaunchIntent])
    expect(h.handlers.has(IPC.ptyExecuteLaunchIntent)).toBe(false)
  })
})
