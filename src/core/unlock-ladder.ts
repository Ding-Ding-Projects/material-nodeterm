// The unlock ladder — a playful way out of a lockout, and the exact boundary of what it may do.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT IT IS
//
// When repeated wrong passwords lock an account, the user normally sits and waits. The ladder
// offers something to DO instead, escalating as it goes:
//
//     rung 1  dim sum      one dish, four choices               5 wrong answers → rung 2
//     rung 2  mental maths ten easy sums, all must be right     one wrong       → rung 3
//     rung 3  whack-a-mole hit enough moles in the round        lose            → serve the clock
//
// Clearing any rung ends the CURRENT wait. Failing the whole ladder is not a punishment: it just
// leaves the user where they already were, waiting, and the ladder is not offered again for that
// lockout.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT IT MUST NEVER DO, and why each line of this is load-bearing
//
// 1. IT CLEARS THE WAITING, NEVER THE CREDENTIAL. Passing rung 3 does not log anybody in. The
//    user still has to know the password. A quiz that granted access would be a second, far
//    weaker password, and "guess a dumpling" is not an authentication factor.
//
// 2. IT NEVER REFUNDS THE ATTEMPT BUDGET. Waiting out a lockout returns the same five attempts
//    the ladder does. If the ladder handed back MORE, solving it would be strictly better than
//    waiting and brute force would get cheaper, which is the one thing a lockout exists to stop.
//
// 3. IT IS BUDGETED, because a script can play it. Every rung is guessable or computable by a
//    machine — a four-choice question is one-in-four, ten small sums are trivial, and a mole
//    schedule is just arithmetic. So the ladder may skip at most LADDER_BUDGET waits per rolling
//    hour; after that the clock is the only way through, for everyone. This is the cap that keeps
//    the honest attacker economics intact, and it is why the ladder is fun rather than dangerous.
//
// 4. IT NEVER SLOWS THE ESCALATION IT SKIPS. The underlying lockout still doubles each time
//    (`nextLockoutMs`), so an attacker who spends their whole ladder budget still walks into an
//    exponentially longer wait afterwards.
//
// 5. EVERY ANSWER IS CHECKED HERE, SERVER-SIDE, AGAINST A ONE-SHOT NONCE. A ladder graded in the
//    browser is a ladder skipped with a single fetch, and would be pure theatre.
//
// 6. THE WHACK-A-MOLE ROUND CANNOT BE WON FASTER THAN IT LASTS. The submission is rejected if it
//    arrives before the round's own duration has actually elapsed — otherwise a script returns a
//    perfect score instantly and the last rung costs nothing.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// SCHOOL MODE
//
// School mode requires every dim-sum capability to behave as if it is not installed. So under it
// the ladder simply STARTS at maths — the dim-sum rung is not skipped-with-a-message (that would
// name the thing being hidden), it is absent, and `firstRung` is the single place that decides.

import { randomInt } from 'crypto'

import { DIM_SUM_NAMES } from '../shared/dimsum-names'

/** Rungs, in the order they are climbed. */
export type LadderRung = 'dimsum' | 'math' | 'whack'

/** Wrong dim-sum answers tolerated before the ladder moves on to maths. */
export const DIMSUM_MAX_FAILS = 5
/** Maths questions in a round. Every one must be right; the first mistake moves to whack-a-mole. */
export const MATH_QUESTION_COUNT = 10
/** How long a whack-a-mole round runs. */
export const WHACK_DURATION_MS = 15_000
/** Moles that must be hit to clear the round. */
export const WHACK_REQUIRED_HITS = 8
/** Moles offered during the round — more than required, so a couple of misses are survivable. */
export const WHACK_MOLE_COUNT = 14
/** A ladder challenge is stale after this long; the user takes a fresh one. */
export const LADDER_TTL_MS = 5 * 60 * 1000
/** Waits the ladder may skip per rolling hour. See rule 3 above — this is the real safety cap. */
export const LADDER_BUDGET = 3
export const LADDER_BUDGET_WINDOW_MS = 60 * 60 * 1000
/** A peer may refresh or retry a ceremony, but it cannot turn the playful route into an
 *  unbounded nonce store. */
