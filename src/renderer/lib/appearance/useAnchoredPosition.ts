import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Positions a non-modal popover BESIDE an anchor element, tracking it while open and handling
 * viewport-edge collision on both axes without the popover becoming visually detached from its
 * anchor: it prefers the anchor's right edge, flips to the LEFT edge when the right side wouldn't
 * fit (rather than the plain horizontal clamp `useMenuFlip` uses for menus, which would leave a
 * gap between the anchor and a popover pushed back into the viewport), and clamps vertically.
 */
export function useAnchoredPosition(
  anchorEl: HTMLElement | null,
  open: boolean
): { ref: RefObject<HTMLDivElement>; top: number; left: number } {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: -9999, left: -9999 })

  useLayoutEffect(() => {
    if (!open || !anchorEl) return
    const el = ref.current
    if (!el) return
    const M = 8
    const measure = (): void => {
      const rect = anchorEl.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      let left = rect.right + M
      if (left + w > window.innerWidth - M) {
        const leftSide = rect.left - w - M
        left = leftSide >= M ? leftSide : Math.max(M, window.innerWidth - w - M)
      }
      let top = rect.top
      if (top + h > window.innerHeight - M) top = Math.max(M, window.innerHeight - h - M)
      if (top < M) top = M
      setPos((p) => (p.top === top && p.left === left ? p : { top, left }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const onScrollOrResize = () => measure()
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [anchorEl, open])

  return { ref, top: pos.top, left: pos.left }
}
