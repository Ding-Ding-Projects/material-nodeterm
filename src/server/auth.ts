// scrypt (built-in) instead of the spec's argon2 — no native dependency; parameters N=16384,r=8,p=1 per OWASP baseline.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

import type { StoredCredential } from './webauthn'
import {
  UnlockLadder,
  UnlockLadderBudget,
  UnlockLadderChallengeBudget,
  nextLockoutMs
} from '../core/unlock-ladder'
import { base32Decode, totp, totpCounterForTime } from '../core/toylocks/totp'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** A WebAuthn challenge is a freshness proof, not a session — it only has to survive the round
 *  trip to the authenticator. Two minutes covers a user reaching for a phone or a hardware key;
 *  anything longer just widens the window a captured challenge could be replayed in. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000
/** One browser ceremony may legitimately be retried a few times, but an unauthenticated caller
 *  must never be able to turn challenges into an unbounded in-memory store. */
export const MAX_CHALLENGES_PER_CLIENT = 8
export const MAX_CHALLENGES_GLOBAL = 256
export const LOCKOUT_MS = 60_000
const MAX_FAILURES = 5
const DEFAULT_CLIENT_KEY = 'default'
export const MAX_LOGIN_CLIENT_STATES = 1024
const LOGIN_STATE_IDLE_MS = 24 * 60 * 60 * 1000
const MAX_PENDING_PASSWORD_ATTEMPTS = 32
const MAX_PENDING_PASSWORD_ATTEMPTS_PER_CLIENT = MAX_FAILURES
const DEFAULT_MAX_ACTIVE_PASSWORD_VERIFICATIONS = 2

interface AuthFile {
  salt: string
  hash: string
  N: number
  r: number
  p: number
}

interface SessionEntry {
  createdAt: number
}

type SessionMap = { [token: string]: SessionEntry }

interface LoginState {
  failures: number
  lockedUntil: number
  /** Consecutive lockouts, for the exponential backoff. A real sign-in resets it immediately;
   *  an inactive unlocked peer identity may age out after 24h to keep the table bounded. */
  lockoutStreak: number
  lastSeen: number
  /** Changes whenever a lockout cycle is created or cleared, so an older proof cannot wake after
   *  that boundary and consume/reset the new cycle. */
  generation: number
}

interface ChallengeEntry {
  expiresAt: number
  clientKey: string
  purpose: ChallengePurpose
}

export type PasswordAttemptResult = 'success' | 'invalid' | 'locked' | 'busy' | 'error'
export type ChallengePurpose = 'login' | 'register'

export interface AuthDeps {
  now?: () => number
  /** Test seam for deterministic slow/concurrent verification. Production always uses async
   *  crypto.scrypt with the parameters stored beside the hash. */
  passwordVerifier?: (password: string) => Promise<boolean>
  maxActivePasswordVerifications?: number
  /** Counts expiry-scan visits so the single bounded cleanup pass can be mutation-tested. */
  onChallengeSweepVisit?: () => void
}

export class Auth {
  private authPath: string
  private sessionsPath: string
  private readonly now: () => number
  private readonly passwordVerifier: (password: string) => Promise<boolean>
  private readonly maxActivePasswordVerifications: number
  private readonly onChallengeSweepVisit: () => void

  private setupTokenValue: string | null = null

  private sessions: SessionMap | null = null

  private loginStates = new Map<string, LoginState>()
  private nextLoginStateSweepAt = 0

  /** Same-peer attempts are FIFO, so five requests that passed an early HTTP check cannot all
   *  wake after the fifth failure and continue spending scrypt. The global pool bounds CPU and
   *  libuv pressure across distinct peers without turning one peer's failures into everybody's
   *  exponential lockout. */
  private passwordTails = new Map<string, Promise<void>>()
  private pendingPasswordAttempts = new Map<string, number>()
  private pendingPasswordAttemptTotal = 0
  private activePasswordVerifications = 0
  private passwordVerificationWaiters: Array<() => void> = []