export const MAX_LADDER_CHALLENGES_PER_PEER = 8
/** All peer ladders for one account share this second ceiling. */
export const MAX_LADDER_CHALLENGES_GLOBAL = 256

/** One account can have several independently locked network peers, but distributing failures
 *  must not multiply the number of waits the ladder may skip. Each peer owns a climb while every
 *  climb records against this one rolling account budget. */
export class UnlockLadderBudget {
  private clears: number[] = []

  left(now: number): number {
    const cutoff = now - LADDER_BUDGET_WINDOW_MS
    this.clears = this.clears.filter((t) => t > cutoff)
    return Math.max(0, LADDER_BUDGET - this.clears.length)
  }

  tryRecord(now: number): boolean {
    if (this.left(now) <= 0) return false
    this.clears.push(now)
    return true
  }
}

/** Shared live-nonce accounting. UnlockLadder owns the records; this object owns only the exact
 *  process-wide reservation count so independent peer ladders cannot multiply the memory cap. */
export class UnlockLadderChallengeBudget {
  private reservations = new Map<symbol, number>()

  available(now: number): boolean {
    this.sweep(now)
    return this.reservations.size < MAX_LADDER_CHALLENGES_GLOBAL
  }

  tryReserve(expiresAt: number, now: number): symbol | null {
    if (!this.available(now)) return null
    const token = Symbol()
    this.reservations.set(token, expiresAt)
    return token
  }

  release(token: symbol): void {
    this.reservations.delete(token)
  }

  has(token: symbol): boolean {
    return this.reservations.has(token)
  }

  private sweep(now: number): void {
    // The global ledger is capped at 256, so this remains one bounded O(n) pass and lets a new
    // peer reclaim expired reservations even if the peer that minted them never returns.
    for (const [token, expiresAt] of this.reservations) {
      if (expiresAt <= now) this.reservations.delete(token)
    }
  }
}

// ---- Question shapes (what a surface renders) --------------------------------------------

export interface DimSumChallenge {
  kind: 'dimsum'
  nonce: string
  /** The dish named in Traditional Chinese; the user picks its English name. */
  prompt: string
  choices: string[]
  /** Wrong answers left before this rung gives up and hands over to maths. */
  triesLeft: number
}

export interface MathChallenge {
  kind: 'math'
  nonce: string
  /** Ten renderable sums, e.g. `"7 + 6"`. Answers are integers. */
  questions: string[]
}

export interface WhackMole {
  /** Index into a `gridSize × gridSize` grid. */
  cell: number
  showAtMs: number
  hideAtMs: number
}

export interface WhackChallenge {
  kind: 'whack'
  nonce: string
  gridSize: number
  durationMs: number
  requiredHits: number
  moles: WhackMole[]
}

export type LadderChallenge = DimSumChallenge | MathChallenge | WhackChallenge

/** A claimed hit: the cell tapped, at this many ms after the round started. */
export interface WhackHit {
  cell: number
  atMs: number
}

export type LadderAnswer =
  | { kind: 'dimsum'; nonce: string; choice: string }
  | { kind: 'math'; nonce: string; answers: number[] }
  | { kind: 'whack'; nonce: string; hits: WhackHit[] }

export interface LadderVerdict {
  /** True only when the wait has been cleared. Never means "authenticated". */
  cleared: boolean
  /** The rung to present next, or null when the ladder is finished (cleared, or exhausted). */
  next: LadderRung | null
  /** Plain-language outcome. Carries the fact; funny levels style the copy around it. */
  message: string
  /** Set when the ladder is over and the user must serve the remaining wait. */
  exhausted?: boolean
}

// ---- Internal challenge record -------------------------------------------------------------

interface Issued {
  rung: LadderRung
  expiresAt: number
  /** When the challenge was handed out — the whack round's honest start time. */
  issuedAt: number
  dimsumAnswer?: string
  mathAnswers?: number[]
  moles?: WhackMole[]
  gridSize?: number
  challengeReservation: symbol
}

