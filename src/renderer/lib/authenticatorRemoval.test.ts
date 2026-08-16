import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatorEntry } from '@shared/authenticator'

import {
  authenticatorRemovalTargetIdentity,
  dispatchAuthenticatorRemoval,
  planAuthenticatorRemoval,
  sameAuthenticatorEntry
} from './authenticatorRemoval'

const ENTRY: AuthenticatorEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  issuer: 'Example',
  account: 'child@example.test',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  createdAt: 1,
  updatedAt: 2,
  revision: 'a'.repeat(64),
  linkedToyLockId: 'lock-1'
}

describe('authenticator seed removal policy', () => {
  it('uses the two-key gate under Kids safety and performs nothing before approval', () => {
    const perform = vi.fn()
    let request:
      | Parameters<Parameters<typeof dispatchAuthenticatorRemoval>[1]['openGate']>[0]
      | undefined

    dispatchAuthenticatorRemoval(planAuthenticatorRemoval(ENTRY, true), {
      perform,
      openGate(next) {
        request = next
        return true
      },
      openConfirm: vi.fn(() => true)
    })

    expect(request?.description).toMatch(/sealed copy of the TOTP seed/i)
    expect(perform).not.toHaveBeenCalled()
    request?.onConfirm()
    expect(perform).toHaveBeenCalledWith('two-key')
  })

  it('preserves the ordinary one-confirm contract only when policy is known off', () => {
    const perform = vi.fn()
    let request:
      | Parameters<Parameters<typeof dispatchAuthenticatorRemoval>[1]['openConfirm']>[0]
      | undefined

    dispatchAuthenticatorRemoval(planAuthenticatorRemoval(ENTRY, false), {
      perform,
      openGate: vi.fn(() => true),
      openConfirm(next) {
        request = next
        return true
      }
    })

    expect(perform).not.toHaveBeenCalled()
    request?.onConfirm()
    expect(perform).toHaveBeenCalledWith('ordinary')
  })

  it('changes identity when any disclosed seed fact or its revision changes', () => {
    const variants: AuthenticatorEntry[] = [
      { ...ENTRY, id: '00000000-0000-4000-8000-000000000002' },
      { ...ENTRY, issuer: 'Replacement' },
      { ...ENTRY, account: 'replacement@example.test' },
      { ...ENTRY, algorithm: 'SHA256' },
      { ...ENTRY, digits: 8 },
      { ...ENTRY, period: 60 },
      { ...ENTRY, createdAt: 0 },
      { ...ENTRY, updatedAt: 3 },
      { ...ENTRY, revision: 'b'.repeat(64) },
      { ...ENTRY, linkedToyLockId: 'lock-2' }
    ]
    for (const variant of variants) {
      expect(authenticatorRemovalTargetIdentity(variant)).not.toBe(
        authenticatorRemovalTargetIdentity(ENTRY)
      )
      expect(sameAuthenticatorEntry(ENTRY, variant)).toBe(false)
    }
  })
})
