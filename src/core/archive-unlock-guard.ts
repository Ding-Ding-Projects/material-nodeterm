// Repeated wrong passwords on a protected project file — the wait, and the playful way out of it.
//
// This is the same shape the toy locks already use (core/toylocks/toylock-service.ts): count the
// failures per target, make the wait double once the threshold is passed, and offer the unlock
// ladder (core/unlock-ladder.ts — dim sum → mental maths → whack-a-mole) as a way to end THIS
// wait. Every one of the ladder's five rules holds here unchanged, and two of them are worth
// restating because this target is a file rather than an account:
//
//   · Clearing a rung ends the WAITING, never the credential. The user lands back on the same
//     password prompt, still needing the same password. Nothing here decrypts anything.
//   · No attempt refund. `fails` survives a ladder clear, so the NEXT wrong password waits longer
//     than this one would have — the ladder skips a wait, it never makes the next one shorter.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS NOT
//
// It is NOT what protects the file. Anyone holding the bytes can attack them offline, at their own
// pace, with this code nowhere in the picture; what costs them is the KDF (128 MiB of scrypt per
// guess — see project-archive-encryption.ts). This is a speed bump for the person at the keyboard,
// in exactly the sense the toy locks are, and the copy in front of it must never imply otherwise.
//
// It lives in the CORE process rather than the renderer for the reason the ladder's own header
// gives: a count kept by the guesser is not a count. It is deliberately in-memory only — a wait
// that a restart clears is honest about being a speed bump, and persisting it would mean a file
// the user typo'd twice could refuse them after a reboot with no way to see why.

import { UnlockLadder, UnlockLadderBudget, UnlockLadderChallengeBudget, nextLockoutMs } from './unlock-ladder'
import type { LadderAnswer, LadderChallenge, LadderVerdict } from '../shared/unlock-ladder-types'

/** Wrong passwords tolerated before any wait at all. Matches the Server Edition's login gate: the
 *  first few are typos, and a person who has just been handed a file deserves them. */
export const ARCHIVE_UNLOCK_THRESHOLD = 5

export interface ArchiveUnlockState {
  /** Milliseconds still to wait before another password may be tried. 0 = try now. */
  waitMs: number
  /** Wrong passwords so far for this file. Survives a ladder clear (rule 2). */
  fails: number
  /** A ladder may be offered right now: this climb has not been failed to the bottom and the
   *  shared rolling budget still has a clear in it. */
  ladderAvailable: boolean
}

interface RateState {
  fails: number
  lastFailAt: number
  /** How many waits this file has already served/skipped — what makes the next one longer. */
  lockouts: number
}

export interface ArchiveUnlockGuardDeps {
  now?: () => number
  /** True while School mode is on. Read as a CLOSURE, never sampled once: it is a shared switch a
   *  running app must pick up without a restart, and under it the ladder starts at maths because
   *  the dim-sum rung must behave as though it is not installed. */
  schoolMode?: () => boolean
  /** Base wait after the threshold is passed. Injected for tests only. */
  baseWaitMs?: number
  /** Inclusive-exclusive integer in [0, max) — the ladder's own randomness dep, forwarded so a
   *  test can know which dish is the right one. Production never passes it. */
  rand?: (max: number) => number
}

/**
 * One guard per process, keyed by the resolved path of the protected file.
 *
 * The rolling ladder budget is shared across every file, exactly as the toy-lock service shares
 * one across every lock: spreading wrong attempts over several files must not multiply the number
 * of waits the ladder may skip. That cap — not the difficulty of the games — is what keeps this
 * playful rather than a second, much weaker password.
 */
export class ArchiveUnlockGuard {
  private readonly now: () => number
  private readonly schoolMode: () => boolean
  private readonly baseWaitMs: number
  private readonly rand?: (max: number) => number
  private readonly rate = new Map<string, RateState>()
  private readonly ladderBudget = new UnlockLadderBudget()
  private readonly challengeBudget = new UnlockLadderChallengeBudget()
  /** One ladder per file, remembered with the `lockouts` count that minted it so a NEW wait starts
   *  a fresh climb rather than resuming the last one. */
  private readonly ladders = new Map<string, { ladder: UnlockLadder; lockouts: number }>()

  constructor(deps: ArchiveUnlockGuardDeps = {}) {
    this.now = deps.now ?? ((): number => Date.now())
    this.schoolMode = deps.schoolMode ?? ((): boolean => false)
    this.baseWaitMs = deps.baseWaitMs ?? 60_000
    this.rand = deps.rand
  }