export interface LadderDeps {
  now?: () => number
  /** Inclusive-exclusive integer in [0, max). Injected so tests can be deterministic. */
  rand?: (max: number) => number
  /** True while School mode is on, which removes the dim-sum rung entirely. */
  schoolMode?: () => boolean
  /** Shared by every independently locked peer of one account. Omit for a standalone ladder. */
  budget?: UnlockLadderBudget
  /** Shared live-challenge ceiling for those peer ladders. Omit for a standalone ladder. */
  challengeBudget?: UnlockLadderChallengeBudget
}

/**
 * Escalating lockout duration. Independent of the ladder on purpose (rule 4): the ladder skips a
 * wait, it never makes the NEXT one shorter.
 */
export function nextLockoutMs(consecutiveLockouts: number, baseMs = 60_000, capMs = 60 * 60 * 1000): number {
  const n = Math.max(0, Math.floor(consecutiveLockouts))
  // 2^n grows fast enough to overflow into Infinity for a long-running attack; clamp the exponent
  // before the shift rather than trusting the cap to catch a non-finite value.
  const factor = 2 ** Math.min(n, 20)
  return Math.min(capMs, baseMs * factor)
}

export class UnlockLadder {
  private readonly now: () => number
  private readonly rand: (max: number) => number
  private readonly schoolMode: () => boolean
  private readonly budget: UnlockLadderBudget
  private readonly challengeBudget: UnlockLadderChallengeBudget

  /** Live challenges by nonce. In memory only: a challenge that does not survive a restart is a
   *  challenge that cannot be replayed after one, which is a feature. */
  private issued = new Map<string, Issued>()
  /** Dim-sum wrong answers so far in this climb. */
  private dimsumFails = 0
  /** True once this lockout's ladder has been failed to the bottom; no second climb. */
  private exhausted = false

  constructor(deps: LadderDeps = {}) {
    this.now = deps.now ?? (() => Date.now())
    this.rand = deps.rand ?? ((max) => randomInt(0, max))
    this.schoolMode = deps.schoolMode ?? (() => false)
    this.budget = deps.budget ?? new UnlockLadderBudget()
    this.challengeBudget = deps.challengeBudget ?? new UnlockLadderChallengeBudget()
  }

  /** Reset per-lockout climb state. Called when a NEW lockout begins. The rolling clear budget
   *  deliberately survives — it is a cap across lockouts, not within one. */
  reset(): void {
    this.clearIssued()
    this.dimsumFails = 0
    this.exhausted = false
  }

  /** The rung a fresh climb starts on. School mode removes dim sum, so it starts at maths. */
  firstRung(): LadderRung {
    return this.schoolMode() ? 'math' : 'dimsum'
  }

  /** Ladder clears still available in the rolling window. */
  budgetLeft(): number {
    return this.budget.left(this.now())
  }

  /** Whether a ladder may be offered at all right now. */
  available(): boolean {
    return !this.exhausted && this.budgetLeft() > 0
  }

