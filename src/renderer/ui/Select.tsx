import { Children, cloneElement, isValidElement, type ReactNode, type SelectHTMLAttributes } from 'react'
import './md3/primitives.css'
import { cn } from './cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../lib/personalVocabulary/useVocabularyText'

function mapOptionChildren(children: ReactNode, map: ReturnType<typeof useVocabularyMapper>): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    const props = child.props as { children?: ReactNode; label?: unknown }
    if (child.type === 'option') {
      const label = props.children
      return typeof label === 'string' ? cloneElement(child, undefined, map(label)) : child
    }
    if (child.type === 'optgroup') {
      const label = props.label
      return cloneElement(child, {
        label: typeof label === 'string' ? map(label) : label
      }, mapOptionChildren(props.children, map))
    }
    return child
  })
}

/**
 * The app's dense select, on the same Material Design 3 outlined-field anatomy as `ui/Input`
 * (`.mdx-select`, `ui/md3/primitives.css`). The chevron is drawn rather than left to the
 * platform, so the control looks identical on every OS -- a native select arrow is the one part
 * of a form that most obviously is not the design system.
 */
export function Select({
  className,
  children,
  vocabularyOptions = true,
  vocabularyMode = 'authored',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { vocabularyOptions?: boolean; vocabularyMode?: VocabularyTextMode }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <span className="mdx-select__wrap">
      <select className={cn('mdx-select', className)} {...rest} aria-label={vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']} title={vocabularyMode === 'authored' ? vocab(rest.title) : rest.title}>
        {vocabularyOptions && vocabularyMode === 'authored' ? mapOptionChildren(children, vocab) : children}
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
