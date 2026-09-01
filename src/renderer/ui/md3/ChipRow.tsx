import { Children, useState, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn'
import { Chip } from './Chip'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

export interface ChipRowProps extends HTMLAttributes<HTMLDivElement> {
  /** A short leading label ("Terminal profile"). */
  label?: string
  /** Show only this many chips until the reader expands the row. Omit for no collapsing. */
  collapseAfter?: number
  children: ReactNode
}

/**
 * A wrapping row of chips that is never clipped. A row that would overflow its panel is
 * collapsed behind a "+N more" assist chip instead of a fixed `max-height` + scroll gutter, which
 * is what used to cut the Node Catalog's third row of profile chips in half.
 */
export function ChipRow({ label, collapseAfter, className, children, ...rest }: ChipRowProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [expanded, setExpanded] = useState(false)
  const items = Children.toArray(children)
  const hidden = collapseAfter !== undefined && !expanded ? Math.max(0, items.length - collapseAfter) : 0
  const visible = hidden > 0 ? items.slice(0, collapseAfter) : items
  return (
    <div className={cn('mdx-chip-row', className)} {...rest}>
      {label && <span className="mdx-chip-row__label">{vocab(label)}</span>}
      {visible}
      {hidden > 0 && (
        <Chip type="button" onClick={() => setExpanded(true)} vocabularyMode="factual" aria-label={`${vocab('Show')} ${hidden} ${vocab('more')}`}>
          {`+${hidden} ${vocab('more')}`}
        </Chip>
      )}
      {collapseAfter !== undefined && expanded && items.length > collapseAfter && (
        <Chip type="button" onClick={() => setExpanded(false)}>
          Show fewer
        </Chip>
      )}
    </div>
  )
}
