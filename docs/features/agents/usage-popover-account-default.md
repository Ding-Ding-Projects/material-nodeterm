# Usage popover account defaults

The usage popover lets a user choose which Claude identity new sessions use for the active
project. Existing nodes and running sessions keep the account identity resolved when they were
created.

## Behaviour

When more than one Claude identity has usage data, the popover presents a searchable account
picker. The System identity and each configured managed identity are separate radio rows. The
selected row carries `aria-checked="true"` and a check marker. Selecting an account updates the
active project's `defaultAccountId`; selecting System clears that field. The popover remains open
so the user can compare limits after changing the choice.

The picker has a plain-text search by default and an adjacent anchored regex builder. Search
matches the visible account label and email. Invalid patterns are reported inline and fail open,
so an invalid filter never hides the recovery route. Arrow keys, Home, End, Enter, and visible
focus provide a keyboard path through the radio rows.

SSH projects apply the same picker to the connected host's Claude identities. The host is shown
beside each remote identity, and the selected remote id is stored in the active project's existing
`defaultAccountId` field. Non-Claude provider rows remain read-only.

## Persistence and fallback

The existing project store updates the active project's `defaultAccountId` and invokes the shared
workspace-dirty seam. The normal workspace save persists the choice. No node `accountId` is
rewritten, and no credential or provider session is moved.

If a saved account was removed, disconnected, or is not present in the current host scope, the
picker reports that the saved default is unavailable and presents System as the effective choice
for new sessions. The saved value is not silently rewritten. Choosing another identity or System
explicitly repairs the project setting.

## Surfaces and architecture

The feature is implemented in `src/renderer/components/UsageIndicator.tsx`, with shared renderer
state from `src/renderer/state/projects.ts` and `src/renderer/state/workspaceDirty.ts`. Desktop and
Server Edition use the same renderer and therefore the same interaction and persistence path.
Mobile is unchanged because its launch-account surface is separate.

## Security and privacy

The picker handles account ids only. Credentials, config directories, tokens, and usage request
payloads remain in their existing local or host-scoped services. Regex evaluation is local and
bounded by the shared regex search field. The picker never sends account search text over the
network.

## Verification status

The implementation lane intentionally did not run tests, type checking, builds, packaging, UI
interaction, or captures. Those checks remain required before release. Review the exact built
artifact before claiming the interaction is verified.

## Suggested articles

- [Agent support](./agent-support.md)
- [Global and project settings](../global-and-project-settings.md)
- [Remote and SSH](../remote/README.md)
