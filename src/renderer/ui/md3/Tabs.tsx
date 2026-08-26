import { useRef } from 'react'
import { cn } from '../cn'

export interface TabOption {
  id: string
  label: string
  disabled?: boolean
}

export interface TabsProps {
  items: readonly TabOption[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
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
  ariaLabel,
  className,
  tabClassName,
  activeTabClassName,
  idPrefix = 'tab',
  panelIdPrefix
}: TabsProps): React.JSX.Element {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const enabledItems = items.filter((item) => !item.disabled)
  const activeIndex = Math.max(0, enabledItems.findIndex((item) => item.id === value))

  const focusAt = (index: number): void => {
    if (enabledItems.length === 0) return
    const item = enabledItems[(index + enabledItems.length) % enabledItems.length]
    if (!item) return
    onChange(item.id)
    refs.current[item.id]?.focus()
  }

  return (
    <div className={cn('mdx-tabs', className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[item.id] = node
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-${item.id}`}
            aria-selected={selected}
            aria-controls={selected && panelIdPrefix ? `${panelIdPrefix}-${item.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={cn(tabClassName, selected && activeTabClassName)}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                focusAt(activeIndex + 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
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
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
