# Terminal sharpness under pan and zoom

A terminal node paints through a **fixed-resolution raster**: xterm's WebGL renderer owns a
`<canvas>` whose backing store is sized in device pixels, and nothing in it knows about the canvas
camera. The node then lives inside React Flow's viewport, whose
`transform: translate(x, y) scale(z)` decides where and how big it actually lands. So there are two
independent ways a raster built to be pixel-exact ends up resampled, and both read to a user as
"the text is a bit blurry".

## The two causes

**PHASE.** Even at zoom 1, `translate(x, y)` carries arbitrary fractions of a CSS pixel, and a
fractional CSS offset is a fractional *device* offset unless it happens to land on the device grid.
A raster whose origin sits at 9.555 device px is smeared across two device columns for its whole
width.

**SCALE.** At canvas zoom `z` the raster is displayed at `dpr × z` device px per CSS px while it was
rasterized at `dpr`. Every zoom other than exactly 1 resamples.

Measured on Windows 11 at 150% scaling (dpr 1.5), Electron 42 with the repo's own xterm 5.5 and
addon-webgl 0.18, 13px Consolas, identical text. The metric is the share of ink pixels that are
fully on — higher is crisper:

| configuration                              | fully-on ink |        |
| ------------------------------------------ | ------------ | ------ |
| aligned origin, zoom 1 (the reference)     | 0.552        |        |
| fractional origin (translate .37px/.61px)  | 0.335        | −39%   |
| zoom 0.83                                  | 0.311        | −44%   |

Two things follow that are worth stating plainly, because both are counter-intuitive:

- **At "default zoom" the phase term alone costs about as much crispness as zooming out by a
  fifth.** That is the shape of the blurry-text report.
- **The renderer is not the cause.** The DOM renderer measured 0.566 against WebGL's 0.552 when both
  were aligned, so switching renderers does not fix this. The transform does.

**Why Windows and not a Mac.** Both terms are ratios against the device grid, and mac dprs are
integers, so a whole-CSS-pixel translate is automatically a whole-device-pixel translate. At dpr
1.25 a CSS offset must be a multiple of 0.8 to be device-aligned, and at dpr 1.5 a multiple of ⅔ —
which an arbitrary pan never is. Windows at 125% / 150% is the delivery platform's normal state.

## What the app does about each

The arithmetic for both lives in `src/renderer/terminal/device-pixel-fit.ts`, deliberately as pure
functions with no DOM, `window` or xterm in them, so the rules are pinned by unit tests on the exact
dprs users have rather than by a screenshot nobody can reproduce.

### Phase: the viewport is snapped at rest

