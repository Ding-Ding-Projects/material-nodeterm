# Universal file converter

A local, offline file-conversion surface reachable from the converter icon in the canvas'
controls cluster, the command palette ("File converter"), or `⌘K` → *File converter*. It runs
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

## Overwrite protection

A destination path that already exists is never silently overwritten. The item is queued as
`needs-confirm` (reason `overwrite`); the queue runner **re-checks again immediately before the
write**, even for an item that was previously cleared, because the destination could have appeared
in between (another queued item, another process). Only `item.overwriteAllowed === true` — set by
an explicit `resolvePending(id, { overwrite: true })` — permits the write.

## Resource bounds

- Every adapter declares `maxInputBytes`; a source over that limit is refused up front with an
  exact byte-count message, never partially read.
- The runner reads a whole file into memory per item (bounded by that limit), converts, then
  **validates the output before writing it** — every bundled adapter's `validate()` round-trips the
  produced bytes back through the target format's own parser (or, for gzip/brotli, decompresses
  them) before the write is allowed to happen. A validation failure aborts the item as `failed`
  and the destination is never touched.
- Writes are **atomic**: output goes to `<dest>.part-<pid>-<ts>` and is `rename()`d into place —
  a crash mid-write can never leave a half-written destination file.
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

## Batch results

Every add reports `{ added, rejected }` with the exact reason per rejected path (adapter
unavailable, file missing, over the size limit, not a regular file). Every queue item's terminal
state is one of `done | failed | cancelled | skipped`, each shown distinctly in the panel — a
partially-successful batch is never presented as a uniform success or a uniform failure.

## Known gaps (deliberately out of scope this pass)

- **No document/image/audio/video adapters are bundled.** Every row in those four categories is
  listed disabled. Adding real ones (e.g. `pdf-parse` for PDF text extraction, `sharp` for images,
  `ffmpeg`/`fluent-ffmpeg` for audio/video) is real, valuable follow-up work — but each is a new
  native or sizeable dependency and was out of scope for this pass's "no new dependency" bundled
  rule.
- **No ZIP/TAR/7-Zip container support**, bundled or otherwise — listed disabled with their exact
  missing library.
- **Per-category search is plain substring matching**, not the full anchored regex-builder popover
  described in the house UI contract. A future pass should give each category's search field (and
  every other search field in these two panels) a real regex-builder affordance.
- **The overwrite/lossy confirmation is the app's existing inline `ConfirmDialog`-style flow**
  (a message + explicit acknowledgement), not the full two-key, slider-gated destructive-action
  super-confirmation used elsewhere in the codebase for irreversible actions. Overwriting a file is
  reversible relative to those (the source is never touched), but a stricter gate would still be a
  reasonable follow-up.
- **The queue list in the panel shows only the first page** (up to 500 items) — the engine itself
  is already paginated (`converter.state(offset, limit)`); a pager control in the UI is a follow-up.
- **Browser (Server Edition) "Add files…" uploads through the shared `files.saveUpload` RPC**,
  which rides the same WebSocket frame as everything else and is capped by `WS_MAX_PAYLOAD` (8 MiB,
  `src/server/ws.ts`) — comfortably fine for the text-based formats this pass bundles, but well
  under the 64–170 MB per-adapter limits declared for the desktop path. A future pass could chunk
  large browser uploads instead of sending one RPC frame.
- **Relay (remote-desktop) tabs do not route the converter to the host.** `converter` stays
  `E_UNSUPPORTED` over a relay connection rather than silently running on the wrong machine — see
  `src/renderer/bridge/relay-api.ts`.
