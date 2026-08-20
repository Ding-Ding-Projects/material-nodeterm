// @vitest-environment jsdom
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyRendererMode } from './renderer-mode'
import {
  RASTER_APPLY_SETTLE_MS,
  __resetRasterScaleForTests,
  displayDprOf,
  parseTransformScale,
  patchTerminalRasterScale
} from './raster-scale'
import { __resetWebglBudgetForTests, setWebglEnabled } from './webgl-budget'

/**
 * A stand-in for the exact xterm internals this patch reaches through, shaped from the real ones
 * (`@xterm/xterm` 5.5 `CoreBrowserService`, `RenderService`, `CharSizeService`; `@xterm/addon-webgl`
 * 0.18 `WebglRenderer`). Two details are copied deliberately rather than simplified, because both
 * decide whether the wiring works at all:
 *
 *  - `dpr` is a getter ON THE PROTOTYPE returning the window's ratio, with no setter. That is why
 *    the patch shadows it with an own property instead of assigning to it.
 *  - `handleDevicePixelRatioChange` re-reads `dpr` and compares it to the renderer's own cached
 *    value, exactly as `WebglRenderer` does — so a patch that set the value AFTER driving the
 *    render service would be a silent no-op, and this fake would catch it.
 */
class FakeCoreBrowserService {
  public constructor(private readonly _win: { devicePixelRatio: number }) {}
  public get dpr(): number {
    return this._win.devicePixelRatio
  }
}

interface FakeTerminal {
  element?: HTMLElement
  dispose(): void
  _core: {
    _coreBrowserService: FakeCoreBrowserService
    _charSizeService: { width: number }
    _renderService: { handleDevicePixelRatioChange(): void }
  }
}

interface Harness {
  term: Terminal
  fake: FakeTerminal
  /** The dpr the renderer has actually rasterized at — updated only through the dpr-change path. */
  rasterizedAt(): number
  rebuilds(): number
  disposed(): boolean
}

const win = { devicePixelRatio: 1.5 }

function makeTerminal(measuredWidth = 8.7): Harness {
  const svc = new FakeCoreBrowserService(win)
  let cached = svc.dpr
  let rebuilds = 0
  let disposed = false
  const fake: FakeTerminal = {
    dispose(): void {
      disposed = true
    },
    _core: {
      _coreBrowserService: svc,
      _charSizeService: { width: measuredWidth },
      _renderService: {
        handleDevicePixelRatioChange(): void {
          if (cached === svc.dpr) return
          cached = svc.dpr
          rebuilds++
        }
      }
    }
  }
  return {
    term: fake as unknown as Terminal,
    fake,
    rasterizedAt: () => cached,
    rebuilds: () => rebuilds,
    disposed: () => disposed
  }
}

/** A React Flow canvas: the viewport element whose inline transform IS the camera. */
function mountViewport(zoom: number): HTMLElement {
  const viewport = document.createElement('div')
  viewport.className = 'react-flow__viewport'
  viewport.style.transform = `translate(10px,20px) scale(${zoom})`
  document.body.appendChild(viewport)
  return viewport
}

function setZoom(viewport: HTMLElement, zoom: number): void {
  viewport.style.transform = `translate(10px,20px) scale(${zoom})`
}

