import { useRef } from 'react'
import type { ReactNode } from 'react'

import { cn } from '../cn'
import { useTablistKeys } from './useTablistKeys'

export interface TablistProps {
  children: ReactNode
  /** The accessible name. Already-resolved text: this does not map vocabulary for you. */
  ariaLabel: string
  className?: string
  orientation?: 'horizontal' | 'vertical'
  id?: string
}

/**
 * A `role="tablist"` container that actually honours the role.
 *
 * `Tabs.tsx` renders a whole tab strip and is the right choice for a new one. This is for the
 * strips already built out of another Material primitive -- a chip set, a segmented row of
 * buttons -- where the visual is legitimate and only the keyboard contract was missing. Swapping
 * the bare `<div role="tablist">` for this changes nothing on screen and adds Arrow/Home/End
 * traversal plus a roving tab stop, by way of the one shared implementation in `useTablistKeys`.
 *
 * Why a container rather than a hook at each site: eighteen files had hand-rolled strips, and
 * asking each of them to declare a ref and call a hook is eighteen chances to place it in the
 * wrong component and eighteen places for it to be quietly dropped later. A container cannot be
 * adopted halfway -- if the element is a `Tablist`, the contract is on it.
 */
export function Tablist({
  children,
  ariaLabel,
  className,
  orientation = 'horizontal',
  id
}: TablistProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useTablistKeys(ref, orientation)
  return (
    <div
      ref={ref}
      id={id}
      className={cn(className)}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
    >
      {children}
    </div>
  )
}
