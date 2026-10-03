# Live links (protocol foundation)

A live link is a read-only, expiring browser URL that shows one terminal or agent node live to a
viewer with nothing installed. Upstream nodeterm ships it as a Pro feature. This fork currently
carries the **foundation** of that feature only: the viewer protocol, its key derivation and wire
rules, the output filter, the sealed link store, and the tmux argument builders a watcher needs.
**No live link can be created, listed, hosted or watched from this fork yet**, and no control for
one is rendered on any surface. This article describes exactly what is present, what is missing,
and why.

## Behaviour

Nothing a user can see changes. The landed modules are inert until a later change wires them into
both shells:

| Piece | Path | What it does |
| --- | --- | --- |
| Keys and URL | `src/shared/watch-link/keys.ts`, `link.ts`, `bytes.ts`, `hkdf.ts` | Derives the host key pair, the viewer key pair and the join key from one 32-byte secret, and formats or parses `https://nodeterm.dev/s/<linkId>#1.<secret>`. |
| Wire and protocol | `src/shared/watch-link/wire.ts`, `protocol.ts` | The sealed-box frame header, pty frames, tunnel JSON, the `watch:` event names, end reasons, and the chat sanitizers. |
| Browser client | `src/shared/watch-link/client.ts` | The viewer's relay client, written without any Node API so the same file runs in a browser. |
| Test vectors | `src/shared/watch-link/vectors.json` | Fixed inputs and outputs shared with the upstream viewer page. |
| Output filter | `src/core/watch-link/stream-filter.ts` | Removes every string-type escape sequence (OSC, DCS, SOS, PM, APC, 7- and 8-bit) from a stream. |
| Token bucket | `src/core/watch-link/token-bucket.ts` | A byte-rate limiter with a sustained rate and a burst. |
| Visible capture | `src/core/watch-link/capture-route.ts` | Chooses which backends can produce a visible-screen-only capture and builds and parses the tmux argv for it. |
| Watcher client | `src/core/watch-link/watcher-client.ts` | Builds the argv for a read-only tmux client that never resizes, creates, or rewrites the session environment, and parses the window size and the tmux version. |
| Link store | `src/core/watch-link/store.ts` | Persists active links with a sealed secret, serialized writes, and a latch that never writes over an unreadable file. |

The `src/shared/watch-link/` directory is copied byte for byte from upstream. Upstream's viewer
page vendors the same directory, so a protocol change must land upstream first with new vectors.
`isomorphism.guard.test.ts` refuses an import from outside the directory (only siblings and
`tweetnacl`), a Node API, or a type imported without `type`.

The relay host policy now reserves the whole `watchLink:` channel namespace as host-only
(`src/shared/host-control.ts`): any owner channel added later is refused to every relay peer from
the day it exists. The viewer protocol uses `watch:`, which stays outside that namespace.

## What is missing, and why

Hosting a link needs a relay host that can run per-viewer sessions with an inbound access hook
and an outbound sink wrapper, plus a hosted listener scheduler with a bridged-listener cap and a
host-token mint. Upstream builds those as its core relay modules (the relay host, the hosted
scheduler, the host-token mint, the relay proof-of-possession helper and an in-process transport
pair), which is the hosted team relay feature. This fork's relay still lives in `src/main/remote/`
without those hooks, so the following upstream pieces are not taken yet:

- the link host, the watcher policy, the pty seam, the registry service and the API client
  (upstream's `link-host`, `watcher-policy`, `pty-seam`, `service` and `api` modules in its
  watch-link directory);
- the `PtyManager` additions (`captureVisible`, `joinAsWatcher`, `syncWatcherClientSize`,
  `sessionSize`), the sink-registry `quiet`/`selfPaced` options and the reaper's `liveClientIds`;
- the owner IPC channels, the preload and Server Edition bridge members, and the shell wiring;
- every renderer surface: the LIVE chip, its popover, the create dialog, the Settings section,
  and the node, card, sidebar and palette entry points.

Showing any of those controls before a link can actually be hosted would offer an action that
cannot work, so none is rendered. Creating a link also requires upstream's hosted service
(`POST /v1/watch-links` on the nodeterm API, which checks a Pro license) and the viewer page on
nodeterm.dev.

