/**
 * WHEN IS A TERMINAL'S RASTER 1:1 WITH THE SCREEN, AND WHAT SCALE WOULD MAKE IT SO.
 *
 * A terminal node paints through a FIXED-RESOLUTION raster: xterm's WebglAddon owns a `<canvas>`
 * whose backing store is `cols × device.cell.width` texels (`_updateDimensions`), and the DOM
 * renderer's glyphs are laid out against the same device cell. That raster is produced at
 * `devicePixelRatio` device px per CSS px, and NOTHING in it knows about the canvas camera. The
 * node then lives inside React Flow's `.react-flow__viewport`, whose
 * `transform: translate(x,y) scale(z)` decides where and how big it actually lands.
 *
 * So there are two independent ways the compositor ends up RESAMPLING a raster that was built to
 * be pixel-exact, and both are invisible in code review:
 *
 *   1. SCALE. At canvas zoom `z` the raster is displayed at `dpr × z` device px per CSS px while
 *      it was rasterized at `dpr`. Every zoom other than exactly 1 resamples.
 *   2. PHASE. Even at zoom 1, `translate(x, y)` carries arbitrary FRACTIONS of a CSS pixel, and a
 *      fractional CSS offset is a fractional DEVICE offset unless it happens to land on the
 *      device grid. A raster whose origin sits at 9.555 device px is bilinearly smeared across two
 *      device columns for its whole width.
 *
 * MEASURED, on Windows 11 at 150% scaling (dpr 1.5), Electron 42 + the repo's own xterm 5.5 /
 * addon-webgl 0.18 with `quantizeCharSize` applied, 13px Consolas, identical text, metric =
 * "share of ink pixels that are fully on" (the same metric `raster.ts`'s header quotes; higher is
 * crisper):
 *
 *      aligned origin, zoom 1                        0.552      <- the reference
 *      fractional origin (translate .37px/.61px)     0.335      -39%
 *      zoom 0.83                                     0.311      -44%
 *
 * i.e. at "default zoom" the PHASE term alone costs about as much crispness as zooming out by a
 * fifth. That is the shape of the "text is a bit blurry" report on Windows, and it is why this
 * module exists as a decision the wiring can be tested against rather than as arithmetic inlined
 * at a call site.
 *
 * WHY IT IS WORSE ON WINDOWS THAN ON A MAC. Both terms are ratios against the DEVICE grid, and
 * mac dprs are integers (1 or 2): a whole-CSS-pixel translate is automatically a whole-device-pixel
 * translate, so the phase term only appears at fractional CSS offsets. At dpr 1.25 a CSS offset
 * must be a multiple of 0.8 to be device-aligned, and at dpr 1.5 a multiple of 2/3 — which an
 * arbitrary pan never is. Windows is the delivery platform and 125% / 150% is its normal state.
 *
 * NOTHING HERE READS THE DOM, `window`, or xterm. It is the pure half of a fix whose wiring lives
 * in the components (the viewport transform, and whichever renderer is asked to rasterize), so
 * the rule can be pinned by unit tests on the exact dprs users have instead of by a screenshot
 * nobody can reproduce.
 */

/**
 * The quantization step for a raster scale.
 *
 * A raster scale is not free to follow the zoom continuously: changing it re-rasterizes the glyph
 * atlas, and the canvas wheel-zoom is a CONTINUOUS `zoom * Math.exp(-d * 0.01)` (Canvas.tsx), so
 * an unquantized scale would rebuild every atlas on every wheel event of every gesture — on every
 * live terminal at once. Quarter steps keep the rebuild count per gesture in single digits while
 * never leaving the raster more than one step coarser than the screen.
 */
export const RASTER_SCALE_STEP = 0.25

/**
 * The floor. Never rasterize COARSER than the display's own device pixel ratio, even when zoomed
 * far out and a coarser raster would be "enough" for the current frame.
 *
 * Two reasons, both failures rather than preferences: a terminal that dropped its raster on
 * zoom-out would have to rebuild it during the zoom-IN — the exact moment the user is looking at
 * it — and minifying a dpr-resolution raster is what the atlas's mip chain is already built and
 * gutter-padded for (see `glyphgrid/atlas.ts`), whereas magnifying a sub-dpr one has no such
 * defence.
 */
export const RASTER_SCALE_MIN_FACTOR = 1

/**
 * The ceiling, in device px per CSS px.
 *
 * An atlas costs memory as the SQUARE of this, and it is paid per live GPU context — the same
 * budget `terminal/webgl-budget.ts` exists to keep under Chromium's per-page cap. 3 covers dpr 2
 * at 1.5× zoom and dpr 1.5 at 2× zoom (React Flow's `maxZoom` is 2), and past it the honest
 * answer is that the text is magnified: a zoomed-in terminal that is slightly soft is a cosmetic
 * loss, a canvas full of terminals that exhausted the GPU budget is a black node.
 */
export const RASTER_SCALE_MAX = 3

