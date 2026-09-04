/**
 * The window's declared minimum client area — the floor every layout claim is measured at.
 *
 * Why this exists as a shared constant rather than two literals in the window options: the
 * clipping matrix, its probe receipts, and the window itself all have to agree on one number.
 * When they do not, a capture proves a width the app never actually permits, which is worse
 * than no capture because it reads as evidence. `src/main` enforces it on the BrowserWindow,
 * `scripts/capture-shots.mjs` reads it as the narrow end of its viewport axis, and
 * `src/main/window-minimum.test.ts` asserts the two have not drifted apart.
 *
 * 640x540 is deliberately inside the narrow tier `styles.clipping.css` already designs for
 * (`max-width: 720px`, `max-height: 640px`). A minimum above that tier would leave those rules
 * unreachable — present, passing their source guard, and never rendered by anyone.
 */
export const MIN_WINDOW_WIDTH = 640
export const MIN_WINDOW_HEIGHT = 540
