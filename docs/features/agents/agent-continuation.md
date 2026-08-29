# Codex crash-recovery continuation

## Behaviour

The desktop app keeps one bounded continuation packet per Codex node. The packet is derived from
Codex provider hook events, not terminal scrollback. It contains a short progress summary, a
bounded preview, the provider session id, and a warning that earlier side effects may already
exist. A cold relaunch hydrates the packet and presents an anchored review card beside the owning
node. The cold-relaunch decision carries an explicit continuation-review bit: it is set only when
the new provider session is fresh and a packet is present. A successful provider resume does not
show the card or submit the recovered prompt a second time.

The card never injects text merely because it mounted. The user must explicitly choose **Review and
continue**. The host first requires a verified Codex provider-start event for the same node and
session, then delivers the bounded continuation prompt. The packet is removed only after a verified
next-turn receipt arrives. If provider start, delivery, or receipt verification fails, the packet
remains available for a later retry. Retries are serialized per node.

## Configuration and persistence

Continuation state uses schema version `1`, has fixed byte and count bounds, and uses one packet per
node. The packet file lives under the app's stable data directory. A random AES-256-GCM key is
sealed by the platform's OS-backed secret store and kept in a separate key record. The node id is
the stable authenticated-data binding, so relaunch and packet replacement cannot silently accept a
record for another node.

The renderer receives only the redacted packet preview. Credentials, raw command arguments,
complete provider results, terminal scrollback, status-mirror payloads, logs, exports,
notifications, clipboard data, and delivery traces are excluded.

## Failure modes and security

Missing OS-backed secret storage, malformed key or packet data, invalid identifiers, oversized
fields, authentication-tag failure, unavailable provider start, failed delivery, and a missing
next-turn receipt all fail closed. Failed continuation does not clear the packet. A user can
discard it explicitly from the anchored card, or mark it reviewed without clearing it.

The initial adapter is Codex only. Other providers do not create continuation packets until their
transcript event contract has been implemented and reviewed. The feature never reads terminal
scrollback as a substitute for provider events.

## Verification

Focused tests are in `src/core/agent-continuation.test.ts`,
`src/renderer/terminal/agent-cold-relaunch.test.ts`, and
`src/renderer/components/AgentContinuationReview.test.tsx`. They cover redaction, encrypted file
creation, one-packet-per-node behaviour, acknowledgement without clearing, serialized retries,
provider-readiness refusal, delivery and receipt-timeout retention, exact node/session receipt
matching, packet authentication tamper rejection, the fresh-only review bit, and the rule that
mounting the review card never injects a prompt. The source and real packaged desktop flow remain
unverified in the current lane. Tests, lint, type checks, builds, packaging, runtime interaction,
reviews, audits, and screen captures were not run.

## Suggested articles

- [Agent support](./agent-support.md)
- [Context-window progress](./context-window-progress.md)
- [Managed Codex account behavior](./codex-account-behavior.md)
- [Local version history](../local-history.md)
