import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> {
  /** Icon before the input (a magnifier glyph, usually). */
  leadingIcon?: ReactNode
  /** The slot for the `.*` anchored-regex trigger, or a clear button. */
  trailingSlot?: ReactNode
  /** 40px instead of 44px — inside a toolbar row that is already dense. */
  dense?: boolean
  /** Wrapper className — the pill is the field. */
  className?: string
  /** Extra class on the native input, for the few tests and scripts that address it by class. */
  inputClassName?: string
  vocabularyMode?: VocabularyTextMode
}

/**
 * The docked search pill (`design/v2/md3/HANDOFF.md`: "Search: docked bar 44px pill
 * surface-container-high"), shared by every panel with a filter field. Renders `.mdx-search`
 * with a native `type="search"` input and a trailing slot — see primitives.css for why the pill
 * is `min-height`/`flex: 0 0 auto` and not the `height`/`flex-basis` pair its predecessors used.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { leadingIcon, trailingSlot, dense = false, className, inputClassName, vocabularyMode = 'authored', ...rest },
  ref
) {
  const vocab = useVocabularyMapper()
  const mapped = (value: string | undefined): string | undefined =>
    vocabularyMode === 'authored' ? vocab(value) : value
  return (
    <div className={cn('mdx-search', dense && 'mdx-search--dense', className)}>
      {leadingIcon && <span className="mdx-search__icon" aria-hidden>{leadingIcon}</span>}
      <input
        ref={ref}
        type="search"
        className={cn('mdx-search__input', inputClassName)}
        spellCheck={false}
        {...rest}
        aria-label={mapped(rest['aria-label'])}
        title={mapped(rest.title)}
        placeholder={mapped(rest.placeholder)}
      />
      {trailingSlot && <div className="mdx-search__trailing">{trailingSlot}</div>}
    </div>
  )
})
