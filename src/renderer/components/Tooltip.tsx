import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent
} from 'react'
import { createPortal } from 'react-dom'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

interface TooltipProps {
  label: string
  children: ReactNode
  delay?: number
}

/** A custom styled tooltip (portal, fixed-positioned) shown on hover after a short delay. */
export function Tooltip({ label, children, delay = 350 }: TooltipProps) {
  // Personal-vocabulary boundary: a tooltip is pure explanatory prose, and every caller of this
  // component gets the substitution from here rather than wrapping its own label.
  const vocab = useVocabularyMapper()
  const tooltipId = useId()
  const tooltipRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (e: SyntheticEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLElement
    anchorRef.current = e.target instanceof HTMLElement ? e.target : el
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = (anchorRef.current ?? el).getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.bottom + 6 })
    }, delay)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setPos(null)
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  useLayoutEffect(() => {
    if (!pos || !tooltipRef.current || !anchorRef.current) return
    const trigger = anchorRef.current.getBoundingClientRect()
    const tip = tooltipRef.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(
      Math.max(margin + tip.width / 2, trigger.left + trigger.width / 2),
      window.innerWidth - margin - tip.width / 2
    )
    const below = trigger.bottom + 6
    const above = trigger.top - tip.height - 6
    const top = below + tip.height <= window.innerHeight - margin ? below : Math.max(margin, above)
    if (Math.abs(pos.x - left) > 0.5 || Math.abs(pos.y - top) > 0.5) setPos({ x: left, y: top })
  }, [pos])

  useEffect(() => {
    if (!pos || !anchorRef.current) return
    const remeasure = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect) setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 })
    }
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
    }
  }, [pos])

  const describedId = pos ? tooltipId : undefined
  const content = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': [
          (children as ReactElement<{ 'aria-describedby'?: string }>).props['aria-describedby'],
          describedId
        ].filter(Boolean).join(' ') || undefined
      })
    : children

  return (
    <span
      className="tooltip-trigger nodrag"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onMouseDown={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
      aria-describedby={describedId}
      tabIndex={typeof children === 'string' || typeof children === 'number' ? 0 : undefined}
    >
      {content}
      {pos &&
        createPortal(
          <div ref={tooltipRef} id={tooltipId} className="tooltip" role="tooltip" style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}>
            {vocab(label)}
          </div>,
          document.body
        )}
    </span>
  )
}
