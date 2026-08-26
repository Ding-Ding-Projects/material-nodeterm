import type { SelectHTMLAttributes } from 'react'
import './md3/primitives.css'
import { cn } from './cn'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

/**
 * The app's dense select, on the same Material Design 3 outlined-field anatomy as `ui/Input`
 * (`.mdx-select`, `ui/md3/primitives.css`). The chevron is drawn rather than left to the
 * platform, so the control looks identical on every OS -- a native select arrow is the one part
 * of a form that most obviously is not the design system.
 */
export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <span className="mdx-select__wrap">
      <select className={cn('mdx-select', className)} {...rest} aria-label={vocab(rest['aria-label'])} title={vocab(rest.title)}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        className="mdx-select__arrow"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 4.5 6 7.5l3-3" />
      </svg>
    </span>
  )
}
