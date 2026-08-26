import { useEffect, useRef } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

export interface TabOption {
  id: string
  label: string
  disabled?: boolean
}

export interface TabsProps {
  items: readonly TabOption[]
  value?: string
  onChange: (id: string) => void
  /** Called when a missing or disabled value is corrected to the first enabled tab. */
  onInvalidValue?: (id: string | undefined) => void
  ariaLabel: string
  orientation?: 'horizontal' | 'vertical'
  className?: string
  tabClassName?: string
  activeTabClassName?: string
  idPrefix?: string
  panelIdPrefix?: string | null
}

/**
 * Material Design 3 tabs with a roving keyboard focus model.
 *
 * Feature surfaces keep their existing BEM classes through the class-name props, while this
 * component owns the shared tab/listbox roles, selected state, focus ring and arrow/Home/End
 * navigation. A tab list that only looks selected but cannot be traversed with a keyboard is a
 * custom lookalike, so the interaction contract lives here with the visual recipe.
 */
export function Tabs({
  items,
  value,
  onChange,
  onInvalidValue,
  ariaLabel,
  orientation = 'horizontal',
  className,
  tabClassName,
  activeTabClassName,
  idPrefix = 'tab',
  panelIdPrefix
}: TabsProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const enabledItems = items.filter((item) => !item.disabled)
  const selected = enabledItems.find((item) => item.id === value) ?? enabledItems[0]
  const activeIndex = Math.max(0, enabledItems.findIndex((item) => item.id === selected?.id))

  useEffect(() => {
    if (value !== selected?.id) onInvalidValue?.(selected?.id)
  }, [onInvalidValue, selected?.id, value])

  const focusAt = (index: number): void => {
    if (enabledItems.length === 0) return
    const item = enabledItems[(index + enabledItems.length) % enabledItems.length]
    if (!item) return
    onChange(item.id)
    refs.current[item.id]?.focus()
  }

  return (
    <div
      className={cn('mdx-tabs', orientation === 'vertical' && 'mdx-tabs--vertical', className)}
      role="tablist"
      aria-label={vocab(ariaLabel)}
      aria-orientation={orientation}
    >
      {items.map((item) => {
        const isSelected = item.id === selected?.id
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[item.id] = node
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-${item.id}`}
            aria-selected={isSelected}
            aria-controls={isSelected && panelIdPrefix ? `${panelIdPrefix}-${item.id}` : undefined}
            tabIndex={isSelected ? 0 : -1}
            disabled={item.disabled}
            className={cn(tabClassName, isSelected && activeTabClassName)}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              const forward = orientation === 'vertical' ? event.key === 'ArrowDown' : event.key === 'ArrowRight'
              const backward = orientation === 'vertical' ? event.key === 'ArrowUp' : event.key === 'ArrowLeft'
              if (forward) {
                event.preventDefault()
                focusAt(activeIndex + 1)
              } else if (backward) {
                event.preventDefault()
                focusAt(activeIndex - 1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                focusAt(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                focusAt(enabledItems.length - 1)
              }
            }}
          >
            {vocab(item.label)}
          </button>
        )
      })}
    </div>
  )
}
