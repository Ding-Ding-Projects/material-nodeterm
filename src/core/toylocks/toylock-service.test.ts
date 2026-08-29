// Task 2 (password+TOTP combo) and Task 3 (Windows PIN) coverage for toylock-service.ts. Follows
// the same real-SecureStore-over-a-tmp-dir harness src/core/secure-store.test.ts already uses for
// this service, rather than mocking SecureStore itself — the sealing/unsealing round trip is part
// of what a combo lock's correctness depends on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { fakePlatform, type FakePlatform } from '../platform-fake'
import { initPlatform, resetPlatformForTests } from '../platform'
import { startToyLockService } from './toylock-service'
import { totp } from './totp'
import { base32Decode } from './totp'
import { IPC } from '../../shared/ipc'
import type {
  ToyLockBeginTotpInput,
  ToyLockBeginTotpResult,
  ToyLockConfirmTotpInput,
  ToyLockConfirmTotpResult,
  ToyLockCreatePasswordInput,
  ToyLockCreateResult,
  ToyLockVerifyInput,
  ToyLockVerifyResult
} from '../../shared/toylock'

let dir = ''
let corePlatform: FakePlatform

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodeterm-toylock-'))
  resetPlatformForTests()
  corePlatform = fakePlatform({ userDataDir: dir })
  initPlatform(corePlatform)
})

