import { describe, expect, it } from 'vitest'
import { ARCHIVE_UNLOCK_THRESHOLD, ArchiveUnlockGuard } from './archive-unlock-guard'
import { DIM_SUM_NAMES } from '../shared/dimsum-names'

/** With `rand: () => 0` the engine always picks the first dish, so a test can answer correctly
 *  without the wire shape ever revealing the answer (it must not, and does not). */
const RIGHT_DISH = DIM_SUM_NAMES[0].en

/** A guard on a clock the test owns, so no case sleeps and none is flaky under CI contention. */
function make(opts: { schoolMode?: boolean } = {}): {
  guard: ArchiveUnlockGuard
  advance: (ms: number) => void
} {
  let clock = 1_000_000
  const guard = new ArchiveUnlockGuard({
    now: () => clock,
    baseWaitMs: 60_000,
    rand: () => 0,
    schoolMode: () => opts.schoolMode ?? false
  })
  return { guard, advance: (ms) => { clock += ms } }
}

const failTo = (guard: ArchiveUnlockGuard, key: string, n: number): void => {
  for (let i = 0; i < n; i += 1) guard.recordFailure(key)
}

describe('ArchiveUnlockGuard', () => {
  it('lets the first typos through with no wait at all', () => {
    const { guard } = make()
    for (let i = 1; i < ARCHIVE_UNLOCK_THRESHOLD; i += 1) {
      expect(guard.recordFailure('/f').waitMs).toBe(0)
    }
  })

  it('starts a wait at the threshold and ends it when the clock is served', () => {
    const { guard, advance } = make()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    expect(guard.state('/f').waitMs).toBe(60_000)
    advance(59_999)
    expect(guard.state('/f').waitMs).toBe(1)
    advance(1)
    expect(guard.state('/f').waitMs).toBe(0)
  })

  it('doubles the wait for each new lockout', () => {
    const { guard, advance } = make()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    expect(guard.state('/f').waitMs).toBe(60_000)
    advance(60_000)
    // Wrong again after serving the wait: a second lockout, twice as long.
    expect(guard.recordFailure('/f').waitMs).toBe(120_000)
    advance(120_000)
    expect(guard.recordFailure('/f').waitMs).toBe(240_000)
  })

  it('counts each file separately', () => {
    const { guard } = make()
    failTo(guard, '/a', ARCHIVE_UNLOCK_THRESHOLD)
    expect(guard.state('/a').waitMs).toBeGreaterThan(0)
    expect(guard.state('/b').waitMs).toBe(0)
  })

  it('forgets a file once the right password arrives', () => {
    const { guard } = make()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    guard.recordSuccess('/f')
    expect(guard.state('/f')).toEqual({ waitMs: 0, fails: 0, ladderAvailable: false })
  })

  it('offers no ladder while there is no wait to end', () => {
    const { guard } = make()
    expect(guard.state('/f').ladderAvailable).toBe(false)
    expect(guard.issue('/f').challenge).toBeNull()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD - 1)
    expect(guard.issue('/f').challenge).toBeNull()
  })

  it('offers a ladder once a wait is running, and clearing it ends that wait', () => {
    const { guard } = make()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    const issued = guard.issue('/f')
    expect(issued.challenge?.kind).toBe('dimsum')
    expect(guard.state('/f').ladderAvailable).toBe(true)

    const challenge = issued.challenge
    if (!challenge || challenge.kind !== 'dimsum') throw new Error('expected a dim-sum rung')
    const verdict = guard.verify('/f', {
      kind: 'dimsum',
      nonce: challenge.nonce,
      choice: RIGHT_DISH
    })
    expect(verdict.cleared).toBe(true)
    expect(verdict.waitMs).toBe(0)
  })

  it('clears the WAITING and never the credential or the attempt budget', () => {
    // Rule 1 and rule 2 together — the two the whole feature's safety rests on. A ladder clear
    // must leave the failure count intact, so the NEXT wrong password waits LONGER than this one
    // did rather than restarting the count.
    const { guard } = make()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    const challenge = guard.issue('/f').challenge
    if (!challenge || challenge.kind !== 'dimsum') throw new Error('expected a dim-sum rung')
    guard.verify('/f', { kind: 'dimsum', nonce: challenge.nonce, choice: RIGHT_DISH })

    const after = guard.state('/f')
    expect(after.waitMs).toBe(0)
    expect(after.fails).toBe(ARCHIVE_UNLOCK_THRESHOLD)
    // And the escalation it skipped is untouched (rule 4): the next failure is the SECOND
    // lockout's 2 minutes, not the first's one.
    expect(guard.recordFailure('/f').waitMs).toBe(120_000)
  })

  it('refuses a replayed nonce', () => {
    const { guard } = make()
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    const challenge = guard.issue('/f').challenge
    if (!challenge || challenge.kind !== 'dimsum') throw new Error('expected a dim-sum rung')
    const answer = { kind: 'dimsum', nonce: challenge.nonce, choice: RIGHT_DISH } as const
    expect(guard.verify('/f', answer).cleared).toBe(true)
    // The nonce is consumed BEFORE grading, so the same correct answer cannot clear a second wait.
    guard.recordFailure('/f')
    expect(guard.verify('/f', answer).cleared).toBe(false)
  })

  it('spends one shared budget across files, not one per file', () => {
    // The cap is the real defence: every rung is machine-solvable, so spreading wrong attempts
    // over several files must not multiply the waits the ladder can skip.
    const { guard } = make()
    const clear = (key: string): boolean => {
      const challenge = guard.issue(key).challenge
      if (!challenge || challenge.kind !== 'dimsum') return false
      return guard.verify(key, { kind: 'dimsum', nonce: challenge.nonce, choice: RIGHT_DISH })
        .cleared
    }
    for (const key of ['/a', '/b', '/c', '/d']) failTo(guard, key, ARCHIVE_UNLOCK_THRESHOLD)
    expect([clear('/a'), clear('/b'), clear('/c')]).toEqual([true, true, true])
    // Fourth file, fresh wait, and the rolling budget is spent — the clock is the only way now.
    expect(guard.state('/d').ladderAvailable).toBe(false)
    expect(guard.issue('/d').challenge).toBeNull()
  })

  it('starts at maths under School mode, with no dim-sum rung anywhere', () => {
    // School mode requires every dim-sum capability to behave as if it is not installed — so the
    // rung is ABSENT, never skipped with a message that would name the hidden thing.
    const { guard } = make({ schoolMode: true })
    failTo(guard, '/f', ARCHIVE_UNLOCK_THRESHOLD)
    expect(guard.issue('/f').challenge?.kind).toBe('math')
  })
})
