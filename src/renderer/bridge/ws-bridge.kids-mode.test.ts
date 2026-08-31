import { describe, expect, it, vi } from 'vitest'

import { IPC } from '../../shared/ipc'
import { buildRealApi } from './ws-bridge'

describe('Server Edition Kids-mode bridge parity', () => {
  it('forwards credential state, PIN verification, and targeted reset over the shared channels', async () => {
    const request = vi.fn((method: string) => {
      if (method === IPC.kidsModeCredentialState) return Promise.resolve('present')
      if (method === IPC.kidsModeVerifyPin) return Promise.resolve(true)
      return Promise.resolve({ ok: true })
    })
    const client = {
      request,
      subscribe: vi.fn(() => () => {})
    } as never

    const kidsMode = buildRealApi(client).kidsMode
    await expect(kidsMode.credentialState()).resolves.toBe('present')
    await expect(kidsMode.verifyPin('1234')).resolves.toBe(true)
    await expect(kidsMode.resetCredential()).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenNthCalledWith(1, IPC.kidsModeCredentialState)
    expect(request).toHaveBeenNthCalledWith(2, IPC.kidsModeVerifyPin, '1234')
    expect(request).toHaveBeenNthCalledWith(3, IPC.kidsModeResetCredential)
  })
})
