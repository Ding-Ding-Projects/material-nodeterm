# Global and project settings

## Behavior

Global mode is the durable app-wide default. Project mode renders the same complete settings
sections and writes a sparse override for the active project. Effective values resolve as project
override over global default; an active schedule remains a temporary runtime overlay.

The header reports the override count and offers **Reset all to Global**. Settings search and its
adjacent regex builder, command-palette destinations, localization, accessibility, tabs, menus,
appearance, history, and scheduling remain the existing shared components.

## Persistence and migration

Global defaults remain in `settings.json`. Sparse project overrides live in the versioned,
machine-local workspace index. Existing projects have no overlay and inherit every global value.
The Git-shared `.nodeterm/project.json` schema never accepts the overlay.

## Security and privacy

A cloned repository cannot use settings JSON to inject executable paths, account identifiers,
credentials, local paths, relay targets, or host secrets. Credentials continue to use their
protected stores and are not project-setting exports.

## Failure modes

An unreadable workspace index never treats shared project JSON as a fallback settings source.
Resetting an overlay is local and does not alter global defaults.

## Verification

This ultra-speed lane did not run tests, type-checking, lint, runtime interaction, accessibility
review, or screenshots. The implementation is committed but unverified by those checks.

## Suggested articles

- [Scheduled settings](../scheduled-settings.md)
- [Personal vocabulary](../personal-vocabulary.md)
- [Remote sessions](../remote-sessions.md)
