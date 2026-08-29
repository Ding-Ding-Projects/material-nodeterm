# Markdown preview on open

The editor can open Markdown files directly in the rendered preview. This keeps documentation and
README files readable on first open while retaining the full editor and the existing Preview/Edit
toggle.

## Supported files and configuration

The automatic decision is based on the lower-cased extension. `md`, `markdown`, `mdown`, and `mkd`
open in preview when **Behavior → Open Markdown in preview** is enabled. Other text files remain
editable. The setting is available through the Behavior settings search, the command palette, and
scheduled settings. It is included in the Behavior reset group and in local settings history.

New installations default to enabled. Existing settings are migrated once with
`openMarkdownPreviewMigrated`. An unstamped saved value is enabled and stamped, including a saved
`false` produced by the old default. Once stamped, a deliberate `false` remains false.

## Interaction and accessibility

Preview renders through the shared Markdown renderer after the file has loaded, so a failed or
oversized read cannot replace the editor with an empty preview. **Edit** returns to the editor and
the existing Markdown shortcut continues to toggle the view. The preview bar contains one label and
one shortcut hint, so assistive technology does not encounter duplicate content.

## Explorer pin hint

The Explorer's existing pin action is discoverable through a one-shot informational notification.
It appears only when an unpinned Explorer transitions from open to closed after the user opened a
file from that Explorer open spell. Browsing and dismissing without opening a file does not trigger
it, and a pinned Explorer does not trigger it. The marker is `nodeterm.seenExplorerPinHint` in local
browser storage. A storage read failure is treated as already seen and a write failure is ignored,
so private-mode and quota failures cannot interrupt file work.

## Failure modes and security

Markdown content is read through the existing local or SSH filesystem abstraction and rendered by
the existing isolated renderer. The feature adds no network request and does not persist file
content. A malformed settings file falls back to the safe default settings object; a malformed
scheduled value is discarded by the shared scheduler validator.

## Verification

- `src/renderer/lib/markdownPreview.test.ts` covers all supported extensions, case folding, and
  the enabled/disabled decision.
- `src/renderer/lib/explorerPinHint.test.ts` covers the exact open-to-closed predicate, one-shot
  behavior, pinned and browse-only exclusions, and storage failures.
- `src/core/settings-store.test.ts` covers absent, unstamped false, and stamped opt-out migration.
- `src/shared/scheduled-settings.test.ts` covers the allowlisted boolean value and rejection of
  unsupported values.

## Suggested articles

- [Files node](./files-node.md)
- [Global and project settings](../global-and-project-settings.md)
- [Scheduled settings](../../scheduled-settings.md)
- [In-app documentation browser](../help/in-app-documentation.md)
