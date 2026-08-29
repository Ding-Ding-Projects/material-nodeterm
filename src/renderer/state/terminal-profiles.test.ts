import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowsTerminalProfile } from '@shared/types'
import {
  supportsWindowsTerminalProfiles,
  terminalProfileLabel,
  useTerminalProfiles
} from './terminal-profiles'

const PROFILES: WindowsTerminalProfile[] = [
  {
    id: 'auto',
    label: 'Automatic (PowerShell 7)',
    kind: 'auto',
    available: true
  },
  { id: 'pwsh', label: 'PowerShell 7', kind: 'pwsh', available: true },
  {
    id: 'git-bash',
    label: 'Git Bash',
    kind: 'git-bash',
    available: false,
    unavailableReason: 'Git for Windows was not found.'
  }
]

function setPlatform(platform: string): void {
  vi.stubGlobal('navigator', { platform, userAgent: platform })
}

describe('terminal profile renderer state', () => {
  const list = vi.fn(async () => PROFILES)
  const refresh = vi.fn(async () => PROFILES)

  beforeEach(() => {
    setPlatform('Win32')
    vi.stubGlobal('window', {
      nodeTerminal: { terminalProfiles: { list, refresh } }
    })
    useTerminalProfiles.setState({
      profiles: [],
      loading: false,
      initialized: false,
      supported: null,
      error: null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('loads only when a visible surface explicitly asks for profiles', async () => {
    expect(list).not.toHaveBeenCalled()
    await useTerminalProfiles.getState().ensureLoaded()
    expect(list).toHaveBeenCalledOnce()
    expect(useTerminalProfiles.getState()).toMatchObject({
      profiles: PROFILES,
      initialized: true,
      supported: true,
      error: null
    })

    await useTerminalProfiles.getState().ensureLoaded()
    expect(list).toHaveBeenCalledOnce()
  })

  it('uses refresh for explicit re-detection', async () => {
    await useTerminalProfiles.getState().ensureLoaded()
    await useTerminalProfiles.getState().refresh()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps the last good result when refresh fails', async () => {
    await useTerminalProfiles.getState().ensureLoaded()
    refresh.mockRejectedValueOnce(new Error('WSL enumeration timed out'))

    await useTerminalProfiles.getState().refresh()

    expect(useTerminalProfiles.getState()).toMatchObject({
      profiles: PROFILES,
      loading: false,
      initialized: true,
      error: 'WSL enumeration timed out'
    })
  })

  it('uses a non-empty error when IPC rejects without a useful message', async () => {
    list.mockRejectedValueOnce(null)

    await useTerminalProfiles.getState().ensureLoaded()

    expect(useTerminalProfiles.getState().error).toBe('Terminal profile detection failed.')
  })

  it('does not expose or call the desktop API on a non-Windows renderer', async () => {
    setPlatform('MacIntel')
    expect(supportsWindowsTerminalProfiles()).toBe(false)

    await useTerminalProfiles.getState().ensureLoaded()

    expect(list).not.toHaveBeenCalled()
    expect(useTerminalProfiles.getState()).toMatchObject({
      supported: false,
      profiles: []
    })
  })

  it('does not treat a Windows Server Edition browser as desktop support', async () => {
    vi.stubGlobal('window', { nodeTerminal: {} })
    expect(supportsWindowsTerminalProfiles()).toBe(false)

    await useTerminalProfiles.getState().ensureLoaded()

    expect(list).not.toHaveBeenCalled()
    expect(useTerminalProfiles.getState().supported).toBe(false)
  })

  it('provides useful labels before detection and for removed WSL distributions', () => {
    expect(terminalProfileLabel('pwsh', [])).toBe('PowerShell 7')
    expect(terminalProfileLabel('wsl:Ubuntu Development', [])).toBe('WSL — Ubuntu Development')
    expect(terminalProfileLabel('auto', PROFILES)).toBe('Automatic (PowerShell 7)')
  })

  it('does not reflect hostile hand-edited profile ids into labels', () => {
    expect(terminalProfileLabel('', [])).toBe('Unavailable terminal profile')
    expect(terminalProfileLabel('unknown\u202eexe', [])).toBe('Unavailable terminal profile')
    expect(terminalProfileLabel(`wsl:${'x'.repeat(129)}`, [])).toBe('Unavailable terminal profile')
  })
})
