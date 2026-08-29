import type { Terminal } from '@xterm/xterm'
import { cellWidthIsStable, safeRasterScale } from './device-pixel-fit'
import { isWebglEnabled } from './webgl-budget'

/**
 * THE SCALE HALF OF THE DE-BLUR: tell a terminal's renderer to rasterize at the density the canvas
 * camera will actually display it at.
 *
 * `device-pixel-fit.ts` names the two independent ways a terminal's fixed-resolution raster ends up
 * resampled, and carries the measurements. PHASE is fixed already (Canvas snaps the viewport
 * translate onto the device grid at gesture end). This module is the other one: at canvas zoom `z`
 * the raster is displayed at `dpr × z` device px per CSS px while it was built at `dpr`, so every
 * zoom above 1 magnifies a raster that was never dense enough.
 *
 * HOW A TERMINAL LEARNS ITS DPR, and therefore where this has to attach. Every renderer reads one
 * number: `ICoreBrowserService.dpr`, which in `@xterm/xterm` is a getter returning
 * `window.devicePixelRatio` and nothing else — it has no setter and no notion of a camera. The
 * WebGL renderer caches it (`_devicePixelRatio`), sizes `device.char.width = floor(charWidth ×
 * dpr)` from it, and rebuilds its glyph atlas when `RenderService.handleDevicePixelRatioChange()`
 * observes it move. So the whole fix is: shadow that one getter per terminal with `dpr × n`, and
 * drive the existing dpr-change path. Nothing new is invented; the renderer is simply told the
 * truth about how big it will be drawn.
 *
 * WHY THE CSS LAYOUT DOES NOT MOVE. The same `_updateDimensions` divides straight back out —
 * `css.canvas.width = round(device.canvas.width / dpr)`, `css.cell = device.cell / dpr` — so a
 * denser raster occupies the identical CSS box. This is supersampling, not a resize.
 *
 * ...WITH ONE EXCEPTION, WHICH IS THE ONLY DANGEROUS THING HERE. That division is not exact,
 * because `device.char.width` was FLOORED. `addon-fit` derives `cols` from `css.cell.width`, so a
 * scale that shifts the cell by a fraction of a pixel shifts the column count, and a column change
 * is `terminal.resize()` — a SIGWINCH into the user's tmux session, on every zoom step. Two things
 * stop that, and both are required:
 *   1. `safeRasterScale` only ever returns whole MULTIPLES of the display dpr, for which the floor
 *      provably loses nothing (see `cellWidthIsStable`, which carries the worked example).
 *   2. The proof in (1) assumes the measurement is already on the display grid, which is
 *      `quantizeCharSize`'s doing — and that helper is deliberately fail-open, so it can be absent
 *      on some future xterm. `applyTo` therefore RE-CHECKS the predicate against the terminal's
 *      live measured width and refuses the change if it does not hold. A soft terminal is a
 *      cosmetic loss; a reflowed session is somebody's work.
 *
 * COST. `safeRasterScale` answers `dpr` for every zoom ≤ 1 and `2 × dpr` above it, so zooming out
 * re-rasterizes NOTHING and a zoom-in gesture crosses at most one change. The observer below pays
 * one string read and a `parseFloat` per viewport transform write (i.e. per frame of a pan, once
 * for the whole canvas, not once per terminal) and returns immediately while the zoom is unchanged;
 * a real change is applied on a trailing debounce so a gesture rebuilds at rest rather than mid-
 * flight. It never re-acquires a WebGL context — `webgl-budget.ts` owns grants and is untouched by
 * this; an atlas rebuild happens inside the context the terminal already holds.
 *
 * FAIL-OPEN THROUGHOUT, in the same guarded style as `quantizeCharSize` and
 * `patchTerminalScale`: if any internal is missing, nothing installs and the terminal keeps
 * xterm's stock behaviour exactly. A terminal that is not inside a React Flow viewport — the card
 * modal's second view, the settings preview, the focused node while it is reparented out — has no
 * camera, resolves to zoom 1, and is therefore byte-identical to today.
 */

