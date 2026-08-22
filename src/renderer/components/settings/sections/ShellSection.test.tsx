// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type WindowsTerminalProfile } from '@shared/types'
import { useSettings } from '../../../state/settings'
import { useTerminalProfiles } from '../../../state/terminal-profiles'
import { ShellSection } from './ShellSection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  },
  {
    id: 'custom',
    label: 'Custom executable',
    kind: 'custom',
    available: false,
    unavailableReason: 'No custom executable is configured.'
  }
]

describe('ShellSection Windows terminal profiles', () => {
  let root: Root | undefined
  let host: HTMLElement
  let list: ReturnType<typeof vi.fn>
  let refresh: ReturnType<typeof vi.fn>
  let selectFile: ReturnType<typeof vi.fn>
  let save: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32'
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    list = vi.fn(async () => PROFILES)
    refresh = vi.fn(async () => PROFILES)
    selectFile = vi.fn(async () => null)
    save = vi.fn(async () => undefined)
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      terminalProfiles: { list, refresh },
      dialog: { selectFile },
      settings: { save }
    }
    const settings = {
      ...DEFAULT_SETTINGS,
      defaultShell: '',
      defaultTerminalProfileId: 'auto'
    }
    useSettings.setState({ settings, base: settings })
    useTerminalProfiles.setState({
      profiles: [],
      loading: false,
      initialized: false,
      supported: null,
      error: null
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
    act(() => vi.runOnlyPendingTimers())
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const render = async (isActive = true): Promise<void> => {
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellSection isActive={isActive} />)
    })
  }

  const button = (label: string): HTMLButtonElement => {
    const result = [...host.querySelectorAll('button')].find((element) =>
      element.textContent?.includes(label)
    )
    if (!result) throw new Error(`Button not found: ${label}`)
    return result
  }

  const click = async (element: Element): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  const chooseProfile = (profileId: string): void => {
    const select = host.querySelector<HTMLSelectElement>('#terminal-profile-select')!
    act(() => {
      select.value = profileId
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  const typeCustom = (value: string): void => {
    const input = host.querySelector<HTMLInputElement>('#custom-shell-executable')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('does not enumerate profiles until the Shell section is actually rendered', async () => {
    await render(false)
    expect(host.textContent).toBe('')
    expect(list).not.toHaveBeenCalled()

    await act(async () => {
      root!.render(<ShellSection isActive />)
    })

    expect(list).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('Automatic (PowerShell 7) is available.')
  })

  it('shows detected availability and disables unavailable choices with their reason', async () => {
    await render()

    const unavailable = [
      ...host.querySelectorAll<HTMLOptionElement>('#terminal-profile-select option')
    ].find((option) => option.value === 'git-bash')
    expect(unavailable?.disabled).toBe(true)
    expect(unavailable?.textContent).toContain('unavailable')
    expect(host.textContent).toContain('Git for Windows was not found.')
    expect(host.querySelector('[aria-label="Detected terminal profile availability"]')).toBeTruthy()
  })

  it('associates labels, status, and the custom picker with their controls', async () => {
    await render()

    expect(host.querySelector('label[for="terminal-profile-select"]')).toBeTruthy()
    expect(host.querySelector('label[for="custom-shell-executable"]')).toBeTruthy()
    expect(host.querySelector('#terminal-profile-select')?.getAttribute('aria-describedby')).toBe(
      'terminal-profile-status'
    )
    expect(button('Choose executable').getAttribute('aria-controls')).toBe(
      'custom-shell-executable'
    )
  })

  it('changes only the profile id when a detected default is selected', async () => {
    const settings = {
      ...useSettings.getState().base,
      defaultShell: 'C:\\Tools With Spaces\\shell.exe'
    }
    useSettings.setState({ settings, base: settings })
    await render()

    chooseProfile('pwsh')

    expect(useSettings.getState().settings.defaultTerminalProfileId).toBe('pwsh')
    expect(useSettings.getState().settings.defaultShell).toBe('C:\\Tools With Spaces\\shell.exe')
  })

  it('selects custom even when the custom executable is emptied, without falling back', async () => {
    const settings = {
      ...useSettings.getState().base,
      defaultShell: 'C:\\Tools\\shell.exe'
    }
    useSettings.setState({ settings, base: settings })
    await render()
    typeCustom('')

    expect(useSettings.getState().settings).toMatchObject({
      defaultShell: '',
      defaultTerminalProfileId: 'custom'
    })
    expect(host.textContent).toContain(
      'Unavailable until an executable is chosen. New terminals will not silently fall back.'
    )
  })

  it('preserves an executable path containing spaces from the native picker and selects custom', async () => {
    selectFile.mockResolvedValueOnce('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    await render()

    await click(button('Choose executable'))

    expect(useSettings.getState().settings).toMatchObject({
      defaultShell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      defaultTerminalProfileId: 'custom'
    })
  })

  it('hands detection the exact custom path WITHOUT persisting base settings', async () => {
    // This used to assert that Refresh persisted `base` first. That was the defect, not the
    // contract: persisting here bypassed project scope, ignored sparse overrides and could
    // make a project-local shell look global — refreshDetection's own comment records why it
    // was removed. Detection now receives the effective value directly and persistence stays
    // owned by useSettings.update().
    await render()
    typeCustom('C:\Program Files\Git\bin\bash.exe')

    await click(button('Refresh detection'))

    expect(refresh).toHaveBeenCalledWith('C:\Program Files\Git\bin\bash.exe')
    expect(save).not.toHaveBeenCalled()
  })

  it('changes nothing when the native picker is cancelled', async () => {
    await render()
    await click(button('Choose executable'))

    expect(useSettings.getState().settings).toMatchObject({
      defaultShell: '',
      defaultTerminalProfileId: 'auto'
    })
  })

  it('surfaces a refresh failure without replacing the saved default or last profile list', async () => {
    refresh.mockRejectedValueOnce(new Error('WSL enumeration timed out'))
    await render()

    await click(button('Refresh detection'))

    expect(host.textContent).toContain('Detection failed: WSL enumeration timed out')
    expect(host.textContent).toContain('Previous availability may be stale.')
    expect(host.textContent).toContain('PowerShell 7')
    expect(useSettings.getState().settings.defaultTerminalProfileId).toBe('auto')
  })

  it('keeps a failed initial read distinct from an empty or unavailable result', async () => {
    list.mockRejectedValueOnce(new Error('Profile IPC disconnected'))
    await render()

    expect(host.textContent).toContain('Detection failed: Profile IPC disconnected')
    expect(host.textContent).toContain(
      'Profile detection failed. The saved default was not changed.'
    )
    expect(host.textContent).not.toContain('No terminal profiles were returned.')
    expect(host.textContent).not.toContain('this saved profile is no longer detected')
    expect(host.querySelector<HTMLSelectElement>('#terminal-profile-select')?.value).toBe(
      '__configured-profile-unavailable__'
    )
    expect(useSettings.getState().settings.defaultTerminalProfileId).toBe('auto')
  })

  it('shows a saved profile that disappeared as unavailable instead of selecting a fallback', async () => {
    const settings = {
      ...useSettings.getState().base,
      defaultTerminalProfileId: 'wsl:Removed Distribution'
    }
    useSettings.setState({ settings, base: settings })
    await render()

    const select = host.querySelector<HTMLSelectElement>('#terminal-profile-select')!
    expect(select.value).toBe('__configured-profile-unavailable__')
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain(
      'WSL — Removed Distribution is unavailable: this saved profile is no longer detected'
    )
    expect(useSettings.getState().settings.defaultTerminalProfileId).toBe(
      'wsl:Removed Distribution'
    )
  })

  it('keeps an explicitly empty hand-edited profile id unavailable instead of falling back', async () => {
    const settings = {
      ...useSettings.getState().base,
      defaultShell: 'C:\\Tools\\shell.exe',
      defaultTerminalProfileId: ''
    }
    useSettings.setState({ settings, base: settings })
    await render()

    const select = host.querySelector<HTMLSelectElement>('#terminal-profile-select')!
    expect(select.value).toBe('__configured-profile-unavailable__')
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain(
      'Unavailable terminal profile is unavailable: this saved profile is no longer detected'
    )
    expect(useSettings.getState().settings.defaultTerminalProfileId).toBe('')
  })

  it('does not reflect a hostile hand-edited id into profile option text or values', async () => {
    const hostileId = 'unknown\u202eexe'
    const settings = {
      ...useSettings.getState().base,
      defaultTerminalProfileId: hostileId
    }
    useSettings.setState({ settings, base: settings })
    await render()

    const options = [...host.querySelectorAll<HTMLOptionElement>('#terminal-profile-select option')]
    expect(options.some((option) => option.value === hostileId)).toBe(false)
    expect(host.textContent).not.toContain(hostileId)
    expect(host.textContent).toContain('Unavailable terminal profile')
    expect(useSettings.getState().settings.defaultTerminalProfileId).toBe(hostileId)
  })

  it('keeps the existing shell field and never calls the optional API off Windows', async () => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel'
    })
    await render()

    expect(host.querySelector('#settings-default-shell')).toBeTruthy()
    expect(host.querySelector('#terminal-profile-select')).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })
})
