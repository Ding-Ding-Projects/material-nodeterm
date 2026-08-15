import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from './cn'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-8 rounded-md border border-border bg-bg px-2.5 text-[13px] text-text outline-none placeholder:text-muted-2 focus:border-accent',
          className
        )}
        {...rest}
      />
    )
  }
)
