# Photo, Video, and Gallery nodes

Photo and Video nodes put a local media file on the canvas. Gallery is an ordered collection that
can contain both kinds and keeps a visible missing-asset state when a portable copy is unavailable.
The nodes use the same drag, resize, colour, grouping, deletion, and persistence machinery as other
canvas nodes.

## Behaviour

Use **Open file** for one file, or **New media gallery** for an empty collection. Photo and Video
selection is determined by the file's extension only for routing; the media protocol allowlist
still validates the path before it is served. Video uses the browser's native controls for play,
pause, seeking, volume, and fullscreen. Gallery shows the active asset, an ordered thumbnail rail,
the collection count, and a bounded status message while an asset is loading or missing.

The catalogue is registered in `src/shared/media-catalog.ts`. It names supported Photo, Video, and
mixed Gallery entries and provides byte-signature validation for PNG, JPEG, GIF, WebP, BMP, MP4,
WebM, Ogg, and Matroska inputs. Signature validation is bounded and never trusts an extension or a
browser MIME claim.

## Portable references and missing assets

Project data stores a content reference (`assetId`, portable relative path, MIME, byte count,
SHA-256, and optional dimensions or duration), not an absolute machine path. A transient
`sourcePath` or single-file `filePath` may help resolve an asset on the current computer. Shared
serialization strips those paths and stores them in the machine-local workspace index, keyed by
node and content address, so a local restart does not lose the binding and a cloned project never
inherits another computer's path.

Schema 3 stores the ordered node references and active Gallery selection. Included bytes are written
under `assets/media/<sha256>.<extension>` and listed in both the media manifest and the outer archive
manifest. Export reads the selected file again and proves its byte count, signature, and SHA-256
before publication. Import validates the complete archive first, stages media below the new project
root, then atomically publishes the destination. A reference without a matching byte carrier is
retained with `missing: true`; it never resolves merely because a plausible filename exists.

## Accessibility and appearance

Every node has an accessible title, labelled media region, keyboard-reachable close control, native
video controls where applicable, and a non-colour loading or missing message. The media surface is
bounded and uses `object-fit: contain`, so portrait images and wide videos do not clip. Copy is
compatible with the app's English, playful Hong Kong-style Cantonese, and bilingual language modes;
media names, MIME values, counts, and metadata remain factual.

## Failure modes and security

Empty, malformed, unsupported, missing, or disallowed files remain untouched and render an honest
state. The `nt-media://` protocol allowlists local paths and remote SSH media is resolved through the
existing host cache path. Media references are content-addressed and portable; credentials, host
details, and absolute paths do not enter shared project data or exports. The shared resolver requires
caller-supplied byte-count and SHA-256 evidence before returning a cache or bundled path. A missing
file and a same-named file with different bytes remain distinct failure states.

## Verification state

The serialization and durable-byte boundaries are implemented in source on issue #20's lane. Tests,
type checking, lint, reviews, security and accessibility checks, builds, packaging, installer
execution, runtime interaction, and captures were intentionally not run. Those verdicts and the
release remain pending in the coordinating integration lane.

## Suggested articles

- [Canvas node kinds](./node-kinds.md)
- [Portable project saves](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
- [File converter](../file-converter.md)