  /** Hand out a challenge for a rung. Returns null when the ladder is not on offer. */
  issue(rung: LadderRung = this.firstRung()): LadderChallenge | null {
    if (!this.available()) return null
    // School mode must not produce a dim-sum question even if a caller asks for one by name.
    const r: LadderRung = rung === 'dimsum' && this.schoolMode() ? 'math' : rung
    this.sweep()
    // Refuse while the shared ledger is full before rotating this peer's oldest nonce. Otherwise
    // existing holders could extend their leases before TTL instead of competing afresh afterward.
    if (!this.challengeBudget.available(this.now())) return null
    while (this.issued.size >= MAX_LADDER_CHALLENGES_PER_PEER) {
      const oldest = this.issued.keys().next().value as string | undefined
      if (!oldest) break
      this.deleteIssued(oldest)
    }
    const nonce = this.nonce()
    const at = this.now()
    const base = { expiresAt: at + LADDER_TTL_MS, issuedAt: at }

    if (r === 'dimsum') {
      const pick = DIM_SUM_NAMES[this.rand(DIM_SUM_NAMES.length)]
      const others = DIM_SUM_NAMES.filter((d) => d.id !== pick.id)
      const distractors: string[] = []
      // Three DIFFERENT wrong dishes. Drawing with replacement would sometimes show the same
      // wrong answer twice, which quietly turns a four-choice question into a three-choice one.
      const pool = others.slice()
      while (distractors.length < 3 && pool.length) {
        distractors.push(pool.splice(this.rand(pool.length), 1)[0].en)
      }
      const choices = this.shuffle([pick.en, ...distractors])
      if (!this.storeIssued(nonce, { ...base, rung: 'dimsum', dimsumAnswer: pick.en })) return null
      return {
        kind: 'dimsum',
        nonce,
        prompt: pick.zhHant,
        choices,
        triesLeft: DIMSUM_MAX_FAILS - this.dimsumFails
      }
    }

    if (r === 'math') {
      const questions: string[] = []
      const answers: number[] = []
      for (let i = 0; i < MATH_QUESTION_COUNT; i++) {
        const q = this.mathQuestion()
        questions.push(q.text)
        answers.push(q.answer)
      }
      if (!this.storeIssued(nonce, { ...base, rung: 'math', mathAnswers: answers })) return null
      return { kind: 'math', nonce, questions }
    }

    const gridSize = 3
    const moles: WhackMole[] = []
    // Spread the moles across the round rather than randomising freely: random placement clumps,
    // and a clump makes the round unwinnable through no fault of the player.
    const slot = Math.floor(WHACK_DURATION_MS / WHACK_MOLE_COUNT)
    for (let i = 0; i < WHACK_MOLE_COUNT; i++) {
      const showAtMs = i * slot + this.rand(Math.max(1, Math.floor(slot / 2)))
      moles.push({ cell: this.rand(gridSize * gridSize), showAtMs, hideAtMs: showAtMs + 1200 })
    }
    if (!this.storeIssued(nonce, { ...base, rung: 'whack', moles, gridSize })) return null
    return {
      kind: 'whack',
      nonce,
      gridSize,
      durationMs: WHACK_DURATION_MS,
      requiredHits: WHACK_REQUIRED_HITS,
      moles
    }
  }

  /** Grade an answer. The ONLY way the ladder can be cleared. */
  verify(answer: LadderAnswer): LadderVerdict {
    this.sweep()
    if (this.exhausted) {
      this.clearIssued()
      return {
        cleared: false,
        next: null,
        exhausted: true,
        message: 'That climb is over — the clock is the way through.'
      }
    }
    const rec = this.issued.get(answer.nonce)
    if (!rec) {
      return {
        cleared: false,
        next: this.exhausted ? null : this.firstRung(),
        message: 'That challenge has expired — take a fresh one.'
      }
    }
    // One answer advances this one climb, so consume every outstanding nonce before grading. If
    // two tabs requested different rungs, an older correct answer must not clear after the newer
    // answer moved the state machine on or exhausted it.
    this.clearIssued()
    if (rec.rung !== answer.kind) {
      return { cleared: false, next: rec.rung, message: 'That answer does not match the challenge.' }
    }

    if (answer.kind === 'dimsum') {
      if (answer.choice === rec.dimsumAnswer) return this.clear('Correct — that is the one. Unlocked.')
      this.dimsumFails += 1
      if (this.dimsumFails >= DIMSUM_MAX_FAILS) {
        return {
          cleared: false,
          next: 'math',
          message: `Not that one. That is ${DIMSUM_MAX_FAILS} misses — ten easy sums instead.`
        }
      }
      return {
        cleared: false,
        next: 'dimsum',
        message: `Not that one. ${DIMSUM_MAX_FAILS - this.dimsumFails} tries left.`
      }
    }

    if (answer.kind === 'math') {
      const expected = rec.mathAnswers ?? []
      const given = Array.isArray(answer.answers) ? answer.answers : []
      const allRight =
        given.length === expected.length && expected.every((v, i) => Number(given[i]) === v)
      if (allRight) return this.clear('All ten right. Unlocked.')
      return { cleared: false, next: 'whack', message: 'One of those was wrong — whack-a-mole it is.' }
    }

    // whack-a-mole
    const moles = rec.moles ?? []
    const grid = rec.gridSize ?? 3
    const elapsed = this.now() - rec.issuedAt
    if (elapsed < WHACK_DURATION_MS) {
      // Rule 6: the round cannot be finished before it is over. Without this a script posts a
      // perfect score the moment it receives the schedule and the last rung is free.
      return {
        cleared: false,
        next: 'whack',
        message: 'That round has not finished yet. Play it out.'
      }
    }
    const hits = Array.isArray(answer.hits) ? answer.hits : []
    const used = new Set<number>()
    let good = 0
    for (const h of hits) {
      if (!Number.isFinite(h?.atMs) || h.atMs < 0 || h.atMs > WHACK_DURATION_MS) continue
      if (!Number.isInteger(h?.cell) || h.cell < 0 || h.cell >= grid * grid) continue
      const i = moles.findIndex(
        (m, idx) => !used.has(idx) && m.cell === h.cell && h.atMs >= m.showAtMs && h.atMs <= m.hideAtMs
      )
      // A hit only counts against a mole that was actually up, in that cell, at that moment —
      // and each mole can only be hit once, so a hundred taps on one cell is still one hit.
      if (i >= 0) {
        used.add(i)
        good += 1
      }
    }
    if (good >= WHACK_REQUIRED_HITS) return this.clear(`${good} moles. Unlocked.`)
    this.exhausted = true
    this.clearIssued()
    return {
      cleared: false,
      next: null,
      exhausted: true,
      message: `${good} of ${WHACK_REQUIRED_HITS} moles. The clock it is — the wait is nearly over anyway.`
    }
  }

