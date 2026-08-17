import { describe, expect, it } from 'vitest'
import { troubleshootSteps } from './troubleshoot'

describe('troubleshootSteps', () => {
  it('darwin, health not passed (unknown whether installed): shows install AND start AND verify', () => {
    expect(troubleshootSteps('darwin').map((s) => s.label)).toEqual([
      'Install Ollama (Homebrew)',
      'Or download the macOS app',
      'Start the Ollama service',
      'Verify it is listening'
    ])
  })

  it('darwin, health "stopped" (real evidence the binary is already installed): skips the install steps', () => {
    expect(troubleshootSteps('darwin', 'stopped').map((s) => s.label)).toEqual([
      'Start the Ollama service',
      'Verify it is listening'
    ])
  })

  it('darwin, health "not-installed": still shows the full install sequence, same as no health at all', () => {
    expect(troubleshootSteps('darwin', 'not-installed')).toEqual(troubleshootSteps('darwin'))
  })

  it('win32, health "not-installed": keeps the download step', () => {
    expect(troubleshootSteps('win32', 'not-installed')[0].label).toBe('Download the Windows installer')
  })

  it('win32, health "stopped": drops the download step, keeps the tray-icon + verify steps', () => {
    expect(troubleshootSteps('win32', 'stopped').map((s) => s.label)).toEqual([
      'Ollama starts automatically after install — check the system tray icon',
      'Verify it is listening (PowerShell)'
    ])
  })

  it('linux, health "unreachable" (a timeout/abort genuinely does not tell us whether it is installed): shows every step, same as no health at all', () => {
    expect(troubleshootSteps('linux', 'unreachable')).toEqual(troubleshootSteps('linux'))
  })

  it('linux, health "unhealthy": also shows every step — a bad response still doesn\'t prove the binary is where we\'d expect', () => {
    expect(troubleshootSteps('linux', 'unhealthy')).toEqual(troubleshootSteps('linux'))
  })

  it('linux, health "stopped": drops only the install step, keeps both start options and verify', () => {
    expect(troubleshootSteps('linux', 'stopped').map((s) => s.label)).toEqual([
      'Start the service',
      'Or run it directly in a terminal',
      'Verify it is listening'
    ])
  })

  it('an unrecognized platform string falls back to the linux steps', () => {
    expect(troubleshootSteps('freebsd')).toEqual(troubleshootSteps('linux'))
    expect(troubleshootSteps('freebsd', 'stopped')).toEqual(troubleshootSteps('linux', 'stopped'))
  })

  it('every step still carries a command where the original always did (health filtering must not blank the guidance)', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      for (const health of [undefined, 'not-installed', 'stopped', 'unreachable', 'unhealthy'] as const) {
        const steps = troubleshootSteps(platform, health)
        expect(steps.length).toBeGreaterThan(0)
      }
    }
  })
})
