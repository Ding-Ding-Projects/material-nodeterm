# Infinite colour picker

Every colour control in the app (the appearance editor's colour fields, the app-logo background
picker) opens the same picker: a continuous field, never a fixed swatch list. This document
covers behaviour, configuration, failure modes, security considerations and verification.

## Why "infinite"

A swatch-only picker can only ever offer the colours someone thought to include. This picker is
built on a continuous 2-D saturation/brightness field plus a hue slider — every reachable sRGB
colour is one drag away — with numeric entry as the precise alternative for anyone who already
knows the number they want. Swatches (a small quick-pick row, plus a session-only "recently
used" row) and an eyedropper sit on top of that as convenience, never as the only way in.

## Controls

- **2-D field**: drag anywhere, or Tab to it and use the arrow keys (Shift+arrow moves in 10%
  steps; Home/End jump saturation to its extremes). It has `role="slider"` with a live
  `aria-valuetext` announcing the current saturation/brightness.
- **Hue slider** and **alpha slider**: native `<input type="range">`, so they inherit full
  keyboard and screen-reader support for free. The alpha slider is painted over a checkerboard so
  translucency is visible while dragging.
- **Eyedropper**: shown only when the browser exposes the `EyeDropper` API (Chromium-based —
  which covers every surface this app ships on). Cancelling it (Escape) is treated as "no
  change", not an error.
- **Format tabs**: HEX, RGB, HSL, HSV, HWB, LAB, LCH, OKLab, OKLCH, CMYK. Switching tabs doesn't
  change the colour — it changes which numeric representation you're looking at and editing.
  Each tab's fields commit on blur or Enter; an invalid HEX entry is rejected with the last valid
  colour left showing (never silently coerced to something else, never blanked).
- **Persistence is browser CSS**: HSV and CMYK are editing/copy representations, not CSS colour
  syntaxes. When either tab changes a value, the picker emits the equivalent `rgb()`/`rgba()` for
  storage and live styling, preserving alpha. The controls stay in HSV/CMYK and **Copy** still
  copies that selected representation; only the value crossing into CSS is normalized.
- **Copy**: copies the *currently active tab's* formatted string through nodeterm's acknowledged
  clipboard bridge, with the browser clipboard as a fallback when that bridge is absent, reports
  failure, or rejects.
- **Named colour**: when the current colour exactly matches a CSS named colour (opaque only), its
  name is shown underneath the entry row.

## Clipboard routing and failure feedback

Clipboard access is app-global rather than project/core-bound: copying from a relay tab is meant to
write to the viewing computer's clipboard. The picker therefore tries nodeterm's active clipboard
bridge first (Electron on Desktop, the browser-aware bridge in Server Edition) and awaits its
truthful success boolean, then tries `navigator.clipboard` only as a fallback. A missing API,
synchronous throw, rejected promise, or explicit `false` is contained. If no route completes, the
button remains **Copy** and one failure toast is raised; the picker never shows a false **Copied**
receipt.

- **Desktop:** preload uses request/response IPC. Main returns `true` only after Electron's system
  clipboard write completes and converts an invalid input or host exception to `false`; a torn-down
  renderer IPC request is also caught and resolves `false`, because older copy callers deliberately
  ignore the safe Promise.
- **Server Edition:** the bridge uses the secure-context browser clipboard when available and its
  click-driven `execCommand` fallback on plain HTTP, awaiting both and returning their real result.
  The picker suppresses that bridge's failure toast while its final direct-browser route remains;
  only an exhausted copy reports an error, so a successful fallback cannot sit beside a stale red
  banner.
- **Mobile companion:** separate and unchanged. The picker in this React renderer is not the
  private mobile app's colour or clipboard implementation.

## Translation

`renderer/lib/color/convert.ts` is the pure conversion core (no DOM), covering, both directions:

- Named colours (the full CSS Color Module Level 4 extended keyword set)
- HEX / HEX8
- RGB(A)
- HSL(A)
- HSV/HSB
- HWB
- CIELAB / LCH (via sRGB → linear → XYZ (D65) → Lab)
- OKLab / OKLCH (Björn Ottosson's reference matrices)
- CMYK (the standard naive/device-independent formula every browser colour-picker/print-preview
  tool uses for an approximate on-screen readout — there is no ICC profile involved)

`parseAnyColor` accepts any of the above as free text (hex with or without `#`, `rgb()`/`rgba()`,
`hsl()`, `hsv()`/`hsb()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `cmyk()`, or a bare
named colour) and is what the picker, the appearance editor and the app-logo background field all
use to accept a pasted or typed value.

## Gamut and clipping

sRGB is the only gamut this app can actually **display** in, so it's the reference gamut for
clipping warnings. Lab, LCH, OKLab and OKLCH can all express colours outside sRGB (a saturated
teal in OKLCH, for instance, has no exact sRGB equivalent). Every conversion *from* one of those
spaces back to RGB (`labToRgbClamped`, `lchToRgbClamped`, `oklabToRgb`, `oklchToRgbClamped`)
reports `{ clipped: boolean }`; the picker shows a warning **before** the clipped value becomes
the active colour, naming exactly what happened ("outside sRGB … clipped to the nearest colour it
can actually show") rather than silently rounding.

## Contrast

The picker always shows the WCAG 2.x contrast ratio between the current colour (composited over
an opaque background, since translucency alone doesn't have a contrast ratio) and a reference
surface — the caller's `against` prop, defaulting to the app's own panel background
(`--panel`) — labelled AAA / AA / AA Large / Fail per the standard thresholds (7 / 4.5 / 3 / below
that). This is advisory, not enforced: the picker never refuses a low-contrast colour, it just
tells you.

## Security & privacy

Entirely local: no network request, no external colour-name service, no telemetry. Colour
conversion is synchronous; the clipboard write may complete asynchronously through the app or
browser API. The eyedropper is the browser's own OS-level picker (Chromium's `EyeDropper` API) —
this app never reads screen pixels itself. "Recently used" colours live in memory only for the
life of the renderer process (a module-level array); they are not persisted to disk or synced.

## Verification

- `npx tsc --noEmit` passes for both the node and web TypeScript projects.
- Round-tripped a set of colours (pure red/green/blue, mid-grey, a semi-transparent teal, an
  out-of-sRGB OKLCH value) through every format tab and confirmed the HEX readout matches at each
  step, and that the clipping warning appears exactly for the one value that needed it.
- Confirmed the 2-D field is fully operable by keyboard alone (Tab to focus, arrows to move,
  Enter/Space not required since it's a continuous drag surface) and that the contrast readout
  updates live as the colour changes.
- `ColorPicker.test.tsx` drives the real HSV and CMYK tab/channel DOM controls and hands each
  emitted alpha colour to a browser `CSSStyleDeclaration`; removing the RGBA boundary conversion
  makes both cases fail.
