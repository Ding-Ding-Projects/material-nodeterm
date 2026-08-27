# Universal file converter

A local, offline file-conversion surface reachable from the navigation rail's Tools destination or
the command palette (`Ctrl+Shift+F` → *File converter*). It runs
identically on Desktop (Electron) and the Server Edition (browser) — the whole engine lives in
`src/core/converter/*`, registered once via `registerConverterIpc()` and consumed by both shells
(`src/main/index.ts`, `src/server/handlers/index.ts`).

## Architecture

```
src/shared/converter.ts        pure types + the declarative CONVERTER_CATALOG (every format,
                                bundled and disabled) + the ConverterApi shape
src/core/converter/
  detect.ts                    bounded byte-signature + content sniffing (never reads more than
                                CONVERTER_SNIFF_BYTES = 64 KiB of a file)
  structured-codec.ts          hand-rolled JSON/YAML/TOML/XML/CSV/TSV parse+serialize
  text-codec.ts                line-ending + text-encoding + Markdown→HTML adapters
  binary-codec.ts              base64/hex encode-decode + gzip/brotli (Node's own zlib)
  registry.ts                  adapter id → real implementation; assertRegistryMatchesCatalog()
                                fails loudly at boot if the catalog and the registry ever drift
  fs-scan.ts                   paged, constant-memory directory walk for "Add folder…"
  store.ts / atomic-json-store.ts   crash-recoverable queue persistence (atomic write + rename)
  service.ts                   the queue engine: detect, preflight, add, start/pause/cancel/retry,
                                bounded-concurrency runner, atomic writes, pre-write validation
  register-ipc.ts              the converter:* RPC surface, shared by both shells
src/renderer/components/converter/
  AdapterCatalog.tsx           categorized, searchable catalog picker
  FileConverterPanel.tsx       the whole user-facing panel
```

## Session routing and shipped surfaces

The converter drawer is mounted above the canvas' project-keyed `SessionProvider`, so it resolves
the API from the **active project binding** rather than reading the viewer's global preload. That
machine boundary applies to every operation: catalog/state reads, file selection and upload,
preflight, queue mutation, cancellation and retry.

- **Desktop:** the active local project uses the Electron-hosted converter service.
- **Server Edition:** the browser uses the same converter service in the server process. Browser
  files are staged on that server through the authenticated HTTP upload route described below.
- **Relay project:** converter RPC is not routed to the host in this release. The active relay API
  returns `E_UNSUPPORTED`, and the drawer shows that refusal. It never falls back to converting
  files on the viewing computer.
- **Mobile companion:** not applicable. *nodeterm mobile* is a separate app and has no converter
  management panel; this change does not alter its transport protocol.

## The bundled rule

Every row in `CONVERTER_CATALOG` declares `bundled` and `available` explicitly. A row is
`bundled: true` **only** when `src/core/converter/registry.ts` has a real, offline, zero-new-
dependency implementation for it — no PATH discovery, no developer-machine tool, no network call,
no optional dependency that might not be installed. `assertRegistryMatchesCatalog()` runs once at
boot and throws if the catalog and the registry ever disagree, so a mismatch is a loud startup
failure rather than a button that silently does nothing.

Everything else is listed **disabled**, with the exact missing dependency named in
`unavailableReason` — the catalog never hides a format it can't yet convert. For this pass, the
genuinely bundled adapters are the ones expressible in pure JS/Node with zero new dependencies:

- **Structured Data / Spreadsheets** — the full mesh among JSON, YAML, TOML, XML, CSV and TSV (30
  directed pairs), through hand-rolled parsers/serializers in `structured-codec.ts`. These are
  deliberately a **subset** of each format's real spec, not full parsers:
  - **YAML**: block style only (no anchors/aliases/tags/multi-document streams); simple flow
    collections (`[a, b]`, `{a: 1}`) with one level of nesting.
  - **TOML**: flat/nested tables (`[section]`, `[section.sub]`) and array-of-tables (`[[section]]`);
    **no `null`** (TOML has none — dropped on write, flagged lossy).
  - **XML**: this app's **own convention** (object keys → child elements, arrays repeat the element
    name, primitives → text content) — not a general-purpose XML/schema reader. No attributes, no
    namespaces, no mixed content, no comments preserved.
  - **CSV/TSV**: only a flat array of objects; nested values are JSON-stringified into the cell,
    and reading coerces `true`/`false`/integers/decimals for a friendlier JSON round trip.
- **Code / Text** — line-ending normalization (LF/CRLF), text-encoding re-encoding (UTF-8 ⇄
  UTF-16LE ⇄ Latin-1), and Markdown → HTML via the already-bundled `marked` package (run in Node,
  no DOM — the output is a plain HTML file, not something rendered live, so it is not run through
  DOMPurify; raw HTML embedded in the Markdown source passes through unsanitized into the file,
  which is disclosed as a lossy note).
