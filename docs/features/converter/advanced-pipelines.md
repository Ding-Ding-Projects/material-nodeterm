# Advanced media, archive, PDF, OCR, and structured-data pipelines

## Behaviour

The existing File converter now runs advanced work through the same persistent, bounded queue.
Bundled operations include PDF text extraction, page and metadata inspection, split-to-ZIP,
merge-from-ZIP, first-page extraction, reverse ordering, clockwise page rotation, metadata removal,
image conversion among PNG, JPEG, WebP, SVG, GIF, and BMP where the
packaged codec supports the source, English image OCR, ZIP entry inventory, deterministic JSON key
ordering, and the existing full structured-data conversion mesh.

Audio, video, TAR, 7-Zip, DOCX, HEIC, and ICO operations remain visible but disabled when a verified
packaged adapter is unavailable. The interface never discovers an executable on `PATH` to turn a
disabled row on.

## Guided controls and progress

Files use the semantic file picker and destinations use the folder picker. Detection shows the
byte-inspected kind and confidence. Each category has its own plain-text search plus adjacent
anchored regex builder. Disabled rows state the missing capability. Lossy operations require an
explicit acknowledgement before the queue can run them.

The queue reports per-file progress and independent queued, running, attention, completed, failed,
and cancelled totals. It supports bounded parallelism, pause, cancellation, retry, partial batch
results, restart reconciliation, destination-capacity preflight, and atomic validated output.
Informational outcomes use the existing non-blocking notification path. Existing overwrite approval
remains the destructive decision boundary.

## Resource bounds and failure modes

- Image decoding is capped at 40 million pixels, one frame, and the adapter byte limit.
- PDF work is capped at 500 pages and the adapter byte limit. Output PDFs are reopened before use.
- ZIP inventory is capped at 2,048 entries, 4 KiB per entry name, and 512 MiB of declared expanded
  data. Traversal and absolute entry names are refused. Inventory never extracts or executes an
  entry.
- Every advanced adapter also caps produced bytes at 512 MiB before publication. Oversized output
  is reported as a failed queue item, leaving the destination untouched.
- OCR uses the packaged English training data through a local path. It does not fetch language data
  from a network service. The reported confidence is a review warning, never a correctness claim.
- Structured data is capped at 64 MiB and the existing parsers retain their documented format
  subsets. Canonical JSON sorts keys recursively without changing array order.

A malformed, encrypted, unsupported, over-limit, or non-reopenable result fails that queue item and
does not publish a partial destination. Cancellation requested during a non-interruptible codec call
is applied before validation or publication.

## Portability and privacy

`portableAdvancedPipelineIntent()` projects only schema version, adapter id, family, operation,
source and target kinds, and resource profile. It always imports unbound. On another computer the
available actions are Configure, Rebind, Adopt, Deploy, Locate Asset, and Leave Unbound.

The portable intent omits source and destination paths, credentials, provider sessions, process and
host identifiers, machine identity, runtime caches, and generated output. Import performs no file
read, conversion, extraction, deployment, process start, or network request. The user must bind a
local source and destination and deliberately start the queue.

## Surfaces

- **Windows desktop:** full local picker, queue, and packaged adapters.
- **Server Edition:** the same core queue on the server host, with the existing bounded browser
  upload ceiling. Operations run on that host, not the viewing computer.
- **Relay project:** visibly unavailable until the converter namespace is routed to the host.
- **Mobile companion:** portable intent may be displayed as unbound, but there is no conversion
  management surface.

## Verification boundary

This ultra-speed implementation lane intentionally did not run tests, type checks, lint, builds,
packaging, installer execution, runtime interaction, reviews, security or accessibility audits, or
UI captures. Source presence and a pushed commit are not runtime evidence.

## Suggested articles

- [Universal file converter reference](../../file-converter.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Portable bindings](../projects/portable-bindings.md)
- [Portable media assets](../projects/portable-media-assets.md)