  state(key: string): ArchiveUnlockState {
    const s = this.rate.get(key)
    if (!s || s.fails < ARCHIVE_UNLOCK_THRESHOLD) {
      return { waitMs: 0, fails: s?.fails ?? 0, ladderAvailable: false }
    }
    // `lockouts` counts from 1 (the first one), while `nextLockoutMs` doubles from 0 — so the
    // first lockout is the base wait and each later one is twice its predecessor.
    const waitMs = Math.max(
      0,
      s.lastFailAt + nextLockoutMs(Math.max(0, s.lockouts - 1), this.baseWaitMs) - this.now()
    )
    return {
      waitMs,
      fails: s.fails,
      // Offered only while there is actually a wait to end. A ladder on a file the user may
      // already retry would be a game for nothing.
      ladderAvailable: waitMs > 0 && this.ladderFor(key, s.lockouts).available()
    }
  }

  /** Record a wrong password. Returns the state the caller should report — including the wait this
   *  very failure may have just started. */
  recordFailure(key: string): ArchiveUnlockState {
    const prev = this.rate.get(key) ?? { fails: 0, lastFailAt: 0, lockouts: 0 }
    const fails = prev.fails + 1
    // Crossing the threshold, or failing again after a served wait, is a NEW lockout — and each
    // one is longer than the last (`nextLockoutMs`). The ladder never touches this number, which
    // is rule 4: it skips a wait without slowing the escalation.
    const startsNewLockout = fails >= ARCHIVE_UNLOCK_THRESHOLD && this.state(key).waitMs === 0
    const lockouts = startsNewLockout ? prev.lockouts + 1 : prev.lockouts
    this.rate.set(key, { fails, lastFailAt: this.now(), lockouts })
    return this.state(key)
  }

  /** The right password arrived: forget this file entirely, ladder included. */
  recordSuccess(key: string): void {
    this.rate.delete(key)
    this.ladders.delete(key)
  }

  /**
   * Rule 1 and rule 2 in one place: end the WAIT, keep the failure count.
   *
   * `lastFailAt = 0` makes the wait already elapsed while `fails` and `lockouts` survive — so the
   * next wrong password starts a longer wait than this one, exactly as if the clock had been
   * served. Nothing here supplies, weakens, or checks a credential.
   */
  private clearWaitByLadder(key: string): void {
    const s = this.rate.get(key)
    if (s) this.rate.set(key, { ...s, lastFailAt: 0 })
  }

  private ladderFor(key: string, lockouts: number): UnlockLadder {
    const existing = this.ladders.get(key)
    if (existing && existing.lockouts === lockouts) return existing.ladder
    const ladder =
      existing?.ladder ??
      new UnlockLadder({
        schoolMode: this.schoolMode,
        ...(this.rand ? { rand: this.rand } : {}),
        budget: this.ladderBudget,
        challengeBudget: this.challengeBudget
      })
    if (existing) ladder.reset()
    this.ladders.set(key, { ladder, lockouts })
    return ladder
  }

  /** Hand out the next question, or `null` when no ladder is on offer (no wait to end, the climb
   *  was already failed to the bottom, or the rolling budget is spent). */
  issue(key: string): { challenge: LadderChallenge | null; budgetLeft: number; waitMs: number } {
    const st = this.state(key)
    const s = this.rate.get(key)
    const ladder = this.ladderFor(key, s?.lockouts ?? 0)
    return {
      challenge: st.waitMs > 0 ? ladder.issue() : null,
      budgetLeft: ladder.budgetLeft(),
      waitMs: st.waitMs
    }
  }

  /**
   * Grade an answer core-side against its one-shot nonce (rule 5) and, on a clear, end the wait.
   * The next rung's question is minted here rather than left to a second round-trip, and the
   * remaining rolling budget travels with the verdict — the panel drawing this has no other way
   * to know either, and must never compute them itself.
   */
  verify(
    key: string,
    answer: LadderAnswer
  ): LadderVerdict & { waitMs: number; budgetLeft: number; challenge: LadderChallenge | null } {
    const s = this.rate.get(key)
    const ladder = this.ladderFor(key, s?.lockouts ?? 0)
    if (this.state(key).waitMs <= 0) {
      // The wait ended on its own while the round was being played. Say so rather than spending a
      // ladder clear on a wait that is already over.
      return {
        cleared: true,
        next: null,
        message: 'The wait is over — try the password again.',
        challenge: null,
        budgetLeft: ladder.budgetLeft(),
        waitMs: 0
      }
    }
    const verdict = ladder.verify(answer)
    if (verdict.cleared) this.clearWaitByLadder(key)
    const challenge = verdict.cleared || !verdict.next ? null : ladder.issue(verdict.next)
    return { ...verdict, challenge, budgetLeft: ladder.budgetLeft(), waitMs: this.state(key).waitMs }
  }
}
