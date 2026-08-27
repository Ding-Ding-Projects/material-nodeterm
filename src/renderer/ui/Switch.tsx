import { useVocabularyTemplate, type VocabularyTextMode } from '../lib/personalVocabulary/useVocabularyText'

/**
 * Material Design 3 switch: 52×32 track, 16px off-knob growing to a 24px on-knob (recipe in
 * design/v2/md3/HANDOFF.md's component table). `.md3-switch`/`.md3-switch__knob` (styles.md3.css)
 * do the whole visual — this component just owns the `role="switch"` contract, which several
 * built-app harnesses key off directly (the first switch on Settings → Agents, in particular),
 * so it stays a plain `<button>` in normal document flow rather than gaining any positioning of
 * its own.
 */
export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  vocabularyMode = 'authored',
  ariaLabelParams
  disabled = false
}: {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel?: string
  vocabularyMode?: VocabularyTextMode
  ariaLabelParams?: Record<string, string>
  /** Renders inert (native `disabled` + aria): for a switch whose subject does not currently
   *  exist, e.g. a per-project capability while no project is open. */
  disabled?: boolean
}): React.JSX.Element {
  const mappedAriaLabel = useVocabularyTemplate(ariaLabel, ariaLabelParams)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={vocabularyMode === 'authored' ? mappedAriaLabel : ariaLabel}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={() => onChange(!checked)}
      className="md3-switch"
      aria-label={ariaLabel}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative box-border block h-[24px] w-[42px] shrink-0 rounded-full border-0 p-0 outline-none transition-colors duration-200',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'bg-accent' : 'bg-fill'
      )}
    >
      <span className="md3-switch__knob" />
    </button>
  )
}
