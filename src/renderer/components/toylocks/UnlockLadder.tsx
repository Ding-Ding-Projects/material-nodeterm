// The unlock ladder, drawn for a rate-limited toy lock (docs/unlock-ladder.md).
//
// Five rules are the entire safety of this, and every one of them lives in the CORE engine
// (src/core/unlock-ladder.ts) rather than here — this file draws questions the engine minted and
// posts answers back for the engine to grade:
//
//   1. Clearing a rung ends the WAIT, never the CREDENTIAL. The user lands back on the same
//      password prompt still needing the same password.
//   2. No attempt refund: the failure count that produced the wait survives, so the next wrong
//      attempt waits longer than this one would have.
//   3. A shared rolling budget (3 clears/hour across every lock on this machine) is the real
//      defence — every rung here is machine-solvable by design, which is exactly why the cap and
//      not the difficulty is what makes the route safe.
//   4. Escalation is untouched.
//   5. Every answer is graded core-side against a single-use nonce, consumed BEFORE grading.
//
// Two more that cost the whole rung when missed and are likewise enforced in core: a timed round
// cannot be won faster than it lasts, and each mole grades once. The on-screen whack score is
// encouragement only — the real score is recomputed from the posted hits.
//
// Under School mode the dim-sum rung never arrives (the engine starts a climb at maths), so there
// is deliberately nothing here that names it or explains its absence.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LadderAnswer, LadderChallenge, WhackHit } from '@shared/unlock-ladder-types'

