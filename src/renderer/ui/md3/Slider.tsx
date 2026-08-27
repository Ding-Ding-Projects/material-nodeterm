import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper, type VocabularyTextMode } from '../../lib/personalVocabulary/useVocabularyText'

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Renders the active track up to the thumb. Pass the same value/min/max you give the input. */
  fill?: boolean
  vocabularyMode?: VocabularyTextMode
}

/**
 * Material Design 3 slider.
 *
 * Deliberately a styled native `<input type="range">` rather than a rebuilt control: the native
 * element already has the keyboard model (arrows, Home/End, Page Up/Down), the pointer and touch
 * handling, and the `slider` role with its value announcements. Rebuilding those is how a
 * hand-rolled slider ends up worse for a keyboard or screen-reader user than the platform one it
 * replaced. Only the paint is ours.
 *
 * `fill` paints the active track with a gradient stop computed from the current value, because
 * `::-webkit-slider-runnable-track` cannot see the thumb position on its own.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { fill = true, className, style, value, min = 0, max = 100, vocabularyMode = 'authored', ...rest },
  ref
) {
  const vocab = useVocabularyMapper()
  const n = Number(value)
  const lo = Number(min)
  const hi = Number(max)
  const pct = fill && Number.isFinite(n) && hi > lo ? ((n - lo) / (hi - lo)) * 100 : null

  return (
    <input
      ref={ref}
      type="range"
      value={value}
      min={min}
      max={max}
      className={cn('mdx-slider', className)}
      style={pct === null ? style : { ...style, ['--mdx-slider-pct' as string]: `${pct}%` }}
      {...rest}
      aria-label={vocabularyMode === 'authored' ? vocab(rest['aria-label']) : rest['aria-label']}
      title={vocabularyMode === 'authored' ? vocab(rest.title) : rest.title}
    />
  )
})
