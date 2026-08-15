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
 *  Appearance → Accent) — see docs/toy-locks.md for how to wire up another target kind. */
export type ToyLockTargetKind = 'tab' | 'node' | 'appearance'

/** A lockable thing. `id` is whatever identifier the target kind uses natively (a project id, a
 *  node id, a stable setting key like `'accent'`); `label` is a human-readable name captured at
 *  lock-creation time so the lock list and search results stay meaningful even if the underlying
 *  target is later renamed. */
export interface ToyLockTarget {
  kind: ToyLockTargetKind
  id: string
  label: string
}

export type ToyLockCredentialKind = 'password' | 'totp'

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
}

export interface ToyLockBeginTotpInput {
  target: ToyLockTarget
  duration: ToyLockDurationMode
  durationMinutes?: number
  lockedOnLaunch: boolean
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
