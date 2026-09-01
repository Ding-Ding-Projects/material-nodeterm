import { describe, it, expect } from 'vitest'
import {
  remoteLoginCopyFor,
  showsCommandInstead,
  detectHelpPlatform
} from './remoteLoginHelp'

describe('remote-login help copy', () => {
  it('names the OpenSSH Server feature to a Windows reader', () => {
    expect(remoteLoginCopyFor('win32').what).toBe('OpenSSH Server')
    expect(remoteLoginCopyFor('win32').what).not.toContain('Remote Login')
  })

  it('labels the control for the settings app the platform actually has', () => {
    expect(remoteLoginCopyFor('win32').button).toBe('Open Windows Settings')
  })

  it('prints the command instead of a button where nothing can be opened', () => {
    // Linux: no settings URL is right across desktops, so a button either opens the wrong thing or
    // nothing. The command is the honest control.
    expect(showsCommandInstead({ opened: 'none', command: 'sudo systemctl enable --now ssh' })).toBe(true)
    expect(showsCommandInstead({ opened: 'settings' })).toBe(false)
    expect(showsCommandInstead({ opened: 'settings', note: 'openssh-server' })).toBe(false)
  })

  it('offers the button while the answer is still unknown, rather than stranding the reader', () => {
    // Pressing it is what asks the question. Rendering nothing until an answer arrives reproduces
    // the exact dead end this replaced: a warning telling you to turn something on, with no route.
    expect(showsCommandInstead(null)).toBe(false)
  })

  it('does not print an empty command as though it were an instruction', () => {
    expect(showsCommandInstead({ opened: 'none' })).toBe(false)
    expect(showsCommandInstead({ opened: 'none', command: '' })).toBe(false)
  })

  it('reads the platform from either navigator field', () => {
    expect(detectHelpPlatform({ platform: 'Win32' })).toBe('win32')
    expect(detectHelpPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('win32')
    expect(detectHelpPlatform({ platform: 'Linux x86_64' })).toBe('linux')
    // Unknown uses the command-based Linux path instead of inventing a settings destination.
    expect(detectHelpPlatform({})).toBe('linux')
  })
})
