# App logo customization

Settings → **App name & logo** lets you pick a shipped colour variant of the app's mark, or
upload your own image to use instead. This document covers behaviour, configuration, failure
modes, security considerations and verification.

## Presets

Four shipped variants (`renderer/components/appearance/BrandMark.tsx` → `APP_LOGO_PRESETS`), all
recolours of the same shape rather than unrelated artwork, so every preset still reads as
"nodeterm" at a glance: **Default (purple)** — the shipped mark — plus **Ocean**, **Ember**, and
**Monochrome**. Selecting one sets `settings.appLogo.selection` to its id; the shipped default is
`'shipped'`.

## Custom upload

**Upload custom image…** opens a native file picker (`accept="image/png,image/jpeg,image/gif,
image/webp,image/bmp"`). Everything after that runs **entirely on your machine**:

1. **Size bound**: rejected above 12 MB before anything else happens.
2. **Byte-level format sniff** (`renderer/lib/appearance/imageSniff.ts`) — the file's actual
   magic bytes are read (PNG signature, GIF87a/89a header, JPEG SOI marker, WebP RIFF/WEBP
   chunks, BMP header), **never** its extension or the browser's MIME guess. An SVG is detected
   the same way (it starts with `<?xml`/`<svg`) and is explicitly **rejected** — SVG is XML that
   can carry embedded scripts, and this feature has no need to accept an executable format for a
   static logo.
3. **Animation rejection** — the sniff also looks for each format's own animation marker (GIF's
   image-descriptor count, WebP's `ANIM` chunk, PNG's `acTL` chunk for APNG) and rejects anything
   animated. A logo is a single static mark.
4. **Declared-dimension bound** — the format's own header dimensions (where the format makes that
   cheap to read without a full decode) are checked against a 6000px-per-side / 30-million-pixel
   ceiling **before** any decode is attempted — the point of checking this first is refusing a
   decompression-bomb-shaped file without ever inflating it.
5. **Decode** via `createImageBitmap`, with the *decoded* bitmap's real dimensions checked again
   against the same bounds (a header can lie about content; only the decoder's own answer is
   trusted for what's about to be drawn).
6. **Composite** into a fixed 512×512 canvas (`renderer/lib/appearance/logoProcess.ts` →
   `compositeToDataUrl`), applying the crop, fit and background chosen in step 7, and exported as
   a PNG data URL. **This processed PNG — never the original file — is what gets persisted.**

Any rejection at any of these steps reports its exact reason (too large, wrong format, animated,
dimensions too large, couldn't decode) and leaves the **previously active logo unchanged** — a
failed upload never partially applies.

## Real rendering choices

After a successful upload, an adjustment panel appears:

- **Fit**: Contain (the whole image visible, background shows around it), Cover (fills the frame,
  cropping overflow), or Fill (stretches to the frame, ignoring aspect ratio).
- **Background**: the infinite colour picker (see [`docs/colour-picker.md`](./colour-picker.md)),
  including full alpha control — so a transparent PNG can be composited over a solid colour, kept
  transparent, or anything in between. This is the "transparent or selected background treatment"
  the source image's own transparency needs when flattened onto a non-transparent preview
  surface.
- **Crop**: four percentage fields (x/y/width/height, 0–100%, relative to the *source* image) —
  the keyboard-accessible numeric equivalent of a drag-crop handle. Each field is a plain
  `<input type="number">` with a stepper and full keyboard support; there is no pointer-only path
  to the same result.

Every adjustment re-runs the full validate → decode → composite pipeline against the originally
selected file (kept only in the settings page's local component state — never persisted itself)
and updates the live preview immediately.

## What changes, and what doesn't

Selecting a custom image changes **only** what the tab bar's brand mark renders
(`data:image/png;base64,…` via a plain `<img>`). It does **not**, and — short of a full rebuild
and re-package of the app — **cannot**:

- Change the packaged application icon (macOS `.icns`, Windows `.ico`, the taskbar/dock icon, the
  installer's own icon). Those are generated from `build/icon.png` at **package time**
  (`scripts/make-icon.mjs`) and baked into the installer; nothing at runtime can rewrite an
  already-installed app's icon. This is stated in the settings UI itself, not left implicit.
- Rewrite the package identity, application ID, executable filename, installer identity, update
  feed, data directory, or signing state — exactly the same non-negotiable boundary the app-rename
  feature draws (see [`docs/app-rename.md`](./app-rename.md)): a custom logo is presentation, full
  stop.

## Configuration

`Settings.appLogo: { selection: string; customImage?: AppLogoCustomImage }`. `selection` is
either `'shipped'`, one of the other preset ids, or `'custom'`. `customImage` (present once a
custom upload has succeeded) carries the processed PNG data URL, its output dimensions, the
original filename (label only — never re-read from disk), the chosen fit, background colour and
crop rectangle. Choosing `'custom'` with no `customImage` present is refused by the UI (the
custom-logo radio button is disabled until an upload succeeds).

## Failure modes

| Situation | Result |
| --- | --- |
| File over 12 MB | Rejected, explains the size and the limit, prior logo unchanged |
| Extension says image, bytes don't match any supported format | Rejected, explains bytes ≠ filename |
| `.svg` file | Rejected, explains why (embedded-script risk) and suggests exporting a raster format |
| Animated GIF/APNG/WebP | Rejected, explains a logo must be static |
| Declared or decoded dimensions too large | Rejected before/after decode respectively |
| Decoder throws on genuinely malformed bytes | Rejected, generic decode-failure message |
| No 2D canvas context available | Rejected, generic composite-failure message |

## Security & privacy

No network request is made anywhere in this feature. The source file is read via the browser's
own `File`/`FileReader`/`createImageBitmap` APIs from the picker the OS/browser already sandboxes;
nothing is uploaded, no CDN or remote conversion service is involved, and the processed result is
written only to `settings.json` on disk (the same file every other local setting lives in) — never
to telemetry, logs, exports, or a screenshot.

## Verification

- `npx tsc --noEmit` passes for both TypeScript projects.
- Manual checks performed: uploaded a valid PNG (accepted, previewed, applied to the brand mark);
  renamed a `.txt` file to `.png` and attempted to upload it (rejected on the byte sniff, exact
  message shown); uploaded an animated GIF (rejected, exact message shown); adjusted fit,
  background and crop on a valid upload and confirmed the brand mark updates live; reset back to
  a shipped preset and confirmed the custom image (and its disabled-until-present radio state)
  survived a reload for later re-selection.
