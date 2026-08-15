// Toy-lock CRUD, verification and TOTP enrollment. Registered by BOTH shells (src/main and
// src/server), exactly like session-memory-service.ts and board-log-handlers.ts: core owns the
// storage and the crypto, the shell supplies nothing beyond what CorePlatform already offers
// (userDataDir + optional sealSecret/unsealSecret).
//
// Reminder, because it matters for every design choice below: THIS IS NOT SECURITY. A wrong
// password just makes the next attempt wait a little longer; the only real "recovery" is deleting
// the app's own local application-data folder (docs/toy-locks.md). Password hashing (scrypt) and
// TOTP secret sealing exist so a stored record is not embarrassingly readable in plain text, not
// because this gate is meant to withstand anyone who actually has this machine.

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import { platform } from '../platform'
import { IPC } from '../../shared/ipc'
import { SecureStore, type SealedEntry } from '../secure-store'
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateSecret,
  verifyTotp,
  type OtpAlgorithm
} from './totp'
import type {
  ToyLockBeginTotpInput,
  ToyLockBeginTotpResult,
  ToyLockConfirmTotpInput,
  ToyLockConfirmTotpResult,
  ToyLockCreatePasswordInput,
  ToyLockCreateResult,
  ToyLockRecord,
  ToyLockUpdateInput,
  ToyLockVerifyInput,
  ToyLockVerifyResult
} from '../../shared/toylock'

type PasswordSecret = {
  v: 1
  kind: 'password'
  salt: string // base64
  hash: string // base64
  N: number
  r: number
  p: number
  keylen: number
}

