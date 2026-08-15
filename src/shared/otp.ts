// The one place `OtpAlgorithm` is defined — shared by src/shared/toylock.ts,
// src/shared/authenticator.ts, and the real RFC 6238/4226 implementation in
// src/core/toylocks/totp.ts (which re-exports it for convenience so its own callers can keep
// writing `import type { OtpAlgorithm } from './totp'`). Kept in src/shared rather than src/core
// because shared types must not depend on core — only the other way around.
export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** Every OtpAlgorithm this module (and RFC 6238) understands, in the order the enrollment UI
 *  should offer them — SHA-1 first because it's the universal default every authenticator app
 *  supports; the wider hashes are offered for completeness but most third-party apps ignore the
 *  `algorithm` param and always compute SHA-1 regardless of what the URI says. Lives in
 *  src/shared (not src/core/toylocks/totp.ts, which re-exports it) so the renderer — which must
 *  never import core/* directly, only via window.nodeTerminal — can still build a picker from it. */
export const OTP_ALGORITHMS: OtpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512']
