# Built-in authenticator

Settings → Just for fun → **Authenticator**: a local, offline place to keep arbitrary TOTP
secrets (a GitHub account's 2FA, a work SSO, a friend's Wi-Fi captive portal — whatever) and read
live codes for them, plus the secrets nodeterm's own [toy locks](./toy-locks.md) can optionally
also save here when you create a TOTP toy lock.

## Standards, exactly

- **RFC 4226 HOTP** (`hotp()`) and **RFC 6238 TOTP** (`totp()`), implemented in
  `src/core/toylocks/totp.ts`. Dynamic truncation follows RFC 4226 §5.3 exactly: HMAC over the
  8-byte big-endian counter, the low nibble of the *last* hash byte as the offset, four bytes read
  from there as a big-endian `uint32` with the top bit masked off, `% 10**digits`. This is the same
  construction every mainstream authenticator (Google Authenticator, Authy, `otplib`,
  `speakeasy`, …) uses, and is checkable by hand against RFC 4226 Appendix D's published test
  vectors (secret = ASCII `"12345678901234567890"`, 6 digits: counter 0 → `755224`, counter 1 →
  `287082`, … counter 9 → `520489`).
- **SHA-1, SHA-256, or SHA-512** (`OtpAlgorithm`, `src/shared/otp.ts`), 6–8 digits, an arbitrary
  period — defaulting to the universal SHA-1 / 6 digits / 30 seconds every authenticator app
  assumes. Most third-party apps ignore a non-default `algorithm`/`digits`/`period` in an
  `otpauth://` URI and always compute the default anyway, so those are offered for completeness
  rather than because they're commonly useful.
- **RFC 4648 base32** for the secret itself (`base32Encode` / `base32Decode`), tolerant on decode
  of mixed case, stray whitespace, and missing padding — the way a human actually retypes a
  "manual key."
- Verification (`verifyTotp`) allows **one period of drift either side** (the conventional TOTP
  validation window per RFC 6238 §5.2), and reports which offset actually matched so a caller
  could — though today only a debug log would — flag "your clock looks off."

There are deliberately no automated unit tests in this pass (see the project's own delivery
constraints for that decision); the reasoning above and the inline comments in `totp.ts` are the
substitute — the algorithm's construction is unambiguous enough to check by inspection against the
published RFC vectors.

## The QR code is drawn entirely in-process

Registering a fresh secret (from a toy-lock TOTP enrollment) shows a QR code encoding a standard
`otpauth://totp/` key URI (issuer, account, secret, algorithm, digits, period). That QR is drawn
**entirely locally**, in the renderer process, with **no network call anywhere in the path**:

1. `qrcode` (MIT-licensed, already a nodeterm dependency — see `usePhonePairing.ts` for its other
   use pairing a phone) computes the QR module matrix synchronously, in memory
   (`create(text, {errorCorrectionLevel:'M'})`).
