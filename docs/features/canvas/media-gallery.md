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
`sourcePath` may help resolve a local asset while the node is open, but serialization strips it.
References with an invalid path, digest, or byte budget are rejected. An omitted or unavailable
asset remains represented as `missing` and offers a locate/restore route in the owning flow rather
than silently deleting the node.

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
details, and absolute paths do not enter shared project data or exports.

## Verification state

The implementation is present in the source tree on issue #20's lane. Tests, builds, packaged
interaction, and real captures are intentionally pending for the parent integration lane.

## Suggested articles

- [Canvas node kinds](./node-kinds.md)
- [Portable project saves](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
- [File converter](../file-converter.md)
