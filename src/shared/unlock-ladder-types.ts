// Wire shapes for the unlock ladder (docs/unlock-ladder.md).
//
// These live in `shared/` rather than beside the engine in `src/core/unlock-ladder.ts` because
// the ladder now has TWO consumers with a process boundary between them: the Server Edition's
// server-rendered lockout page (same process as the engine) and the desktop/browser renderer's
// toy-lock unlock prompt (which reaches the engine over IPC/WS and must never import `src/core`).
// The engine re-exports every one of these, so no existing import site changed.

/** Rungs, in the order they are climbed. */
export type LadderRung = 'dimsum' | 'math' | 'whack'

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
  /** Index into a `gridSize x gridSize` grid. */
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
