import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (e: SyntheticEvent<HTMLElement>) => {
    const el = e.currentTarget as HTMLElement
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
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

  return (
    <span
      className="tooltip-trigger nodrag"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onMouseDown={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
      aria-describedby={pos ? tooltipId : undefined}
      tabIndex={typeof children === 'string' || typeof children === 'number' ? 0 : undefined}
    >
      {children}
      {pos &&
        createPortal(
          <div id={tooltipId} className="tooltip" role="tooltip" style={{ left: pos.x, top: pos.y }}>
            {vocab(label)}
          </div>,
          document.body
        )}
    </span>
  )
}