/** Let the MutationObserver's microtask run, then expire the trailing debounce. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  vi.advanceTimersByTime(RASTER_APPLY_SETTLE_MS + 1)
}

beforeEach(() => {
  vi.useFakeTimers()
  win.devicePixelRatio = 1.5
  document.body.innerHTML = ''
  __resetRasterScaleForTests()
  __resetWebglBudgetForTests() // leaves the WebGL renderer enabled, i.e. the default 'webgl' mode
})

afterEach(() => {
  __resetRasterScaleForTests()
  __resetWebglBudgetForTests()
  vi.useRealTimers()
})

describe('parseTransformScale', () => {
  it('reads the scale React Flow actually writes', () => {
    // Verbatim shape from @xyflow/react: `translate(${x}px,${y}px) scale(${zoom})`.
    expect(parseTransformScale('translate(133.5px,-42.25px) scale(0.8318)')).toBeCloseTo(0.8318, 6)
    expect(parseTransformScale('translate(0px,0px) scale(1)')).toBe(1)
  })

  it('reads a composed matrix rather than calling it "no zoom"', () => {
    // Misreading a transform as absent would silently disable the whole module instead of failing.
    expect(parseTransformScale('matrix(1.75, 0, 0, 1.75, 10, 20)')).toBeCloseTo(1.75, 6)
  })

  it('answers null for nothing to read, and for values that cannot be a scale', () => {
    expect(parseTransformScale(null)).toBeNull()
    expect(parseTransformScale('')).toBeNull()
    expect(parseTransformScale('none')).toBeNull()
    expect(parseTransformScale('translate(10px,20px)')).toBeNull()
    expect(parseTransformScale('scale(0)')).toBeNull()
    expect(parseTransformScale('scale(oops)')).toBeNull()
  })
})

describe('patchTerminalRasterScale', () => {
  it('tells the renderer the display dpr while the camera is at zoom 1', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))

    expect(patchTerminalRasterScale(h.term)).toBe(true)
    await settle()

    // The base case, and the one that must never regress: at zoom 1 today's behaviour IS correct,
    // so nothing is re-rasterized and the reported dpr is untouched.
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)
    expect(h.rebuilds()).toBe(0)
  })

  it('raises the raster to a whole multiple of the dpr when the canvas zooms in', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    await settle()

    setZoom(viewport, 1.3)
    await settle()

    // dpr 1.5 x 2 = 3: the renderer now rasterizes dense enough that a 1.3x magnified terminal is
    // sampled at or under 1:1 instead of being stretched.
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(3, 10)
    expect(h.rasterizedAt()).toBeCloseTo(3, 10)
    expect(h.rebuilds()).toBe(1)
  })

  it('re-rasterizes nothing while the canvas only pans, or only zooms out', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    await settle()

    // A pan is a transform write per frame with the scale untouched — the hot path this module is
    // shaped around. And zoom-out is deliberately free: the raster is never made coarser.
    for (let i = 0; i < 60; i++) {
      viewport.style.transform = `translate(${i}px,${i * 2}px) scale(1)`
    }
    await settle()
    for (const zoom of [0.9, 0.83, 0.5, 0.2]) {
      setZoom(viewport, zoom)
      await settle()
    }
    expect(h.rebuilds()).toBe(0)
  })

  it('crosses at most one scale change over a whole zoom-in gesture', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    await settle()

    // A continuous wheel-zoom, applied one frame at a time all the way to React Flow's maxZoom.
    for (let z = 1; z <= 2.0001; z += 0.02) {
      setZoom(viewport, z)
      await settle()
    }
    expect(h.rebuilds()).toBe(1)
  })

  it('refuses a scale that would move the cell width, rather than reflowing the session', async () => {
    // The runtime half of the reflow guard. A width that is NOT on the display grid is what a
    // failed `quantizeCharSize` leaves behind; supersampling it would change `cols`, so the patch
    // declines and the terminal simply stays as soft as it is today.
    const viewport = mountViewport(1)
    const h = makeTerminal(8.43) // floor(8.43 x 1.5)/1.5 = 8.0 != 8.43 -> unstable at scale 3
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    await settle()

    setZoom(viewport, 1.3)
    await settle()

    expect(h.rebuilds()).toBe(0)
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)
  })

  it('leaves a terminal with no canvas above it exactly as it was', async () => {
    // The card-modal viewer and the settings preview are body portals, and the focused node is
    // reparented out of the viewport. All three resolve to zoom 1 and must be byte-identical.
    const h = makeTerminal()
    h.fake.element = document.createElement('div')
    document.body.appendChild(h.fake.element)
    patchTerminalRasterScale(h.term)
    await settle()

    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)
    expect(h.rebuilds()).toBe(0)
  })

  it('follows the display when the window moves to a monitor with a different dpr', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal(8) // 8 is on every grid, so the scale is free to move
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    await settle()

    // The original getter is captured LIVE, not snapshotted, so the shadow tracks the real ratio.
    win.devicePixelRatio = 2
    setZoom(viewport, 1.3)
    await settle()

    // dpr 2's next multiple is past the memory ceiling, so the honest answer is 2 and no rebuild.
    expect(displayDprOf(h.term, 1)).toBe(2)
    expect(h.fake._core._coreBrowserService.dpr).toBe(2)
  })

  it('reports the display dpr to the char-size quantizer even while supersampling', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    setZoom(viewport, 1.3)
    await settle()

    // If the quantizer followed the RASTER grid it would re-quantize the cell finer and change
    // `cols` — the reflow the whole design avoids. It must keep seeing 1.5 while the renderer
    // sees 3.
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(3, 10)
    expect(displayDprOf(h.term, 999)).toBeCloseTo(1.5, 10)
  })

  it('falls back to the caller value for a terminal it never patched', () => {
    const h = makeTerminal()
    expect(displayDprOf(h.term, 1.25)).toBe(1.25)
    // An unusable fallback still yields something finite rather than NaN or 0.
    expect(displayDprOf(h.term, undefined)).toBe(1)
    expect(displayDprOf(h.term, 0)).toBe(1)
  })

  it('is idempotent, and stops following the camera once the terminal is disposed', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    expect(patchTerminalRasterScale(h.term)).toBe(true)
    expect(patchTerminalRasterScale(h.term)).toBe(true)
    await settle()

    h.term.dispose()
    expect(h.disposed()).toBe(true)

    setZoom(viewport, 1.3)
    await settle()
    // A disposed terminal must not be re-driven, and must not sit in the registry forever.
    expect(h.rebuilds()).toBe(0)
    expect(displayDprOf(h.term, 1.25)).toBe(1.25)
  })

  it('installs nothing on an xterm whose internals do not match', () => {
    // Fail-open, in the same style as quantizeCharSize: a future xterm that renames or removes any
    // of this keeps its stock behaviour instead of throwing into the caller's mount path.
    expect(patchTerminalRasterScale({} as unknown as Terminal)).toBe(false)
    expect(patchTerminalRasterScale({ _core: {} } as unknown as Terminal)).toBe(false)
    // A `dpr` that is a plain value rather than a prototype getter cannot be shadowed safely.
    const plain = { _core: { _coreBrowserService: { dpr: 1.5 } }, dispose(): void {} }
    expect(patchTerminalRasterScale(plain as unknown as Terminal)).toBe(false)
  })

  it('leaves the reported dpr alone when WebGL is not the renderer in charge', async () => {
    // `dom` and `shared` both switch the budget off. The shared glyph layer in particular sizes its
    // atlas from the `device` cell this dpr computes, while drawing quads from the `css` cell and
    // the real ratio — inflating one side of that pairing is the stretched-slot mismatch it names.
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    setWebglEnabled(false)

    setZoom(viewport, 1.3)
    await settle()

    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)
    expect(h.rebuilds()).toBe(0)
  })

  it('re-settles when the renderer mode changes, which moves no camera', async () => {
    const viewport = mountViewport(1.3)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    patchTerminalRasterScale(h.term)
    setWebglEnabled(false)
    await settle()
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)

    // Switching INTO webgl at a zoom that was already set: nothing about the transform changes, so
    // the mutation observer will never fire and only this path can put the scale right.
    applyRendererMode('webgl', { setWebglEnabled, setSharedEnabled: () => {} })
    await settle()
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(3, 10)

    // ...and back out of it, which must hand the shared layer an untouched device cell.
    applyRendererMode('shared', { setWebglEnabled, setSharedEnabled: () => {} })
    await settle()
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)
  })

  it('rolls back its reported dpr if driving the renderer throws', async () => {
    const viewport = mountViewport(1)
    const h = makeTerminal()
    viewport.appendChild((h.fake.element = document.createElement('div')))
    h.fake._core._renderService.handleDevicePixelRatioChange = (): void => {
      throw new Error('renderer is gone')
    }
    patchTerminalRasterScale(h.term)
    setZoom(viewport, 1.3)
    await settle()

    // Leaving the shadow at 3 while the renderer still holds a 1.5 atlas would report a lie to
    // every later reader, including the fit path.
    expect(h.fake._core._coreBrowserService.dpr).toBeCloseTo(1.5, 10)
  })
})