  private clear(message: string): LadderVerdict {
    // Several independently locked peers may have challenges outstanding while one global slot
    // remains. Claim it again at grading time; issue-time availability alone lets every already-
    // issued correct answer overspend the account-wide budget.
    if (!this.budget.tryRecord(this.now())) {
      this.exhausted = true
      this.clearIssued()
      return {
        cleared: false,
        next: null,
        exhausted: true,
        message: 'No shortcuts left — the clock is the way through.'
      }
    }
    this.reset()
    return { cleared: true, next: null, message }
  }

  private mathQuestion(): { text: string; answer: number } {
    const op = this.rand(3)
    if (op === 0) {
      const a = this.rand(20) + 1
      const b = this.rand(20) + 1
      return { text: `${a} + ${b}`, answer: a + b }
    }
    if (op === 1) {
      // Ordered so the answer is never negative — "easy" means easy.
      const a = this.rand(20) + 5
      const b = this.rand(a)
      return { text: `${a} − ${b}`, answer: a - b }
    }
    const a = this.rand(9) + 2
    const b = this.rand(9) + 2
    return { text: `${a} × ${b}`, answer: a * b }
  }

  private shuffle<T>(xs: T[]): T[] {
    const out = xs.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.rand(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  private nonce(): string {
    let s = ''
    for (let i = 0; i < 24; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[this.rand(36)]
    return s
  }

  private storeIssued(nonce: string, record: Omit<Issued, 'challengeReservation'>): boolean {
    // A cryptographic collision is fantastically unlikely, but deterministic Chuts inject dice
    // and accounting must remain exact even then.
    if (this.issued.has(nonce)) this.deleteIssued(nonce)
    const reservation = this.challengeBudget.tryReserve(record.expiresAt, this.now())
    if (!reservation) return false
    this.issued.set(nonce, { ...record, challengeReservation: reservation })
    return true
  }

  private deleteIssued(nonce: string): void {
    const record = this.issued.get(nonce)
    if (!record || !this.issued.delete(nonce)) return
    this.challengeBudget.release(record.challengeReservation)
  }

  private clearIssued(): void {
    for (const nonce of this.issued.keys()) this.deleteIssued(nonce)
  }

  private sweep(): void {
    const now = this.now()
    // This is a single bounded pass: both non-monotonic clocks and an attacker refreshing one
    // rung are safe because a peer can retain at most MAX_LADDER_CHALLENGES_PER_PEER entries.
    for (const [nonce, record] of this.issued) {
      if (
        record.expiresAt <= now ||
        !this.challengeBudget.has(record.challengeReservation)
      ) this.deleteIssued(nonce)
    }
  }
}
