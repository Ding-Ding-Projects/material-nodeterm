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
import { createNodeUnlockRegistry } from './node-unlock-registry'
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

/** The scrypt fields shared by every password-shaped secret (a real password AND a Windows PIN —
 *  see `WindowsPinSecret` below; a PIN is, honestly, just a short password). Factored out so the
 *  two credential kinds hash and check identically and cannot silently drift apart. */
interface ScryptSecret {
  salt: string // base64
  hash: string // base64
  N: number
  r: number
  p: number
  keylen: number
}

type PasswordSecret = ScryptSecret & { v: 1; kind: 'password' }

/** Windows-only, and honestly just a numeric password under the hood — see the wizard's platform
 *  gate and docs/toy-locks.md for why this is NOT a real Windows Hello prompt. Kept as its OWN
 *  sealed-secret kind (rather than silently reusing `'password'`) so what is actually on disk is
 *  never harder to read than what the record already claims. */
type WindowsPinSecret = ScryptSecret & { v: 1; kind: 'windows-pin' }

type TotpSecret = {
  v: 1
  kind: 'totp'
  secretBase32: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

/** The two-factor combo (`password-totp`): BOTH halves are required, sealed together as one
 *  record. `confirmTotp` is the only place this is ever constructed — see there for why neither
 *  factor is persisted alone. */
type ComboSecret = {
  v: 1
  kind: 'password-totp'
  password: ScryptSecret
  totp: Omit<TotpSecret, 'v' | 'kind'>
}

type LockSecret = PasswordSecret | WindowsPinSecret | TotpSecret | ComboSecret

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

function hashScryptSecret(secret: string): ScryptSecret {
  const salt = randomBytes(16)
  const hash = scryptSync(secret, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return {
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    ...SCRYPT
  }
}

function hashPassword(password: string): PasswordSecret {
  return { v: 1, kind: 'password', ...hashScryptSecret(password) }
}

function hashWindowsPin(pin: string): WindowsPinSecret {
  return { v: 1, kind: 'windows-pin', ...hashScryptSecret(pin) }
}

function checkScryptSecret(secret: ScryptSecret, attempt: string): boolean {
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
  /** Present only for a `password-totp` enrollment — the hashed FIRST factor, stashed here rather
   *  than persisted, so a combo lock never exists on disk with only one factor proven. Folded into
   *  a `ComboSecret` by `confirmTotp` the moment the TOTP half also matches. */
  passwordSecret?: ScryptSecret
}

const PENDING_TOTP_TTL_MS = 10 * 60 * 1000
const RATE_LIMIT_THRESHOLD = 3
const RATE_LIMIT_MAX_MS = 30_000

interface RateState {
  fails: number
  lastFailAt: number
}

export function startToyLockService(): { dispose(): void; mayWriteToNode(nodeId: string): Promise<boolean> } {
  const store = new SecureStore<ToyLockRecord>('toylocks.json')
  const pending = new Map<string, PendingTotp>()
  const rate = new Map<string, RateState>()
  // Which node-targeted locks are unlocked RIGHT NOW — the core-side twin of the renderer store,
  // fed by verify below (core witnesses every successful unlock) plus the renderer relock cast
  // (only the renderer can see a session-mode surface being left). Exists because sendText
  // addresses sessions by NAME and never meets the renderer gate — see node-unlock-registry.ts.
  const nodeUnlocks = createNodeUnlockRegistry()

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
      const credentialKind = input.credentialKind ?? 'password'
      // Windows-only, enforced HERE regardless of what the wizard already hid — the renderer's
      // platform guess (`navigator.platform`) drives copy, not authority; a Server Edition browser
      // could be a different OS from the core process this request actually lands on. Refuse
      // cleanly (not silently, not by pretending to succeed) on every other platform.
      if (credentialKind === 'windows-pin' && process.platform !== 'win32') {
        return { ok: false, error: 'Windows PIN locks are only available on Windows.' }
      }
      if (credentialKind === 'windows-pin' && !/^\d+$/.test(input.password ?? '')) {
        return { ok: false, error: 'A Windows PIN must be digits only.' }
      }
      return store.mutate<ToyLockCreateResult>((entries) => {
        if (findByTarget(entries, input.target.kind, input.target.id)) {
          return {
            changed: false,
            result: { ok: false, error: 'This is already locked — remove the existing lock first.' }
          }
        }
        if (!input.password || input.password.length < 1) {
          return {
            changed: false,
            result: {
              ok: false,
              error: credentialKind === 'windows-pin' ? 'A PIN is required.' : 'A password is required.'
            }
          }
        }
        const meta: ToyLockRecord = {
          id: randomUUID(),
          target: input.target,
          credentialKind,
          createdAt: Date.now(),
          duration: input.duration,
          durationMinutes: input.durationMinutes,
          lockedOnLaunch: input.lockedOnLaunch
        }
        const secretEnc = store.seal(
          credentialKind === 'windows-pin' ? hashWindowsPin(input.password) : hashPassword(input.password)
        )
        entries.push({ meta, secretEnc })
        return { changed: true, result: { ok: true, record: meta } }
      })
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
      // The combo's first factor: hashed and stashed on the PENDING record only. It is never
      // written to the store until `confirmTotp` also proves the TOTP half — see PendingTotp.
      if (input.password !== undefined && input.password.length < 1) {
        return { ok: false, error: 'A password is required.' }
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
        credentialKind: input.password !== undefined ? 'password-totp' : 'totp',
        createdAt: Date.now(),
        duration: input.duration,
        durationMinutes: input.durationMinutes,
        lockedOnLaunch: input.lockedOnLaunch
      }
      pending.set(lockId, {
        meta,
        secret: { v: 1, kind: 'totp', secretBase32, algorithm, digits, period },
        expiresAt: Date.now() + PENDING_TOTP_TTL_MS,
        passwordSecret: input.password !== undefined ? hashScryptSecret(input.password) : undefined
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
      // The combo's SECOND (and last) factor just matched — only now does either half get
      // written anywhere. `p.passwordSecret` is undefined for a plain TOTP lock, so this collapses
      // to exactly the old single-factor behavior for every existing caller.
      const secret: LockSecret = p.passwordSecret
        ? {
            v: 1,
            kind: 'password-totp',
            password: p.passwordSecret,
            totp: { secretBase32: p.secret.secretBase32, algorithm: p.secret.algorithm, digits: p.secret.digits, period: p.secret.period }
          }
        : p.secret
      return store.mutate<ToyLockConfirmTotpResult>((entries) => {
        // A duplicate could only appear if two enrollments for the same target were confirmed in
        // a race; this check and its append share one transaction, so both cannot win.
        if (findByTarget(entries, p.meta.target.kind, p.meta.target.id)) {
          return {
            changed: false,
            result: { ok: false, error: 'This is already locked — remove the existing lock first.' }
          }
        }
        const secretEnc = store.seal(secret)
        entries.push({ meta: p.meta, secretEnc })
        return { changed: true, result: { ok: true, record: p.meta } }
      })
    }
  )

  platform().handle(IPC.toylockCancelTotp, async (lockId: string): Promise<void> => {
    pending.delete(lockId)
  })

  platform().handle(
    IPC.toylockUpdate,
    async (input: ToyLockUpdateInput): Promise<ToyLockRecord | null> => {
      const updated = await store.mutate<ToyLockRecord | null>((entries) => {
        const entry = entries.find((e) => e.meta.id === input.id)
        if (!entry) return { changed: false, result: null }
        if (input.duration !== undefined) entry.meta.duration = input.duration
        if (input.durationMinutes !== undefined) entry.meta.durationMinutes = input.durationMinutes
        if (input.lockedOnLaunch !== undefined) entry.meta.lockedOnLaunch = input.lockedOnLaunch
        if (input.targetLabel !== undefined) {
          entry.meta.target = { ...entry.meta.target, label: input.targetLabel }
        }
        return { changed: true, result: entry.meta }
      })
      if (updated) rate.delete(input.id)
      return updated
    }
  )

  platform().handle(IPC.toylockRemove, async (id: string): Promise<void> => {
    await store.mutate<void>((entries) => {
      const next = entries.filter((e) => e.meta.id !== id)
      if (next.length === entries.length) return { changed: false, result: undefined }
      entries.splice(0, entries.length, ...next)
      return { changed: true, result: undefined }
    })
    rate.delete(id)
    // A deleted lock must not leave a ghost unlock behind for a FUTURE lock on the same node.
    nodeUnlocks.drop(id)
  })

  platform().handle(IPC.toylockRelock, async (lockId: string): Promise<void> => {
    // Renderer-driven: a session-mode surface was left or the user relocked by hand. Losing this
    // call would leave core authorizing name-addressed writes (dictation) into a visibly locked
    // terminal — the exact bypass the registry exists to close.
    nodeUnlocks.relock(lockId)
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
      // Exhaustive on `secret.kind`, deliberately NOT `if (kind === 'password') {…} else {…totp…}`.
      // That shape shipped once and was a live trap: an `else` treats ANY future kind as TOTP, so
      // a new credential kind that forgot its own branch here would silently verify against the
      // wrong factor instead of failing to compile. The `default` below is the guard — see
      // `_exhaustive` — and it is what makes that impossible now.
      let ok = false
      let reason: string
      switch (secret.kind) {
        case 'password':
          ok = typeof input.password === 'string' && checkScryptSecret(secret, input.password)
          reason = "That password doesn't match."
          break
        case 'windows-pin':
          ok = typeof input.password === 'string' && checkScryptSecret(secret, input.password)
          reason = "That PIN doesn't match."
          break
        case 'totp': {
          const secretBytes = base32Decode(secret.secretBase32)
          ok =
            typeof input.code === 'string' &&
            verifyTotp(secretBytes, input.code, {
              algorithm: secret.algorithm,
              digits: secret.digits,
              period: secret.period
            }).matched
          reason = "That code doesn't match."
          break
        }
        case 'password-totp': {
          // BOTH factors are computed before this returns — no early return on the first wrong
          // one. An early return would leak, via which branch replied fastest (a real password
          // check is a deliberately slow scrypt call; a TOTP check is fast HMACs), WHICH factor
          // was wrong. Awaiting both keeps that timing signal — and the reason string below —
          // identical whether the password, the code, or both were wrong.
          const secretBytes = base32Decode(secret.totp.secretBase32)
          const passwordOk = typeof input.password === 'string' && checkScryptSecret(secret.password, input.password)
          const codeOk =
            typeof input.code === 'string' &&
            verifyTotp(secretBytes, input.code, {
              algorithm: secret.totp.algorithm,
              digits: secret.totp.digits,
              period: secret.totp.period
            }).matched
          ok = passwordOk && codeOk
          // Never "the password was right but the code wasn't" — see the comment above.
          reason = "That password or code doesn't match."
          break
        }
        default: {
          const _exhaustive: never = secret
          throw new Error(`toylock-service: unhandled credential kind ${(_exhaustive as LockSecret).kind}`)
        }
      }
      if (ok) {
        rate.delete(input.id)
        // Core marks the unlock ITSELF for node targets — the renderer needs no extra "I unlocked"
        // call it could forget, and a forged call could never mint an unlock without the credential
        // having just passed above. Session/until-close map to Infinity; session-mode re-engages
        // via the toylockRelock cast (only the renderer can see the surface being left).
        if (entry.meta.target.kind === 'node') {
          const until =
            entry.meta.duration === 'minutes'
              ? now + Math.max(1, entry.meta.durationMinutes ?? 5) * 60_000
              : Infinity
          nodeUnlocks.markUnlocked(entry.meta.id, entry.meta.target.id, until)
        }
        return { ok: true }
      }
      const next: RateState = { fails: (state?.fails ?? 0) + 1, lastFailAt: now }
      rate.set(input.id, next)
      return { ok: false, reason }
    }
  )

  return {
    dispose: (): void => {
      clearInterval(sweepTimer)
      pending.clear()
      rate.clear()
      nodeUnlocks.clear()
    },
    /** May text be written into this node's terminal right now? The pty layer asks this before
     *  honouring a name-addressed write (sendText — dictation, note pushes, canvas-control). A
     *  node with no lock record is always writable; a locked one only while a live unlock covers
     *  it. Store-read failure answers FALSE for a locked node by construction (no record found =
     *  writable is the one acceptable default, because absence of the record is the common case
     *  and the sealed store failing entirely surfaces loudly elsewhere). */
    mayWriteToNode: async (nodeId: string): Promise<boolean> => {
      let hasLock = false
      try {
        const entries = await store.load()
        hasLock = entries.some((e) => e.meta.target.kind === 'node' && e.meta.target.id === nodeId)
      } catch {
        // An unreadable store cannot prove absence — fail LOCKED, same asymmetry as the renderer.
        return false
      }
      return nodeUnlocks.mayWrite(nodeId, () => hasLock)
    }
  }
}
