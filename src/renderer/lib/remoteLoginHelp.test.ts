import { describe, it, expect } from 'vitest'
import {
  remoteLoginCopyFor,
  showsCommandInstead,
  detectHelpPlatform
} from './remoteLoginHelp'

describe('remote-login help copy', () => {
  it('never says "Remote Login" to a Windows reader — their machine has no such setting', () => {
    // The whole reason this module exists. "Remote Login" is macOS's name; on Windows the thing to
    // turn on is the OpenSSH Server optional feature, and telling a Windows user to find "Remote
    // Login" sends them hunting for a switch that does not exist under that name.
    expect(remoteLoginCopyFor('win32').what).toBe('OpenSSH Server')
    expect(remoteLoginCopyFor('win32').what).not.toContain('Remote Login')
    expect(remoteLoginCopyFor('darwin').what).toBe('Remote Login')
  })

  it('labels the control for the settings app the platform actually has', () => {
    expect(remoteLoginCopyFor('darwin').button).toBe('Open System Settings')
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
    expect(detectHelpPlatform({ platform: 'MacIntel' })).toBe('darwin')
    expect(detectHelpPlatform({ platform: 'Win32' })).toBe('win32')
    expect(detectHelpPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('win32')
    expect(detectHelpPlatform({ platform: 'Linux x86_64' })).toBe('linux')
    // Unknown is not macOS: defaulting to darwin would put "Remote Login" and a mac-only button in
    // front of somebody whose platform we failed to read.
    expect(detectHelpPlatform({})).toBe('linux')
  })
})
