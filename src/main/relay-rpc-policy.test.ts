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

describe('WSL distribution management stays local-only over relay', () => {
  // src/core/wsl/service.ts registers exactly these six channels (docs pending; see the module's
  // own header). This list is a tripwire as much as an assertion: a new wsl:* channel that lands
  // here without a deliberate decision is exactly the failure this repository's relay allowlist
  // exists to prevent (CLAUDE.md, "Relay RPC authorization is an exact allowlist"), and WSL
  // management is machine-global in precisely the sense authenticator:* and password-manager:*
  // already are -- a relay peer gets shell-equivalent access to the JOINED project, never to
  // this desktop's own machine-level state.
  const wslMethods = [
    IPC.wslList,
    IPC.wslCatalogue,
    IPC.wslCreate,
    IPC.wslSleep,
    IPC.wslWake,
    IPC.wslDelete
  ]

  it('is absent from the relay request allowlist', () => {
    for (const method of wslMethods) {
      expect(relayRequestAllowed(method), method).toBe(false)
    }
  })

  it('is absent from the relay cast allowlist', () => {
    for (const method of wslMethods) {
      expect(relayCastAllowed(method), method).toBe(false)
    }
  })
})
