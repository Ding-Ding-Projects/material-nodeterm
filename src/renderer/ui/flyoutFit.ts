/**
 * Keep a submenu flyout inside the viewport.
 *
 * The PARENT menu has had edge-flipping since forever (`useMenuFlip`), but a flyout never did:
 * `.ctx-submenu` is plain `position: absolute; left: calc(100% - 4px); top: -6px`, which knows
 * about the row it hangs off and nothing about the window. So a long list — the Windows
 * "Restart with profile…" one, which grows with every installed shell and WSL distribution —
 * opened downward from its row and ran straight off the bottom of the screen, with the last
 * entries unreachable. Right-clicking near the right edge did the same thing sideways.
 *
 * Pure so the decision can be tested without a DOM: jsdom reports every rect as zero, so a test
 * driving the real component could never tell a correct clamp from a broken one.
 *
 * Two different remedies, because the axes are not symmetrical:
 * - Vertically the flyout SLIDES UP. Flipping it to hang entirely above its row would detach it
 *   from the row it belongs to when the list is tall.
 * - Horizontally it FLIPS to the other side of the row, which is what every native menu does.
 *   Sliding sideways would put the flyout on top of its own parent menu.
 */

export interface FlyoutBox {
  /** Viewport coordinates of the flyout as currently laid out, plus its natural size. */
  top: number
  left: number
  width: number
  height: number
}

export interface FlyoutHost {
  /** Viewport x-coordinates of the row the flyout hangs off. */
  left: number
  right: number
}

export interface Viewport {
  width: number
  height: number
}

export interface FlyoutFit {
  /** Pixels to move the flyout UP. Never negative — a flyout that fits is never pushed down. */
  shiftY: number
  /** Open on the row's left instead of its right. */
  flipX: boolean
}

export const FLYOUT_MARGIN = 6

export function fitFlyout(
  flyout: FlyoutBox,
  host: FlyoutHost,
  viewport: Viewport,
  margin: number = FLYOUT_MARGIN,
): FlyoutFit {
  const overflowBelow = flyout.top + flyout.height - (viewport.height - margin)
  // Clamped by how much room there is ABOVE, so a flyout taller than the viewport pins to the top
  // margin and scrolls rather than sliding its own header off the screen. `Math.max(0, …)` is what
  // keeps a flyout that already fits exactly where the CSS put it.
  const shiftY = overflowBelow > 0 ? Math.max(0, Math.min(overflowBelow, flyout.top - margin)) : 0

  // Only flip when the other side can actually hold it. Flipping into an even smaller gap trades a
  // clipped right edge for a clipped left one, and the left edge hides the labels, not the chevrons.
  const overflowsRight = flyout.left + flyout.width > viewport.width - margin
  const fitsOnLeft = host.left - flyout.width >= margin
  return { shiftY, flipX: overflowsRight && fitsOnLeft }
}
