# Export everything, in every format

Every record, view, list, log, document, setting and generated artifact nodeterm owns is
exportable. A feature that renders data and offers no way out of it is incomplete — "you can copy
it from the screen" is not an export.

Files:

| Layer | File |
|---|---|
| Types (`ExportFormat`, `ExportTable`, `ExportDocument`, `BuiltExport`, `LossyNote`) | `src/shared/export/types.ts` |
| Format catalog + per-kind offering | `src/shared/export/catalog.ts` |
| Lossy-field disclosure | `src/shared/export/lossy.ts` |
| Low-level scalar escaping | `src/shared/export/scalars.ts` |
| Hand-rolled block-style YAML emitter | `src/shared/export/yaml-block.ts` |
| Row-oriented encoders (CSV/TSV/JSON/JSONL/YAML/Markdown/HTML/SQL/XML) | `src/shared/export/table.ts` |
| Document encoders (JSON/YAML/TOML/XML/Markdown/HTML) | `src/shared/export/document.ts` |
| Pure, dependency-free ZIP writer (STORE) | `src/shared/export/zip.ts` |
| Public orchestrator (`buildTableExport`, `buildDocumentExport`, `buildArchive`) | `src/shared/export/index.ts` |
| Browser-side "save" (Blob download) | `src/renderer/lib/exportSave.ts` |
| "Open in Visual Studio Code" detection + launch | `src/core/vscode-detect.ts`, `src/core/vscode-handlers.ts` |
| Reusable UI: format picker, lossy disclosure, save, "Open in VS Code" | `src/renderer/components/ExportMenu.tsx` |

## The format matrix

A format is offered **per datum**, not per app. `src/shared/export/catalog.ts`'s
`FORMATS_FOR_KIND` decides which formats a given piece of data is offered in:

| Kind | Meaning | Offered formats |
|---|---|---|
| `tabular` | A list of same-shaped records (session rows, history entries, a notification log) | CSV, TSV, JSON, JSON Lines, YAML, Markdown, HTML, SQL, XML |
| `structured` | One arbitrary JSON-shaped document (a settings object) | JSON, YAML, TOML, XML, Markdown, HTML |
| `prose` | Long-form text (a note, a transcript) | Markdown, HTML, JSON (wrapped) |

Markdown and HTML are marked `writeOnly` in `FORMAT_INFO` — this module writes them but does not
read them back. They are still offered (an export is still an export), but the UI never claims
they round-trip.

## Never a silent drop — the lossy-disclosure rule

Before an export runs, `describeTableLossage` / `describeDocumentLossage` compute exactly what the
CHOSEN format cannot carry faithfully, and `ExportMenu` shows that list before the Save button is
useful. Examples:

- **CSV/TSV/SQL/Markdown/HTML** flatten a nested object or array into a JSON-text cell. The bytes
  survive; the structure does not, and re-importing that cell literally requires re-parsing the
  JSON text — disclosed per affected column.
- **TOML has no null type.** A `null` field is **omitted from the output entirely**, never
  silently written as an empty string (which would be indistinguishable from a real empty
  string on re-import).
- **XML** writes a nested value as a `CDATA` JSON block inside its element rather than as native
  child elements.
- **Markdown/HTML** are flagged, whole-document, as "a presentation of this document, not a
  re-importable data format" — writing them is legitimate (a human, or another tool, wants
  Markdown), but this module does not pretend it is lossless.

`BuiltExport.lossy` always carries this list too, so a caller that skips the UI disclosure (e.g.
a scripted export) still has the facts.

## Self-describing files