2. `src/renderer/components/toylocks/QrCode.tsx` turns that matrix into inline SVG itself — a
   `<rect>` per dark module, a 4-module quiet zone (the QR spec's minimum recommended margin), a
   real `<title>` element and `aria-label` naming what the code pairs (never a decorative empty
   `alt`), and `shape-rendering: crisp-edges` so it stays legible at the small sizes a lock wizard
   popover actually has room for.

The rendered code is **always black-on-white**, deliberately never themed to the app's light/dark
mode — a themed QR code (a low-contrast accent colour, an inverted dark-mode palette) is a
scannability bug waiting to happen, and the entire point of a code this small is that a phone
camera can read it reliably, including under bad lighting.

The manual base32 key is **always shown alongside the QR**, grouped into 4-character chunks for
easier reading/typing, with the algorithm, digit count, and period stated in plain text next to
it — never hidden behind a "reveal" toggle at registration time (that reveal gate exists for
*already-stored* secrets, see [Secrets stay local](#secrets-stay-local-and-out-of-ordinary-exports)
below).

**Pairing is confirmed before it activates.** Whether it's a toy lock or a plain authenticator
entry, the flow never trusts that scanning worked — the user has to type back one current code,
verified against the real secret, before anything is persisted.

## Registering an existing secret

The authenticator's main job is holding secrets you *already have* from some other service's own
QR code, not generating fresh ones (that's the toy-lock flow above). Two registration routes:

- **Paste a URI** — an `otpauth://totp/...` string, parsed by `parseOtpAuthUri()`
  (`src/core/toylocks/totp.ts`). Only the `totp` type is accepted; `otpauth://hotp/...` and any
  other scheme are refused with a plain error rather than silently mis-parsed.
- **Manual entry** — issuer, account, secret (base32), algorithm, digit count, and period, each a
  real field rather than one opaque text box.

**Not implemented in this pass, and documented rather than silently missing:** reading a QR code
from an image file or the system clipboard, and scanning with a device camera. Both are real,
useful registration routes a full authenticator app would have; building a QR *decoder* (as
opposed to the encoder above) is materially more work than this focused pass had room for. Paste-a-URI
and manual entry cover every case where you can already see the secret or the URI in some form.

## Reading live codes

Each entry's row shows the **current 6–8 digit code**, grouped for readability, with a **copy**
action; a small **countdown** to the next period boundary; and a dimmed **peek at the next code**
(so a code that's about to roll over doesn't catch you out mid-type). The code region uses
`aria-live="polite"` on the digits themselves — which only actually announces when the rendered
text changes, i.e. once per period, not once a second — plus a separate `aria-live="off"` text
equivalent for the countdown, so a screen reader gets the fact without being read a number every
single second.

**The clock is the failure nobody diagnoses.** Codes are computed from this machine's system
clock; if that clock looks obviously wrong (specifically: reporting a time *before* this very
process started, e.g. a stopped or rolled-back RTC), the entry shows a plain warning that codes may
be refused rather than silently emitting confidently-wrong digits with no explanation. This is a
coarse heuristic — there is no oracle for "the correct time" available locally to compare against —
so it catches gross clock failures, not small genuine drift (which the ±1-period tolerance in
`verifyTotp` already absorbs anyway).

Codes are computed **server-side** (in nodeterm's own core process, wherever that runs — see
[Server Edition](#server-edition--the-desktop-relay) below) and only the resulting 6–8 digit code
crosses back to the renderer; the secret itself never needs to live in renderer memory for ongoing
use. It only ever reaches the renderer in two deliberate, narrow places: [reveal](#reveal) and
[export](#secrets-stay-local-and-out-of-ordinary-exports).

## Reveal

Each entry has a **"Reveal secret"** action that fetches and shows the raw base32 key (with its
matching `otpauth://` URI) — for the rare case you need to re-pair the same secret into a *different*
app. It is never shown by default, always behind that explicit click.

## Removing a stored seed

**Remove** deletes this app's sealed TOTP seed and therefore its current and future live codes. It
does not change the account at the service that issued the seed, and removing an authenticator copy
linked to a toy lock does not remove that toy lock's separately stored credential.

Under Kids mode — and while the renderer cannot establish an authoritative live Kids-mode record —
seed removal uses the app-wide two-key destructive gate. The authorization is bound to the entry's
full non-secret identity plus an opaque core revision that changes when either its metadata or sealed
seed changes. The core list is fetched again immediately before deletion, then core serializes a
compare-and-remove against that exact revision. A rename, seed replacement, failed/corrupt store
read, concurrent edit, or disappearance while either dialog is open performs zero deletion. If an
ordinary dialog was already open when Kids mode turns on or becomes unavailable, it closes without
deleting and a fresh two-key gate takes its place.

## Secrets stay local, and out of ordinary exports

Nothing about the authenticator syncs, phones home, or makes a network request of any kind — see
[Credential storage](./toy-locks.md#credential-storage) in the toy-locks doc for exactly how (and
where) the secrets are sealed at rest.

**Ordinary exports never include these secrets, and say so.** The one deliberate action that does
write them out, in the clear, is a separate, explicitly-named **"Export all secrets…"** button
behind a real **two-key super-confirmation gate**
(`src/renderer/components/authenticator/TwoKeyExportGate.tsx`):

1. Two independently-operated checkboxes ("keys") must **both** be checked — acknowledging that
   the output file holds readable secrets, and that you're exporting somewhere private — before
   the confirmation control even becomes operable.
2. Only then does a range slider arm; dragging it to the end is what actually triggers the export.
3. An **Emergency exit** button is present the whole time.

The export itself downloads a plain-text file listing each entry's issuer, account, and full
`otpauth://` URI — genuinely usable secrets, which is exactly why the gate above exists and why the
warning text names that plainly rather than euphemistically.

## Server Edition and the desktop relay

Like toy locks, the authenticator is **core-bound**: entries live wherever nodeterm's core process
runs (Electron's main process on Desktop; the server process for the Server Edition), reached over
the same request/response channel every other core service uses. A relay tab (viewing another
desktop's canvas over the E2EE relay) keeps its **own local** authenticator — it describes the
viewer's own machine, exactly like the toy-lock list does. That is enforced below the UI as well as
in the bridge assembly: the desktop host's raw-relay dispatcher default-denies every
`authenticator:*` method before handler lookup. A peer-crafted `reveal`, `export-secrets`, or live
code request therefore receives `E_FORBIDDEN` without loading or unsealing the host's store; the
renderer-only reveal and two-key export confirmations are never treated as a network authorization
boundary. The Server Edition is unaffected — its authenticated browser socket still reaches the
authenticator service running on that server.

## Known limitations

- **No camera or image/clipboard QR scanning** for registering an existing secret — see
  [Registering an existing secret](#registering-an-existing-secret) above. Paste-a-URI and manual
  entry are the two supported routes in this pass.
- **No automated test suite** for this pass (project-level delivery constraint for this change);
  correctness is documented above via the RFC test-vector reasoning instead.
