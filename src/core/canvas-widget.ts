/**
 * Pure logic for the "escape to widget window" feature (a terminal node popped out of the
 * canvas into its own always-on-top-configurable desktop window). See `Settings.canvasWidgets`
 * in `shared/types.ts` for the persisted shape and `main/canvas-widget-window.ts` for the
 * Electron-side window management this feeds.
 *
 * Electron-free by design (see `src/core/no-electron.test.ts`): everything here is testable
 * without a display, a BrowserWindow, or even Electron installed.
 */

import type { CanvasWidgetState } from '../shared/types'

/** Default widget size in CSS/device-independent pixels — comfortably fits one terminal's worth
 *  of a typical monospace grid (80x24 at a normal font size) plus the widget's own title bar. */
export const WIDGET_DEFAULT_WIDTH = 480
export const WIDGET_DEFAULT_HEIGHT = 360

/** Never let a widget shrink below a size where its title bar controls (always-on-top toggle,
 *  back-to-canvas, close) stop fitting or the terminal becomes unreadable. */
export const WIDGET_MIN_WIDTH = 240
export const WIDGET_MIN_HEIGHT = 160

/** A screen's usable work area, in the same coordinate space as a widget's bounds. Electron's
 *  `screen.getDisplayNearestPoint(...).workArea` has exactly this shape; kept as our own type so
 *  this module never imports `electron`. */
export interface ScreenWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WidgetBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Clamp a widget's bounds so it is never smaller than the minimum size and never opens fully (or
 * mostly) off-screen — the trap that makes a popped-out window unreachable, most commonly after
 * a monitor is unplugged or a saved position came from a larger display. Requires only a sliver
 * (`MIN_VISIBLE_PX`) of the window to remain inside the work area rather than the whole window,
 * so a deliberately edge-docked widget is not forced back to center on every launch.
 */
const MIN_VISIBLE_PX = 40

export function clampWidgetBounds(bounds: WidgetBounds, workArea: ScreenWorkArea): WidgetBounds {
  const width = Math.max(WIDGET_MIN_WIDTH, Math.min(bounds.width, workArea.width))
  const height = Math.max(WIDGET_MIN_HEIGHT, Math.min(bounds.height, workArea.height))
  const maxX = workArea.x + workArea.width - MIN_VISIBLE_PX
  const minX = workArea.x + MIN_VISIBLE_PX - width
  const maxY = workArea.y + workArea.height - MIN_VISIBLE_PX
  const minY = workArea.y + MIN_VISIBLE_PX - height
  const x = Math.min(Math.max(bounds.x, minX), maxX)
  const y = Math.min(Math.max(bounds.y, minY), maxY)
  return { x, y, width, height }
}

/** The bounds a BRAND NEW widget (no saved state for this node) opens with: centered on the given
 *  work area at the default size. Pure — the caller supplies the work area rather than this
 *  module reaching into `electron.screen` itself. */
export function defaultWidgetBounds(workArea: ScreenWorkArea): WidgetBounds {
  const width = Math.min(WIDGET_DEFAULT_WIDTH, workArea.width)
  const height = Math.min(WIDGET_DEFAULT_HEIGHT, workArea.height)
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  }
}

/**
 * The bounds to open a widget with, given its persisted state (if any) and the work area of the
 * display it is opening on. A first-ever open (no saved bounds) centers at the default size; a
 * reopen restores the saved bounds, clamped so a saved-then-stale position (removed monitor,
 * smaller screen) can never leave the window unreachable.
 */
export function resolveOpenBounds(
  saved: CanvasWidgetState['bounds'] | undefined,
  workArea: ScreenWorkArea
): WidgetBounds {
  const base = saved ?? defaultWidgetBounds(workArea)
  return clampWidgetBounds(base, workArea)
}

/** Default persisted state for a node that has never had a widget: always-on-top OFF (the safer
 *  default — an always-on-top window the user did not ask to stay atop everything is an
 *  annoyance, not a convenience) and no saved bounds (first open centers). */
export function defaultCanvasWidgetState(): CanvasWidgetState {
  return { alwaysOnTop: false }
}

/** Merge a patch (bounds moved, always-on-top toggled) into a node's persisted widget state,
 *  creating it from the default if this is the node's first widget interaction. Pure — the
 *  caller owns writing the result into `settings.canvasWidgets` and persisting it. */
export function mergeCanvasWidgetState(
  existing: CanvasWidgetState | undefined,
  patch: Partial<CanvasWidgetState>
): CanvasWidgetState {
  return { ...defaultCanvasWidgetState(), ...existing, ...patch }
}

/**
 * Drop widget state for node ids that no longer exist on any canvas — the same pruning discipline
 * `pruneCollapsedItems` (sidebar disclosure) already applies, so `settings.json` does not grow
 * forever as a canvas churns through nodes. Never mutates the input map.
 */
export function pruneCanvasWidgets(
  widgets: Record<string, CanvasWidgetState>,
  liveNodeIds: ReadonlySet<string>
): Record<string, CanvasWidgetState> {
  let changed = false
  const next: Record<string, CanvasWidgetState> = {}
  for (const [nodeId, state] of Object.entries(widgets)) {
    if (liveNodeIds.has(nodeId)) {
      next[nodeId] = state
    } else {
      changed = true
    }
  }
  return changed ? next : widgets
}
