import { describe, expect, it } from 'vitest'
import { VeraCryptManager, type VeraCryptRuntime } from './service'
import type { CorePlatform } from '../platform'

function fakePlatform(): CorePlatform {
  return {
    userDataDir: 'C:\\Users\\test\\AppData\\Local\\nodeterm-test',
    appVersion: '0.0.0-test',
    isPackaged: false,
    handle: () => {},
    on: () => {},
    handleWithSender: () => {},
    onWithSender: () => {},
    sendTo: () => {},
    broadcast: () => {},
    clientIds: () => [],
    openExternal: async () => undefined
  }
}

describe('VeraCryptManager preflight fallbacks', () => {
  it('keeps a rejected drive probe as an empty string list without weakening path checks', async () => {
    const runtime: VeraCryptRuntime = {
      platform: 'win32',
      executableCandidates: [],
      whereExecutable: async () => [],
      run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      pathExists: async () => { throw new Error('drive probe unavailable') },
      lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false })
    }
    const manager = new VeraCryptManager(fakePlatform(), runtime)

    const result = await manager.preflight({ containerPath: 'C:\\vault.hc', driveLetter: 'X' })

    expect(result.ok).toBe(false)
    expect(result.containerPath).toBe('C:\\vault.hc')
    expect(result.availableDriveLetters).toEqual([])
    expect(result.reason).toContain('already occupied or unavailable')
  })
})
