/**
 * A plain MD3 switch matching `MD3 Kids Mode.dc.html`'s own recipe (52×32 track, 24px/16px
 * knob) exactly — not a reuse of `ui/Switch.tsx`, which is 42×24, uses a `box-shadow` on the
 * knob, and reads Tailwind's `bg-accent`/`bg-fill` utilities rather than `--md-*` tokens
 * directly. Rule #3 in this lane's brief forbids new `box-shadow` chrome, and rule #2 asks for
 * real classes reading tokens rather than Tailwind arbitrary values — this is that, self-contained
 * so it never drifts from the recipe other MD3 lanes are matching too.
 */
export function Md3Switch({
  checked,
  onChange,
  ariaLabel,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={'md3-switch' + (checked ? ' md3-switch--on' : '')}
      onClick={() => onChange(!checked)}
    >
      <span className="md3-switch__knob" />
    </button>
  )
}
