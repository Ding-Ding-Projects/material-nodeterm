/**
 * WebGL context-cap coordination between the desktop shell and the renderer.
 *
 * Chromium caps live WebGL contexts per page (default ~16); past it the browser force-evicts the
 * least-recently-used context, which is what flashes a dead canvas on a visible terminal. The
 * renderer's budget coordinator (`renderer/terminal/webgl-budget.ts`) keeps our own count under a
 * budget so the cap is never hit — but the default cap leaves room for only ~12 GPU-rendered
 * terminals on a busy canvas.
 *
 * On DESKTOP we control the browser too: main raises Chromium's cap via the
 * `--max-active-webgl-contexts` switch (added for exactly this in crbug.com/771792), and the
 * renderer raises the budget to match at boot (`main.tsx` → `setWebglBudget`). The two constants
 * live together here so the "budget comfortably under the cap" invariant is visible in one place.
 * A BROWSER tab (Server Edition) cannot raise its cap, so it stays on the default budget.
 */

/** Chromium's per-page WebGL context cap on desktop (`--max-active-webgl-contexts`). */
export const WEBGL_CONTEXT_CAP_DESKTOP = 32

/** Renderer budget on desktop, comfortably under `WEBGL_CONTEXT_CAP_DESKTOP`, with the same margin
 *  philosophy as the default 12-under-16. */
export const WEBGL_BUDGET_DESKTOP = 24

/** How a terminal actually paints: xterm's own DOM renderer, one budgeted WebGL context per
 *  terminal (the coordinator described above), or glyphgrid — ONE context for the whole canvas,
 *  into which every terminal paints. */
export type TerminalRenderer = 'dom' | 'webgl' | 'shared'

/**
 * Resolve the `terminalGpuRendering` setting to the renderer the terminals should use. THE single
 * resolver: there is deliberately no second "is GPU rendering on?" boolean helper, because
 * 'shared' is a GPU mode whose PER-TERMINAL budget must be off, so a boolean answer is wrong for
 * one of its two callers no matter which way it goes.
 *
 * `auto` and `on` are per-terminal WebGL, `off`
 * is the DOM renderer, 'shared' is the canvas-wide glyph renderer on every platform.
 *
 * Legacy booleans still mean their own explicit choice ('on'/'off'); anything unrecognised
 * resolves exactly like 'auto' — the settings-store migration normalizes the file, and a value
 * that slipped past it must land on the DEFAULT.
 */
export function resolveTerminalRenderer(
  value: 'auto' | 'on' | 'off' | 'shared' | boolean | undefined
): TerminalRenderer {
  if (value === 'shared') return 'shared'
  if (value === 'on' || value === true) return 'webgl'
  if (value === 'off' || value === false) return 'dom'
  return 'webgl'
}
