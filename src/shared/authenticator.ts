// The built-in authenticator: a local, offline place to keep arbitrary TOTP secrets (GitHub,
// a work SSO, a friend's Wi-Fi captive portal, whatever) and read live codes for them, plus the
// secrets nodeterm's own toy locks mint for themselves. Nothing here ever leaves this machine —
// see docs/authenticator.md.

import type { OtpAlgorithm } from './otp'

export type { OtpAlgorithm }

/** Non-secret metadata for one registered entry. The TOTP secret itself never appears here —
 *  see core/toylocks/authenticator-service.ts for where it actually lives (sealed at rest). */
export interface AuthenticatorEntry {
  id: string
  issuer: string
  account: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
  createdAt: number
  updatedAt: number
  /** Opaque core-computed generation of metadata + sealed seed bytes. Destructive compare/remove
   *  sends this value back so another window cannot replace a seed behind an unchanged id. */
  revision?: string
  /** True for a secret that a toy-lock TOTP enrollment ALSO saved here on request — purely
   *  informational, so the list can say "this one also unlocks <target>" instead of the user
   *  discovering the overlap by surprise. */
  linkedToyLockId?: string
}

export type AuthenticatorRemoveResult =
  | { ok: true; removed: AuthenticatorEntry }
  | { ok: false; error: 'not-found' | 'changed' }

export interface AuthenticatorAddManualInput {
  issuer: string
  account: string
  secretBase32: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

export type AuthenticatorAddResult =
  | { ok: true; entry: AuthenticatorEntry }
  | { ok: false; error: string }

/** The current AND next code for one entry, plus enough timing info to draw a countdown without
 *  polling every second — `periodStart`/`period` let the renderer compute `secondsRemaining`
 *  locally and only re-request when it actually crosses a boundary (or on-demand from ⟳). */
export interface AuthenticatorCode {
  code: string
  next: string
  /** Epoch seconds the CURRENT code's period started. */
  periodStart: number
  period: number
  digits: number
  /** Set when the system clock looks skewed enough that a code computed here would likely be
   *  refused by whatever the entry is a second factor FOR (an admittedly fuzzy heuristic — real
   *  skew can only be known by comparing against the other side). Surfaced so the UI can say so
   *  instead of quietly showing a wrong-looking code with total confidence. */
  clockWarning?: string
}

export interface AuthenticatorRenameInput {
  id: string
  issuer?: string
  account?: string
}

export type AuthenticatorRevealResult =
  | { ok: true; secretBase32: string; otpauthUri: string }
  | { ok: false; error: string }

/** `ids` empty = every entry. `confirmed` is the wire-level speed bump behind the renderer's real
 *  two-key super-confirmation UI — see docs/authenticator.md. */
export interface AuthenticatorExportInput {
  ids: string[]
  confirmed: boolean
}

export interface AuthenticatorExportEntry {
  issuer: string
  account: string
  otpauthUri: string
}

export type AuthenticatorExportResult =
  | { ok: true; entries: AuthenticatorExportEntry[] }
  | { ok: false; error: string }
