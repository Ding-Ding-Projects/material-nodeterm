# Project history and archives

Every successful project save is recorded in a separate, app-owned Git repository under the
application-data directory. The project folder's own `.git` directory is never read or copied for
that history feature. Identical autosaves do not create empty revisions.

## One-file project saves (`.nodeterm-project`)

New saves use schema 3. The portable file contains only safe project intent and the app-owned
history bundle, with a manifest that records every payload hash and every omission. Legacy V1 and
V2 files remain readable, but they are never reproduced on export. In particular, vaults,
credentials, machine paths, provider sessions, process state, repository working files, and caches
stay on the source machine and must be configured again at the destination.

The project context menu provides **Save project as one file…** and **Open project from file…**.
A legacy V2 save file carries the WHOLE project, the way a `.docx` carries a whole document — it is a
genuine ZIP container (rename it to `.zip` and any archive tool opens it):

| Entry | Contents |
| --- | --- |
| `mimetype` | `application/x-nodeterm-project` (identification aid) |
| `archive.json` | Manifest: schema version, export time, project name, and the full inclusion/exclusion report |
| `project.json` | The portable canvas snapshot (identical text to the bundled history tip) |
| `history.bundle` | The complete app-owned local history as a Git bundle |
| `repo/repository.bundle` | The project's OWN repository — `git bundle create --all` (all branches, tags, remote-tracking refs) |
| `files/…` | Working files: tracked files at their current on-disk content, plus untracked-but-not-ignored files |

### What is included, and what is not

The inclusion rule is stated up front rather than implied:

- **Included**: everything Git tracks (at its current working-tree content, so uncommitted edits
  travel), everything untracked that `.gitignore` does not exclude, and the complete history as a
  bundle (branches, tags, and remote-tracking refs — remote URLs and other repository *config* are
  not part of a bundle and do not travel).
- **Excluded**: gitignored paths (build output, caches, `node_modules` — recoverable by
  reinstall/rebuild). **Nothing is dropped silently**: every exclusion is recorded in
  `archive.json` with its reason, grouped per ignored root with file counts and bytes, and the
  save notification shows the totals. Nested repositories/submodules, symlinks, and unreadable
  files are likewise excluded and individually listed.
- A folder **without** a Git repository has no ignore rule to respect, so every regular file is
  included (the size caps are the guard rail) and the report says so.
- An SSH project's folder lives on the remote host; its save file carries the canvas and local
  history only, and the report says so. The same applies to an inline (folder-less) canvas and to
  a project whose folder no longer exists.

### Limits (refused with real numbers, never truncated)

- Save file: 512 MB. Raw payload: 2 GB (also the import-side decompression budget, so a file that
  can be written can always be read back). File entries: 60,000 (ZIP without zip64). An
  over-limit project is refused with the measured sizes; a truncated file is never written.
- V1 archives keep their historical 180 MB import cap.

### Import

Schema 3 import reads and validates the complete container before writing. It checks the manifest,
all relative paths, duplicate and case-colliding names, entry and aggregate byte budgets, and the
SHA-256 recorded for every payload entry. Legacy snapshots are migrated in memory through the same
authority-stripping boundary. A destination is built in a private sibling staging directory and
published with one atomic rename; an existing destination is refused as a collision, and a failed
or cancelled import removes only its own stage. No provider, deployment, process, download, or
binding action runs during import. The imported project is intentionally left unbound until the
destination binding wizard is chosen.

Opening a V2 file that carries a repository asks for an **empty destination folder** — import can
therefore never overwrite anything, which is why it needs no destructive-action confirmation. The
working files are extracted, then the repository is restored (`git init`, `bundle verify`,
`fetch +refs/*:refs/*`, HEAD re-attached to its branch, index reset to HEAD) so `git log`, tags,
branches AND the uncommitted working state all come back exactly as saved. Validation still proves
the canvas snapshot matches the bundled history tip before anything is adopted, and a failed
import removes everything it wrote (the destination was empty, so everything inside it is ours).

**V1 archives** (JSON text, canvas + history only) still import, as folder-less projects, and the
result says plainly that the old format carried no repository or working files.

Machine-local executable choices, shell arguments, credentials, account bindings, and camera
position never enter the portable snapshot. Import never overwrites an existing history
repository and removes staged state when validation fails.

### Overwrite and concurrency

Saving over an existing file goes through the operating system's own replace confirmation, and the
bytes land via temp-file + atomic rename — an interrupted save can never tear an existing save
file. One save/open runs at a time: the main process refuses re-entry independently of the
disabled menu rows, so a keyboard-driven second submit cannot start a concurrent operation.

## Failure modes

- A cancelled file or folder picker changes nothing.
- A malformed, oversized, unsupported, truncated, tampered or checksum-failing file is refused
  before the project is adopted — a save file that cannot be FULLY read is refused whole.
- A non-empty destination folder is refused by name; nothing in it is touched.
- Local-history recording is secondary to saving the live project: a history write failure is
  reported by diagnostics but never discards an otherwise successful project save.

## Known limitations

- The staged/unstaged split is not preserved (the index is reset to HEAD on import); the *content*
  of every staged and unstaged change survives in the working files.
- Repository config (remote URLs, hooks), stash reflog history beyond the top entry, empty
  directories, and POSIX file modes of extracted working files are not carried.
- A folder nested inside a larger repository saves its files but not the surrounding repository's
  history; the report says so.
- Progress is honestly indeterminate (a busy notification, disabled controls, and main-process
  re-entry refusal) — there is no per-byte progress channel yet.

## Three surfaces

- **Desktop**: full save/open with native dialogs.
- **Server Edition**: not wired — the browser bridge answers with an explicit "available in the
  desktop app" error (no native dialogs, and the WebSocket bridge's 8 MiB frame cap has no carrier
  for a multi-hundred-MB archive). The service itself lives in `src/core`, so a future
  HTTP-download carrier can reuse it unchanged.
- **Mobile companion**: not applicable — it attaches to sessions over the transport protocol and
  has no canvas or project files.

## Verification

Focused tests exercise the ZIP container (round-trip, DEFLATE/STORE selection, interop with an
independent ZIP reader, truncation/corruption/forged-size/traversal refusal, budget enforcement),
complete export/import with a REAL Git repository (history, tag and branch equality via `git log`,
uncommitted-edit and untracked-file survival, ignored-path exclusion with counted bytes), fresh
identity creation, V1 compatibility, destination-emptiness refusal, and refusal of a snapshot
changed outside its bundled history.
