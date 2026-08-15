// Kids mode — the safety policy, and the exact limits of what it can honestly promise.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// nodeterm's core function is arbitrary shell access plus AI agents that run commands. That
// cannot be made safe for a child by hiding user interface, because the terminal IS the danger
// surface and it is also the product. So this module draws a deliberately narrow line:
//
//   Kids mode CAN honestly:  refuse the permission modes that let an agent act without asking,
//                            force the destructive-action confirmation on, and keep the copy and
//                            targets friendly.
//   Kids mode CANNOT:        sandbox the shell, restrict what a typed command may do, or stop a
//                            determined child from running anything a normal user could.
//
// KIDS_DISCLOSURE below says exactly that, in plain words, and every surface that offers this
// mode must show it. The precedent is the toy locks, which already tell the user outright that
// they are "a speed bump, not real security" — a feature that overstates its protection is worse
// than no feature, because somebody relies on it.
//
// HOW IT DIFFERS FROM SCHOOL MODE, which is easy to conflate: School mode strips playfulness out
// (forces English, hides dim sum, Cantonese, funny levels) so a screen looks serious in a
// classroom. Kids mode does the opposite — it KEEPS all of that — and adds safety restrictions
// instead. They are near-opposites that happen to share a shared-record-plus-PIN shape, so they
// are separate records and separate credentials. One is not a profile of the other.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import {
  ALL_PERMISSION_MODES,
  isPermissionMode,
  type AgentPermissionMode
} from '../shared/agents/config'

/**
 * The one sentence every kids-mode surface must show, unstyled by the funny level.
 *
 * It is deliberately blunt about the limit. A parent who reads "safe for children" and walks away
 * has been misled by us; a parent who reads this knows what they are getting.
 */
export const KIDS_DISCLOSURE =
  'Kids mode keeps things friendly and asks before anything is deleted. It does NOT sandbox the ' +
  'terminal — a typed command can still do anything your account can do, so stay nearby.'

/**
 * Permission modes an agent may START in while kids mode is on.
 *
 * `bypassPermissions` is refused outright: it is the one mode whose entire purpose is to let an
 * agent act without asking, which is precisely the thing a child cannot be expected to supervise.
 * `acceptEdits` is refused for the same reason at smaller scale — it auto-approves file writes.
 *
 * `plan` is allowed and is the safest of the set (it proposes without acting). `manual` is
 * allowed because asking every time is exactly right here. `auto` is allowed but is the loosest
 * one on the list — see the note on `gateKidsPermissionMode`.
 */
export const KIDS_ALLOWED_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  'manual',
  'plan',
  'auto'
]

/** Modes kids mode refuses, with the reason each is refused — surfaced to the user, not hidden. */
export const KIDS_REFUSED_PERMISSION_MODES: Readonly<Record<string, string>> = {
  bypassPermissions:
    'lets an agent act without asking at all — the one thing a child cannot supervise',
  acceptEdits: 'auto-approves file changes, so edits happen with nobody looking'
}

/**
 * The mode a session actually starts in while kids mode is on.
 *
 * Refused modes degrade to `manual` — ask every time — rather than to the next-loosest option.
 * Degrading "bypass everything" to "auto" would still be a large widening of what happens
 * unattended, and the safe direction when a value is rejected is always the most conservative
 * one, not the nearest one.
 *
 * An UNRECOGNISED value also degrades to `manual`. The mode arrives from hand-editable,
 * git-shared JSON and ends up interpolated into a command line, so this re-validates at the
 * decision point rather than trusting the TypeScript type, exactly as `approvalFlags` does.
 */
export function gateKidsPermissionMode(
  mode: string,
  kidsModeOn: boolean
): { mode: AgentPermissionMode; changed: boolean; why?: string } {
  const valid = isPermissionMode(mode) ? (mode as AgentPermissionMode) : null

  if (!kidsModeOn) {
    // Off: this module changes nothing at all. An unrecognised value is still not ours to
    // rewrite here — the existing approval-mode layer already refuses it by emitting no flag.
    return { mode: (valid ?? 'manual') as AgentPermissionMode, changed: false }
  }

  if (valid && KIDS_ALLOWED_PERMISSION_MODES.includes(valid)) {
    return { mode: valid, changed: false }
  }

  const why = valid
    ? KIDS_REFUSED_PERMISSION_MODES[valid] ?? 'is not allowed while kids mode is on'
    : 'is not a permission mode this app recognises'
  return { mode: 'manual', changed: true, why }
}

/** Actions kids mode always routes through the two-key destructive confirmation. */
export type GuardedAction =
  | 'delete-project'
  | 'delete-node'
  | 'discard-changes'
  | 'remove-worktree'
  | 'revoke-device'
  | 'clear-history'

/**
 * Whether the destructive-action super-confirmation is mandatory for this action right now.
 *
 * While kids mode is on the answer is always yes — the gate cannot be turned off, and a surface
 * may not skip it because the action "seems small". Returning a reason rather than a bare boolean
 * so the gate can say WHY it appeared, which is the difference between a child learning something
 * and a child clicking through.
 */
export function requiresDestructiveGate(
  action: GuardedAction,
  kidsModeOn: boolean
): { required: boolean; reason?: string } {
  if (!kidsModeOn) return { required: false }
  return {
    required: true,
    reason: 'Kids mode asks before anything is deleted or thrown away.'
  }
}

/**
 * Sanity check used by the tests and by the settings surface: every mode the app knows about is
 * either explicitly allowed or explicitly refused WITH A REASON.
 *
 * This exists because the failure it prevents is silent. A new permission mode added to
 * `AgentPermissionMode` later would otherwise fall through `gateKidsPermissionMode` into the
 * refused branch with the generic message, and nobody would notice that kids mode had quietly
 * formed an opinion about a mode nobody had considered.
 */
export function unclassifiedPermissionModes(): AgentPermissionMode[] {
  return ALL_PERMISSION_MODES.filter(
    (m) => !KIDS_ALLOWED_PERMISSION_MODES.includes(m) && !(m in KIDS_REFUSED_PERMISSION_MODES)
  )
}
