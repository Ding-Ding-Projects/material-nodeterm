import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  Auth,
  CHALLENGE_TTL_MS,
  LOCKOUT_MS,
  MAX_CHALLENGES_GLOBAL,
  MAX_CHALLENGES_PER_CLIENT,
  MAX_LOGIN_CLIENT_STATES
} from './auth'
import {
  LADDER_BUDGET,
  MAX_LADDER_CHALLENGES_GLOBAL,
  type DimSumChallenge
} from '../core/unlock-ladder'
import { DIM_SUM_NAMES } from '../shared/dimsum-names'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-auth-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); vi.useRealTimers() })

describe('Auth', () => {
  it('refuses short passwords from non-HTTP callers', () => {
    const a = new Auth(dir)
    expect(() => a.setPassword('1234567')).toThrow(/at least 8/i)
    expect(() => a.setPassword('12345678')).not.toThrow()
    expect(a.isConfigured()).toBe(true)
  })

  it('is unconfigured until a password is set; then verifies only the right one', () => {
    const a = new Auth(dir)
    expect(a.isConfigured()).toBe(false)
    expect(a.verifyPassword('anything')).toBe(false)
    a.setPassword('correct horse')
    expect(a.isConfigured()).toBe(true)
    expect(a.verifyPassword('correct horse')).toBe(true)
    expect(a.verifyPassword('wrong')).toBe(false)
    // survives process restart (re-read from disk)
    expect(new Auth(dir).verifyPassword('correct horse')).toBe(true)
  })

  it('uses real asynchronous scrypt for admitted HTTP-path password attempts', async () => {
    const a = new Auth(dir)
    a.setPassword('correct horse')
    expect(await a.attemptPassword('peer-a', 'correct horse')).toBe('success')
    expect(await a.attemptPassword('peer-a', 'wrong')).toBe('invalid')
  })

  it('refuses hand-edited scrypt cost parameters before starting a proof', async () => {
    fs.writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({
        salt: '00'.repeat(16),
        hash: '00'.repeat(32),
        N: 2 ** 30,
        r: 8,
        p: 1
      })
    )
    expect(await new Auth(dir).attemptPassword('peer-a', 'anything')).toBe('error')
  })

  it('setup token is single-use and timing-safe-compared', () => {
    const a = new Auth(dir)
    const tok = a.setupToken()
    expect(a.setupToken()).toBe(tok) // stable within process
    expect(a.consumeSetupToken('wrong')).toBe(false)
    expect(a.consumeSetupToken(tok)).toBe(true)
    expect(a.consumeSetupToken(tok)).toBe(false) // consumed
  })

  it('sessions persist, validate, expire and revoke one or all', () => {
    vi.useFakeTimers()
    const a = new Auth(dir)
    const t = a.createSession()
    expect(a.validateSession(t)).toBe(true)
    expect(a.validateSession('nope')).toBe(false)
    expect(a.validateSession(undefined)).toBe(false)
    expect(new Auth(dir).validateSession(t)).toBe(true) // persisted
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)
    expect(a.validateSession(t)).toBe(false) // expired
    const t2 = a.createSession()
    const t3 = a.createSession()
    expect(a.revokeSession(t2)).toBe(true)
    expect(a.revokeSession(t2)).toBe(false)
    expect(new Auth(dir).validateSession(t2)).toBe(false)
    expect(new Auth(dir).validateSession(t3)).toBe(true)
    a.revokeAll()
    expect(a.validateSession(t3)).toBe(false)
  })

  it('locks out after 5 consecutive failures for 60s; success resets', () => {
    vi.useFakeTimers()
    const a = new Auth(dir)
    for (let i = 0; i < 5; i++) { expect(a.loginAllowed()).toBe(true); a.recordLoginFailure() }
    expect(a.loginAllowed()).toBe(false)
    vi.advanceTimersByTime(61_000)
    expect(a.loginAllowed()).toBe(true)
    a.recordLoginFailure(); a.recordLoginSuccess()
    for (let i = 0; i < 5; i++) { expect(a.loginAllowed()).toBe(true); a.recordLoginFailure() }
    expect(a.loginAllowed()).toBe(false)
  })

  it('serializes already-admitted slow attempts and stops before a sixth scrypt', async () => {
    let calls = 0
    let running = 0
    let maxRunning = 0
    const releases: Array<() => void> = []
    const a = new Auth(dir, {
      passwordVerifier: async () => {
        calls += 1
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await new Promise<void>((resolve) => releases.push(resolve))
        running -= 1
        return false
      }
    })

    const attempts = Array.from({ length: 6 }, () => a.attemptPassword('peer-a', 'wrong'))
    await vi.waitFor(() => expect(calls).toBe(1))
    for (let completed = 0; completed < 5; completed++) {
      releases.shift()!()
      if (completed < 4) await vi.waitFor(() => expect(calls).toBe(completed + 2))
    }
    const results = await Promise.all(attempts)

    expect(results.filter((r) => r === 'invalid')).toHaveLength(5)
    expect(results.filter((r) => r === 'busy')).toHaveLength(1)
    expect(maxRunning).toBe(1)
    expect(a.loginAllowed('peer-a')).toBe(false)
    expect(await a.attemptPassword('peer-a', 'right')).toBe('locked')
    expect(calls).toBe(5)
  })

  it('scopes exponential lockout to one TCP peer while retaining bounded global verification', async () => {
    let running = 0
    let maxRunning = 0
    const a = new Auth(dir, {
      maxActivePasswordVerifications: 2,
      passwordVerifier: async (password) => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await new Promise<void>((resolve) => setImmediate(resolve))
        running -= 1
        return password === 'right'
      }
    })

    for (let i = 0; i < 5; i++) expect(await a.attemptPassword('peer-attacker', 'wrong')).toBe('invalid')
    expect(a.loginAllowed('peer-attacker')).toBe(false)
    expect(a.loginAllowed('peer-legitimate')).toBe(true)
    expect(await a.attemptPassword('peer-legitimate', 'right')).toBe('success')
    expect(a.loginAllowed('peer-attacker')).toBe(false)

    const otherPeers = await Promise.all([
      a.attemptPassword('peer-b', 'wrong'),
      a.attemptPassword('peer-c', 'wrong'),
      a.attemptPassword('peer-d', 'wrong')
    ])
    expect(otherPeers).toEqual(['invalid', 'invalid', 'invalid'])
    expect(maxRunning).toBeLessThanOrEqual(2)
  })

  it('does not charge a late slow failure to the next lockout cycle', async () => {
    vi.useFakeTimers()
    let release!: () => void
    let started = false
    const a = new Auth(dir, {
      passwordVerifier: async () => {
        started = true
        await new Promise<void>((resolve) => { release = resolve })
        return false
      }
    })
    const slow = a.attemptPassword('peer-a', 'wrong')
    await vi.waitFor(() => expect(started).toBe(true))
    for (let i = 0; i < 5; i++) a.recordLoginFailure('peer-a')
    expect(a.loginAllowed('peer-a')).toBe(false)
    // Let the wait expire before the old proof finishes. A simple `currently locked` check is not
    // enough here; the generation boundary must still keep this result out of the new cycle.
    vi.advanceTimersByTime(LOCKOUT_MS + 1)
    release()
    expect(await slow).toBe('invalid')

    for (let i = 0; i < 4; i++) {
      expect(a.recordLoginFailure('peer-a')).toBe(true)
      expect(a.loginAllowed('peer-a')).toBe(true)
    }
    a.recordLoginFailure('peer-a')
    expect(a.loginAllowed('peer-a')).toBe(false)
  })

  it('cancels queued proofs when a real sign-in changes their admission epoch', async () => {
    let releaseBlocker!: () => void
    let blockerStarted = false
    let staleProofsStarted = 0
    const a = new Auth(dir, {
      maxActivePasswordVerifications: 1,
      passwordVerifier: async (password) => {
        if (password === 'block-global-slot') {
          blockerStarted = true
          await new Promise<void>((resolve) => { releaseBlocker = resolve })
          return false
        }
        staleProofsStarted += 1
        return false
      }
    })
    const blocker = a.attemptPassword('peer-b', 'block-global-slot')
    await vi.waitFor(() => expect(blockerStarted).toBe(true))
    const stale = Array.from({ length: 5 }, () => a.attemptPassword('peer-a', 'wrong'))

    // All five requests captured peer-a's original state before waiting. A passkey/password
    // success deletes that epoch; none may start a proof or seed the fresh counter afterward.
    a.recordLoginSuccess('peer-a')
    releaseBlocker()
    expect(await blocker).toBe('invalid')
    expect(await Promise.all(stale)).toEqual(Array(5).fill('locked'))
    expect(staleProofsStarted).toBe(0)

    for (let i = 0; i < 4; i++) {
      expect(a.recordLoginFailure('peer-a')).toBe(true)
      expect(a.loginAllowed('peer-a')).toBe(true)
    }
    a.recordLoginFailure('peer-a')
    expect(a.loginAllowed('peer-a')).toBe(false)
  })

  it('releases a failed verification slot and its pristine reservation', async () => {
    let rejectFirst!: (error: Error) => void
    let call = 0
    const a = new Auth(dir, {
      maxActivePasswordVerifications: 1,
      passwordVerifier: async () => {
        call += 1
        if (call === 1) return new Promise<boolean>((_resolve, reject) => { rejectFirst = reject })
        return true
      }
    })
    const first = a.attemptPassword('peer-a', 'wrong')
    const second = a.attemptPassword('peer-b', 'right')
    await vi.waitFor(() => expect(call).toBe(1))
    rejectFirst(new Error('synthetic scrypt failure'))
    expect(await first).toBe('error')
    expect(await second).toBe('success')

    for (const invalidMax of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const safe = new Auth(dir, {
        maxActivePasswordVerifications: invalidMax,
        passwordVerifier: async () => true
      })
      expect(await safe.attemptPassword(`peer-${String(invalidMax)}`, 'right')).toBe('success')
    }
  })

  it('caps the process-wide pending password backlog at 32 requests', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const a = new Auth(dir, {
      maxActivePasswordVerifications: 1,
      passwordVerifier: async () => {
        calls += 1
        await gate
        return false
      }
    })
    const attempts = Array.from({ length: 33 }, (_, i) => a.attemptPassword(`peer-${i}`, 'wrong'))
    await vi.waitFor(() => expect(calls).toBe(1))
    release()
    const results = await Promise.all(attempts)
    expect(results.filter((result) => result === 'busy')).toHaveLength(1)
    expect(results.filter((result) => result === 'invalid')).toHaveLength(32)
    expect(calls).toBe(32)
  })

  it('evicts only an unlocked non-pending peer when the scoped state table is full', async () => {
    let now = 1_000
    let release!: () => void
    let started = false
    const a = new Auth(dir, {
      now: () => now,
      passwordVerifier: async () => {
        started = true
        await new Promise<void>((resolve) => { release = resolve })
        return false
      }
    })

    a.recordLoginFailure('pending-peer')
    const pending = a.attemptPassword('pending-peer', 'wrong')
    await vi.waitFor(() => expect(started).toBe(true))
    now += 1
    for (let i = 0; i < 5; i++) a.recordLoginFailure('locked-peer')
    for (let i = 0; i < MAX_LOGIN_CLIENT_STATES - 2; i++) {
      now += 1
      a.recordLoginFailure(`inactive-${i}`)
    }

    now += 1
    expect(a.admitLoginClient('new-legitimate-peer')).toBe(true)
    expect(a.loginAllowed('locked-peer')).toBe(false)
    // inactive-0 was the oldest eligible victim and already had one failure. Four new failures
    // must still be allowed, proving admission actually deleted/reset it rather than merely
    // returning true while the table grew beyond its ceiling.
    for (let i = 0; i < 4; i++) expect(a.recordLoginFailure('inactive-0')).toBe(true)
    expect(a.loginAllowed('inactive-0')).toBe(true)
    a.recordLoginFailure('inactive-0')
    expect(a.loginAllowed('inactive-0')).toBe(false)
    release()
    expect(await pending).toBe('invalid')
    for (let i = 0; i < 3; i++) a.recordLoginFailure('pending-peer')
    expect(a.loginAllowed('pending-peer')).toBe(false)
  })

  it('refuses a new peer when every bounded state is still locked', () => {
    const a = new Auth(dir)
    const documentedCap = 1024
    expect(MAX_LOGIN_CLIENT_STATES).toBe(documentedCap)
    for (let peer = 0; peer < documentedCap; peer++) {
      for (let failure = 0; failure < 5; failure++) {
        expect(a.recordLoginFailure(`locked-${peer}`)).toBe(true)
      }
    }
    expect(a.admitLoginClient('one-peer-too-many')).toBe(false)
  })

  it('shares both ladder budgets across every Auth peer', () => {
    const a = new Auth(dir, { now: () => 1_000 })
    const clearLadders = Array.from(
      { length: LADDER_BUDGET + 1 },
      (_, i) => a.ladderFor(`clear-peer-${i}`)
    )
    const challenges = clearLadders.map((ladder) => ladder.issue('dimsum') as DimSumChallenge)
    const verdicts = clearLadders.map((ladder, i) => {
      const right = DIM_SUM_NAMES.find((dish) => dish.zhHant === challenges[i].prompt)!.en
      return ladder.verify({ kind: 'dimsum', nonce: challenges[i].nonce, choice: right })
    })
    expect(verdicts.filter((verdict) => verdict.cleared)).toHaveLength(LADDER_BUDGET)

    const nonceAuth = new Auth(dir, { now: () => 1_000 })
    for (let i = 0; i < MAX_LADDER_CHALLENGES_GLOBAL; i++) {
      expect(nonceAuth.ladderFor(`nonce-peer-${i}`).issue('dimsum')).not.toBeNull()
    }
    const overflow = nonceAuth.ladderFor('nonce-peer-overflow')
    expect(overflow.issue('dimsum')).toBeNull()
    nonceAuth.recordLoginSuccess('nonce-peer-0')
    expect(overflow.issue('dimsum')).not.toBeNull()
  })

  it('bounds, peer-binds and expires passkey challenges', () => {
    let now = 1_000
    const a = new Auth(dir, { now: () => now })
    const perPeer = Array.from(
      { length: MAX_CHALLENGES_PER_CLIENT + 1 },
      () => a.newChallenge('peer-a', 'login')!
    )
    expect(a.consumeChallenge(perPeer[0], 'peer-a', 'login')).toBe(false)

    const bound = a.newChallenge('peer-a', 'login')!
    expect(a.consumeChallenge(bound, 'peer-b', 'login')).toBe(false)
    expect(a.consumeChallenge(bound, 'peer-a', 'register')).toBe(false)
    expect(a.consumeChallenge(bound, 'peer-a', 'login')).toBe(true)

    const capped = new Auth(dir, { now: () => now })
    const issued: string[] = []
    for (let i = 0; i < MAX_CHALLENGES_GLOBAL; i++) {
      const challenge = capped.newChallenge(`peer-${Math.floor(i / MAX_CHALLENGES_PER_CLIENT)}`, 'login')
      expect(challenge).not.toBeNull()
      issued.push(challenge!)
    }
    expect(capped.newChallenge('one-peer-too-many', 'login')).toBeNull()
    expect(capped.newChallenge('peer-0', 'login')).toBeNull()

    now += CHALLENGE_TTL_MS + 1
    expect(capped.newChallenge('fresh-peer', 'login')).not.toBeNull()
    expect(capped.consumeChallenge(issued[0], 'peer-0', 'login')).toBe(false)
  })

  it('sweeps each bounded challenge exactly once, including after clock rollback', () => {
    let now = 0
    let visits = 0
    const a = new Auth(dir, { now: () => now, onChallengeSweepVisit: () => { visits += 1 } })
    a.newChallenge('peer-a', 'login')
    a.newChallenge('peer-b', 'login')
    visits = 0
    expect(a.consumeChallenge('garbage', 'peer-a', 'login')).toBe(false)
    expect(visits).toBe(2)

    const prefix = new Auth(dir, { now: () => now, onChallengeSweepVisit: () => { visits += 1 } })
    prefix.newChallenge('peer-1', 'login')
    now += 10
    prefix.newChallenge('peer-2', 'login')
    now += 10
    prefix.newChallenge('peer-3', 'login')
    now = CHALLENGE_TTL_MS + 15
    visits = 0
    expect(prefix.consumeChallenge('garbage', 'peer-1', 'login')).toBe(false)
    expect(visits).toBe(3)

    now = 1_000
    const rollback = new Auth(dir, { now: () => now })
    const earlier = rollback.newChallenge('peer-early', 'login')!
    now = 0
    const laterButSoonerExpiry = rollback.newChallenge('peer-later', 'login')!
    now = CHALLENGE_TTL_MS + 1
    expect(rollback.consumeChallenge(laterButSoonerExpiry, 'peer-later', 'login')).toBe(false)
    expect(rollback.consumeChallenge(earlier, 'peer-early', 'login')).toBe(true)
  })
})
