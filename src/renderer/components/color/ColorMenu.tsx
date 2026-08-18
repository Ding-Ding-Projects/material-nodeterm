import { useEffect } from 'react'
import { ContextMenu } from '../ContextMenu'

export interface ColorMenuProps {
  /** Viewport coordinates to open at — normally the trigger chip's bottom-left corner. */
  x: number
  y: number
  /** The target's CURRENT colour, so the full picker opens on it instead of on a preset. Omit
   *  only where "current" would be a lie (see `seedColor`). */
  value?: string
  /** Applied LIVE on every change while the surface stays open. */
  onPick: (color: string) => void
  onClose: () => void
}

/**
 * The colour surface for anything that is not already a `ContextMenu` row: the sticky-note and
 * group-frame header chips, the project tab caret menu.
 *
 * It is deliberately a `ContextMenu` carrying ONE `colors` row rather than a second popover
 * implementation. Everything the reference row already settled comes with it and cannot drift:
 * the seven presets, the wheel chip that opens the full `ColorPicker` in place, live application
 * on every drag with the surface held open, and — load-bearing — the open-picker state living on
 * the MENU rather than on the row, so a re-render of the host (which happens on every single
 * live-applied colour, because the host is what stores the colour) cannot collapse the picker
 * mid-drag. A hand-rolled popover in each node file is how those four rules become three
 * different behaviours.
 *
 * The old surface here was a `.color-popover` inside the node, which had two further problems a
 * portal fixes: `.sticky-node` is `overflow: hidden`, so a 280px picker inside a 160px-wide note
 * was clipped, and a popover inside the React Flow viewport is scaled by the canvas zoom — a
 * saturation field is unusable at 40%.
 */
export function ColorMenu({ x, y, value, onPick, onClose }: ColorMenuProps): React.JSX.Element {
  // ContextMenu closes on its backdrop; Escape is the other half of the contract, and a colour
  // surface that applies live has no "cancel" button by design. Capture phase + stopPropagation
  // so this Escape closes the picker ONLY — the canvas's own Escape (clear selection / cancel the
  // draw tool) must not also fire on the keypress that dismissed a popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return <ContextMenu x={x} y={y} items={[{ type: 'colors', value, onPick }]} onClose={onClose} />
}
