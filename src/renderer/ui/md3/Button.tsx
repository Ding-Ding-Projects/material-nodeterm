import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../cn'

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text'

/** M3 Expressive button sizes. `small` (32px) exists for dense rows -- settings controls,
 *  toolbars -- where the 40px default would break an existing row height. */
export type ButtonSize = 'medium' | 'small'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** @default 'filled' */
  variant?: ButtonVariant
  /** @default 'medium' */
  size?: ButtonSize
  /** Layers the error tone onto whichever `variant` is chosen — the design's convention for the
   *  one dangerous action in an otherwise neutral action row. */
  danger?: boolean
  /** Icon rendered before the label (tightens left padding per the M3 spec, same as
   *  `trailingIcon`). Pass a `<MaterialSymbol .../>` or any small element. */
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

/**
 * Material Design 3 button — filled / tonal / outlined / text, all 40px pills
 * (`design/v2/md3/HANDOFF.md`'s component-recipe table). A thin wrapper: the class names carry
 * the whole visual (`ui/md3/primitives.css`), this component only resolves the variant and
 * forwards everything else.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'filled', size = 'medium', danger = false, leadingIcon, trailingIcon, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'mdx-btn',
        `mdx-btn--${variant}`,
        size === 'small' && 'mdx-btn--small',
        danger && 'mdx-btn--danger',
        Boolean(leadingIcon) && 'mdx-btn--has-leading-icon',
        Boolean(trailingIcon) && 'mdx-btn--has-trailing-icon',
        className
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  )
})
