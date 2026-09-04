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

  it('win32: suggests the supported psmux install when WinGet is available', () => {
    expect(tmuxInstall('win32', (command) => command === 'winget')).toEqual({
      command:
        'winget install --exact --id marlocarlo.psmux --source winget --accept-source-agreements --accept-package-agreements --silent',
      label: 'Install psmux'
    })
    expect(tmuxInstall('win32', () => false)).toBeNull()
  })
})

describe('findCommand', () => {
  it('scans PATH before fixed Linux fallback directories', () => {
    const seen: string[] = []
    const exists = (p: string) => (seen.push(p), p === '/opt/homebrew/bin/brew')
    expect(findCommand('brew', { PATH: '/usr/bin:/bin' }, exists, 'darwin')).toBe(true)
    expect(seen).toContain('/usr/bin/brew') // PATH first
    expect(seen).toContain('/opt/homebrew/bin/brew') // then the common dirs
    expect(findCommand('brew', { PATH: '/usr/bin' }, () => false, 'darwin')).toBe(false)
  })

  it('tolerates a missing PATH', () => {
    expect(findCommand('brew', {}, (p) => p === '/usr/local/bin/brew', 'darwin')).toBe(true)
  })
})

describe('tmuxCandidatePaths / findFixedTmux', () => {
  it('keeps the four historical paths first, in their historical order', () => {
    expect(tmuxCandidatePaths('/Users/dev', 'dev').slice(0, 4)).toEqual([
      '/opt/homebrew/bin/tmux',
      '/usr/local/bin/tmux',
      '/usr/bin/tmux',
      '/bin/tmux'
    ])
  })

  it('covers the package managers the four fixed paths missed (silent plain-shell fallback)', () => {
    const paths = tmuxCandidatePaths('/Users/dev', 'dev')
    expect(paths).toContain('/opt/local/bin/tmux') // MacPorts
    expect(paths).toContain('/run/current-system/sw/bin/tmux') // NixOS system profile
    expect(paths).toContain('/Users/dev/.nix-profile/bin/tmux') // nix single-user profile
    expect(paths).toContain('/etc/profiles/per-user/dev/bin/tmux') // home-manager / nix-darwin
    expect(paths).toContain('/home/linuxbrew/.linuxbrew/bin/tmux') // Linuxbrew
  })

  it('falls back to the home directory basename when no user name is known', () => {
    expect(tmuxCandidatePaths('/home/ada')).toContain('/etc/profiles/per-user/ada/bin/tmux')
    // No home at all (an odd/locked-down environment): the home-derived paths are simply absent,
    // never emitted as `undefined/...`.
    expect(tmuxCandidatePaths(null).some((p) => p.includes('undefined'))).toBe(false)
    expect(tmuxCandidatePaths(null).some((p) => p.includes('.nix-profile'))).toBe(false)
  })

  it('returns the FIRST candidate that exists', () => {
    const seen: string[] = []
    const exists = (p: string): boolean => (seen.push(p), p === '/opt/local/bin/tmux')
    expect(findFixedTmux(exists, '/Users/dev', 'dev')).toBe('/opt/local/bin/tmux')
    expect(seen[0]).toBe('/opt/homebrew/bin/tmux') // ordered walk, homebrew still wins first
    expect(findFixedTmux(() => false, '/Users/dev', 'dev')).toBeNull()
  })

  it('treats a throwing existsSync as "not here" rather than failing the whole probe', () => {
    const exists = (p: string): boolean => {
      if (p === '/opt/homebrew/bin/tmux') throw new Error('EPERM')
      return p === '/usr/bin/tmux'
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