export function UnlockLadderPanel({
  lockId,
  onCleared,
  onDone
}: {
  lockId: string
  onCleared: () => void
  onDone: () => void
}): React.JSX.Element {
  const [challenge, setChallenge] = useState<LadderChallenge | null>(null)
  const [budgetLeft, setBudgetLeft] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void window.nodeTerminal.toylock.ladderIssue(lockId).then((state) => {
      if (!alive) return
      setChallenge(state.challenge)
      setBudgetLeft(state.budgetLeft)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [lockId])

  const answer = useCallback(
    async (a: LadderAnswer): Promise<void> => {
      if (busy) return
      setBusy(true)
      try {
        const verdict = await window.nodeTerminal.toylock.ladderVerify({ lockId, answer: a })
        setMessage(verdict.message)
        setBudgetLeft(verdict.budgetLeft)
        setChallenge(verdict.challenge)
        if (verdict.cleared) onCleared()
      } finally {
        setBusy(false)
      }
    },
    [busy, lockId, onCleared]
  )

  if (!loaded) return <div className="toylock-ladder__note">Loading…</div>

  if (!challenge) {
    return (
      <div className="toylock-ladder">
        <div className="toylock-ladder__note">
          {message ?? 'No game is on offer right now — the clock is the way through.'}
        </div>
        <button className="toylock-btn" onClick={onDone}>
          Back to the password
        </button>
      </div>
    )
  }

  return (
    <div className="toylock-ladder">
      {message && <div className="toylock-ladder__note">{message}</div>}
      {challenge.kind === 'dimsum' && (
        <DimSumRung
          challenge={challenge}
          busy={busy}
          onPick={(choice) => void answer({ kind: 'dimsum', nonce: challenge.nonce, choice })}
        />
      )}
      {challenge.kind === 'math' && (
        <MathRung
          challenge={challenge}
          busy={busy}
          onSubmit={(answers) => void answer({ kind: 'math', nonce: challenge.nonce, answers })}
        />
      )}
      {challenge.kind === 'whack' && (
        <WhackRung
          challenge={challenge}
          onDone={(hits) => void answer({ kind: 'whack', nonce: challenge.nonce, hits })}
        />
      )}
      <div className="toylock-ladder__foot">
        Winning ends the wait — nothing more. You still need the password. {budgetLeft} skip
        {budgetLeft === 1 ? '' : 's'} left this hour.
      </div>
      <button className="toylock-btn--link" onClick={onDone}>
        No thanks, I will wait
      </button>
    </div>
  )
}

function DimSumRung({
  challenge,
  busy,
  onPick
}: {
  challenge: Extract<LadderChallenge, { kind: 'dimsum' }>
  busy: boolean
  onPick: (choice: string) => void
}): React.JSX.Element {
  return (
    <div className="toylock-ladder__rung">
      <div className="toylock-ladder__prompt">
        Which dish is <strong>{challenge.prompt}</strong>?
      </div>
      <div className="toylock-ladder__choices">
        {challenge.choices.map((c) => (
          <button key={c} className="toylock-btn" disabled={busy} onClick={() => onPick(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="toylock-ladder__hint">
        {challenge.triesLeft} {challenge.triesLeft === 1 ? 'try' : 'tries'} left on this one.
      </div>
    </div>
  )
}

function MathRung({
  challenge,
  busy,
  onSubmit
}: {
  challenge: Extract<LadderChallenge, { kind: 'math' }>
  busy: boolean
  onSubmit: (answers: number[]) => void
}): React.JSX.Element {
  const [values, setValues] = useState<string[]>(() => challenge.questions.map(() => ''))
  // A fresh maths challenge is a fresh set of boxes — keyed off the nonce rather than carrying the
  // previous round's typing into questions it does not answer.
  useEffect(() => setValues(challenge.questions.map(() => '')), [challenge.nonce, challenge.questions])
  const complete = values.every((v) => v.trim() !== '')

  return (
    <div className="toylock-ladder__rung">
      <div className="toylock-ladder__prompt">Ten easy sums. Every one has to be right.</div>
      <div className="toylock-ladder__sums">
        {challenge.questions.map((q, i) => (
          <label key={`${challenge.nonce}:${i}`} className="toylock-ladder__sum">
            <span>{q} =</span>
            <input
              className="toylock-input toylock-input--code"
              inputMode="numeric"
              value={values[i] ?? ''}
              aria-label={`${q} equals`}
              onChange={(e) =>
                setValues((prev) =>
                  prev.map((v, j) => (j === i ? e.target.value.replace(/[^-0-9]/g, '') : v))
                )
              }
            />
          </label>
        ))}
      </div>
      <button
        className="toylock-btn toylock-btn--primary"
        disabled={busy || !complete}
        onClick={() => onSubmit(values.map((v) => Number(v)))}
      >
        Check my sums
      </button>
    </div>
  )
}

function WhackRung({
  challenge,
  onDone
}: {
  challenge: Extract<LadderChallenge, { kind: 'whack' }>
  onDone: (hits: WhackHit[]) => void
}): React.JSX.Element {
  const [started, setStarted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [score, setScore] = useState(0)
  const hitsRef = useRef<WhackHit[]>([])
  const startedAtRef = useRef(0)
  const doneRef = useRef(false)
  const visibleRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!started) return
    startedAtRef.current = performance.now()
    const tick = setInterval(() => {
      const at = performance.now() - startedAtRef.current
      setElapsed(at)
      if (at >= challenge.durationMs && !doneRef.current) {
        doneRef.current = true
        clearInterval(tick)
        // Posted only once the round has genuinely run its length. Core refuses an early
        // submission anyway (rule 6) — this just means the user never meets that refusal.
        onDone(hitsRef.current)
      }
    }, 50)
    return () => clearInterval(tick)
  }, [started, challenge.durationMs, onDone])

  const visible = new Set(
    challenge.moles.filter((m) => elapsed >= m.showAtMs && elapsed < m.hideAtMs).map((m) => m.cell)
  )
  visibleRef.current = visible

  const tap = (cell: number): void => {
    if (!started || doneRef.current) return
    hitsRef.current.push({ cell, atMs: performance.now() - startedAtRef.current })
    if (visibleRef.current.has(cell)) setScore((s) => s + 1)
  }

  if (!started) {
    return (
      <div className="toylock-ladder__rung">
        <div className="toylock-ladder__prompt">
          Whack-a-mole. Hit {challenge.requiredHits} of them in{' '}
          {Math.round(challenge.durationMs / 1000)} seconds.
        </div>
        <button className="toylock-btn toylock-btn--primary" onClick={() => setStarted(true)}>
          Start
        </button>
      </div>
    )
  }

  const left = Math.max(0, Math.ceil((challenge.durationMs - elapsed) / 1000))
  return (
    <div className="toylock-ladder__rung">
      <div className="toylock-ladder__prompt">
        {left}s left · {score}/{challenge.requiredHits}
      </div>
      <div
        className="toylock-ladder__grid"
        style={{ gridTemplateColumns: `repeat(${challenge.gridSize}, 1fr)` }}
      >
        {Array.from({ length: challenge.gridSize * challenge.gridSize }, (_, cell) => (
          <button
            key={cell}
            className={`toylock-ladder__hole${visible.has(cell) ? ' toylock-ladder__hole--up' : ''}`}
            aria-label={visible.has(cell) ? `Mole up in cell ${cell + 1}` : `Empty cell ${cell + 1}`}
            onClick={() => tap(cell)}
          >
            {visible.has(cell) ? '🐹' : ''}
          </button>
        ))}
      </div>
    </div>
  )
}
