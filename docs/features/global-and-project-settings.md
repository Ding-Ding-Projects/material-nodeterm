# Global and project settings

## Behavior

Global mode is the durable app-wide default. Project mode renders the same complete settings
sections and writes a sparse override for the active project. Effective values resolve as project
override over global default; an active schedule remains a temporary runtime overlay.

The header reports the override count and offers **Reset all to Global**. Settings search and its
adjacent regex builder, command-palette destinations, localization, accessibility, tabs, menus,
appearance, history, and scheduling remain the existing shared components.

## Navigation and host parity

Static settings navigation entries and their rendered hosts share one exhaustive host-renderer map
in `src/renderer/components/settings/SettingsPage.tsx`. The page materializes a host for every
entry in `SETTINGS_SECTION_REGISTRY`, while macOS-only and School mode filtered entries retain the
same visibility rules as the sidebar. Runtime project entries remain a separate list because their
identities and project-scoped props are discovered at render time. A missing host renderer fails
closed rather than leaving a navigation row that opens an empty pane.

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

Shell-profile detection is project-aware without becoming a persistence side door. Refresh passes
the effective active-project `defaultShell` value to the bounded desktop detector for that one
read-only probe. It does not write the project value into global `settings.json`; ordinary edits
continue through the shared `useSettings.update()` scope resolver. Terminal preview reads the same
effective settings layer. A source sweep found no other production call that directly saves
`useSettings.getState().base` from a Settings section.

## Verification

The earlier ultra-speed lane did not run tests, type-checking, lint, runtime interaction,
accessibility review, or screenshots. That historical note remains attached to the earlier
implementation record.

The settings registry parity Chut is `src/renderer/components/settings/SettingsPage.registry.test.tsx`.
It checks that every static navigation entry materializes one host and deliberately verifies the
missing-renderer failure path. The focused Chut and `nav.test.ts` pass locally; the complete app
runtime and visual interaction remain outside this registry-only check.

## Suggested articles

- [Scheduled settings](../scheduled-settings.md)
- [Personal vocabulary](../personal-vocabulary.md)
- [Remote sessions](../remote-sessions.md)
