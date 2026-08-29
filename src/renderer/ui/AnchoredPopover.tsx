import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'

interface AnchoredPopoverProps {
  /** The field/button this popover belongs to — it opens attached to this element and focus
   *  returns here on close. */
  anchorRef: RefObject<HTMLElement>
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Preferred width in px (the popover still clamps to the viewport). */
  width?: number
  className?: string
  zIndex?: number
  /** Optional caller-owned ref for focus management when several portaled popovers coexist. */
  contentRef?: MutableRefObject<HTMLDivElement | null>
  id?: string
}

/**
 * A popover that stays visually attached to the field/button that opened it — never a detached
 * global dialog. Paints its OWN background/border/elevation (an overlay this project has shipped
 * transparent before, letting whatever's behind it read through the text on top), stays inside
 * the viewport, and SCROLLS its content when it doesn't fit rather than silently clipping it.
 * Escape and an outside click close it; closing always returns focus to the anchor.
 */
export function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  children,
  width = 420,
  className,
  zIndex = 62,
  contentRef,
  id
}: AnchoredPopoverProps): React.JSX.Element | null {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  // Measure the anchor + popover on open (and on resize) so the popover flips above the anchor
  // when it would otherwise overflow the bottom edge, and clamps horizontally within the
  // viewport. maxHeight is recomputed every time so the content SCROLLS instead of the popover
  // silently growing past the screen with no scrollbar to say anything is missing.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const measure = (): void => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const M = 8
      const popH = popRef.current?.offsetHeight ?? 0
      const popW = popRef.current?.offsetWidth ?? width
      const spaceBelow = window.innerHeight - rect.bottom - M
      const spaceAbove = rect.top - M
      const openAbove = spaceBelow < Math.min(popH, 240) && spaceAbove > spaceBelow
      const top = openAbove ? Math.max(M, rect.top - popH - 6) : rect.bottom + 6
      const maxHeight = openAbove ? Math.max(120, spaceAbove) : Math.max(120, spaceBelow)
      const left = Math.max(M, Math.min(rect.left, window.innerWidth - popW - M))
      setPos((p) => (p && p.top === top && p.left === left && p.maxHeight === maxHeight ? p : { top, left, maxHeight }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (popRef.current) ro.observe(popRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [open, anchorRef, width])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // capture: an ancestor field's own Escape handler (e.g. a find bar closing itself) must not
    // steal this key while the builder is open on top of it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  // Return focus to the field/button that opened this, on every close path.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) wasOpen.current = true
    else if (wasOpen.current) {
      wasOpen.current = false
      anchorRef.current?.focus()
    }
  }, [open, anchorRef])

  if (!open) return null

  return createPortal(
    <>
      {/* Transparent click-catcher — an anchored popover reads as attached to the field, not as
          a modal, so it never dims the rest of the screen. */}
      <div className="anchored-pop__backdrop" style={{ zIndex }} onMouseDown={onClose} />
      <div
        ref={(element) => {
          popRef.current = element
          if (contentRef) contentRef.current = element
        }}
        id={id}
        className={`anchored-pop${className ? ` ${className}` : ''}`}
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width,
          maxHeight: pos?.maxHeight,
          zIndex: zIndex + 1,
          visibility: pos ? 'visible' : 'hidden'
        }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="false"
      >
        <div className="anchored-pop__scroll">{children}</div>
      </div>
    </>,
    document.body
  )
}