afterEach(async () => {
  resetPlatformForTests()
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function handlers(): {
  createPassword: (input: ToyLockCreatePasswordInput) => Promise<ToyLockCreateResult>
  beginTotp: (input: ToyLockBeginTotpInput) => Promise<ToyLockBeginTotpResult>
  confirmTotp: (input: ToyLockConfirmTotpInput) => Promise<ToyLockConfirmTotpResult>
  verify: (input: ToyLockVerifyInput) => Promise<ToyLockVerifyResult>
} {
  return {
    createPassword: corePlatform.handlers[IPC.toylockCreatePassword] as never,
    beginTotp: corePlatform.handlers[IPC.toylockBeginTotp] as never,
    confirmTotp: corePlatform.handlers[IPC.toylockConfirmTotp] as never,
    verify: corePlatform.handlers[IPC.toylockVerify] as never
  }
}

describe('password+TOTP combo (Task 2)', () => {
  it('requires BOTH factors — a correct password alone does not unlock', async () => {
    const service = startToyLockService()
    try {
      const { beginTotp, confirmTotp, verify } = handlers()
      const begin = await beginTotp({
        target: { kind: 'node', id: 'n1', label: 'Node 1' },
        duration: 'until-close',
        lockedOnLaunch: true,
        password: 'correct-horse'
      })
      expect(begin.ok).toBe(true)
      if (!begin.ok) return
      const code = totp(base32Decode(begin.enrollment.secretBase32))
      const confirmed = await confirmTotp({ lockId: begin.enrollment.lockId, code })
      expect(confirmed.ok).toBe(true)
      if (!confirmed.ok) return
      expect(confirmed.record.credentialKind).toBe('password-totp')

      const passwordOnly = await verify({ id: confirmed.record.id, password: 'correct-horse' })
      expect(passwordOnly.ok).toBe(false)
    } finally {
      service.dispose()
    }
  })

  it('requires BOTH factors — a correct code alone does not unlock', async () => {
    const service = startToyLockService()
    try {
      const { beginTotp, confirmTotp, verify } = handlers()
      const begin = await beginTotp({
        target: { kind: 'node', id: 'n2', label: 'Node 2' },
        duration: 'until-close',
        lockedOnLaunch: true,
        password: 'correct-horse'
      })
      expect(begin.ok).toBe(true)
      if (!begin.ok) return
      const code = totp(base32Decode(begin.enrollment.secretBase32))
      const confirmed = await confirmTotp({ lockId: begin.enrollment.lockId, code })
      expect(confirmed.ok).toBe(true)
      if (!confirmed.ok) return

      const codeOnly = await verify({ id: confirmed.record.id, code })
      expect(codeOnly.ok).toBe(false)
    } finally {
      service.dispose()
    }
  })

  it('unlocks only when both factors are correct, and the failure reason never says which one was wrong', async () => {
    const service = startToyLockService()
    try {
      const { beginTotp, confirmTotp, verify } = handlers()
      const begin = await beginTotp({
        target: { kind: 'node', id: 'n3', label: 'Node 3' },
        duration: 'until-close',
        lockedOnLaunch: true,
        password: 'correct-horse'
      })
      if (!begin.ok) throw new Error('begin failed')
      const code = totp(base32Decode(begin.enrollment.secretBase32))
      const confirmed = await confirmTotp({ lockId: begin.enrollment.lockId, code })
      if (!confirmed.ok) throw new Error('confirm failed')

      // Proven correct FIRST (which also resets the fail counter to 0) so the three deliberate
      // failures below can each be asserted without tripping the rate limiter's "stop even looking
      // at the credential after 3 fails" behavior (RATE_LIMIT_THRESHOLD) before all three ran.
      const right = await verify({ id: confirmed.record.id, password: 'correct-horse', code })
      expect(right.ok).toBe(true)

      const wrongPassword = await verify({ id: confirmed.record.id, password: 'nope', code })
      expect(wrongPassword.ok).toBe(false)
      // The correct code just above; using it again here is fine — verify() does not consume it,
      // and TOTP tolerates the same code repeating within one step (that's what makes it a *time*
      // based code, not a nonce). What matters is that the PASSWORD half is wrong.

      const rightAgain = await verify({ id: confirmed.record.id, password: 'correct-horse', code })
      expect(rightAgain.ok).toBe(true) // resets the fail counter for the next deliberate failure

      const wrongCode = await verify({ id: confirmed.record.id, password: 'correct-horse', code: '000000' })
      expect(wrongCode.ok).toBe(false)

      // Same reason regardless of which factor(s) failed — nothing here may hint which one it was.
      expect(wrongPassword.reason).toBe(wrongCode.reason)
      expect(wrongPassword.reason?.toLowerCase()).not.toMatch(/\bpassword only\b|\bcode only\b/)
    } finally {
      service.dispose()
    }
  })
})

describe('Windows PIN credential kind (Task 3)', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  function setProcessPlatform(value: string): void {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
  })

  it('is refused on a non-Windows core, with an honest reason — not silently broken', async () => {
    setProcessPlatform('darwin')
    const service = startToyLockService()
    try {
      const { createPassword } = handlers()
      const result = await createPassword({
        target: { kind: 'node', id: 'pin-node', label: 'PIN node' },
        password: '1234',
        duration: 'until-close',
        lockedOnLaunch: true,
        credentialKind: 'windows-pin'
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/windows/i)
    } finally {
      service.dispose()
    }
  })

  it('creates and verifies on a Windows core', async () => {
    setProcessPlatform('win32')
    const service = startToyLockService()
    try {
      const { createPassword, verify } = handlers()
      const created = await createPassword({
        target: { kind: 'node', id: 'pin-node-2', label: 'PIN node 2' },
        password: '1234',
        duration: 'until-close',
        lockedOnLaunch: true,
        credentialKind: 'windows-pin'
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      expect(created.record.credentialKind).toBe('windows-pin')

      const wrong = await verify({ id: created.record.id, password: '0000' })
      expect(wrong.ok).toBe(false)
      const right = await verify({ id: created.record.id, password: '1234' })
      expect(right.ok).toBe(true)
    } finally {
      service.dispose()
    }
  })

  it('refuses a non-numeric PIN even on Windows', async () => {
    setProcessPlatform('win32')
    const service = startToyLockService()
    try {
      const { createPassword } = handlers()
      const result = await createPassword({
        target: { kind: 'node', id: 'pin-node-3', label: 'PIN node 3' },
        password: 'abcd',
        duration: 'until-close',
        lockedOnLaunch: true,
        credentialKind: 'windows-pin'
      })
      expect(result.ok).toBe(false)
    } finally {
      service.dispose()
    }
  })
})
