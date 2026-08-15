import { describe, expect, it } from 'vitest'

import {
  DIMSUM_MAX_FAILS,
  LADDER_BUDGET,
  LADDER_BUDGET_WINDOW_MS,
  LADDER_TTL_MS,
  MATH_QUESTION_COUNT,
  UnlockLadder,
  WHACK_DURATION_MS,
  WHACK_REQUIRED_HITS,
  nextLockoutMs,
  type DimSumChallenge,
  type MathChallenge,
  type WhackChallenge
} from './unlock-ladder'
import { DIM_SUM_NAMES } from '../shared/dimsum-names'

/** A ladder with a clock and a dice we control. */
function makeLadder(opts: { schoolMode?: boolean } = {}) {
  let t = 1_000_000
  const ladder = new UnlockLadder({
    now: () => t,
    rand: (max) => 0, // deterministic: always the first option
    schoolMode: () => opts.schoolMode === true
  })
  return { ladder, advance: (ms: number) => (t += ms), at: () => t }
}

describe('nextLockoutMs', () => {
  it('doubles per consecutive lockout and stops at the cap', () => {
    expect(nextLockoutMs(0)).toBe(60_000)
    expect(nextLockoutMs(1)).toBe(120_000)
    expect(nextLockoutMs(3)).toBe(480_000)
    expect(nextLockoutMs(99)).toBe(60 * 60 * 1000)
  })

  it('never returns a non-finite value for an absurd streak', () => {
    // 2 ** 1e9 is Infinity, and Math.min(cap, Infinity) is the cap — but Infinity * 0 style
    // arithmetic elsewhere is exactly how a "lockout" becomes NaN and unlocks instantly.
    expect(Number.isFinite(nextLockoutMs(1e9))).toBe(true)
  })
})

describe('dim sum rung', () => {
  it('asks for a real dish with four distinct choices', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue() as DimSumChallenge
    expect(c.kind).toBe('dimsum')
    expect(c.choices).toHaveLength(4)
    expect(new Set(c.choices).size).toBe(4)
    const dish = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)
    expect(dish, 'prompt must be a dish from the shared catalog').toBeTruthy()
    expect(c.choices).toContain(dish!.en)
  })

  it('clears the wait on the right answer', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue() as DimSumChallenge
    const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
    const v = ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: right })
    expect(v.cleared).toBe(true)
  })

  it(`hands over to maths after ${DIMSUM_MAX_FAILS} wrong answers`, () => {
    const { ladder } = makeLadder()
    let next: string | null = 'dimsum'
    for (let i = 0; i < DIMSUM_MAX_FAILS; i++) {
      const c = ladder.issue('dimsum') as DimSumChallenge
      const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
      const wrong = c.choices.find((x) => x !== right)!
      const v = ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: wrong })
      expect(v.cleared).toBe(false)
      next = v.next
    }
    expect(next).toBe('math')
  })

  it('does not exist under School mode — the climb starts at maths', () => {
    const { ladder } = makeLadder({ schoolMode: true })
    expect(ladder.firstRung()).toBe('math')
    // Even when a caller names the rung explicitly, School mode must not surface a dish.
    const c = ladder.issue('dimsum')
    expect(c?.kind).toBe('math')
  })
})

describe('maths rung', () => {
  it('asks ten questions and clears only when every one is right', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue('math') as MathChallenge
    expect(c.questions).toHaveLength(MATH_QUESTION_COUNT)
    const answers = c.questions.map(solve)
    expect(ladder.verify({ kind: 'math', nonce: c.nonce, answers }).cleared).toBe(true)
  })

  it('drops to whack-a-mole on a single wrong answer', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue('math') as MathChallenge
    const answers = c.questions.map(solve)
    answers[4] += 1
    const v = ladder.verify({ kind: 'math', nonce: c.nonce, answers })
    expect(v.cleared).toBe(false)
    expect(v.next).toBe('whack')
  })

  it('rejects a short answer list rather than treating the missing ones as right', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue('math') as MathChallenge
    const v = ladder.verify({ kind: 'math', nonce: c.nonce, answers: [solve(c.questions[0])] })
    expect(v.cleared).toBe(false)
  })
})

