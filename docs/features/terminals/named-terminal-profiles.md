# Named terminal profiles

Named terminal profiles save a local recipe for opening a shell in a known place. A profile has a
display name, a detected shell profile, an optional start directory, an optional startup command,
one managed local account binding, and bounded environment overrides. The Shell settings surface
offers real pickers and validated fields, and New terminal menus expose the saved choices.

## Behaviour

The profile id is snapshotted on a local node, while the recipe stays in machine settings. New local
terminals resolve it in the trusted desktop core immediately before spawning. Existing terminals do
not change when a profile is edited. Startup commands use the existing one-shot launch-intent path.

## Portability and security

Profiles live in `settings.json` under `namedTerminalProfiles`. They never enter `.nodeterm/project.json`,
portable archives, peer mutations, exports, or remote project state. Start directories must be
absolute existing directories at spawn time. Shell choices come from the detected local catalog;
unavailable choices remain visible with their reason. Environment keys reject protected process
variables, control characters, and oversized values. Account ids refer only to configured local
managed accounts. Missing or unreadable values fail closed without silently switching shells.

## Verification

This lane intentionally did not run tests, type checks, lint, builds, packaging, runtime interaction,
or captures. Those checks remain required before a release claim.

## Suggested articles

- [Windows shell profiles](./windows-shell-profiles.md)
- [Global and project settings](../global-and-project-settings.md)
- [Session continuity](./session-continuity.md)
