import { useI18n } from '@renderer/lib/i18n'

/**
 * Renders a catalogue string for the active language mode. In `en`/`yue` mode this is just the
 * resolved text; in `bilingual` mode the English stays prominent and the Cantonese renders as a
 * compact secondary line beneath it — never a full second row of the SAME size, which is what
 * would crowd a narrow settings column or a dialog body.
 *
 * Use this for block-level text (headings, paragraphs, descriptions). For a single-line context
 * that can't stack two lines — a button label, an aria-label, a window title — call `useI18n().ts()`
 * directly instead, which joins the two with " · ".
 */
export function Localized({
  id,
  fallback,
  params,
  as: Tag = 'span',
  className,
  secondaryClassName
}: {
  id: string
  fallback: string
  params?: Record<string, string>
  as?: keyof React.JSX.IntrinsicElements
  className?: string
  secondaryClassName?: string
}): React.JSX.Element {
  const { t } = useI18n()
  const { primary, secondary } = t(id, fallback, params)
  if (!secondary) return <Tag className={className}>{primary}</Tag>
  return (
    <Tag className={className}>
      <span>{primary}</span>
      <span className={secondaryClassName ?? 'mt-0.5 block text-[12px] text-muted-2'}>
        {secondary}
      </span>
    </Tag>
  )
}
