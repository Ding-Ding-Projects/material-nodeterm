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
  ariaLabel
}: {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="md3-switch"
    >
      <span className="md3-switch__knob" />
    </button>
  )
}
