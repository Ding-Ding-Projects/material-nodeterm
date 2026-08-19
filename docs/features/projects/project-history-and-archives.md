# Project history and archives

Every successful project save is recorded in a separate, app-owned Git repository under the
application-data directory. The project folder's own `.git` directory is never read or copied for
this feature. Identical autosaves do not create empty revisions.

The project context menu provides **Export project with history…** and **Import project with
history…**. Export writes one `.nodeterm-project` JSON file containing the canonical portable
project snapshot and a base64 Git bundle containing the complete app-owned history. Import
validates the schema, size, base64 encoding, Git bundle, and snapshot-to-history-tip match before
creating a project with a fresh local identity.

Machine-local executable choices, shell arguments, credentials, account bindings, and camera
position do not enter the portable snapshot. Import never overwrites an existing history
repository and removes staged state when validation fails.

## Failure modes

- A cancelled file picker changes nothing.
- A malformed, oversized, unsupported, truncated, or mismatched archive is refused before the
  project is adopted.
- Local-history recording is secondary to saving the live project: a history write failure is
  reported by diagnostics but never discards an otherwise successful project save.

## Verification

Focused tests exercise complete export/import, fresh identity creation, Git-bundle restoration,
and refusal of a snapshot changed outside its bundled history.