/** A dpr/zoom that arrived as NaN, 0, negative or Infinity means "the browser did not tell us",
 *  never "zero". Answering 1 keeps every caller's arithmetic finite; the alternative is a NaN
 *  scale, which silently blanks a raster instead of making it soft. Same policy as
 *  `glyphgrid/camera.ts`'s `snapPanToDevicePx`, which passes through rather than rounding to NaN. */
function sane(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * The scale a terminal's glyph raster should be produced at, in DEVICE px per CSS px, so that at
 * canvas zoom `zoom` on a `dpr` display its texels sample 1:1 (or, where quantized/clamped,
 * never UNDER-sample).
 *
 * `ceil` to the step rather than round: rounding down would leave the raster coarser than the
 * screen, which is the blur this is trying to remove — the step exists to bound the number of
 * atlas rebuilds, not to license a softer raster than the display asked for.
 */
export function terminalRasterScale(dpr: number, zoom: number): number {
  const d = sane(dpr)
  const ideal = d * sane(zoom)
  // Float noise is rounded out of the QUOTIENT before the ceil: `1.25 * 1.2` is
  // 1.4999999999999998, whose raw quotient ceils to an extra whole step — a rebuild of every
  // atlas on the canvas, bought by a representation error rather than by a real scale change.
  const stepped = Math.ceil(+(ideal / RASTER_SCALE_STEP).toFixed(6)) * RASTER_SCALE_STEP
  return Math.min(RASTER_SCALE_MAX, Math.max(d * RASTER_SCALE_MIN_FACTOR, stepped))
}

/**
 * How many DEVICE pixels one raster texel covers, given the scale it was rasterized at.
 *
 * 1 means pixel-exact. Above 1 the raster is MAGNIFIED (soft edges); below 1 it is minified (the
 * mip/gutter case the atlas is built for). This is the number a device check should read, because
 * it is the thing the compositor actually does — a scale that "looks right" against the dpr can
 * still be wrong once the canvas zoom is in the product.
 */
export function resampleFactor(dpr: number, zoom: number, rasterScale: number): number {
  return (sane(dpr) * sane(zoom)) / sane(rasterScale)
}

/** How far from 1:1 a configuration may sit and still count as pixel-exact. One part in 10^-6 is
 *  float noise from the products above; anything a user could see is orders of magnitude larger
 *  (the smallest REAL offender measured here — xterm's `round(device/dpr)` canvas CSS size — is
 *  6e-4, and even that was not the reported defect). */
const EXACT_EPS = 1e-6

/** Is this combination sampled 1:1? The predicate a test (or a device checklist step) asserts,
 *  kept beside the arithmetic so "crisp" has one definition rather than one per call site. */
export function isPixelExact(dpr: number, zoom: number, rasterScale: number): boolean {
  return Math.abs(resampleFactor(dpr, zoom, rasterScale) - 1) <= EXACT_EPS
}

/**
 * The nudge, in CSS px, that puts a CSS-space coordinate on a whole DEVICE pixel — the PHASE half
 * of the fix, and the one the measurement above says costs the most at default zoom.
 *
 * Add it to the coordinate (a React Flow viewport `x`/`y`, a node's own offset) and the result
 * lands on the device grid. Returns a SIGNED delta rather than the snapped value on purpose: a
 * caller usually has to apply it to a transform it does not own outright, and a delta composes
 * with whatever else is in that transform while a replacement value does not.
 *
 * |offset| never exceeds half a device pixel, so snapping can never move content by something a
 * user would read as a jump — this is the same trade `glyphgrid/camera.ts` already makes for the
 * shared renderer's camera, which is why the shared layer is immune to the phase term.
 *
 * An unknown dpr snaps NOTHING (0), rather than rounding to a grid it cannot name.
 */
export function devicePixelSnapOffset(cssCoord: number, dpr: number): number {
  if (!Number.isFinite(cssCoord)) return 0
  if (!Number.isFinite(dpr) || dpr <= 0) return 0
  return Math.round(cssCoord * dpr) / dpr - cssCoord
}

/**
 * A cell width quantized onto a device grid: `floor(width × grid) / grid`.
 *
 * This is not a helper invented for tidiness — it is the arithmetic BOTH ends of the terminal
 * already perform, written once so the stability proof below can compose them:
 *   - `char-size-quantize.ts` applies it to the raw measurement, so the DOM and WebGL renderers
 *     agree on a cell (that helper's own header explains why);
 *   - `@xterm/addon-webgl`'s `_updateDimensions` applies it again implicitly —
 *     `device.char.width = floor(charWidth × dpr)`, then `css.cell.width = device.cell.width / dpr`
 *     — because its glyph atlas needs an integer grid.
 */
export function quantizedCellWidth(rawWidth: number, grid: number): number {
  const g = sane(grid)
  const w = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 0
  const q = Math.floor(w * g) / g
  // A sub-device-pixel cell quantizes to 0, which would invalidate the whole char size. Same
  // fallback `quantizeCharSize` makes: keep the raw measurement.
  return q > 0 ? q : w
}

/** Slack for the cell-width comparison below. The quantities are sub-pixel CSS widths built from
 *  two divisions, so anything under this is representation noise; a REAL disagreement is at least
 *  `1/scale` px (~0.33 at scale 3), five orders of magnitude larger. */
const CELL_EPS = 1e-9

/**
 * Would rasterizing at `rasterScale` leave the terminal's CSS cell width exactly where the display
 * grid put it?
 *
 * THIS IS THE CONSTRAINT THE WHOLE SCALE FIX HANGS ON, and it is not obvious from the arithmetic
 * above. `@xterm/addon-fit`'s `proposeDimensions` derives `cols` from
 * `renderService.dimensions.css.cell.width`, and the WebGL renderer computes that as
 * `floor(charWidth × dpr) / dpr` — i.e. it depends on the dpr the renderer is told. So a raster
 * scale that moves the CSS cell by even a fraction of a pixel moves the COLUMN COUNT of a wide
 * terminal, and a column change is a `terminal.resize()`, which is a SIGWINCH into the user's tmux
 * session and a full repaint. Re-rasterizing on zoom is a cosmetic change; reflowing somebody's
 * running session on zoom is a defect, so the scale is only allowed to move when this holds.
 *
 * Worked example, at the dpr the module header's measurements were taken on. A measured width of
 * 8.6667 px at dpr 1.5 gives a cell of `floor(13)/1.5 = 8.6667`. Ask for the QUARTER-step scale
 * 1.75 that `terminalRasterScale` would return and the renderer recomputes
 * `floor(8.6667 × 1.75)/1.75 = 15/1.75 = 8.5714` — 1.1% narrower, which turns an 800 px terminal
 * from 92 columns into 93. Multiply an already grid-aligned width by an INTEGER multiple of the dpr
 * instead and the product is an integer by construction
 * (`floor(w × d)/d × n × d = n × floor(w × d)`), so the floor loses nothing and the cell is
 * unmoved. That is why `safeRasterScale` exists beside `terminalRasterScale` rather than replacing
 * it.
 *
 * NOTE WHAT IT COMPARES, because the obvious alternative is a check that can never fail. It runs
 * the SAME measured width through both grids, which is what the renderer itself does — it reads
 * `_charSizeService.width` and floors it against whichever dpr it was told. Quantizing the display
 * answer and THEN re-quantizing that would be a restatement of the proof above rather than a test
 * of it: grid-aligned input survives every multiple by construction, so such a predicate returns
 * true for every multiple and would wave through the one case this must catch — a width that never
 * reached the display grid because `quantizeCharSize` (deliberately fail-open) did not install.
 * With the raw width on both sides, that case is exactly the one that comes back false.
 */
export function cellWidthIsStable(
  measuredWidth: number,
  dpr: number,
  rasterScale: number
): boolean {
  const onDisplayGrid = quantizedCellWidth(measuredWidth, dpr)
  const onRasterGrid = quantizedCellWidth(measuredWidth, rasterScale)
  return Math.abs(onRasterGrid - onDisplayGrid) <= CELL_EPS
}

/**
 * The raster scale the WIRING may actually apply: `terminalRasterScale`'s answer rounded UP to a
 * whole multiple of the display dpr, so `cellWidthIsStable` holds for every possible cell width.
 *
 * Rounding up, never down, keeps the existing module's promise that the raster is never COARSER
 * than the ideal — the step exists to bound rebuilds, not to license blur.
 *
 * The clamp is a multiple too. `RASTER_SCALE_MAX` cannot simply be applied with `Math.min`: at dpr
 * 2 that would produce 3, which is not a multiple of 2 and would move the cell. The ceiling is
 * therefore the largest MULTIPLE at or under `RASTER_SCALE_MAX`, with a floor of one multiple so a
 * display whose own dpr already exceeds the ceiling is never rasterized coarser than itself.
 *
 * Two consequences worth stating out loud rather than discovering on a device:
 *  - Because the multiples of `dpr` are so far apart, the answer is `dpr` for every zoom ≤ 1 and
 *    `2 × dpr` above it (React Flow's `maxZoom` is 2). Zooming OUT never re-rasterizes anything,
 *    and a whole zoom-in gesture crosses at most ONE scale change. That is the cost argument for
 *    the wiring, and it is a property of this function rather than of a debounce.
 *  - At dpr 2 the next multiple is 4, past the memory ceiling, so this returns 2 at every zoom and
 *    the scale half is INERT on an integer-dpr display. Deliberate: dpr 2 is already exact at zoom
 *    1, and the reported defect is Windows at 1.25/1.5.
 */
export function safeRasterScale(dpr: number, zoom: number): number {
  const d = sane(dpr)
  const ideal = terminalRasterScale(d, zoom)
  // Same `.toFixed(6)` guard as `terminalRasterScale`: these quotients are exactly the products
  // that make `1.25 × 1.2` arrive as 1.4999999999999998, and here a float hair would buy a whole
  // extra multiple — a 4× atlas nobody asked for.
  const wanted = Math.max(1, Math.ceil(+(ideal / d).toFixed(6)))
  const ceiling = Math.max(1, Math.floor(+(RASTER_SCALE_MAX / d).toFixed(6)))
  return Math.min(wanted, ceiling) * d
}