Every text export states its own encoding (`UTF-8`, always), its schema version
(`nodeterm-export/v1` for JSON/YAML/XML, `nodeterm-export-manifest/v1` for a ZIP's manifest), and
when it exists, its export timestamp — in a header comment for formats that support one
(`#`/`<!-- -->`/`--`), and always in the returned `BuiltExport` record. CSV deliberately carries
**no** header comment (a `#`-prefixed first line is a comment to some CSV readers and a corrupted
header row to others — safer to stay metadata-free in the file and rely on the returned record).
JSON Lines carries no embedded header either, on purpose: every JSONL reader expects every line to
be a uniform data record, and a metadata line would break that. Pair a JSONL export with the
archive export below when the metadata matters.

Line endings: CSV uses CRLF (RFC 4180's convention); every other text format uses LF. Both are
stated explicitly in `BuiltExport.lineEnding`.

YAML mappings quote **every key and string scalar** as a YAML 1.2-compatible JSON string. Plain
YAML text has structural edge cases (`: ` starts a value and ` #` starts a comment) plus implicit
types such as timestamps, so Cantonese, emoji, colon, quote, or comment-shaped text must remain
data rather than become YAML syntax. The encoder's round-trip test feeds these hostile values
through `js-yaml`, a parser independent of the emitter.

## Archives: ZIP, not 7z

Multiple exports bundle into one **ZIP** archive (`buildArchive`) with a `MANIFEST.json` naming
every member, its format, its byte size and its lossy notes — the sidecar metadata a single
JSONL/CSV file cannot carry inline. The writer (`src/shared/export/zip.ts`) is a small,
dependency-free implementation using the STORE method (no compression): CRC32 computed in pure
JS, no Node/Electron/DOM API used anywhere, so it runs identically in the renderer (Desktop *and*
the Server Edition's browser build) and in the main/core process.

**7z is not offered.** Shipping it would need a native LZMA codec, and this project ships no such
dependency; a fake "7z" option that was secretly a renamed ZIP would be worse than not offering
7z at all. If a real 7z-capable dependency is added later, it should expose what 7z actually
offers — method (LZMA2/LZMA/PPMd/BZip2/Deflate), compression level, dictionary/word/solid-block
size, solid vs non-solid, multi-threading, split volumes, and both AES-256 content encryption
**and** encrypted headers (filenames included) — never a single hard-coded preset presented as "the
7z option."

Every archive entry's path is **sanitized** (`sanitizeZipPath`) before it is written: a leading
drive/slash is stripped and `..`/`.` segments are resolved away, so an archive this module writes
can never extract outside its destination directory (Zip Slip). The manifest records that exact
sanitized path, and paths that collide after sanitizing (or try to replace `MANIFEST.json`) reject
the archive instead of creating two meanings for one name.

The manifest's `bytes` field is the length of the member's actual `TextEncoder` output, not a
JavaScript string's UTF-16 code-unit count; Cantonese and emoji therefore report their real bytes
on disk. Both each local header and its central-directory record carry ZIP general-purpose bit 11,
declaring the filename bytes as UTF-8 rather than legacy CP437. The test opens the completed bytes
with the independent `unzipper` reader, round-trips non-ASCII names/content, and checks its stored
CRC-32 against both the extracted bytes and the standard `123456789` reference vector.

## How a save actually happens

`window.nodeTerminal.export.saveText(filename, content, mimeType)`:

- **Desktop (Electron):** a real native Save-As dialog (`dialog.showSaveDialog`), then a direct
  `fs.writeFile` to the chosen path. Resolves `{ ok: true, path }` — the real absolute path, which
  is what "Open in Visual Studio Code" needs.
- **Server Edition (browser):** there is no native Save dialog on a headless server, so this is a
  plain browser download — a `Blob` + a synthetic `<a download>` click
  (`src/renderer/lib/exportSave.ts`; duplicated inline in `src/renderer/bridge/stubs.ts` to match
  that file's existing self-contained-fallback convention). Resolves `{ ok: true }` with **no
  path** — the browser chose the download folder, and there is nothing on this process's
  filesystem to hand to VS Code.

Archive (ZIP) exports currently always go through the universal Blob-download path on both
surfaces (`saveArchive` in `exportSave.ts`) — a zip is not something you'd point VS Code's
workspace-open at without extracting it first, so the native-save/VS Code follow-up is scoped to
single text-file exports for now.

## "Open in Visual Studio Code"

`src/core/vscode-detect.ts` is Electron-free (only `node:child_process`/`fs`/`os`/`path`), so it
runs identically from the Electron main process and from the Server Edition (a plain Node
process) — registered on **both** shells via the generic `platform.handle` seam
(`src/core/vscode-handlers.ts`, wired in `src/main/index.ts` and
`src/server/handlers/index.ts`). "Open in Visual Studio Code" therefore always acts on the machine
that is actually running the shell answering the call.

Detection order:

1. `code`/`code-insiders` resolvable on `PATH` (`--version` is actually run to verify — a stale
   shortcut or a half-uninstalled app is never reported as usable). This also catches a **portable
   build** the user has added to `PATH` themselves; there is no reliable way to enumerate an
   unregistered portable install otherwise.
2. The well-known per-user/machine install paths for the current platform (macOS
   `/Applications/...`, `/usr/local/bin`, `/opt/homebrew/bin`; Windows
   `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd` and the Program Files equivalent;
   Linux `/usr/bin`, `/snap/bin`, `/usr/share/code/bin`), each also verified with `--version`.

A **folder** path opens as VS Code's own **workspace root** behaviour for a directory argument —
no special flag is needed, VS Code's CLI already does the right thing with a bare directory path.
A **file** path opens the file directly. Both use `-n` (a fresh window), so opening an export
never steals focus from or reuses whatever window VS Code last had open.

When VS Code is not found, `openInVsCode` returns a clear reason rather than silently doing
nothing (`{ ok: false, error }`), which `ExportMenu` renders as an inline error.

## Reusable UI

`src/renderer/components/ExportMenu.tsx` is the one control every export surface in the app uses:
a format picker (scoped to the datum's `kind`), the lossy disclosure (recomputed live as the
format changes), the meta line (MIME type / encoding / line-ending / write-only note), a Save
button, and — only once a save produced a real path — "Open in Visual Studio Code".

It is deliberately an **inline expanding panel**, not a floating popover: it renders in the flow
of whatever section places it, so it needs none of the anchored-overlay viewport-collision
handling a detached popup would (the panel it lives in already scrolls if it needs to). This is a
scoped simplification for this pass, recorded here rather than left silent — a future pass wanting
this as a true anchored popover (matching the app's `ContextMenu`/`FindBar` conventions) can layer
that on without touching the encoders underneath.

## Where it is wired today

- **Session memory panel** (`src/renderer/components/SessionMemoryPanel.tsx`) — export every
  session row currently on screen, in any offered tabular format, via the header's `ExportMenu`;
  bulk-select a subset and export just those (see `docs/bulk-actions.md`).
- **Local settings history** (`src/renderer/components/LocalHistoryPanel.tsx`, Settings →
  History) — export the currently filtered history entries, in any offered tabular format.

Every future list-shaped surface should offer the same `ExportMenu` rather than inventing a
one-off "download CSV" button — that is the whole point of a shared module.
