// Toy locks — a for-fun, opt-in "please don't peek" gate a user can put on a tab, a canvas node,
// or an appearance setting. THIS IS NOT SECURITY. It never claims to protect, secure, or encrypt
// anything, and it never stands between anyone with access to this machine and its data — a
// locked-out user recovers by deleting the app's own local application-data folder (see
// docs/toy-locks.md). It exists purely as a self-imposed speed bump, the same spirit as "School
// mode" elsewhere in the app.
//
// Every lock carries its OWN credential (password or TOTP) — there is no master credential and no
// implicit inheritance between locks. Credential material itself never lives in this file or in
// any persisted `ToyLockRecord`: only non-secret metadata is shared with the renderer. See
// src/core/toylocks/toylock-service.ts for where the secret half lives (sealed at rest, per the
// same node-auth-secret.ts convention the rest of the app already uses).

import type { OtpAlgorithm } from './otp'

/** What kind of on-screen thing a lock is attached to. The engine is generic; today's shipped
 *  integrations are a project tab, a canvas node, and one appearance control (Settings →
 *  Appearance → Accent) — see docs/toy-locks.md for how to wire up another target kind.
 *
 *  `'group'` is a canvas GROUP FRAME. It gates the frame's own structural actions — ungroup,
 *  remove, rename, recolour — and says so on the label pill. It deliberately does NOT hide the
 *  nodes inside the frame: those are separate objects with their own locks, and pretending
 *  otherwise would be the one thing a toy lock must never do, which is claim to protect something
 *  it does not. */
export type ToyLockTargetKind = 'tab' | 'node' | 'group' | 'appearance'

/** A lockable thing. `id` is whatever identifier the target kind uses natively (a project id, a
 *  node id, a stable setting key like `'accent'`); `label` is a human-readable name captured at
 *  lock-creation time so the lock list and search results stay meaningful even if the underlying
 *  target is later renamed. */
export interface ToyLockTarget {
  kind: ToyLockTargetKind
  id: string
  label: string
}

/**
 * `'password-totp'` requires BOTH factors — see toylock-service.ts's `verify()` for why that
 * handler is an exhaustive switch on this union rather than an `if/else`: an `else` silently
 * treats any future kind as TOTP, which is exactly the trap a combo kind would have fallen into
 * (it needs its OWN branch that checks both factors, not "whichever of the two existing branches
 * happens to run").
 *
 * `'windows-pin'` is Windows-only (see the wizard's platform gate) and is, honestly, just a
 * numeric password: Electron has no Windows Hello prompt to call into (see docs/toy-locks.md), so
 * this kind is deliberately NOT presented as Windows Hello anywhere in its copy — "PIN", never
 * "Hello". THIS IS STILL NOT SECURITY, same as every other kind here.
 */
export type ToyLockCredentialKind = 'password' | 'totp' | 'password-totp' | 'windows-pin'

/** How long an unlock stays in effect before the surface re-locks itself. `'session'` re-locks the
 *  moment the surface is left (e.g. switching away from the tab); `'minutes'` runs a timer;
 *  `'until-close'` stays unlocked for the rest of THIS run of the app — every mode resets to
 *  locked on the next launch when `lockedOnLaunch` is true (the default). */
export type ToyLockDurationMode = 'session' | 'minutes' | 'until-close'

/** Non-secret metadata for one lock — what the renderer is allowed to see. The credential itself
 *  (a password hash or a TOTP secret) never appears here. */
export interface ToyLockRecord {
  id: string
  target: ToyLockTarget
  credentialKind: ToyLockCredentialKind
  createdAt: number
  duration: ToyLockDurationMode
  /** Only meaningful when `duration === 'minutes'`. */
  durationMinutes?: number
  /** Locked again the moment the app relaunches (the shipped default — the whole point of a lock
   *  is that it survives a restart even though nothing else about it is "secure"). */
  lockedOnLaunch: boolean
}

export interface ToyLockCreatePasswordInput {
  target: ToyLockTarget
  password: string
  duration: ToyLockDurationMode
  durationMinutes?: number
  lockedOnLaunch: boolean
  /** Defaults to `'password'` — omitted, every existing caller (the wizard's plain-password step)
   *  is byte-identical to before. `'windows-pin'` reuses this SAME channel and the SAME scrypt
   *  hashing (a PIN is just a short password); it differs only in copy/validation and a
   *  Windows-only platform gate the core enforces regardless of what the renderer already hid. */
  credentialKind?: 'password' | 'windows-pin'
}

export interface ToyLockBeginTotpInput {
  target: ToyLockTarget
  duration: ToyLockDurationMode
  durationMinutes?: number
  lockedOnLaunch: boolean
  /** Present only when creating the two-factor combo (`password-totp`): the password half. It is
   *  hashed and stashed alongside the pending TOTP secret; NEITHER factor is persisted until
   *  `confirmTotp` proves the TOTP half too, so a combo lock can never exist half-armed. Absent ⇒
   *  a plain `'totp'` lock, exactly as before. */
  password?: string
}

/** What `toylock.beginTotp` hands back so the wizard can draw the QR and show the manual secret.
 *  Nothing here is persisted yet — the lock does not exist until `confirmTotp` proves the user
 *  actually paired an authenticator against this exact secret. */
