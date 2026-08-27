# Managed Codex account behavior

Managed Codex accounts provide isolated local login homes and preserve the selected account through
account-specific session operations. This article covers the account lifecycle and same-machine
conversation switching slice from issue #86 and upstream PR #422.

## Lifecycle

The desktop account service owns the local account lifecycle through the `codexAccounts:*` IPC
channels:

- Add creates a validated account id, a private account home, and links only non-secret runtime
  assets from the system Codex home.
- Wait-login polls the account's own `auth.json` and accepts only a real regular file. A missing
  credential or a symlink to another account remains logged out.
- Identity reads the account email from that account's app-server.
- Remove cancels a pending login, stops the account daemon when available, and removes the managed
  account home. Removal refuses while an account switch reservation is active or another removal is
  already running.

Account ids are validated by the shared `isSafeAccountId` predicate before they become filesystem,
socket, or scope components. The system account remains the empty account-id case and uses the
normal Codex home.

## Same-machine switching

Switching a live conversation between local accounts is a three-phase, owner-authorized operation:

1. `switch-thread` reserves both account ids, reads the source rollout, and validates the source
   path without changing the filesystem.
2. `commit-switch` creates an atomic, no-overwrite hardlink for the same rollout inode under the
   target account's `sessions` directory.
3. `finish-switch` releases the reservation only after the commit phase succeeds.

Rollback, renderer destruction, and the bounded reservation lifetime release an incomplete
reservation without publishing a target rollout. A different existing target rollout is refused,
symlinked target directories are refused, and a cross-filesystem link reports a named failure
   rather than silently copying the conversation.

The source and target account ids are held by the reservation, so account removal cannot race a
switch. Each phase checks the renderer owner, preventing another window from completing a prepared
switch.

## Credential boundaries

Managed account credentials and the Codex thread database are not shared from the system home.
Only non-secret installation assets may be linked. OAuth-shadowing environment variables are removed
from the selected session environment so a managed account uses its own login instead of an ambient
API key.

The account service does not expose stored credential contents. Account identity is reported only as
the non-secret email returned by the app-server.

## Scope and verification

This article deliberately excludes endpoint modeling, migration, cross-project transport,
projections, navigation, grouping, dependency operations, custom-agent harnesses, model switching,
and restart logic. Those slices have their own lanes.

The implementation commit is
`e91c4ee610307302fb427efc1b12f75b65e7d254` on `feat/program-75-account-behavior`. The lane was
reconciled against `origin/main` at
`54164b84dce0b7e62787b1de2885405ff4ed821c` by inspection. Importing that newer base would add
unrelated changes across 284 files, so it was not merged into this account-only lane.

Tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, and screen
captures were intentionally not run in this lane.

## Suggested articles

- [Agent support](./agent-support.md)
- [Codex shared identity](../../codex-shared-identity.md)
- [S6 managed-account acceptance](../../codex-accounts-acceptance.md)
