import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Button as Md3Button, type ButtonVariant, type ButtonSize } from './md3'
import { cn } from './cn'
import type { VocabularyTextMode } from '../lib/personalVocabulary/useVocabularyText'

/** The app's historical variant names. Kept so no call site has to change. */
type Variant = 'default' | 'primary' | 'ghost'

/**
 * The app's shared button, now a thin alias for the Material Design 3 primitive
 * (`ui/md3/Button`) rather than a second, pre-MD3 implementation.
 *
 * It used to style itself from the legacy `panel-header` / `border-border` / `bg-accent` tokens,
 * which is why every surface built on it read as generic: no state layer, no M3 shape, and a
 * `primary` variant that painted `text-white` on `--md-primary` -- in the dark theme that is
 * `#D0BCFF`, a light lavender, so the app's most prominent buttons were white-on-lavender instead
 * of using `--md-on-primary`. Delegating fixes that everywhere at once; see docs/md3-primitives.md,
 * which recorded the contrast bug as an unfixed follow-up.
 *
 * The mapping onto M3's own vocabulary:
 * - `primary` -> **filled**   (the one high-emphasis action)
 * - `default` -> **outlined** (a neutral bordered button)
 * - `ghost`   -> **text**     (lowest emphasis)
 *
 * `size` defaults to `small` (32px) rather than M3's 40px, because these call sites are dense
 * settings rows and toolbars that were built around the old 30px button; `small` is a real
 * M3 Expressive size, so this is still the design system rather than an exception to it.
 */
const VARIANTS: Record<Variant, ButtonVariant> = {
  primary: 'filled',
  default: 'outlined',
  ghost: 'text'
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: ButtonSize; danger?: boolean; vocabularyMode?: VocabularyTextMode }
>(function Button({ variant = 'default', size = 'small', danger = false, className, ...rest }, ref) {
  // This compatibility wrapper deliberately owns no second vocabulary boundary. Md3Button is
  // the one producer for its children, aria-label and title, preventing replacement cascades.
  return (
    <Md3Button
      ref={ref}
      variant={VARIANTS[variant]}
      size={size}
      danger={danger}
      className={cn(className)}
      {...rest}
    />
  )
})