/** How long after the last viewport transform write a scale change is applied.
 *
 *  An atlas rebuild plus a full row refresh is real work, and a wheel-zoom is a burst; doing it at
 *  rest costs the user nothing, because nobody judges sharpness mid-gesture. This is the same trade
 *  `webgl-budget.ts` makes with `WEBGL_GESTURE_SETTLE_MS` for renderer swaps, kept as its own
 *  constant because it is a different (much cheaper) operation and should be free to diverge. */
export const RASTER_APPLY_SETTLE_MS = 200

/** The scale factor of a CSS transform string, or `null` when there is none to read.
 *
 *  React Flow writes its viewport as `translate(Xpx,Ypx) scale(Z)` (@xyflow/react), which is the
 *  case that matters; `matrix(a,b,c,d,e,f)` is accepted too because a composed transform is the
 *  shape a future version could emit and misreading one as "no zoom" would silently disable this
 *  whole module rather than fail. Parsed by hand rather than through `DOMMatrix` because this runs
 *  on every frame of a pan and allocating a matrix there is the one cost worth avoiding. */
export function parseTransformScale(transform: string | null | undefined): number | null {
  if (!transform) return null
  const scaleAt = transform.indexOf('scale(')
  if (scaleAt >= 0) {
    const value = Number.parseFloat(transform.slice(scaleAt + 6))
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const matrixAt = transform.indexOf('matrix(')
  if (matrixAt >= 0) {
    const value = Number.parseFloat(transform.slice(matrixAt + 7))
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return null
}

interface CharSizeServiceLike {
  width?: number
}
interface CoreBrowserServiceLike {
  dpr?: number
}
interface RenderServiceLike {
  handleDevicePixelRatioChange(): void
}
interface CoreLike {
  _charSizeService?: CharSizeServiceLike
  _coreBrowserService?: CoreBrowserServiceLike
  _renderService?: RenderServiceLike
}

interface Client {
  term: Terminal
  core: CoreLike
  /** The dpr the display actually has, read through the getter we shadowed. Never our own value. */
  displayDpr(): number
  /** The scale the renderers are currently being told. What the shadowing getter returns. */
  applied: number
}

const clients = new Map<Terminal, Client>()

/** Viewport elements under observation, with the last zoom seen on each. The map is the
 *  short-circuit: a pan rewrites the transform every frame with the scale unchanged. */
const viewports = new Map<Element, number>()
let observer: MutationObserver | null = null
let applyTimer: ReturnType<typeof setTimeout> | null = null

function windowDpr(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/**
 * The dpr of the DISPLAY, for a terminal whose reported dpr this module may have shadowed.
 *
 * `quantizeCharSize` must keep quantizing on the display grid even while the renderers are being
 * told a denser one: quantizing on the raster grid would move the CSS cell width, which is exactly
 * the column reflow this module exists to avoid. It therefore asks here instead of reading
 * `_coreBrowserService.dpr` directly. Unpatched terminals fall through to that same field, so the
 * precedence it documents (the terminal's own live service, then the window) is unchanged.
 */
export function displayDprOf(term: Terminal, fallback: number | undefined): number {
  const client = clients.get(term)
  if (client) {
    const d = client.displayDpr()
    if (Number.isFinite(d) && d > 0) return d
  }
  return Number.isFinite(fallback) && (fallback as number) > 0 ? (fallback as number) : 1
}

/** The canvas zoom a terminal is being drawn at: the scale of its nearest React Flow viewport
 *  ancestor, or 1 when it has none (card modal, settings preview, focused node reparented out).
 *  Resolved from the DOM on each use rather than cached, because a terminal's element is moved
 *  between containers by park/adopt and by focus, and a cached ancestor would outlive the move. */
function zoomFor(term: Terminal): { zoom: number; viewport: Element | null } {
  const el = term.element as HTMLElement | undefined
  if (!el || typeof el.closest !== 'function') return { zoom: 1, viewport: null }
  const viewport = el.closest('.react-flow__viewport')
  if (!viewport) return { zoom: 1, viewport: null }
  const scale = parseTransformScale((viewport as HTMLElement).style?.transform)
  return { zoom: scale ?? 1, viewport }
}

/** Push one client's scale to `next`, if the cell width provably survives it. Returns whether the
 *  renderers were re-driven. */
function applyTo(client: Client, next: number): boolean {
  if (!(next > 0) || next === client.applied) return false
  const dpr = client.displayDpr()
  const measured = client.core._charSizeService?.width
  // The runtime half of the reflow guard. `safeRasterScale`'s multiple-of-dpr rule is only a proof
  // once the measurement sits on the display grid; if `quantizeCharSize` did not install, or a
  // future xterm measures differently, this is what refuses the change instead of resizing a live
  // session. A width we cannot read is also a refusal — never a guess.
  if (!(typeof measured === 'number' && measured > 0)) return false
  if (!cellWidthIsStable(measured, dpr, next)) return false
  const render = client.core._renderService
  if (!render || typeof render.handleDevicePixelRatioChange !== 'function') return false
  // Order matters: the getter must already answer `next` when the renderer compares its own cached
  // dpr against it, or `WebglRenderer.handleDevicePixelRatioChange` sees no change and returns.
  const previous = client.applied
  client.applied = next
  try {
    render.handleDevicePixelRatioChange()
  } catch {
    client.applied = previous
    return false
  }
  return true
}

/**
 * The scale a client should be reporting right now — or its plain display dpr, when this fix does
 * not apply to the renderer that currently owns the terminal's pixels.
 *
 * ONLY THE `webgl` MODE. The other two are not oversights:
 *  - `dom`: the glyphs are real DOM text, which Chromium rasterizes at the composited scale, so a
 *    DOM terminal is already sharp under zoom and there is nothing here to win.
 *  - `shared`: the glyph layer sizes its atlas from xterm's `device` cell — which is computed from
 *    exactly the dpr this module shadows — while drawing quads from the `css` cell and the REAL
 *    ratio. Inflating one side of that pairing is the "atlas slot stretched over the quad"
 *    mismatch `SharedGlyphLayer` calls out by name, and the shared camera already snaps itself, so
 *    it has nothing to gain and a working renderer to lose.
 *
 * Evaluated per apply rather than latched at install, so a runtime renderer change (Settings →
 * Terminal rendering) puts the reported dpr back where the new owner expects it.
 */
function targetScaleFor(client: Client): number {
  const dpr = client.displayDpr()
  if (!isWebglEnabled()) return dpr
  return safeRasterScale(dpr, zoomFor(client.term).zoom)
}

function applyAll(): void {
  for (const client of clients.values()) applyTo(client, targetScaleFor(client))
}

/** Re-settle every terminal's reported dpr. Called when the renderer mode changes, because that
 *  changes the ANSWER without changing the camera — nothing else would schedule an apply. */
export function resyncRasterScales(): void {
  // Guarded so the common case — a mode applied at boot, before any terminal exists — does not arm
  // a timer that has nothing to do.
  if (clients.size === 0) return
  scheduleApply()
}

function scheduleApply(): void {
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    applyTimer = null
    applyAll()
  }, RASTER_APPLY_SETTLE_MS)
}

/** The per-frame path during a pan or zoom. Everything here is on the hot side of the trade, so it
 *  does the least it can: one inline-style read and one `parseFloat` per observed viewport, and an
 *  early return whenever the scale is what it was — which is every frame of a pan. */
function onViewportMutation(): void {
  let changed = false
  for (const [el, lastZoom] of viewports) {
    const zoom = parseTransformScale((el as HTMLElement).style?.transform) ?? 1
    if (zoom === lastZoom) continue
    viewports.set(el, zoom)
    changed = true
  }
  if (changed) scheduleApply()
}

function observe(viewport: Element): void {
  if (viewports.has(viewport)) return
  viewports.set(viewport, parseTransformScale((viewport as HTMLElement).style?.transform) ?? 1)
  if (typeof MutationObserver === 'undefined') return
  if (!observer) observer = new MutationObserver(onViewportMutation)
  // Attribute-filtered to `style`: React Flow writes the transform inline, and every other
  // attribute mutation on that element is somebody else's business.
  observer.observe(viewport, { attributes: true, attributeFilter: ['style'] })
}

function unregister(term: Terminal): void {
  clients.delete(term)
  if (clients.size === 0) {
    observer?.disconnect()
    observer = null
    viewports.clear()
    if (applyTimer) {
      clearTimeout(applyTimer)
      applyTimer = null
    }
  }
}

/**
 * Shadow `term`'s reported device pixel ratio with the canvas-aware raster scale, and keep it in
 * step with the camera. Idempotent per terminal, safe on every mount/adopt, and a no-op returning
 * `false` on any xterm whose internals do not match.
 *
 * Call it AFTER `quantizeCharSize` has succeeded: the reflow proof depends on the measurement
 * already sitting on the display grid (`applyTo` re-checks, but a terminal that never satisfies the
 * predicate simply never sharpens, which is a silent no-feature rather than a bug).
 */
export function patchTerminalRasterScale(term: Terminal): boolean {
  try {
    const core = (term as unknown as { _core?: CoreLike })._core
    const svc = core?._coreBrowserService
    if (!core || !svc) return false
    if (clients.has(term)) return true

    // The live original, captured from the PROTOTYPE descriptor so it keeps tracking the real
    // window (a display change, a window moved between monitors) rather than freezing today's
    // value. An own property on the instance shadows it and is fully reversible.
    const proto = Object.getPrototypeOf(svc) as object | null
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'dpr') : undefined
    const original = descriptor?.get
    if (typeof original !== 'function') return false
    const displayDpr = (): number => {
      try {
        const d = original.call(svc) as number
        return Number.isFinite(d) && d > 0 ? d : windowDpr()
      } catch {
        return windowDpr()
      }
    }

    const client: Client = { term, core, displayDpr, applied: displayDpr() }
    Object.defineProperty(svc, 'dpr', {
      configurable: true,
      get: () => client.applied
    })
    clients.set(term, client)

    // Teardown through the public method, so a disposed terminal cannot sit in the registry
    // forever. Wrapped rather than replaced, and guarded — a throw here would take the caller's
    // own dispose path down with it.
    const dispose = term.dispose.bind(term)
    term.dispose = (): void => {
      unregister(term)
      dispose()
    }

    const { viewport } = zoomFor(term)
    if (viewport) observe(viewport)
    // The terminal may already be inside a zoomed canvas at open time (a project loads at its saved
    // viewport), so settle the initial scale through the same debounced path rather than assuming
    // the camera is at 1.
    scheduleApply()
    return true
  } catch {
    return false
  }
}