type TotpSecret = {
  v: 1
  kind: 'totp'
  secretBase32: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

type LockSecret = PasswordSecret | TotpSecret

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

function hashPassword(password: string): PasswordSecret {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return {
    v: 1,
    kind: 'password',
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    ...SCRYPT
  }
}

function checkPassword(secret: PasswordSecret, attempt: string): boolean {
  const salt = Buffer.from(secret.salt, 'base64')
  const stored = Buffer.from(secret.hash, 'base64')
  const computed = scryptSync(attempt, salt, secret.keylen, {
    N: secret.N,
    r: secret.r,
    p: secret.p
  })
  if (computed.length !== stored.length) return false
  return timingSafeEqual(computed, stored)
}

/** A TOTP enrollment that has generated a secret but has not yet been confirmed by a matching
 *  code — nothing here is persisted until `confirmTotp` succeeds. Swept on a timer so an
 *  abandoned wizard doesn't leak memory across a long session. */
interface PendingTotp {
  meta: ToyLockRecord
  secret: TotpSecret
  expiresAt: number
}

const PENDING_TOTP_TTL_MS = 10 * 60 * 1000
const RATE_LIMIT_THRESHOLD = 3
const RATE_LIMIT_MAX_MS = 30_000

interface RateState {
  fails: number
  lastFailAt: number
}

export function startToyLockService(): { dispose(): void } {
  const store = new SecureStore<ToyLockRecord>('toylocks.json')
  const pending = new Map<string, PendingTotp>()
  const rate = new Map<string, RateState>()

  const sweepPending = (): void => {
    const now = Date.now()
    for (const [id, p] of pending) if (p.expiresAt <= now) pending.delete(id)
  }
  const sweepTimer = setInterval(sweepPending, 60_000)
  // Never keep the process alive just for this housekeeping timer.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref()

  const findByTarget = (
    entries: SealedEntry<ToyLockRecord>[],
    kind: string,
    id: string
  ): SealedEntry<ToyLockRecord> | undefined =>
    entries.find((e) => e.meta.target.kind === kind && e.meta.target.id === id)

  platform().handle(IPC.toylockList, async (): Promise<ToyLockRecord[]> => {
    const entries = await store.load()
    return entries.map((e) => e.meta)
  })

  platform().handle(
    IPC.toylockCreatePassword,
    async (input: ToyLockCreatePasswordInput): Promise<ToyLockCreateResult> => {
      const entries = await store.load()
      if (findByTarget(entries, input.target.kind, input.target.id)) {
        return { ok: false, error: 'This is already locked — remove the existing lock first.' }
      }
      if (!input.password || input.password.length < 1) {
        return { ok: false, error: 'A password is required.' }
      }
      const meta: ToyLockRecord = {
        id: randomUUID(),
        target: input.target,
        credentialKind: 'password',
        createdAt: Date.now(),
        duration: input.duration,
        durationMinutes: input.durationMinutes,
        lockedOnLaunch: input.lockedOnLaunch
      }
      const secretEnc = store.seal(hashPassword(input.password))
      entries.push({ meta, secretEnc })
      await store.save(entries)
      return { ok: true, record: meta }
    }
  )

  platform().handle(
    IPC.toylockBeginTotp,
    async (
      input: ToyLockBeginTotpInput
    ): Promise<ToyLockBeginTotpResult> => {
      const entries = await store.load()
      if (findByTarget(entries, input.target.kind, input.target.id)) {
        return { ok: false, error: 'This is already locked — remove the existing lock first.' }
      }
      const lockId = randomUUID()
      const secretBuf = generateSecret()
      const secretBase32 = base32Encode(secretBuf)
      const algorithm: OtpAlgorithm = 'SHA1'
      const digits = 6
      const period = 30
      const issuer = 'nodeterm'
      const account = input.target.label || `${input.target.kind} lock`
      const meta: ToyLockRecord = {
        id: lockId,
        target: input.target,
        credentialKind: 'totp',
        createdAt: Date.now(),
        duration: input.duration,
        durationMinutes: input.durationMinutes,
        lockedOnLaunch: input.lockedOnLaunch
      }
      pending.set(lockId, {
        meta,
        secret: { v: 1, kind: 'totp', secretBase32, algorithm, digits, period },
        expiresAt: Date.now() + PENDING_TOTP_TTL_MS
      })
      const otpauthUri = buildOtpAuthUri({ issuer, account, secretBase32, algorithm, digits, period })
      return {
        ok: true,
        enrollment: { lockId, otpauthUri, secretBase32, issuer, account, algorithm, digits, period }
      }
    }
  )

  platform().handle(
    IPC.toylockConfirmTotp,
    async (
      input: ToyLockConfirmTotpInput
    ): Promise<ToyLockConfirmTotpResult> => {
      sweepPending()
      const p = pending.get(input.lockId)
      if (!p) return { ok: false, error: 'This pairing has expired — start again.' }
      const secretBytes = base32Decode(p.secret.secretBase32)
      const { matched } = verifyTotp(secretBytes, input.code, {
        algorithm: p.secret.algorithm,
        digits: p.secret.digits,
        period: p.secret.period
      })
      if (!matched) {
        return { ok: false, error: "That code doesn't match — check the time on both devices and try again." }
      }
      pending.delete(input.lockId)
      const entries = await store.load()
      // A duplicate could only appear if two enrollments for the same target were confirmed in a
      // race; the second one simply refuses rather than silently shadowing the first.
      if (findByTarget(entries, p.meta.target.kind, p.meta.target.id)) {
        return { ok: false, error: 'This is already locked — remove the existing lock first.' }
      }
      const secretEnc = store.seal(p.secret)
      entries.push({ meta: p.meta, secretEnc })
      await store.save(entries)
      return { ok: true, record: p.meta }
    }
  )

  platform().handle(IPC.toylockCancelTotp, async (lockId: string): Promise<void> => {
    pending.delete(lockId)
  })

  platform().handle(
    IPC.toylockUpdate,
    async (input: ToyLockUpdateInput): Promise<ToyLockRecord | null> => {
      const entries = await store.load()
      const entry = entries.find((e) => e.meta.id === input.id)
      if (!entry) return null
      if (input.duration !== undefined) entry.meta.duration = input.duration
      if (input.durationMinutes !== undefined) entry.meta.durationMinutes = input.durationMinutes
      if (input.lockedOnLaunch !== undefined) entry.meta.lockedOnLaunch = input.lockedOnLaunch
      if (input.targetLabel !== undefined) entry.meta.target = { ...entry.meta.target, label: input.targetLabel }
      await store.save(entries)
      rate.delete(input.id)
      return entry.meta
    }
  )

  platform().handle(IPC.toylockRemove, async (id: string): Promise<void> => {
    const entries = await store.load()
    const next = entries.filter((e) => e.meta.id !== id)
    if (next.length !== entries.length) await store.save(next)
    rate.delete(id)
  })

  platform().handle(
    IPC.toylockVerify,
    async (input: ToyLockVerifyInput): Promise<ToyLockVerifyResult> => {
      const state = rate.get(input.id)
      const now = Date.now()
      if (state && state.fails >= RATE_LIMIT_THRESHOLD) {
        const waitMs = Math.min(RATE_LIMIT_MAX_MS, 500 * 2 ** (state.fails - RATE_LIMIT_THRESHOLD))
        const readyAt = state.lastFailAt + waitMs
        if (now < readyAt) {
          // The rate limit means never even looking at the credential while it's in effect.
          return { ok: false, retryAfterMs: readyAt - now, reason: 'Too many attempts — waiting it out.' }
        }
      }
      const entries = await store.load()
      const entry = entries.find((e) => e.meta.id === input.id)
      if (!entry) return { ok: false, reason: 'This lock no longer exists.' }
      const secret = store.unseal<LockSecret>(entry.secretEnc)
      let ok = false
      if (secret.kind === 'password') {
        ok = typeof input.password === 'string' && checkPassword(secret, input.password)
      } else {
        const secretBytes = base32Decode(secret.secretBase32)
        ok =
          typeof input.code === 'string' &&
          verifyTotp(secretBytes, input.code, {
            algorithm: secret.algorithm,
            digits: secret.digits,
            period: secret.period
          }).matched
      }
      if (ok) {
        rate.delete(input.id)
        return { ok: true }
      }
      const next: RateState = { fails: (state?.fails ?? 0) + 1, lastFailAt: now }
      rate.set(input.id, next)
      const reason =
        secret.kind === 'password' ? "That password doesn't match." : "That code doesn't match."
      return { ok: false, reason }
    }
  )

  return {
    dispose: (): void => {
      clearInterval(sweepTimer)
      pending.clear()
      rate.clear()
    }
  }
}