  /**
   * The unlock ladder — dim sum, then maths, then whack-a-mole — offered while locked out.
   *
   * It can end the CURRENT wait and nothing else: it never authenticates, never returns extra
   * password attempts, and never softens the exponential backoff below. The full reasoning lives
   * in src/core/unlock-ladder.ts; the two rules that matter here are that `clearLockoutByLadder`
   * changes no failure/streak/credential/session state, and that `lockoutStreak` survives it.
   */
  private readonly ladderBudget = new UnlockLadderBudget()
  private readonly ladderChallengeBudget = new UnlockLadderChallengeBudget()
  private readonly ladders = new Map<string, UnlockLadder>()

/** Compatibility/default-peer view used by direct callers and focused core gates. HTTP always
   *  asks ladderFor(clientKey), so one peer cannot reset or answer another peer's climb. */
  get ladder(): UnlockLadder {
    return this.ladderFor(DEFAULT_CLIENT_KEY)
  }

  /** School mode removes every dim-sum surface, so the ladder must start at maths under it. */
  private schoolMode: () => boolean = () => false

  constructor(dataDir: string, deps: AuthDeps = {}) {
    this.authPath = path.join(dataDir, 'auth.json')
    this.sessionsPath = path.join(dataDir, 'sessions.json')
    this.now = deps.now ?? (() => Date.now())
    this.passwordVerifier = deps.passwordVerifier ?? ((password) => this.verifyPasswordOrTotp(password))
    const requestedMax = deps.maxActivePasswordVerifications ?? DEFAULT_MAX_ACTIVE_PASSWORD_VERIFICATIONS
    this.maxActivePasswordVerifications =
      Number.isFinite(requestedMax) && requestedMax >= 1
        ? Math.floor(requestedMax)
        : DEFAULT_MAX_ACTIVE_PASSWORD_VERIFICATIONS
    this.onChallengeSweepVisit = deps.onChallengeSweepVisit ?? (() => {})
  }

  private async verifyPasswordOrTotp(candidate: string): Promise<boolean> {
    const secretPath = process.env.NODETERM_TOTP_SECRET_FILE
    if (/^\d{6}$/.test(candidate) && secretPath) {
      try {
        const secret = base32Decode(fs.readFileSync(secretPath, 'utf8').trim())
        const nowSeconds = Math.floor(this.now() / 1000)
        const current = totpCounterForTime(nowSeconds, 30)
        const replayPath = path.join(path.dirname(this.authPath), 'totp-replay.json')
        let last = -1
        try {
          const parsed = JSON.parse(fs.readFileSync(replayPath, 'utf8')) as { counter?: unknown }
          if (Number.isSafeInteger(parsed.counter)) last = parsed.counter as number
        } catch { /* no accepted deployment code yet */ }
        for (const counter of [current - 1, current, current + 1]) {
          if (counter <= last) continue
          const expected = totp(secret, { epochSeconds: counter * 30, period: 30, digits: 6 })
          if (!crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) continue
          fs.mkdirSync(path.dirname(replayPath), { recursive: true })
          fs.writeFileSync(replayPath, JSON.stringify({ counter }), { mode: 0o600 })
          return true
        }
      } catch {
        // A missing/corrupt secret never weakens password authentication.
      }
    }
    return this.verifyPasswordAsync(candidate)
  }

  // ---- Configuration / password ------------------------------------------

  isConfigured(): boolean {
    return fs.existsSync(this.authPath)
  }