describe('whack-a-mole rung', () => {
  function play(ladder: UnlockLadder, advance: (ms: number) => void, hitCount: number) {
    const c = ladder.issue('whack') as WhackChallenge
    advance(WHACK_DURATION_MS)
    const hits = c.moles.slice(0, hitCount).map((m) => ({ cell: m.cell, atMs: m.showAtMs + 10 }))
    return ladder.verify({ kind: 'whack', nonce: c.nonce, hits })
  }

  it('clears when enough moles are hit', () => {
    const { ladder, advance } = makeLadder()
    expect(play(ladder, advance, WHACK_REQUIRED_HITS).cleared).toBe(true)
  })

  it('ends the ladder when too few are hit', () => {
    const { ladder, advance } = makeLadder()
    const v = play(ladder, advance, WHACK_REQUIRED_HITS - 1)
    expect(v.cleared).toBe(false)
    expect(v.exhausted).toBe(true)
    expect(ladder.available()).toBe(false)
  })

  it('cannot be won faster than the round lasts', () => {
    // The rule that stops a script posting a perfect score the instant it gets the schedule.
    const { ladder, advance } = makeLadder()
    const c = ladder.issue('whack') as WhackChallenge
    advance(WHACK_DURATION_MS - 1)
    const hits = c.moles.map((m) => ({ cell: m.cell, atMs: m.showAtMs + 10 }))
    const v = ladder.verify({ kind: 'whack', nonce: c.nonce, hits })
    expect(v.cleared).toBe(false)
    expect(v.message).toMatch(/not finished/i)
  })

  it('counts each mole once, however many times its cell is tapped', () => {
    const { ladder, advance } = makeLadder()
    const c = ladder.issue('whack') as WhackChallenge
    advance(WHACK_DURATION_MS)
    const m = c.moles[0]
    const spam = Array.from({ length: 50 }, () => ({ cell: m.cell, atMs: m.showAtMs + 5 }))
    const v = ladder.verify({ kind: 'whack', nonce: c.nonce, hits: spam })
    expect(v.cleared).toBe(false)
  })

  it('ignores a hit on a cell that never had a mole', () => {
    const { ladder, advance } = makeLadder()
    const c = ladder.issue('whack') as WhackChallenge
    advance(WHACK_DURATION_MS)
    // The deterministic dice puts every mole on cell 0, so cells 1..8 are empty for the whole
    // round. Tapping an empty cell at a perfectly valid TIME must still count for nothing —
    // otherwise "hit a mole" degrades into "send enough taps".
    const empty = c.moles.map((m) => ({ cell: m.cell + 1, atMs: m.showAtMs + 10 }))
    expect(ladder.verify({ kind: 'whack', nonce: c.nonce, hits: empty }).cleared).toBe(false)
  })

  it('ignores a hit outside the round window', () => {
    const { ladder, advance } = makeLadder()
    const c = ladder.issue('whack') as WhackChallenge
    advance(WHACK_DURATION_MS)
    const late = c.moles.map((m) => ({ cell: m.cell, atMs: WHACK_DURATION_MS + 1_000 }))
    expect(ladder.verify({ kind: 'whack', nonce: c.nonce, hits: late }).cleared).toBe(false)
  })
})

describe('the safety boundary', () => {
  it('a challenge is single-use — the same right answer cannot be replayed', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue() as DimSumChallenge
    const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
    expect(ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: right }).cleared).toBe(true)
    expect(ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: right }).cleared).toBe(false)
  })

  it('a challenge expires', () => {
    const { ladder, advance } = makeLadder()
    const c = ladder.issue() as DimSumChallenge
    const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
    advance(LADDER_TTL_MS + 1)
    expect(ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: right }).cleared).toBe(false)
  })

  it('an answer of the wrong kind cannot clear a challenge', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue('math') as MathChallenge
    const v = ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: 'Egg tart' })
    expect(v.cleared).toBe(false)
  })

  it(`skips at most ${LADDER_BUDGET} waits per hour, then makes everyone serve the clock`, () => {
    // THE cap. Every rung is machine-solvable, so this is what stops the ladder from making
    // brute force cheaper than waiting.
    const { ladder, advance } = makeLadder()
    for (let i = 0; i < LADDER_BUDGET; i++) {
      const c = ladder.issue() as DimSumChallenge
      const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
      expect(ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: right }).cleared).toBe(true)
      ladder.reset()
    }
    expect(ladder.budgetLeft()).toBe(0)
    expect(ladder.available()).toBe(false)
    expect(ladder.issue()).toBeNull()

    advance(LADDER_BUDGET_WINDOW_MS + 1)
    expect(ladder.budgetLeft()).toBe(LADDER_BUDGET)
    expect(ladder.issue()).not.toBeNull()
  })

  it('reset() clears the climb but NOT the rolling budget', () => {
    const { ladder } = makeLadder()
    const c = ladder.issue() as DimSumChallenge
    const right = DIM_SUM_NAMES.find((d) => d.zhHant === c.prompt)!.en
    ladder.verify({ kind: 'dimsum', nonce: c.nonce, choice: right })
    ladder.reset()
    expect(ladder.budgetLeft()).toBe(LADDER_BUDGET - 1)
  })
})

/** Evaluate a rendered question like `"7 + 6"` / `"19 − 4"` / `"3 × 8"`. */
function solve(q: string): number {
  const m = /^(\d+)\s*([+−×])\s*(\d+)$/.exec(q)
  if (!m) throw new Error(`unparseable question: ${q}`)
  const a = Number(m[1])
  const b = Number(m[3])
  return m[2] === '+' ? a + b : m[2] === '−' ? a - b : a * b
}
