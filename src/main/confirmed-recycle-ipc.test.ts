import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import { registerConfirmedRecycleIpc } from './confirmed-recycle-ipc'
import type { TerminalProfileIpcMain } from './windows-terminal-profiles'

function fakeIpc() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const removed: string[] = []
  const ipc: TerminalProfileIpcMain = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    },
    removeHandler: (channel) => {
      removed.push(channel)
      handlers.delete(channel)
    }
  }
  return { ipc, handlers, removed }
}

describe('registerConfirmedRecycleIpc', () => {
  it('attributes teardown to the native sender and releases tails only after success', async () => {
    const { ipc, handlers } = fakeIpc()
    const order: string[] = []
    const recycleSessionFromClient = vi.fn(async (clientId: number, persistKey: string) => {
      order.push(`recycle:${clientId}:${persistKey}`)
    })
    const releaseNodeTails = vi.fn((persistKey: string) => order.push(`release:${persistKey}`))
    registerConfirmedRecycleIpc(ipc, { recycleSessionFromClient }, releaseNodeTails)
    const target = { profileId: 'wsl:Ubuntu 24.04', cwd: 'C:\\work tree' }

    await handlers.get(IPC.ptyRecycleConfirmed)!({ sender: { id: 73 } }, 'node-4', target)

    expect(recycleSessionFromClient).toHaveBeenCalledWith(73, 'node-4', target)
    expect(releaseNodeTails).toHaveBeenCalledWith('node-4')
    expect(order).toEqual(['recycle:73:node-4', 'release:node-4'])
  })

  it('preserves the legacy manager call shape when no target is provided', async () => {
    const { ipc, handlers } = fakeIpc()
    const recycleSessionFromClient = vi.fn(async () => undefined)
    registerConfirmedRecycleIpc(ipc, { recycleSessionFromClient }, vi.fn())

    await handlers.get(IPC.ptyRecycleConfirmed)!({ sender: { id: 41 } }, 'node-legacy')

    expect(recycleSessionFromClient).toHaveBeenCalledWith(41, 'node-legacy')
  })

  it('keeps live tailers when destructive teardown fails', async () => {
    const { ipc, handlers } = fakeIpc()
    const releaseNodeTails = vi.fn()
    registerConfirmedRecycleIpc(
      ipc,
      {
        recycleSessionFromClient: async () => {
          throw new Error('session-host kill failed')
        }
      },
      releaseNodeTails
    )

    await expect(
      handlers.get(IPC.ptyRecycleConfirmed)!({ sender: { id: 8 } }, 'node-9')
    ).rejects.toThrow('session-host kill failed')
    expect(releaseNodeTails).not.toHaveBeenCalled()
  })

  it('removes the local handler idempotently on teardown', () => {
    const { ipc, handlers, removed } = fakeIpc()
    const dispose = registerConfirmedRecycleIpc(
      ipc,
      { recycleSessionFromClient: async () => {} },
      () => {}
    )

    dispose()
    dispose()

    expect(handlers.has(IPC.ptyRecycleConfirmed)).toBe(false)
    expect(removed).toEqual([IPC.ptyRecycleConfirmed])
  })
})