/** Test seam: drop every registration, observer and pending apply. */
export function __resetRasterScaleForTests(): void {
  clients.clear()
  observer?.disconnect()
  observer = null
  viewports.clear()
  if (applyTimer) {
    clearTimeout(applyTimer)
    applyTimer = null
  }
}

/**
 * DIAGNOSTIC ONLY — `window.__rasterProbe`. This changes no default, no setting and no
 * terminal's behaviour unless something calls it; it exists purely to answer one open question,
 * left open in `docs/features/canvas/terminal-sharpness.md` and `HANDOFF.md`, that arithmetic
 * alone cannot settle:
 *
 * `cellWidthIsStable` is a STATIC proof, and it is deliberately conservative — it refuses any
 * `rasterScale` that is not a whole multiple of the display `dpr`, because that is the only case
 * `safeRasterScale` can prove `floor(width * rasterScale) / rasterScale` lands on the same value
 * as `floor(width * dpr) / dpr`. But the thing that actually decides whether a terminal reflows is
 * `RenderService.handleDevicePixelRatioChange()`, which does not consult that proof at all — it
 * RE-MEASURES through xterm's own `charSizeService`, and (when `quantizeCharSize` is installed)
 * that re-measurement is itself quantized onto the DISPLAY grid before `addon-fit` derives `cols`
 * from it. So a scale the static guard refuses MAY still leave the live column count untouched;
 * the static proof is sufficient but not shown to be necessary. Only a measurement decides which
 * it is — this probe takes that measurement.
 *
 * `list()` is read-only. `force(scale)` mutates exactly one thing per client — `client.applied` —
 * and re-drives its renderer the same way `applyTo` does, deliberately BYPASSING
 * `cellWidthIsStable` (that bypass is the whole point: it lets you ask "what actually happens" for
 * a scale the guard would have refused before anything ran). It rolls back `client.applied` on
 * throw, exactly as `applyTo` does. Nothing here schedules an `applyAll()`, arms the mutation
 * observer, or survives one: the very next real viewport transform (or a mode change through
 * `resyncRasterScales`) recomputes `targetScaleFor` from scratch and overwrites whatever `force()`
 * left behind. It is not gated by a debug flag, in the same spirit as `__glyphgridSnap` in
 * `SharedGlyphLayer.tsx` — the question it answers can only be answered by someone looking at a
 * real device, and there is nothing here to protect: it can move a terminal's column count for as
 * long as `force()`'s effect lasts, on the terminal you pointed it at, which is exactly the
 * one-terminal blast radius the question requires you to accept to answer it.
 */
