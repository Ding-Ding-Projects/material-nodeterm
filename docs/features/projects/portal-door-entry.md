# Portal-door entry

Portal doors may require one optional entry value before navigation into their child canvas. The
owner chooses exactly one mode:

- **Numeric code**: 4 to 12 digits, kept as a value the entry service verifies.
- **Passphrase**: a bounded text value. Whitespace is meaningful, so the service does not trim it.

This is a navigation admission feature, not a toy lock. A toy lock is a user-selected, for-fun
presentation speed bump. Portal entry is owned by the portal and is checked by the portal-door
service. It never uses toy-lock records, toy-lock ladders, or the recovery game.

## Local persistence and portability

The door's safe presence metadata may travel in the schema 3 portable canvas projection through a
node's `portalEntry` field:

```json
{
  "enabled": true,
  "mode": "passphrase",
  "duration": "minutes",
  "durationMinutes": 30,
  "lockedOnLaunch": true
}
```

Setting `enabled` to `false` is an explicit no-entry state. It may be retained with the door's
safe metadata for a later re-enable, but the entry service treats the door as open and never asks
for a value while it is disabled.

This metadata contains no code, passphrase, hash, credential id, path, host identity, session, or
vault content. The actual verifier is sealed in the application-data store
`portal-door-entries.json`, using the shell's OS-backed secret sealing where available. The local
record is keyed by the project and stable door id, so a clone can show that entry is configured
without receiving a usable secret. A destination computer that lacks the local record must offer
the owner an explicit configure or rebind action; import itself makes no network request,
deployment, process launch, or provider mutation.

## Unlock duration and rate limits

After a successful check, the entry stays open for the selected duration:

- `session` lasts until the portal is left or an explicit relock is requested.
- `minutes` expires after the configured 1 to 10080 minute window.
- `until-close` lasts only for the current application run.

Unlock state is memory-only. A fresh process starts locked, and the `lockedOnLaunch` metadata
keeps that intent visible to the renderer. Relocking removes the in-memory authorization and never
changes the stored entry value.

Wrong values receive the same neutral mismatch message regardless of which internal comparison
failed. After three failures for one door, verification pauses with an exponential wait capped at
30 seconds. During the wait the service does not inspect the submitted value. A successful entry
resets the failure counter. Store corruption or an unavailable secret store is an error, never an
empty or unlocked fallback.

## Entry surface and recovery

`PortalDoorEntryPopover` is an anchored, non-modal surface attached to the door control. It moves
inside the viewport, returns focus to its opener, supports Escape and keyboard submission, labels
the field for assistive technology, reports the remaining rate-limit time as text, and keeps the
entry action disabled while a request is in flight. Informational and rate-limit copy remains
non-blocking.

The recovery link does not guess, reveal, or reset a value. It closes the popover and routes to the
portal settings editor, where the owner can deliberately replace or remove the entry requirement.
There is no recovery game and no route that treats a game result as authentication. Removing an
entry is a settings/destructive action and must use the app's existing confirmation surface.

## API boundary

`src/shared/portal-door.ts` defines the typed bridge. `src/core/portal-door-service.ts` owns
validation, hashing, sealing, rate limits, expiry, and relock. Both Electron and Server Edition
register the same handlers. The renderer receives metadata and verification results only; it never
receives a stored verifier or a secret read-back method. Relay sessions deliberately keep this
namespace local to the viewing machine, so a mutually approved relay peer cannot use a remote
canvas as a credential oracle.

## Verification record

This implementation lane was intentionally delivered without running tests, type checks, lint,
security checks, builds, packaging, installer execution, runtime interaction, or UI captures. The
implementation therefore remains **unverified** until a later verification lane runs the focused
Chuts against the built artifact. Those Chuts must cover both modes, invalid and bounded values,
vault sealing, no portable secret fields, rate-limit timing, every duration and relock, store
failure, keyboard and screen-reader paths, focus return, narrow layouts, and the absence of any
recovery-game or toy-lock call.

Suggested articles: [Portable canvas projection](./portable-canvas-projection.md),
[Projects and tabs](./projects-and-tabs.md), and [Toy locks](../../toy-locks.md).