export interface ToyLockTotpEnrollment {
  /** The id the finished lock will have once confirmed — also the pending-enrollment handle for
   *  `confirmTotp` / `cancelTotp`. */
  lockId: string
  otpauthUri: string
  secretBase32: string
  issuer: string
  account: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

export interface ToyLockConfirmTotpInput {
  lockId: string
  /** The current 6–8 digit code the user just read off their authenticator (or nodeterm's own
   *  built-in one) for the secret handed back by `beginTotp`. */
  code: string
}

export interface ToyLockUpdateInput {
  id: string
  duration?: ToyLockDurationMode
  durationMinutes?: number
  lockedOnLaunch?: boolean
  /** Retarget a lock's label without touching its credential (e.g. a renamed tab/node). */
  targetLabel?: string
}

export interface ToyLockVerifyInput {
  id: string
  password?: string
  code?: string
}

export type ToyLockCreateResult =
  | { ok: true; record: ToyLockRecord }
  | { ok: false; error: string }

export type ToyLockBeginTotpResult =
  | { ok: true; enrollment: ToyLockTotpEnrollment }
  | { ok: false; error: string }

export type ToyLockConfirmTotpResult =
  | { ok: true; record: ToyLockRecord }
  | { ok: false; error: string }

export interface ToyLockVerifyResult {
  ok: boolean
  /** Set when a wrong attempt is currently rate-limited: try again no sooner than this many ms
   *  from now. The service does not even look at the credential while this is in effect — that IS
   *  the rate limit, not a courtesy on top of one. */
  retryAfterMs?: number
  /** A short, honest, non-alarming reason to show beside a failed attempt. Never characterises the
   *  stored credential itself (length, composition, etc.). */
  reason?: string
}

export const TOY_LOCK_DURATION_LABELS: Record<ToyLockDurationMode, string> = {
  session: 'Just this surface — locks again the moment you leave it',
  minutes: 'For a number of minutes',
  'until-close': 'Until nodeterm quits'
}

// ---------------------------------------------------------------------------------------------
// Node-lock enforcement — pure decisions, exercised by TerminalNode.tsx (the only wired-up
// consumer of a `kind: 'node'` lock's actual on/off state; see docs/toy-locks.md).
// ---------------------------------------------------------------------------------------------

/**
 * Given the toy-lock store's own view of ONE node target, should that node's terminal be torn
 * down and covered right now?
 *
 * This is asked continuously by a mounted node (a re-render, a tick, a store update), not only at
 * click time the way `TabBar`/`AppearanceSection` ask it — a terminal must react to a lock
 * engaging, or an unlock expiring, with nobody required to click anything first.
 *
 * `storeLoaded` fails CLOSED. "Have we ever heard back from the credential store" is a different
 * fact from "there is no lock on this node", and the house rule is explicit: a failed (or, here,
 * still-pending) read is never evidence of absence. Rendering this node as unlocked before the
 * store has answered even once would treat "unknown" as "no" — exactly backwards for a gate whose
 * whole job is refusing by default. The window this actually costs is tiny (one local IPC round
 * trip, typically resolved before the first paint) and applies to every node, locked or not, for
 * that one window — the alternative (assume unlocked) is the one that can silently leak a locked
 * node's content instead.
 */
export function isNodeLockEngaged(i: {
  storeLoaded: boolean
  hasRecord: boolean
  unlockedNow: boolean
}): boolean {
  if (!i.storeLoaded) return true
  if (!i.hasRecord) return false
  return !i.unlockedNow
}

/** How a locked node's terminal must be torn down, given whether ITS CURRENT session survives
 *  losing its client. */
export type NodeLockTeardownMode = 'release-client' | 'detach-view-only'

/**
 * A persistent session (tmux / the Windows session host) can be released exactly the way the
 * offscreen-viewer feature already releases one: detach the client, dispose the xterm view, leave
 * the session running. Unlocking is then a warm reattach — nothing was ever at risk.
 *
 * A NON-persistent session (the plain-shell fallback) cannot take that same step, and the reason
 * is the one this codebase already learned the hard way for the offscreen release itself (issue
 * #126, `live-work.ts`): without tmux underneath, the pty client IS the shell process. "Release
 * the client" there does not mean "give the buffer back, redraw later" — it means SIGHUP the
 * shell, and for an agent CLI running under it, kill the turn. A lock must not inherit the
 * offscreen release's OWN refusal to do that (`wouldKillLiveWork` — deferring while work looks
 * live), because "I won't lock this because you're running something" defeats the feature the
 * user asked for. But it must not silently become the live-work bug wearing a padlock icon,
 * either. So a non-persistent session gets the OTHER half of that lesson instead: detach the VIEW
 * only — dispose the xterm, stop consuming/painting pty data, refuse input — and leave the
 * client attached so the process underneath keeps running, unattended but alive. See the caller
 * in TerminalNode.tsx for exactly which step of the normal teardown this mode skips.
 */
export function nodeLockTeardownMode(sessionPersistent: boolean): NodeLockTeardownMode {
  return sessionPersistent ? 'release-client' : 'detach-view-only'
}
