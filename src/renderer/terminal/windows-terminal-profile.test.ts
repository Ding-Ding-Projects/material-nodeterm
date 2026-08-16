import { describe, expect, it } from 'vitest'
import {
  windowsTerminalProfileId,
  windowsTerminalProfileLabel,
  type WindowsTerminalProfileSpawnContext
} from './windows-terminal-profile'

const localWindowsDesktop = (
  override: Partial<WindowsTerminalProfileSpawnContext> = {}
): WindowsTerminalProfileSpawnContext => ({
  windows: true,
  desktopProfilesAvailable: true,
  source: 'local',
  ssh: false,
  defaultTerminalProfileId: 'auto',
  ...override
})

describe('windowsTerminalProfileId', () => {
  it('uses a node snapshot, or the current default for a legacy node without one', () => {
    expect(
      windowsTerminalProfileId(localWindowsDesktop({ terminalProfileId: 'wsl:Ubuntu Dev' }))
    ).toBe('wsl:Ubuntu Dev')
    expect(windowsTerminalProfileId(localWindowsDesktop())).toBe('auto')
  })

  it('keeps malformed machine-local ids intact so trusted core validation fails closed', () => {
    expect(windowsTerminalProfileId(localWindowsDesktop({ terminalProfileId: 'bad\u0000id' }))).toBe(
      'bad\u0000id'
    )
    expect(windowsTerminalProfileId(localWindowsDesktop({ terminalProfileId: '' }))).toBe('')
  })

  it.each([
    ['non-Windows', { windows: false }],
    ['Server Edition without the optional bridge', { desktopProfilesAvailable: false }],
    ['relay core', { source: 'relay' as const }],
    ['server core', { source: 'server' as const }],
    ['local SSH terminal', { ssh: true }],
    ['legacy custom executable', { shell: 'C:\\Program Files\\Custom Shell\\shell.exe' }],
    ['even an empty legacy shell field', { shell: '' }]
  ])('omits profileId for %s', (_name, override) => {
    expect(windowsTerminalProfileId(localWindowsDesktop(override))).toBeUndefined()
  })
})

describe('windowsTerminalProfileLabel', () => {
  it.each([
    ['auto', 'Automatic'],
    ['pwsh', 'PowerShell 7'],
    ['windows-powershell', 'Windows PowerShell'],
    ['cmd', 'Command Prompt'],
    ['git-bash', 'Git Bash'],
    ['custom', 'Custom shell'],
    ['wsl:Ubuntu Dev', 'WSL — Ubuntu Dev'],
    ['wsl:日本語 Linux', 'WSL — 日本語 Linux']
  ])('labels %s as %s', (id, label) => {
    expect(windowsTerminalProfileLabel(id)).toBe(label)
  })

  it('does not echo malformed or unknown ids into visible metadata', () => {
    expect(windowsTerminalProfileLabel('wsl:bad\nname')).toBe('Unknown profile')
    expect(windowsTerminalProfileLabel('hostile --argv')).toBe('Unknown profile')
    expect(windowsTerminalProfileLabel(undefined)).toBeNull()
  })
})
