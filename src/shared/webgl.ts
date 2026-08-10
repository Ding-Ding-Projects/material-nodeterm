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

/** Renderer budget on desktop — comfortably under `WEBGL_CONTEXT_CAP_DESKTOP`, same margin
 *  philosophy as the default 12-under-16. */
export const WEBGL_BUDGET_DESKTOP = 24

/**
 * Renderer budget on MAC desktop, deliberately much lower. Two field reports on macOS point at
 * the OS compositor mishandling many simultaneous WebGL canvases: whole-window flicker (the
 * reason the GPU-rendering master toggle exists), and terminals compositing BLACK after a
 * zoom-out grants a burst of contexts — with zero JS-visible errors in either case (no context
 * loss event, so nothing our repaint heals can reach: `term.refresh` re-draws, the compositor
 * still doesn't present it). Staying under the browser CAP is not enough there — the pressure
 * the macOS compositor tolerates is lower than what Chromium allows. ~10 keeps GPU rendering
 * for the terminals the user is actually looking at while staying inside what macOS
 * compositing handles reliably.
 */
export const WEBGL_BUDGET_DESKTOP_MAC = 10

/** How a terminal actually paints: xterm's own DOM renderer, one budgeted WebGL context per
 *  terminal (the coordinator described above), or glyphgrid — ONE context for the whole canvas,
 *  into which every terminal paints. */
export type TerminalRenderer = 'dom' | 'webgl' | 'shared'

/**
 * Resolve the `terminalGpuRendering` setting to the renderer the terminals should use. THE single
 * resolver: there is deliberately no second "is GPU rendering on?" boolean helper, because
 * 'shared' is a GPU mode whose PER-TERMINAL budget must be off, so a boolean answer is wrong for
 * one of its two callers no matter which way it goes. (The former `resolveGpuRendering` returned
 * `true` for every value it did not recognise on non-mac — which for 'shared' would have left the
 * budget handing out contexts to terminals that no longer paint their own pixels.)
 *
 * 'auto' (the default) is per-terminal WebGL everywhere EXCEPT macOS, where it is DOM. The macOS
 * branch moved twice, and the history is the justification:
 *
 *   - It used to be 'dom'. The compositor-level failures documented above (whole-window flicker;
 *     terminals compositing BLACK after a burst of context grants) have only ever been observed on
 *     macOS, they raise no JS-visible error, and no repaint we can issue heals them — so the only
 *     field-proven-clean configuration there was to not use the GPU per terminal at all. A public
 *     default must be the proven one, which made WebGL on a Mac a deliberate 'on'.
 *   - It then moved to 'shared'. That failure class is a function of MANY simultaneous WebGL canvases;
 *     one canvas-wide context removes the pressure by construction rather than by avoiding the
 *     GPU. Phase 2 then closed the gaps that made the shared renderer unfit to be a default —
 *     decorations (search highlights), cursor styles/wide cells/the blurred outline, blink, the
 *     rounded plate, surviving a lost context, dpr changes — and the whole device checklist plus a
 *     ≥30-minute soak with a dozen busy terminals (built-in and external display) was run by the
 *     author on 2026-08-05 with no flicker and no black-composited node.
 *   - The 2026-08-10 field reproduction contradicted text parity: a terminal was sharp during a
 *     drag (when TerminalNode deliberately leaves Shared and lets xterm paint itself), then soft
 *     immediately after drop when it rejoined Shared. Auto therefore returns to DOM. Shared stays
 *     explicit for users who prefer one GPU context over exact xterm text parity.
 *
 * Non-macOS is deliberately NOT promoted: the failure this answers is a macOS one, Linux and
 * Windows have been on per-terminal WebGL all along with no such reports, and there is no soak
 * evidence to move them. One platform at a time, and the platform with the evidence goes first.
 *
 * THE SERVER EDITION IS INCLUDED: platform detection is renderer-side, so a Mac browser tab also
 * gets the DOM default. Shared remains available there as the explicit escape from a low browser
 * WebGL context cap.
 *
 * The four-way setting is unchanged, so the escape hatch survives: 'on' is still per-terminal
 * WebGL (and still uses the budget coordinator above), 'off' is still the DOM renderer, and
 * 'shared' is platform-independent because the per-terminal context pressure it replaces never
 * existed for it. Renderer-side only (platform detection is navigator-based).
 *
 * Legacy booleans still mean their own explicit choice ('on'/'off'); anything unrecognised
 * resolves exactly like 'auto' — the settings-store migration normalizes the file, and a value
 * that slipped past it must land on the DEFAULT.
 */
export function resolveTerminalRenderer(
  value: 'auto' | 'on' | 'off' | 'shared' | boolean | undefined,
  isMac: boolean
): TerminalRenderer {
  if (value === 'shared') return 'shared'
  if (value === 'on' || value === true) return 'webgl'
  if (value === 'off' || value === false) return 'dom'
  return isMac ? 'dom' : 'webgl'
}