- **Binary Encodings** — any file ⇄ Base64 text, any file ⇄ hex text (plain `Buffer` encodings).
- **Archives** — any file ⇄ `.gz` and any file ⇄ `.br`, via Node's built-in `zlib`. Full ZIP/TAR/
  7-Zip container support is **listed, disabled** (`requires a ZIP container library…`, etc.) —
  none of those are bundled in this pass.

**Documents/PDF, Images, Audio and Video have no bundled adapters at all** — every row in those
categories is listed disabled with its exact missing dependency (e.g. `pdf-to-text` needs
`pdf-parse`, `png-to-jpeg` needs an image codec such as `sharp`, `mp3-to-wav` needs `ffmpeg`).
Adding real support for any of these is a good next-pass target — see "Known gaps" below.

## Detection

`converter.detect(path)` reads at most `CONVERTER_SNIFF_BYTES` (64 KiB) from the head of the file
and classifies it via `src/core/converter/detect.ts`: binary magic-byte signatures first (PDF,
PNG, JPEG, GIF, ZIP, gzip, MP3/WAV/FLAC/Ogg, MP4/MOV/MKV, 7-Zip, …), then a "looks binary" NUL-byte
heuristic, then content heuristics for the text-based formats (JSON parse attempt, XML/HTML tag
sniff, Markdown heading heuristic, YAML/TOML/CSV/TSV line-shape heuristics). The result names a
confidence (`high`/`medium`/`low`) and the exact reason, and lists every catalog adapter (bundled
**and** disabled) whose source kind matches — the catalog UI highlights these as "detected", but
every bundled adapter stays selectable regardless: a mismatched pick simply fails at conversion
time with the parser's own clear error message (e.g. "Invalid JSON: …"), never silently produces
wrong output.

## Lossy disclosure

Before a lossy conversion runs, the panel shows the adapter's `lossyNotes` (e.g. "Only a flat array
of objects survives the round trip through a spreadsheet shape") and requires an explicit
**"I understand — convert anyway"** checkbox. Files added without acknowledging it land in the
queue as `needs-confirm` (reason `lossy`) rather than running; resolving that reason (per item, via
`converter.resolvePending`) is what allows the queue runner to pick it up.

## Collision-safe names and overwrite protection

When a file enters the queue, the service reserves the first unused name in the familiar sequence
`name.ext`, `name (2).ext`, `name (3).ext`, and so on. It checks both the destination directory and
every current queue reservation. The second reservation check after the asynchronous filesystem
probe prevents two simultaneous add requests from selecting the same absent path. The chosen suffix
is shown on the queue item, so avoiding a collision never looks like a mysterious rename.

The queue runner re-checks immediately before writing because another program can still create the
reserved path after admission. An unapproved conversion publishes its completed, same-directory
temporary file with an atomic no-clobber hard link. Exactly one of two racing writers can claim an
absent name; the other receives `EEXIST` and returns to `needs-confirm`. A filesystem that cannot
provide that primitive fails closed. Only `item.overwriteAllowed === true`, set by an explicit
`resolvePending(id, { overwrite: true })`, permits replacement through `renameAtomic`.

## Resource bounds

- Every adapter declares `maxInputBytes`; a source over that limit is refused up front with an
  exact byte-count message, never partially read.
- The runner reads a whole file into memory per item (bounded by that limit), converts, then
  **validates the output before writing it** — every bundled adapter's `validate()` round-trips the
  produced bytes back through the target format's own parser (or, for gzip/brotli, decompresses
  them) before the write is allowed to happen. A validation failure aborts the item as `failed`
  and the destination is never touched.
- Writes use a **unique same-directory temporary name** from `tempNameFor`; a PID and timestamp alone
  are not unique when concurrent workers share a clock or PID namespace. Each candidate is claimed
  with an exclusive `wx` open and written through that exact file handle, so a stale collision or
  pre-created symlink is never followed, truncated, or later removed as if this run owned it. A
  completed temporary file is published with the no-clobber link above, or with `renameAtomic`
  after explicit overwrite approval. Failure and cancellation await cleanup of that writer's own
  temporary file. If the no-clobber publish succeeds but removing its second hard-link name fails,
  the item truthfully remains `done` and carries a visible cleanup warning rather than inviting a
  duplicate retry.
- Bounded concurrency (`CONVERTER_DEFAULT_CONCURRENCY = 2`, configurable 1–`CONVERTER_MAX_CONCURRENCY
  = 6`): only that many items are ever being read+converted+written at once, so peak memory for file
  bytes is bounded regardless of how many items are queued.
- **"Add folder…"** never builds one giant in-memory path list. `fs-scan.ts`'s `walkFiles()` is an
  async generator (stack-based DFS, one directory listing at a time); `service.addFolder()` drains
  it in pages of 200 and persists each page's matching files to the queue incrementally, so a very
  large tree is scanned with roughly constant memory rather than materializing every path first.
  Common junk directories (`node_modules`, `.git`, `dist`, …) are skipped by default.
