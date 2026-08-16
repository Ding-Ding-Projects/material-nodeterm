import { describe, expect, it, vi } from 'vitest'
import { resolveLocalSessionShell } from './pty-manager'

describe('legacy local session shell fallback', () => {
  it('uses the Windows resolver when explicit and configured shells are empty', () => {
    const windowsShell = vi.fn(() => String.raw`C:\Windows\System32\cmd.exe`)

    expect(
      resolveLocalSessionShell(undefined, '', {
        platform: 'win32',
        windowsShell,
        posixShell: '/bin/should-not-win'
      })
    ).toBe(String.raw`C:\Windows\System32\cmd.exe`)
    expect(windowsShell).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicit program above a configured shell and platform fallback', () => {
    const windowsShell = vi.fn(() => 'cmd.exe')

    expect(
      resolveLocalSessionShell('/opt/custom-shell', '/bin/configured', {
        platform: 'win32',
        windowsShell
      })
    ).toBe('/opt/custom-shell')
    expect(windowsShell).not.toHaveBeenCalled()
  })

  it('keeps a configured compatibility shell above platform fallback', () => {
    const windowsShell = vi.fn(() => 'cmd.exe')

    expect(
      resolveLocalSessionShell(undefined, String.raw`C:\Tools\My Shell\shell.exe`, {
        platform: 'win32',
        windowsShell
      })
    ).toBe(String.raw`C:\Tools\My Shell\shell.exe`)
    expect(windowsShell).not.toHaveBeenCalled()
  })

  it('uses the POSIX shell, then bash, outside Windows', () => {
    expect(resolveLocalSessionShell(undefined, '', { platform: 'linux', posixShell: '/bin/zsh' })).toBe(
      '/bin/zsh'
    )
    expect(resolveLocalSessionShell(undefined, '', { platform: 'linux', posixShell: '' })).toBe('bash')
  })
})
