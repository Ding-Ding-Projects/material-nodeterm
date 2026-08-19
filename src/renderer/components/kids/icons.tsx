/**
 * A small icon set local to Kids mode's own screens.
 *
 * The design (`design/v2/MD3 Kids Mode.dc.html`) draws every glyph as a Material Symbols
 * Rounded ligature (`<span class="msr">smart_toy</span>`), and that font is not bundled anywhere
 * in this repository yet — it is cross-cutting work several other lanes of this same redesign
 * would also need, and none of them own it either. Rather than ship icons that render as literal
 * un-styled words ("smart_toy") on any build that lands before the font does, these screens use
 * small inline stroke SVGs matching the style already established in `components/icons.tsx`
 * (16–18px viewBox 24, `stroke="currentColor"`) — real vector icons that work with zero external
 * dependencies, in every theme, at every size. `components/icons.tsx` itself is reused directly
 * for the handful of glyphs it already has (lock/unlock, terminal, pencil) rather than
 * duplicated here.
 */

type IconProps = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

/** Beep's own mark: a friendly rounded robot head. Used for the avatar bubble and the "Talk to
 *  Beep" tile so the two read as the same character. */
export function IconBeep({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="8" width="16" height="12" rx="5" />
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="14" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.3" fill="currentColor" stroke="none" />
      <path d="M9.5 17.5c.9.6 4.1.6 5 0" />
    </svg>
  )
}

export function IconBrush({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14.5 3.5 20 9l-8.2 8.2a3 3 0 0 1-1.5.8l-3.6.8.8-3.6a3 3 0 0 1 .8-1.5L16.5 5.5" />
      <path d="M6 17c-1.4 0-2.5 1.1-2.5 2.5S4.6 22 6 22c1.9 0 3.5-1.6 3.5-3.5 0-1-.5-1.5-1.5-1.5" />
    </svg>
  )
}

export function IconBook({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 0 2.5-2.5v-13Z" />
    </svg>
  )
}

export function IconSpeaker({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M17 8.5a5 5 0 0 1 0 7" />
      <path d="M19.5 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  )
}

export function IconSparkle({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none">
      <path d="M12 2.5c.5 3.3 1.4 5 3 6.5s3.2 2.5 6.5 3c-3.3.5-5 1.4-6.5 3S12 18.7 12 21.5c-.5-3.3-1.4-5-3-6.5s-3.2-2.5-6.5-3c3.3-.5 5-1.4 6.5-3S11.5 5.8 12 2.5Z" />
    </svg>
  )
}

export function IconSun({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  )
}

export function IconClock({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export function IconHourglass({ size = 24 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 4 2.5 6 5 8-2.5 2-5 4-5 8M17 3c0 4-2.5 6-5 8 2.5 2 5 4 5 8" />
    </svg>
  )
}

export function IconBackArrow({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  )
}

export function IconCode({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 8 4 12l5 4M15 8l5 4-5 4" />
    </svg>
  )
}

export function IconChevronDown({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function IconPlay({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  )
}
