import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { WindowsTerminalProfile } from '../shared/types'
import {
  registerWindowsTerminalProfileIpc,
  type DesktopTerminalProfileCatalog,
  type TerminalProfileIpcMain
} from './windows-terminal-profiles'

function fakeIpc() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const removed: string[] = []
  const ipc: TerminalProfileIpcMain = {
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`)
      handlers.set(channel, listener)
    },
    removeHandler(channel) {
      removed.push(channel)
      handlers.delete(channel)
    }
  }
  return { ipc, handlers, removed }
}

const profile = (overrides: Partial<WindowsTerminalProfile> = {}): WindowsTerminalProfile => ({
  id: 'pwsh',
  label: 'PowerShell 7',
  kind: 'pwsh',
  available: true,
  ...overrides
})

describe('registerWindowsTerminalProfileIpc', () => {
  it('serves list and refresh only through the two native IPC handlers', async () => {
    const { ipc, handlers } = fakeIpc()
    const list = vi.fn(() => [profile()])
    const refresh = vi.fn(async () => [profile({ available: false, unavailableReason: 'removed' })])

    registerWindowsTerminalProfileIpc(ipc, { list, refresh })

    await expect(handlers.get(IPC.terminalProfilesList)!({ sender: { id: 1 } })).resolves.toEqual([
      profile()
    ])
    await expect(
      handlers.get(IPC.terminalProfilesRefresh)!({ sender: { id: 1 } })
    ).resolves.toEqual([profile({ available: false, unavailableReason: 'removed' })])
    expect(list).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect([...handlers.keys()].sort()).toEqual(
      [IPC.terminalProfilesList, IPC.terminalProfilesRefresh].sort()
    )
  })

  it('allowlists public fields so executable and argv details cannot cross the bridge', async () => {
    const { ipc, handlers } = fakeIpc()
    const privateCoreResult = {
      ...profile(),
      executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      argv: ['-NoLogo'],
      cwd: 'C:\\private'
    }
    const catalog: DesktopTerminalProfileCatalog = {
      list: () => [privateCoreResult],
      refresh: () => [privateCoreResult]
    }

    registerWindowsTerminalProfileIpc(ipc, catalog)
    const result = await handlers.get(IPC.terminalProfilesList)!({})

    expect(result).toEqual([profile()])
    expect(JSON.stringify(result)).not.toContain('executable')
    expect(JSON.stringify(result)).not.toContain('argv')
    expect(JSON.stringify(result)).not.toContain('C:\\private')
  })

  it('removes both handlers exactly once when disposed', () => {
    const { ipc, handlers, removed } = fakeIpc()
    const dispose = registerWindowsTerminalProfileIpc(ipc, {
      list: () => [],
      refresh: () => []
    })

    dispose()
    dispose()

    expect(handlers.size).toBe(0)
    expect(removed).toEqual([IPC.terminalProfilesList, IPC.terminalProfilesRefresh])
  })

  it('rolls back the first handler if the second registration fails', () => {
    const handlers = new Map<string, (...args: any[]) => unknown>()
    const removed: string[] = []
    const ipc: TerminalProfileIpcMain = {
      handle(channel, listener) {
        if (channel === IPC.terminalProfilesRefresh) throw new Error('refresh registration failed')
        handlers.set(channel, listener)
      },
      removeHandler(channel) {
        removed.push(channel)
        handlers.delete(channel)
      }
    }

    expect(() =>
      registerWindowsTerminalProfileIpc(ipc, { list: () => [], refresh: () => [] })
    ).toThrow('refresh registration failed')
    expect(handlers.size).toBe(0)
    expect(removed).toEqual([IPC.terminalProfilesList])
  })
})