## Configuration

None. No setting, file or environment variable is read by the landed modules until the service is
wired. The store, once wired, writes `<userData>/watch-links.json`.

## Failure modes

The landed code fails closed wherever it decides anything:

- `formatWatchLink` throws on a link id that is not 22 base64url characters, a secret that is not
  32 bytes, or an origin that is more than a scheme and a host, rather than produce a link whose
  secret could leave the fragment. `parseWatchLinkLocation` returns `null` for any other shape.
- The store treats only `ENOENT` as "no links". Any other read error, a file over 1 MiB, or an
  unknown version latches it: every later save answers `failed` and the file survives. JSON that
  does not parse is set aside as `.corrupt-<timestamp>`.
- A sealed secret the keychain refuses to unseal is kept verbatim until its own expiry instead of
  being erased; when sealing starts failing mid-run, only a link that was never sealed is left out
  and reported `memory-only`.
- A capture route answers `none` for the Windows session host, a direct Windows pane, a Zellij
  session and a plain shell, and an unavailable capture is distinct from an empty screen.
- The watcher client requires tmux 3.2 or newer for client flags; an older or unreadable version
  answers unsupported.

## Security considerations

- The secret is carried in the URL **fragment**, so it never reaches an HTTP request, a server log
  or a referrer. The link id names a link and unlocks nothing.
- The host key pair, the viewer key pair and the join key are derived from the secret under
  separate domain labels (`nodeterm-watch-link-v1/host`, `/viewer`, `/join`). The API only ever
  sees the join key, and learning it reveals nothing about the key pairs.
- The store seals the **base64 text** of the secret through a string seam, keeps only a SHA-256
  digest of each secret in memory beside its sealed form (never a second plaintext copy), and on a
  desktop refuses a raw secret found in the file instead of adopting it.
- The output filter swallows every string-type sequence to its terminator with no length cap, so
  clipboard contents (OSC 52), titles, hyperlink targets and file transfers never reach a viewer.
  A viewer joining a running session starts as if inside an unknown string and shows nothing until
  the next escape, so a join that lands inside an OSC 52 cannot print the clipboard. No output it
  produces ends on ESC or contains an 8-bit introducer.
- Chat text and names are bounded by code point before cleaning, lose C0/C1 controls and every
  bidirectional control, and are capped at 500 and 32 UTF-16 units without splitting a surrogate
  pair. The bidirectional set is the same one `src/shared/presence.ts` strips from display names,
  which now also includes U+061C.
- The capture and watcher targets are exact (`=nt-<id>:`), because tmux resolves a bare target by
  prefix and `nt-x-1` would otherwise capture `nt-x-12`.
- `chat-cast.guard.test.ts` fails when any source outside the live-link files mentions the
  viewer chat cast, so no platform handler can accept viewer chat from another client.

## Three surfaces

- **Desktop:** foundation only, nothing rendered.
- **Server Edition:** foundation only, nothing rendered. Upstream registers the service there as
  `unsupported` until that edition has a license layer.
- **Mobile companion:** not applicable; upstream also leaves live links out of the phone in its
  first version.

## Verification

- `npx vitest run src/shared/watch-link src/core/watch-link src/main/remote/watch-link-wire.relay.test.ts`
  runs the vectors, key derivation, isomorphism guard, wire and protocol rules, the differential
  test of the filter against xterm's VT500 table, the token bucket, the capture and watcher argv
  builders, the store, and the chat-cast guard.
- `capture-route.realtmux.test.ts` runs against a real tmux when one is installed and proves the
  prefix trap, the exact target and the visible-only capture.
- `src/main/remote/watch-link-wire.relay.test.ts` compares the wire rules with this fork's relay
  session crypto (`src/main/remote/e2ee.ts`).
- `src/shared/host-control.test.ts` proves the `watchLink:` namespace is host-only and `watch:` is not.

## Suggested articles

- [Server Edition](./server-edition.md)
- [Approved relay peers](./approved-relay-peers.md)
- [Upstream sync and the port ledger](../development/upstream-sync.md)
