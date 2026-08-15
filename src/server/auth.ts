// scrypt (built-in) instead of the spec's argon2 — no native dependency; parameters N=16384,r=8,p=1 per OWASP baseline.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

import type { StoredCredential } from './webauthn'
import { UnlockLadder, nextLockoutMs } from '../core/unlock-ladder'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** A WebAuthn challenge is a freshness proof, not a session — it only has to survive the round
 *  trip to the authenticator. Two minutes covers a user reaching for a phone or a hardware key;
 *  anything longer just widens the window a captured challenge could be replayed in. */
const CHALLENGE_TTL_MS = 2 * 60 * 1000
export const LOCKOUT_MS = 60_000
const MAX_FAILURES = 5

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

export class Auth {
  private authPath: string
  private sessionsPath: string

  private setupTokenValue: string | null = null

  private sessions: SessionMap | null = null

  private failures = 0
  private lockedUntil = 0
  /** Consecutive lockouts, for the exponential backoff. Reset only by a real sign-in. */
  private lockoutStreak = 0

  /**
   * The unlock ladder — dim sum, then maths, then whack-a-mole — offered while locked out.
   *
   * It can end the CURRENT wait and nothing else: it never authenticates, never returns extra
   * password attempts, and never softens the exponential backoff below. The full reasoning lives
   * in src/core/unlock-ladder.ts; the two rules that matter here are that `clearLockoutByLadder`
   * touches `lockedUntil` alone, and that `lockoutStreak` survives it.
   */
  readonly ladder: UnlockLadder

  /** School mode removes every dim-sum surface, so the ladder must start at maths under it. */
  private schoolMode: () => boolean = () => false

  constructor(dataDir: string) {
    this.authPath = path.join(dataDir, 'auth.json')
    this.sessionsPath = path.join(dataDir, 'sessions.json')
    this.ladder = new UnlockLadder({ schoolMode: () => this.schoolMode() })
  }

  // ---- Configuration / password ------------------------------------------

  isConfigured(): boolean {
    return fs.existsSync(this.authPath)
  }

  private readAuth(): AuthFile | null {
    try {
      return JSON.parse(fs.readFileSync(this.authPath, 'utf8')) as AuthFile
    } catch {
      return null
    }
  }

  setPassword(password: string): void {
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
  /** Outstanding challenges, keyed by the challenge itself. In-memory only: a challenge is
   *  single-use and short-lived, so surviving a restart is not a feature. */
  private challenges = new Map<string, number>()

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

  /** Mint a single-use challenge. Returned base64url, which is the form WebAuthn compares. */
  newChallenge(): string {
    this.sweepChallenges()
    const c = crypto.randomBytes(32).toString('base64url')
    this.challenges.set(c, Date.now() + CHALLENGE_TTL_MS)
    return c
  }

  /** Consume a challenge. Single-use by construction: a replayed assertion finds it gone. */
  consumeChallenge(candidate: string): boolean {
    this.sweepChallenges()
    if (!candidate || !this.challenges.has(candidate)) return false
    this.challenges.delete(candidate)
    return true
  }

  private sweepChallenges(): void {
    const now = Date.now()
    for (const [k, exp] of this.challenges) if (exp <= now) this.challenges.delete(k)
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
    sessions[token] = { createdAt: Date.now() }
    this.persistSessions()
    return token
  }

  validateSession(token: string | undefined): boolean {
    if (!token) return false
    const sessions = this.loadSessions()
    const now = Date.now()
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

  revokeAll(): void {
    this.sessions = {}
    this.persistSessions()
  }

  // ---- Rate limiting -----------------------------------------------------

  /** Let the server tell auth whether School mode is on, without auth importing the store. */
  setSchoolModeSource(fn: () => boolean): void {
    this.schoolMode = fn
  }

  loginAllowed(): boolean {
    return Date.now() >= this.lockedUntil
  }

  /** Milliseconds still to wait, or 0. What the lockout screen counts down. */
  lockoutRemainingMs(): number {
    return Math.max(0, this.lockedUntil - Date.now())
  }

  recordLoginFailure(): void {
    this.failures += 1
    if (this.failures >= MAX_FAILURES) {
      // Each consecutive lockout lasts twice as long as the last, capped at an hour. The flat
      // sixty seconds this replaced was the same price for the first wrong guess and the five
      // hundredth, which is no price at all for a script.
      this.lockedUntil = Date.now() + nextLockoutMs(this.lockoutStreak, LOCKOUT_MS)
      this.lockoutStreak += 1
      this.failures = 0
      // A fresh lockout is a fresh climb: dim sum again from the top. The ladder's own rolling
      // budget deliberately survives this, so repeated lockouts cannot mint unlimited climbs.
      this.ladder.reset()
    }
  }

  recordLoginSuccess(): void {
    this.failures = 0
    this.lockedUntil = 0
    this.lockoutStreak = 0
    this.ladder.reset()
  }

  /**
   * End the current wait because the ladder was cleared.
   *
   * Deliberately narrow: it moves `lockedUntil` and NOTHING else. `failures` is already zero (it
   * is zeroed when the lockout starts), so the user gets exactly the attempts waiting would have
   * given them — never more. `lockoutStreak` is untouched, so the next lockout is still twice as
   * long as this one. Widening this method is how the ladder would stop being safe.
   */
  clearLockoutByLadder(): void {
    this.lockedUntil = 0
  }
}