export interface RasterProbeEntry {
  dpr: number
  applied: number
  cols: number
  rows: number
  measuredCellWidth: number | undefined
  zoom: number
}

export interface RasterProbeForceResult extends RasterProbeEntry {
  /** What the static guard says about `scale`, for the width measured BEFORE the force ran. */
  wouldBeStable: boolean
  before: { cols: number; measuredCellWidth: number | undefined }
  /** `null` when the renderer could not be driven at all (no `_renderService` on this terminal). */
  after: { cols: number; measuredCellWidth: number | undefined } | null
  /** Set when `handleDevicePixelRatioChange` threw and `applied` was rolled back to its prior value. */
  error: string | null
}

function rasterProbeEntry(client: Client): RasterProbeEntry {
  return {
    dpr: client.displayDpr(),
    applied: client.applied,
    cols: client.term.cols,
    rows: client.term.rows,
    measuredCellWidth: client.core._charSizeService?.width,
    zoom: zoomFor(client.term).zoom
  }
}

function rasterProbeForce(scale: number): RasterProbeForceResult[] {
  const results: RasterProbeForceResult[] = []
  if (!(typeof scale === 'number' && Number.isFinite(scale) && scale > 0)) return results
  for (const client of clients.values()) {
    const dpr = client.displayDpr()
    const measuredBefore = client.core._charSizeService?.width
    const before = { cols: client.term.cols, measuredCellWidth: measuredBefore }
    const wouldBeStable =
      typeof measuredBefore === 'number' && measuredBefore > 0
        ? cellWidthIsStable(measuredBefore, dpr, scale)
        : false
    const render = client.core._renderService
    const previous = client.applied
    let after: { cols: number; measuredCellWidth: number | undefined } | null = null
    let error: string | null = null
    if (!render || typeof render.handleDevicePixelRatioChange !== 'function') {
      error = 'no _renderService.handleDevicePixelRatioChange on this terminal'
    } else {
      client.applied = scale
      try {
        render.handleDevicePixelRatioChange()
        after = { cols: client.term.cols, measuredCellWidth: client.core._charSizeService?.width }
      } catch (e) {
        client.applied = previous
        error = e instanceof Error ? e.message : String(e)
      }
    }
    results.push({ ...rasterProbeEntry(client), before, after, wouldBeStable, error })
  }
  return results
}

function installRasterProbe(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as Record<string, unknown>
  if (w.__rasterProbe) return
  w.__rasterProbe = {
    list: (): RasterProbeEntry[] => Array.from(clients.values()).map(rasterProbeEntry),
    force: rasterProbeForce
  }
}
installRasterProbe()

/** Test seam: drop the installed `window.__rasterProbe` (a fresh module import would otherwise
 *  find `w.__rasterProbe` already set and skip re-installing over a torn-down module state). */
export function __resetRasterProbeForTests(): void {
  if (typeof window === 'undefined') return
  delete (window as unknown as Record<string, unknown>).__rasterProbe
}
