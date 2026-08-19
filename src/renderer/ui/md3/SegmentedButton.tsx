import { cn } from '../cn'

export interface SegmentedButtonProps<T extends string> {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel?: string
  className?: string
}

/**
 * MD3 segmented button — one 40px pill container, 1px `--md-outline` border, the selected segment
 * filled `secondary-container`. Measured off the Canvas/Board/Files prototypes' own nav toggle
 * (`design/v2/MD3 Board.dc.html` — Canvas | Board), which is exactly this shape at exactly this
 * size, so it doubles as the header nav-switcher recipe.
 *
 * Prop shape matches `ui/SegmentedPill.tsx` exactly (`{ value, options, onChange, ariaLabel }`),
 * which now re-exports this component rather than keeping its own, differently-themed
 * implementation — see that file.
 */
export function SegmentedButton<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className
}: SegmentedButtonProps<T>): React.JSX.Element {
  return (
    <div className={cn('mdx-seg', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={cn('mdx-seg__opt', opt.value === value && 'mdx-seg__opt--active')}
          onClick={() => {
            if (opt.value !== value) onChange(opt.value)
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
