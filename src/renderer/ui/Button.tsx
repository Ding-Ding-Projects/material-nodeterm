import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

type Variant = 'default' | 'primary' | 'ghost'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ variant = 'default', className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-md px-3 py-1.5 text-[13px] font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'ghost' && 'bg-transparent text-muted hover:text-text',
        // `--tint-rgb` is the app's theme-correct ink tint (white in dark mode, near-black in
        // light — see styles.css), so this hover overlay flips with the theme instead of staying
        // a literal white that vanished into a light `panel-header` background.
        variant === 'default' && 'border border-border bg-panel-header text-text hover:bg-[rgba(var(--tint-rgb),0.06)]',
        className
      )}
      {...rest}
    />
  )
})
