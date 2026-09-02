import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Viewport-edge flip for fixed-position menus (context menus, the tab caret menu): measured
 * after render but BEFORE paint (useLayoutEffect — no visible jump), and re-measured on size
 * changes (ResizeObserver — the tab menu GROWS while open when its account/permission-mode
 * sub-lists expand, and a grown menu near the bottom edge must lift itself).
 *
 * - Vertically: if the menu would overflow below, its BOTTOM is anchored at `flipBase`
 *   (default = `top`; a dropdown passes its anchor's TOP edge so the flip opens above the
 *   anchor, not above the dropdown gap). The margin clamp is the last resort for a menu
 *   taller than the viewport.
 * - Horizontally: clamped so the right edge stays inside the viewport (native-menu behavior
 *   for both cursor menus and anchored dropdowns).
 */
export function useMenuFlip(
  top: number,
  left: number,
  flipBase?: number
): { ref: RefObject<HTMLDivElement>; top: number; left: number } {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top, left })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const M = 6
    // A flipped-up menu used to clamp at `M`, i.e. 6px from the very top — straight under the top
    // app bar, which it then painted over (menu z 46+ vs bar 30). That hid the bar's own controls
    // AND covered its drag region. Clamp to the bar's real bottom edge when one is mounted; a
    // surface without a bar (the widget window) measures 0 and keeps the old behaviour.
    const barBottom = (): number =>
      document.querySelector('.md3-app-bar')?.getBoundingClientRect().bottom ?? 0
    const measure = (): void => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const t = top + h > window.innerHeight - M ? Math.max(Math.max(M, barBottom() + M), (flipBase ?? top) - h) : top
      const l = Math.max(M, Math.min(left, window.innerWidth - w - M))
      // Identity-guarded so a parent re-render (or an RO tick with no real change) can't loop.
      setPos((p) => (p.top === t && p.left === l ? p : { top: t, left: l }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [top, left, flipBase])
  return { ref, top: pos.top, left: pos.left }
}
