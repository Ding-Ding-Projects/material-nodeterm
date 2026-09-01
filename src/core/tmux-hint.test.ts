import { describe, expect, it } from 'vitest'
import { findCommand, findFixedTmux, tmuxCandidatePaths, tmuxInstall } from './tmux-hint'

describe('tmuxInstall', () => {
  it('uses the first known Linux package manager', () => {
    expect(tmuxInstall('linux', (command) => command === 'apt-get')?.command).toContain(
      'apt-get install -y tmux'
    )
    expect(tmuxInstall('linux', (command) => command === 'dnf')?.command).toBe(
      'sudo dnf install -y tmux'
    )
    expect(tmuxInstall('linux', () => true)?.command).toContain('apt-get')
    expect(tmuxInstall('linux', () => false)).toBeNull()
  })

  it('uses the pinned psmux package on Windows when WinGet is present', () => {
    expect(tmuxInstall('win32', (command) => command === 'winget')).toEqual({
      command: 'winget install -e --id marlocarlo.psmux',
      label: 'Install psmux'
    })
    expect(tmuxInstall('win32', () => false)).toBeNull()
  })
})

describe('findCommand', () => {
  it('scans PATH before fixed Linux fallback directories', () => {
    const seen: string[] = []
    const exists = (candidate: string) => {
      seen.push(candidate)
      return candidate === '/usr/local/bin/tmux'
    }
    expect(findCommand('tmux', { PATH: '/custom/bin:/usr/bin' }, exists, 'linux')).toBe(true)
    expect(seen[0]).toBe('/custom/bin/tmux')
    expect(seen).toContain('/usr/local/bin/tmux')
  })

  it('uses Windows separators and executable suffixes', () => {
    const seen: string[] = []
    expect(
      findCommand(
        'winget',
        { PATH: String.raw`C:\Tools;C:\Windows`, PATHEXT: '.EXE;.CMD' },
        (candidate) => {
          seen.push(candidate)
          return candidate === String.raw`C:\Windows\winget.EXE`
        },
        'win32'
      )
    ).toBe(true)
    expect(seen).toContain(String.raw`C:\Windows\winget.EXE`)
  })
})

describe('tmuxCandidatePaths and findFixedTmux', () => {
  it('covers distro and per-user Nix locations', () => {
    const paths = tmuxCandidatePaths('/home/dev', 'dev')
    expect(paths.slice(0, 2)).toEqual(['/usr/bin/tmux', '/bin/tmux'])
    expect(paths).toContain('/home/dev/.nix-profile/bin/tmux')
    expect(paths).toContain('/etc/profiles/per-user/dev/bin/tmux')
  })

  it('returns the first candidate that exists and tolerates an unreadable one', () => {
    const exists = (candidate: string): boolean => {
      if (candidate === '/usr/bin/tmux') throw new Error('EPERM')
      return candidate === '/bin/tmux'
    }
    expect(findFixedTmux(exists, '/home/dev', 'dev')).toBe('/bin/tmux')
    expect(findFixedTmux(() => false, '/home/dev', 'dev')).toBeNull()
  })

  it('omits user-derived paths when no home is known', () => {
    expect(tmuxCandidatePaths(null).some((candidate) => candidate.includes('undefined'))).toBe(false)
    expect(tmuxCandidatePaths(null).some((candidate) => candidate.includes('.nix-profile'))).toBe(false)
  })
})
