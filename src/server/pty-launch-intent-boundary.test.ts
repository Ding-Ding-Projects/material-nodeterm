import { afterEach, describe, expect, it } from 'vitest'
import { PtyManager } from '../core/pty-manager'
import { initPlatform, resetPlatformForTests } from '../core/platform'
import { E_NO_HANDLER } from '../shared/rpc'
import { IPC } from '../shared/ipc'
import { ServerPlatform } from './platform-server'

afterEach(() => resetPlatformForTests())

describe('Server Edition launch-intent boundary', () => {
  it('registers the ordinary PTY API but omits private Windows launch-intent execution', async () => {
    const platform = new ServerPlatform({ userDataDir: 'server-fixture', appVersion: '0.0.0-test' })
    initPlatform(platform)
    // Deliberately model a Server Edition process running on Windows: without a trusted desktop
    // profile resolver, platform alone must not make this private capability available.
    const pty = new PtyManager({ runtimePlatform: 'win32' })
    pty.registerIpc()

    const ordinary = await platform.dispatch(1, {
      t: 'req',
      id: 1,
      method: IPC.ptySendText,
      args: ['missing-session', 'echo fixture']
    })
    expect(ordinary).toMatchObject({ t: 'res', id: 1, ok: true, result: false })

    const privateLaunch = await platform.dispatch(1, {
      t: 'req',
      id: 2,
      method: IPC.ptyExecuteLaunchIntent,
      args: [
        'live-session-fixture-1',
        '123e4567-e89b-42d3-a456-426614174000',
        { kind: 'agent', action: 'resume', agentId: 'codex', sessionId: 'thread-fixture-1' }
      ]
    })
    expect(privateLaunch).toEqual({
      t: 'res',
      id: 2,
      ok: false,
      error: {
        code: E_NO_HANDLER,
        message: `no handler for ${IPC.ptyExecuteLaunchIntent}`
      }
    })
  })
})
