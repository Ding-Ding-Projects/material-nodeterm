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
  it('uses a node snapshot, or the current default once it has moved off the shipped auto default', () => {
    expect(
      windowsTerminalProfileId(localWindowsDesktop({ terminalProfileId: 'wsl:Ubuntu Dev' }))
    ).toBe('wsl:Ubuntu Dev')
    // The shipped default is 'auto', and that is not a choice anybody made: a legacy node with no
    // snapshot and a still-default machine must stay on the direct spawn path, not be silently
    // routed into profile resolution and the session-host backend (commit 1c305ec2).
    expect(windowsTerminalProfileId(localWindowsDesktop())).toBeUndefined()
    // Once the user has actually moved the machine default off 'auto', a legacy node without its
    // own snapshot picks up that real choice.
    expect(
      windowsTerminalProfileId(localWindowsDesktop({ defaultTerminalProfileId: 'pwsh' }))
    ).toBe('pwsh')
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