The canvas nudges its own viewport translate onto the device grid when a pan or zoom **ends**
(`devicePixelSnapOffset`, applied in `Canvas.tsx`'s `onMoveEnd`). Snapping per-frame would mean
fighting d3-zoom mid-drag, which stutters; a rest-time nudge of at most half a device pixel is
imperceptible as motion and restores crispness exactly when someone can look.

The shared glyphgrid renderer is immune to this term already — its canvas is a sibling of the
viewport rather than a child of it, and it snaps its own camera.

### Scale: the raster follows the camera

`raster-scale.ts` shadows the one number every xterm renderer reads — `ICoreBrowserService.dpr` —
with `dpr × n`, and drives xterm's existing dpr-change path so the glyph atlas is rebuilt at that
density. The CSS box is unchanged, because the same code divides straight back out: this is
supersampling, not a resize.

**This only ever acts when you are zoomed IN.** `safeRasterScale` answers the plain display dpr for
every zoom at or below 1, so zooming out re-rasterizes nothing. That is deliberate — a terminal that
dropped its raster on zoom-out would have to rebuild it during the zoom-in, the exact moment the
user is looking at it. **The −44% measured at zoom 0.83 above is therefore not addressed by this**;
it is minification, and it is left to the compositor's own filtering.

At dpr 2 the fix is inert at every zoom, for a reason given below.

## The one dangerous thing, and the two guards on it

Raising the reported dpr is safe for layout *except* for one detail: the renderer floors the
character width onto the device grid, and `addon-fit` derives the **column count** from the CSS cell
width that flooring produces. A scale that shifts the cell by a fraction of a pixel shifts `cols`,
and a column change is a `terminal.resize()` — a SIGWINCH into the user's tmux session, on every
zoom step. Re-rasterizing on zoom is cosmetic; reflowing somebody's running session is a defect.

Worked example at dpr 1.5. A cell of 8.6667 px, asked to rasterize at the quarter-step scale 1.75,
comes back as `floor(8.6667 × 1.75)/1.75 = 8.5714` — 1.1% narrower, which turns an 800 px terminal
from 92 columns into 93.

Two things prevent it, and both are required:

1. **`safeRasterScale` only ever returns whole multiples of the display dpr**, for which the floor
   provably loses nothing: `floor(w × d)/d × n × d = n × floor(w × d)` is an integer. This is also
   why the memory ceiling is applied as a multiple rather than a `Math.min` — clamping dpr 2 to 3
   would produce a non-multiple and move the cell. Since the next multiple at dpr 2 is 4, past the
   ceiling, the scale fix does nothing at all on an integer-dpr display.
2. **A runtime re-check before every change.** The proof in (1) assumes the measurement already sits
   on the display grid, which is `quantizeCharSize`'s doing — and that helper is deliberately
   fail-open, so a future xterm could leave a raw fractional width in place. `cellWidthIsStable` is
   re-evaluated against the terminal's live measured width and the change is refused if it does not
   hold. A soft terminal is a cosmetic loss; a reflowed session is somebody's work.

The same reasoning is why `quantizeCharSize` keeps quantizing on the **display** grid while the
renderers are told a denser one. Quantizing onto the raster grid would move the cell width — which
is the reflow this design exists to avoid.

## Cost

- **Zooming out, and panning, cost nothing.** The scale only changes as zoom crosses 1, so a whole
  zoom-in gesture to React Flow's `maxZoom` of 2 crosses at most one change.
- The per-frame path during a pan is one inline-style read and one `parseFloat` for the whole
  canvas — not per terminal — returning immediately while the scale is unchanged.
- A real change is applied on a trailing debounce (`RASTER_APPLY_SETTLE_MS`), so a gesture
  re-rasterizes at rest rather than mid-flight. Nobody judges sharpness mid-pinch.
- No WebGL context is ever acquired or released by this. `webgl-budget.ts` still owns every grant;
  an atlas rebuild happens inside the context the terminal already holds.
- A denser atlas costs memory as the square of the scale, which is why the ceiling exists. Atlases
  are shared between terminals with matching dimensions, so a canvas full of identical terminals
  pays for one.

## Which surfaces this applies to

| surface                                  | behaviour                                                     |
| ---------------------------------------- | ------------------------------------------------------------- |
| Terminal node on the canvas (`webgl`)    | Full: phase snapped at rest, raster follows zoom.              |
| Terminal node, `dom` renderer            | Phase only. DOM glyphs are real text, which the browser already rasterizes at the composited scale. |
| Terminal node, `shared` glyphgrid        | Phase is handled by the shared camera's own snapping. The raster scale is deliberately **not** applied — the glyph layer sizes its atlas from the same `device` cell, and inflating one side of that pairing is the stretched-slot mismatch it warns about. |
| Card-modal terminal, settings preview    | Unchanged. Neither sits under a canvas transform, so both resolve to zoom 1. |
| Focused node                             | Unchanged while it is reparented out of the viewport.          |
| Server Edition                           | Same renderer, same behaviour — this is all renderer-side.     |
| Mobile companion                         | Not applicable: no canvas, no camera.                          |

## Reading it in the code

- `terminal/device-pixel-fit.ts` — the pure rules and the measurements, including
  `terminalRasterScale` (the unconstrained ideal), `safeRasterScale` (what the wiring may apply),
  and `cellWidthIsStable` (the reflow predicate).
- `terminal/raster-scale.ts` — the wiring: the shadowed dpr, the viewport observer, the debounce.
- `terminal/char-size-quantize.ts` — the cell-grid quantization the proof depends on, and the one
  call site that installs both.
- `canvas/Canvas.tsx` `onMoveEnd` — the phase snap.
