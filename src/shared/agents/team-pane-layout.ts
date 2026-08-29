/**
 * LEAD PANE WIDTH — correcting Claude Code's own agent-team tmux layout (`settings.
 * agentTeamLeadPaneWidthEnabled`, opt-in, default OFF).
 *
 * ── THE PROBLEM (reported in issue #119) ─────────────────────────────────────────────────────────
 *
 * When a Claude Code session spawns agent-team members, its own tmux teammate backend hardcodes
 * `split-window -h -l 70%` for the first teammate — giving the NEW pane 70% and leaving the
 * ORIGINAL pane (the one the user actually types into — the "lead" pane) at 30% — and then, for
 * every later teammate, `select-layout main-vertical` followed by `resize-pane -t <leadPane> -x
 * 30%`. With four to seven teammates the pane the user types into is the NARROWEST thing on
 * screen. There is no Claude Code setting for this; it is not configurable from inside the CLI.
 *
 * This codebase never calls `split-window`, `select-layout` or `resize-pane` anywhere (verified
 * against the whole source tree), so any additional pane found in a node's tmux WINDOW came from
 * Claude's own team backend — or, rarely, the user's own manual `tmux split-window` inside their
 * pane, which this opt-in setting will also (correctly, if surprisingly) widen back out.
 *
 * ── THE FIX, AND WHY IT MUST RE-FIRE ─────────────────────────────────────────────────────────────
 *
 * The session itself is ours, so nothing stops US correcting the geometry AFTER Claude sets it —
 * but Claude re-applies its own 30% split on EVERY later teammate spawn (see above), so a single
 * one-shot correction is undone the moment the next teammate appears. `decideLeadPaneCorrection`
 * below is therefore deliberately a PURE function of its current inputs, not a "have I already
 * corrected this session" flag: the same `(paneCount, cfg)` pair always answers the same way, so a
 * caller that re-asks it every time a new pane is observed (each poll tick, each new teammate) gets
 * the same "widen it back out" answer every time Claude has just narrowed it. Re-deciding is the
 * whole mechanism — there is no separate "already fixed" state to track or to go stale.
 *
 * ── WHAT THIS MODULE DOES NOT DO ─────────────────────────────────────────────────────────────────
 *
 * It only DECIDES and builds the tmux argv; it never runs anything. The actual trigger — polling or
 * observing a node's tmux WINDOW pane count and, when it changes, calling `runAsync(tmuxBin,
 * resizeLeadPaneArgs(...))` the same way every other tmux call in `PtyManager` already does — is
 * core/main-process wiring outside this module (and outside this task's file scope) and is
 * deliberately left to that layer to add, the same way `renderer/terminal/hibernation-policy.ts`'s
 * header states its own plan "is the pure decision half… the wiring that acts on this plan lives
 * elsewhere".
 *
 * TMUX ONLY, and the caller owns that guard: a node backed by the Windows session-host fallback
 * (`live?.sessionHost` in `PtyManager`) has no split-window/resize-pane primitive at all, so there
 * is nothing to observe and nothing to correct there — this module has no way to see which backend
 * a session runs on and must never be asked to guess it. Wire this in only behind the same
 * `!live?.sessionHost && this.tmuxPath` guard every other tmux-only `PtyManager` branch already
 * uses (e.g. `paneCommand`, `sendText`).
 */

/**
 * Pane index of the "lead" pane inside a node's tmux WINDOW: the one pane every `nt-<id>` session
 * is created with. Nothing in this codebase ever splits a node's window, so pane index 0 is, by
 * construction, always the original pane the user is looking at — whatever teammate panes are
 * later split off alongside it keep higher indices.
 */
export const LEAD_PANE_INDEX = 0

export interface LeadPaneWidthConfig {
  /** `settings.agentTeamLeadPaneWidthEnabled`. */
  enabled: boolean
  /** `settings.agentTeamLeadPaneWidthPercent`. */
  percent: number
}

export interface LeadPaneCorrectionDecision {
  /** Whether the lead pane should be resized right now. */
  act: boolean
  /** The `resize-pane -x` value, e.g. `"60%"`. Present only when `act` is true — never a stale
   *  value left over from a previous decision, since every call starts from `undefined`. */
  widthArg?: string
}

/**
 * Decide whether the lead pane needs correcting, and with what tmux argument, given how many
 * panes the node's tmux WINDOW currently reports (`tmux list-panes -t <session>` count — the same
 * shape of read `session-memory.ts`'s sweep already performs, just scoped to one session instead
 * of every socket).
 *
 * Call this every time pane count is observed, not once — see the module doc for why a single
 * correction is not enough. The function is intentionally cheap to call repeatedly: it does no
 * I/O, and calling it again with the same inputs after Claude has re-applied its own layout is
 * exactly the intended usage, not wasted work.
 */
export function decideLeadPaneCorrection(
  paneCount: number,
  cfg: LeadPaneWidthConfig
): LeadPaneCorrectionDecision {
  if (!cfg.enabled) return { act: false }
  // A single pane IS the plain, un-split terminal — nothing has touched it, so there is nothing to
  // correct. Never resize a session tmux has not split, whatever the setting says.
  if (!Number.isInteger(paneCount) || paneCount <= 1) return { act: false }
  const pct = cfg.percent
  // Unreadable, non-positive or >=100 all read as "off": settings.json is hand-editable and merged
  // without clamping (the settings UI's own clamp only guards keystrokes as they're typed), and a
  // bad value here would either do nothing (0% or less) or leave no room for even one teammate
  // pane (100% or more) — never a value worth sending to tmux.
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return { act: false }
  return { act: true, widthArg: `${Math.round(pct)}%` }
}

/**
 * The tmux argv for the correction, in the SAME pure-builder shape as every sibling tmux-argv
 * function already in this codebase — `core/tmux-naming.ts`'s `localTmuxSendKeysArgs` /
 * `localTmuxEnterArgs` and `core/remote-ssh/control-master.ts`'s `localTmuxKillArgs`: a plain
 * `string[]` a caller hands straight to `runAsync(tmuxBin, args)` (`promisify(execFile)` — no
 * shell involved, so nothing here needs shell-escaping). This is the SAME helper every other tmux
 * call in `PtyManager` already uses; nothing here invents a new way to talk to tmux.
 *
 * `sessionTarget` is the session's own tmux target — `sessionName(persistKey)` from
 * `core/tmux-naming.ts` on the local leg, or the equivalent remote session id over an SSH
 * ControlMaster. This module does not construct it (it has no access to `core`), so it stays
 * usable from whichever leg the caller is on, the same way every sibling builder above does.
 *
 * `widthArg` is meant to be the value `decideLeadPaneCorrection` already validated — this builder
 * does not re-validate it, exactly as `localTmuxSendKeysArgs` does not re-validate its body; the
 * validation lives in the one function whose job is deciding, not in every place the argv is
 * assembled from its answer.
 */
export function resizeLeadPaneArgs(socket: string, sessionTarget: string, widthArg: string): string[] {
  return ['-L', socket, 'resize-pane', '-t', `${sessionTarget}.${LEAD_PANE_INDEX}`, '-x', widthArg]
}