- The queue itself has **no artificial file-count cap**.
- **Cancellation** is checked at each of the three conversion stages (before read, before convert,
  before write) plus continuously during a folder scan (`AbortController`), so a cancel request is
  honored promptly without needing true mid-syscall interruption.
- **Crash recovery**: the queue snapshot is written atomically (`AtomicJsonArrayStore`, temp file +
  rename) to `<userData>/converter/queue.json` after every mutation. On boot, any item still marked
  `running` (the app died mid-conversion) is put back to `queued` rather than lost. A corrupt
  snapshot file is quarantined as `queue.json.corrupt-<timestamp>` and the queue starts empty
  instead of crashing app boot.
- **Destination preflight** (`converter.preflight(destDir)`) reports whether the folder exists, is
  writable, its free disk space (best-effort via `fs.statfsSync` — `null`, never zero, when the
  platform/Node build doesn't support it), and the estimated bytes still needed by everything
  pending in the queue.
- **Server Edition browser uploads do not ride the RPC WebSocket.** The browser passes the selected
  `File` directly to the authenticated, same-origin `POST /upload` route as a Blob body; it does not
  create an ArrayBuffer, base64 string, decoded binary string, or second byte array first. The route
  streams those bytes into the managed staging directory and publishes the completed file
  atomically. The browser checks `File.size` against the shared 64 MiB ceiling before fetch;
  `Content-Length` is only an early server refusal, and streamed/chunked bodies are counted again as
  they arrive. An oversized upload gets a visible `413` refusal and no partial file is published.
  The RPC socket deliberately remains capped at 8 MiB, so a 7 MiB file no longer expands into an
  over-limit base64 RPC frame or disconnects the rest of the UI. The optional Blob carrier exists
  only on the Server Edition API; desktop and relay APIs retain the legacy base64/RPC method.

## Batch results

Every add reports `{ added, rejected }` with the exact reason per rejected path (adapter
unavailable, file missing, over the size limit, not a regular file). Every queue item's terminal
state is one of `done | failed | cancelled | skipped`, each shown distinctly in the panel — a
partially-successful batch is never presented as a uniform success or a uniform failure.

## Completed-output handoff

Every completed queue row offers **Open in Visual Studio Code**. The action uses the active
project's API rather than the viewer-global bridge, so switching projects cannot send a stale path
to the wrong machine. The desktop shell opens the output on the local computer. Server Edition asks
the server process to open the path there. Relay sessions retain their explicit unsupported result
until converter and editor routing are carried over the relay together. If Visual Studio Code is not
installed or cannot open the path, the existing detector's exact result is shown as a non-blocking
error notification. Desktop rows also retain **Reveal** for the operating system file manager.

## Portable project boundary

The converter is a global tool, not a canvas node. Its source paths, destinations, queue status,
progress, errors, temporary names, and editor-launch results are machine-local runtime state stored
under `<userData>/converter/queue.json`. None of those fields enter the schema 3 project projection,
and importing a project performs no file detection, conversion, folder creation, process launch, or
editor launch. Because no node is created, there is no converter node identity, layout, relationship,
or creation-event id to serialize. The omission is deliberate and keeps project import side-effect
free while the same project can use a different local queue on each computer.

## Known gaps (deliberately out of scope this pass)

- **No document/image/audio/video adapters are bundled.** Every row in those four categories is
  listed disabled. Adding real ones (e.g. `pdf-parse` for PDF text extraction, `sharp` for images,
  `ffmpeg`/`fluent-ffmpeg` for audio/video) is real, valuable follow-up work — but each is a new
  native or sizeable dependency and was out of scope for this pass's "no new dependency" bundled
  rule.
- **No ZIP/TAR/7-Zip container support**, bundled or otherwise — listed disabled with their exact
  missing library.
- **The overwrite/lossy confirmation is the app's existing inline `ConfirmDialog`-style flow**
  (a message + explicit acknowledgement), not the full two-key, slider-gated destructive-action
  super-confirmation used elsewhere in the codebase for irreversible actions. Overwriting a file is
  reversible relative to those (the source is never touched), but a stricter gate would still be a
  reasonable follow-up.
- **The queue list in the panel shows only the first page** (up to 500 items) — the engine itself
  is already paginated (`converter.state(offset, limit)`); a pager control in the UI is a follow-up.
- **Server Edition browser staging is capped at 64 MiB**, even where a desktop adapter declares a
  larger `maxInputBytes`. Files above that shared upload bound are refused visibly; widening the
  browser path requires a separate resource/memory decision rather than weakening either guard.
- **Relay (remote-desktop) tabs do not route the converter to the host.** The visible
  `E_UNSUPPORTED` refusal is intentional until that core namespace is carried over the relay.
