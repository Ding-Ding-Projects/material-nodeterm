import { describe, expect, it } from 'vitest'
import { IPC } from '../shared/ipc'
import { relayCastAllowed, relayRequestAllowed } from './relay-rpc-policy'

describe('relay RPC acknowledgement policy', () => {
  it('prefers acknowledged end requests while retaining old-client cast compatibility', () => {
    for (const channel of [IPC.ptyDestroy, IPC.ptyRecycle]) {
      expect(relayRequestAllowed(channel), channel).toBe(true)
      expect(relayCastAllowed(channel), channel).toBe(true)
    }
  })
})