  private readAuth(): AuthFile | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.authPath, 'utf8')) as Partial<AuthFile>
      // auth.json is hand-editable. Accept only the exact format this build writes; feeding a
      // forged N/r/p or key length into scrypt would bypass the otherwise bounded proof pool with
      // attacker-chosen CPU/memory cost.
      if (
        parsed.N !== SCRYPT_N ||
        parsed.r !== SCRYPT_R ||
        parsed.p !== SCRYPT_P ||
        typeof parsed.salt !== 'string' ||
        !/^[0-9a-f]{32}$/i.test(parsed.salt) ||
        typeof parsed.hash !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(parsed.hash)
      ) return null
      return parsed as AuthFile
    } catch {
      return null
    }
  }

  setPassword(password: string): void {
    // The setup route validates this too, but environment seeds and programmatic callers bypass
    // that route. Keep the account invariant at the operation that actually persists a password.
    if (password.length < 8) throw new Error('Server passwords must be at least 8 characters')
    const salt = crypto.randomBytes(16)
    const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    })
    const data: AuthFile = {
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    }
    fs.writeFileSync(this.authPath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  verifyPassword(password: string): boolean {
    const auth = this.readAuth()
    if (!auth) return false
    const salt = Buffer.from(auth.salt, 'hex')
    const stored = Buffer.from(auth.hash, 'hex')
    const computed = crypto.scryptSync(password, salt, stored.length, {
      N: auth.N,
      r: auth.r,
      p: auth.p
    })
    if (computed.length !== stored.length) return false
    return crypto.timingSafeEqual(computed, stored)
  }

  /** The HTTP path must not run scryptSync: it blocks every terminal/WebSocket on the process.
   *  The comparison stays timing-safe and uses the exact parameters persisted with the hash. */
  private verifyPasswordAsync(password: string): Promise<boolean> {
    const auth = this.readAuth()
    if (!auth) {
      return fs.existsSync(this.authPath)
        ? Promise.reject(new Error('Stored server authentication record is invalid'))
        : Promise.resolve(false)
    }
    const salt = Buffer.from(auth.salt, 'hex')
    const stored = Buffer.from(auth.hash, 'hex')
    return new Promise<boolean>((resolve, reject) => {
      crypto.scrypt(
        password,
        salt,
        stored.length,
        { N: auth.N, r: auth.r, p: auth.p },
        (error, computed) => {
          if (error) {
            reject(error)
            return
          }
          resolve(computed.length === stored.length && crypto.timingSafeEqual(computed, stored))
        }
      )
    })
  }

  // ---- Setup token -------------------------------------------------------

  setupToken(): string {
    if (this.setupTokenValue === null) {
      this.setupTokenValue = crypto.randomBytes(16).toString('hex') // 32 hex chars
    }
    return this.setupTokenValue
  }

  /** Constant-time check WITHOUT consuming — GET /setup uses this to decide whether the caller
   *  (who must present the token printed to the console) may see the setup form. */
  verifySetupToken(candidate: string): boolean {
    const current = this.setupTokenValue
    if (current === null || !candidate) return false
    const a = crypto.createHash('sha256').update(candidate).digest()
    const b = crypto.createHash('sha256').update(current).digest()
    return crypto.timingSafeEqual(a, b)
  }

  consumeSetupToken(candidate: string): boolean {
    if (!this.verifySetupToken(candidate)) return false
    this.setupTokenValue = null
    return true
  }

  // ---- Passkeys ----------------------------------------------------------
  //
  // A passkey is a SECOND way into the one account this server has, alongside the password —
  // not a second account. So credentials live in their own file beside auth.json and are not
  // tied to a user record; there is only ever one user.
  //
  // The password is deliberately kept as the fallback rather than being disabled once a passkey
  // exists. A passkey lives in one device's secure enclave or one password manager, and a server
  // whose only credential is on a phone that fell in a river is a server nobody can reach. The
  // recovery story for a self-hosted box is "you still know the password", and removing that to
  // look more secure would make lockout the most likely outcome, not compromise.

  private credentials: StoredCredential[] | null = null
  /** Outstanding challenges, keyed by the challenge itself. The strict 256-entry ceiling makes a
   *  complete expiry sweep one bounded O(n) pass and remains correct when the system clock moves
   *  backward (when insertion order and expiry order are no longer the same). */
  private challenges = new Map<string, ChallengeEntry>()
  private challengeKeysByClient = new Map<string, Set<string>>()

  private get credentialsPath(): string {
    return path.join(path.dirname(this.authPath), 'passkeys.json')
  }

  listCredentials(): StoredCredential[] {
    if (this.credentials === null) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'))
        this.credentials = Array.isArray(raw) ? (raw as StoredCredential[]) : []
      } catch {
        this.credentials = []
      }
    }
    return this.credentials
  }

  hasPasskey(): boolean {
    return this.listCredentials().length > 0
  }

  private persistCredentials(): void {
    const dir = path.dirname(this.credentialsPath)
    fs.mkdirSync(dir, { recursive: true })
    // 0600: a credential's PUBLIC key is not a secret, but the file also records which devices
    // can open this host, which is not something to leave world-readable on a shared box.
    fs.writeFileSync(this.credentialsPath, JSON.stringify(this.listCredentials(), null, 2), { mode: 0o600 })
  }

  addCredential(cred: StoredCredential): void {
    const all = this.listCredentials()
    // Re-registering the same authenticator replaces it rather than adding a duplicate that can
    // never be told apart in the UI.
    const i = all.findIndex((c) => c.id === cred.id)
    if (i >= 0) all[i] = cred
    else all.push(cred)
    this.persistCredentials()
  }

  removeCredential(id: string): boolean {
    const all = this.listCredentials()
    const i = all.findIndex((c) => c.id === id)
    if (i < 0) return false
    all.splice(i, 1)
    this.persistCredentials()
    return true
  }

  updateCredentialCounter(id: string, counter: number): void {
    const c = this.listCredentials().find((x) => x.id === id)
    if (!c) return
    c.counter = counter
    this.persistCredentials()
  }

  /** Mint a single-use challenge. Returned base64url, which is the form WebAuthn compares.
   *  The per-peer cap rotates that peer's oldest ceremony. The global cap refuses instead of
   *  evicting somebody else's live ceremony, so distributed unauthenticated traffic stays
   *  strictly bounded without becoming a cross-client invalidation primitive. */
  newChallenge(clientKey: string, purpose: ChallengePurpose): string | null {
    this.sweepChallenges()
    const key = this.normalizeClientKey(clientKey)
    let clientChallenges = this.challengeKeysByClient.get(key)
    if (!clientChallenges) {
      clientChallenges = new Set<string>()
      this.challengeKeysByClient.set(key, clientChallenges)
    }
    // Check the shared ceiling before rotating this peer's oldest entry. Globally-full holders
    // must let their leases expire and then compete afresh rather than extending them in place.
    if (this.challenges.size >= MAX_CHALLENGES_GLOBAL) {
      if (clientChallenges.size === 0) this.challengeKeysByClient.delete(key)
      return null
    }
    while (clientChallenges.size >= MAX_CHALLENGES_PER_CLIENT) {
      const oldest = clientChallenges.values().next().value as string | undefined
      if (!oldest) break
      this.deleteChallenge(oldest)
    }
    let c: string
    do c = crypto.randomBytes(32).toString('base64url')
    while (this.challenges.has(c))
    this.challenges.set(c, { expiresAt: this.now() + CHALLENGE_TTL_MS, clientKey: key, purpose })
    clientChallenges.add(c)
    return c
  }

  /** Consume a challenge. It belongs to the TCP peer that minted it; a different peer cannot
   *  invalidate or reuse another browser's ceremony. */
  consumeChallenge(candidate: string, clientKey: string, purpose: ChallengePurpose): boolean {
    this.sweepChallenges()
    if (!candidate) return false
    const entry = this.challenges.get(candidate)
    if (
      !entry ||
      entry.clientKey !== this.normalizeClientKey(clientKey) ||
      entry.purpose !== purpose
    ) return false
    this.deleteChallenge(candidate)
    return true
  }

  private sweepChallenges(): void {
    const now = this.now()
    for (const [challenge, entry] of this.challenges) {
      this.onChallengeSweepVisit()
      if (entry.expiresAt <= now) this.deleteChallenge(challenge)
    }
  }

  private deleteChallenge(challenge: string): void {
    const entry = this.challenges.get(challenge)
    if (!entry) return
    this.challenges.delete(challenge)
    const clientChallenges = this.challengeKeysByClient.get(entry.clientKey)
    clientChallenges?.delete(challenge)
    if (clientChallenges?.size === 0) this.challengeKeysByClient.delete(entry.clientKey)
  }

  // ---- Sessions ----------------------------------------------------------

  private loadSessions(): SessionMap {
    if (this.sessions === null) {
      try {
        this.sessions = JSON.parse(fs.readFileSync(this.sessionsPath, 'utf8')) as SessionMap
      } catch {
        this.sessions = {}
      }
    }
    return this.sessions
  }

  private persistSessions(): void {
    fs.writeFileSync(this.sessionsPath, JSON.stringify(this.sessions ?? {}, null, 2), {
      mode: 0o600
    })
  }

  createSession(): string {
    const sessions = this.loadSessions()
    const token = crypto.randomBytes(32).toString('hex')
    sessions[token] = { createdAt: this.now() }
    this.persistSessions()
    return token
  }

  validateSession(token: string | undefined): boolean {
    if (!token) return false
    const sessions = this.loadSessions()
    const now = this.now()
    let changed = false
    for (const [t, entry] of Object.entries(sessions)) {
      if (now - entry.createdAt >= SESSION_TTL_MS) {
        delete sessions[t]
        changed = true
      }
    }
    if (changed) this.persistSessions()
    return Object.prototype.hasOwnProperty.call(sessions, token)
  }

  /** Revoke one browser immediately and durably. Clearing only its cookie leaves the same
   *  persisted bearer valid for 30 days and lets any copied/stale cookie sign straight back in. */
  revokeSession(token: string | undefined): boolean {
    if (!token) return false
    const sessions = this.loadSessions()
    if (!Object.prototype.hasOwnProperty.call(sessions, token)) return false
    delete sessions[token]
    this.persistSessions()
    return true
  }

  revokeAll(): void {
    this.sessions = {}
    this.persistSessions()
  }

  // ---- Rate limiting -----------------------------------------------------

  /** Let the server tell auth whether School mode is on, without auth importing the store. */
  setSchoolModeSource(fn: () => boolean): void {
    this.schoolMode = fn
  }

  /** One peer owns one climb, while every climb draws from the same account-wide rolling budget. */
  ladderFor(clientKey: string = DEFAULT_CLIENT_KEY): UnlockLadder {
    const key = this.normalizeClientKey(clientKey)
    let ladder = this.ladders.get(key)
    if (!ladder) {
      ladder = new UnlockLadder({
        now: this.now,
        schoolMode: () => this.schoolMode(),
        budget: this.ladderBudget,
        challengeBudget: this.ladderChallengeBudget,
      })
      this.ladders.set(key, ladder)
    }
    return ladder
  }

  /** Reserve bounded state before a login ceremony. At capacity, refuse a new peer; never merge
   *  it into a shared failure bucket that an attacker could lock for every later legitimate peer. */
  admitLoginClient(clientKey: string): boolean {
    const key = this.normalizeClientKey(clientKey)
    let state = this.loginStates.get(key)
    if (!state) {
      this.sweepLoginStates()
      if (this.loginStates.size >= MAX_LOGIN_CLIENT_STATES && !this.evictLoginStateForCapacity()) return false
      state = this.emptyLoginState()
      this.loginStates.set(key, state)
    }
    state.lastSeen = this.now()
    return true
  }

  loginAllowed(clientKey: string = DEFAULT_CLIENT_KEY): boolean {
    const state = this.readLoginState(clientKey)
    return !state || this.now() >= state.lockedUntil
  }

  /** Milliseconds still to wait, or 0. What the lockout screen counts down. */
  lockoutRemainingMs(clientKey: string = DEFAULT_CLIENT_KEY): number {
    const state = this.readLoginState(clientKey)
    return Math.max(0, (state?.lockedUntil ?? 0) - this.now())
  }

  recordLoginFailure(clientKey: string = DEFAULT_CLIENT_KEY): boolean {
    const state = this.writeLoginState(clientKey)
    if (!state || this.now() < state.lockedUntil) return false
    state.lastSeen = this.now()
    state.failures += 1
    if (state.failures >= MAX_FAILURES) {
      // Each consecutive lockout lasts twice as long as the last, capped at an hour. The flat
      // sixty seconds this replaced was the same price for the first wrong guess and the five
      // hundredth, which is no price at all for a script.
      state.lockedUntil = this.now() + nextLockoutMs(state.lockoutStreak, LOCKOUT_MS)
      state.lockoutStreak += 1
      state.failures = 0
      // A fresh lockout is a fresh climb: dim sum again from the top. The ladder's own rolling
      // budget deliberately stays global, so spreading failures across peers cannot mint extra
      // climbs. Each peer keeps an independent climb and shares only that account-wide budget.
      state.generation += 1
      this.ladderFor(clientKey).reset()
    }
    return true
  }

  recordLoginSuccess(clientKey: string = DEFAULT_CLIENT_KEY): void {
    const key = this.normalizeClientKey(clientKey)
    this.loginStates.delete(key)
    this.deleteLadder(key)
  }

  /**
   * End the current wait because the ladder was cleared.
   *
   * Deliberately narrow: it changes no failure, streak, credential or session state. `failures` is
   * already zero (it is zeroed when the lockout starts), so the user gets exactly the attempts
   * waiting would have given them — never more. `lockoutStreak` is untouched, so the next lockout
   * is still twice as long as this one. Generation/last-seen only reject stale proofs.
   */
  clearLockoutByLadder(clientKey: string = DEFAULT_CLIENT_KEY): void {
    const state = this.readLoginState(clientKey)
    if (!state) return
    state.lockedUntil = 0
    state.lastSeen = this.now()
    state.generation += 1
  }

  /** Admit, execute and record one password attempt as one ordered decision. Checking lockout in
   *  the HTTP route alone is insufficient: multiple slow request bodies can all pass that check
   *  before any scrypt completes. */
  async attemptPassword(clientKey: string, password: string): Promise<PasswordAttemptResult> {
    const key = this.normalizeClientKey(clientKey)
    const pendingForClient = this.pendingPasswordAttempts.get(key) ?? 0
    if (
      pendingForClient >= MAX_PENDING_PASSWORD_ATTEMPTS_PER_CLIENT ||
      this.pendingPasswordAttemptTotal >= MAX_PENDING_PASSWORD_ATTEMPTS
    ) {
      return 'busy'
    }
    if (!this.admitLoginClient(key)) return 'busy'
    const admittedState = this.readLoginState(key)!
    const admittedGeneration = admittedState.generation

    this.pendingPasswordAttempts.set(key, pendingForClient + 1)
    this.pendingPasswordAttemptTotal += 1
    const previous = this.passwordTails.get(key) ?? Promise.resolve()
    let finishTail!: () => void
    const currentGate = new Promise<void>((resolve) => { finishTail = resolve })
    const currentTail = previous.catch(() => {}).then(() => currentGate)
    this.passwordTails.set(key, currentTail)

    try {
      await previous.catch(() => {})
      if (!this.loginAllowed(key)) return 'locked'
      if (!this.loginAdmissionStillCurrent(key, admittedState, admittedGeneration)) return 'locked'

      const releaseSlot = await this.acquirePasswordVerificationSlot()
      let valid: boolean
      try {
        // Another login path may have locked this peer while this request waited for the global
        // CPU slot. That lockout must win before another expensive proof starts.
        if (!this.loginAllowed(key)) return 'locked'
        if (!this.loginAdmissionStillCurrent(key, admittedState, admittedGeneration)) return 'locked'
        valid = await this.passwordVerifier(password)

        const currentState = this.readLoginState(key)
        if (currentState && this.now() < currentState.lockedUntil) return 'locked'
        if (currentState !== admittedState || currentState?.generation !== admittedGeneration) {
          // A real sign-in may delete the state while this proof runs; an old wrong result must
          // not seed the fresh cycle. Any lockout/ladder boundary is stricter: even a correct old
          // proof retries against the new cycle instead of bypassing it.
          return valid && currentState === undefined ? 'success' : valid ? 'locked' : 'invalid'
        }
      } catch {
        return 'error'
      } finally {
        releaseSlot()
      }

      if (valid) {
        this.recordLoginSuccess(key)
        return 'success'
      }
      return this.recordLoginFailure(key) ? 'invalid' : 'locked'
    } finally {
      finishTail()
      if (this.passwordTails.get(key) === currentTail) this.passwordTails.delete(key)
      const remaining = (this.pendingPasswordAttempts.get(key) ?? 1) - 1
      if (remaining > 0) this.pendingPasswordAttempts.set(key, remaining)
      else {
        this.pendingPasswordAttempts.delete(key)
        this.dropPristineLoginState(key)
      }
      this.pendingPasswordAttemptTotal -= 1
    }
  }

  private acquirePasswordVerificationSlot(): Promise<() => void> {
    if (this.activePasswordVerifications < this.maxActivePasswordVerifications) {
      this.activePasswordVerifications += 1
      return Promise.resolve(() => this.releasePasswordVerificationSlot())
    }
    return new Promise((resolve) => {
      this.passwordVerificationWaiters.push(() => {
        this.activePasswordVerifications += 1
        resolve(() => this.releasePasswordVerificationSlot())
      })
    })
  }

  private loginAdmissionStillCurrent(
    clientKey: string,
    admittedState: LoginState,
    admittedGeneration: number
  ): boolean {
    const current = this.readLoginState(clientKey)
    return current === admittedState && current.generation === admittedGeneration
  }

  private releasePasswordVerificationSlot(): void {
    this.activePasswordVerifications -= 1
    this.passwordVerificationWaiters.shift()?.()
  }

  private normalizeClientKey(clientKey: string): string {
    const key = String(clientKey || DEFAULT_CLIENT_KEY).trim() || DEFAULT_CLIENT_KEY
    // Product keys are TCP addresses (< 64 bytes). Hash an unexpectedly long injected key rather
    // than retaining attacker-controlled strings in the bounded in-memory maps.
    return key.length <= 128 ? key : `sha256:${crypto.createHash('sha256').update(key).digest('hex')}`
  }

  private readLoginState(clientKey: string): LoginState | undefined {
    return this.loginStates.get(this.normalizeClientKey(clientKey))
  }

  private writeLoginState(clientKey: string): LoginState | undefined {
    const key = this.normalizeClientKey(clientKey)
    if (!this.admitLoginClient(key)) return undefined
    return this.loginStates.get(key)
  }

  private emptyLoginState(): LoginState {
    return { failures: 0, lockedUntil: 0, lockoutStreak: 0, lastSeen: this.now(), generation: 0 }
  }

  private sweepLoginStates(): void {
    const now = this.now()
    if (now < this.nextLoginStateSweepAt) return
    this.nextLoginStateSweepAt = now + 60_000
    for (const [key, state] of this.loginStates) {
      // Never evict a live wait or an admitted proof. Unlocked inactive source counters may age
      // out: retaining 1,024 one-failure addresses forever would be a permanent global denial,
      // while the bounded async proof pool remains the distributed-work backstop.
      if (
        now >= state.lockedUntil &&
        !this.pendingPasswordAttempts.has(key) &&
        now - state.lastSeen >= LOGIN_STATE_IDLE_MS
      ) {
        this.loginStates.delete(key)
        this.deleteLadder(key)
      }
    }
  }

  private dropPristineLoginState(clientKey: string): void {
    const state = this.loginStates.get(clientKey)
    if (state && state.failures === 0 && state.lockoutStreak === 0 && state.lockedUntil === 0) {
      this.loginStates.delete(clientKey)
      this.deleteLadder(clientKey)
    }
  }

  private evictLoginStateForCapacity(): boolean {
    const now = this.now()
    let victim: { key: string; lastSeen: number } | undefined
    for (const [key, state] of this.loginStates) {
      if (now < state.lockedUntil || this.pendingPasswordAttempts.has(key)) continue
      if (!victim || state.lastSeen < victim.lastSeen) victim = { key, lastSeen: state.lastSeen }
    }
    if (!victim) return false
    this.loginStates.delete(victim.key)
    this.deleteLadder(victim.key)
    return true
  }

  private deleteLadder(clientKey: string): void {
    const ladder = this.ladders.get(clientKey)
    // reset() releases this peer's live tokens from the shared challenge ledger before the last
    // reference disappears. Deleting the Map entry alone leaves phantom global reservations.
    ladder?.reset()
    this.ladders.delete(clientKey)
  }
}
