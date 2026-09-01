// Pure aggregation and ordering for the collapsed Agent HUD indicator (docs/agent-hud.md).
//
// `buildIndicator` is the ONE definition of what the collapsed capsule shows, derived from the same
// row array the expanded panel draws. It lives here rather than beside the main-process HUD model
// because the renderer is the only side that draws it, and a renderer must never import src/main
// (process-model boundary) — a copy over there could only ever be dead code that drifts, which is
// exactly what happened: it never grew the `needsYou` dot this renderer has been drawing.
//
// The ordering keeps the stable agent priority used by the status surfaces. The indicator is a
// normal left-to-right flex row, so the last element is the rightmost one.
//
// Kept pure + Electron-free so both are unit-tested without a DOM.

/** The minimal row shape the aggregation reads — a structural subset of the HUD row contract, so
 *  this module needs no type from main/preload (main.ts mirrors that contract locally on purpose). */
export interface IndicatorRow {
  state: 'working' | 'needsYou' | 'done' | 'idle'
  agentId?: string
}

/** What the collapsed capsule draws: a walking mascot per working agent kind, plus the two dots. */
export interface HudIndicator {
  /** Distinct agentIds that have at least one working node (drives a walking mascot slot each),
   *  in first-seen order — pass through `orderIndicatorAgents` for the paint order. */
  workingAgents: string[]
  /** True if any row is a finished-but-unseen (`done`) session → the green blob. */
  doneUnseen: boolean
  /** True if any row is waiting/blocked (`needsYou`) → the red dot. Without it the capsule reads as
   *  EMPTY (and hides) for a session that is waiting on the user while nothing else is working. */
  needsYou: boolean
}

/** Fold the HUD rows into the collapsed indicator's content. */
export function buildIndicator(rows: readonly IndicatorRow[]): HudIndicator {
  const workingAgents: string[] = []
  let doneUnseen = false
  let needsYou = false
  for (const r of rows) {
    if (r.state === 'working') {
      const id = r.agentId || 'unknown'
      if (!workingAgents.includes(id)) workingAgents.push(id)
    } else if (r.state === 'done') {
      doneUnseen = true
    } else if (r.state === 'needsYou') {
      needsYou = true
    }
  }
  return { workingAgents, doneUnseen, needsYou }
}

/** Higher rank means drawn further right. Claude remains the stable anchor. */
const SLOT_RANK: Record<string, number> = {
  claude: 3,
  codex: 2,
  gemini: 1
}

/**
 * Order the distinct working agent ids left to right so the stable slot (rightmost, last child)
 * is Claude, then Codex to its left, with any other or custom agents further left. Ties (unknown
 * agents, rank 0) keep their incoming order (a stable sort), so the collapsed strip stays stable
 * frame-to-frame instead of reshuffling as rows re-sort by activity.
 */
export function orderIndicatorAgents(workingAgents: readonly string[]): string[] {
  return workingAgents
    .map((id, i) => ({ id, i, rank: SLOT_RANK[id] ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.id)
}
