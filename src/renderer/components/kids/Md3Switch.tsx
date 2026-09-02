/**
 * The Kids-mode switch is the shared MD3 `Switch` (`ui/Switch.tsx`, 52×32 track, 24px/16px knob
 * on `--md-*` tokens). This file used to carry a second copy of the same recipe; it now only
 * keeps the historical name so the Kids screens need no import churn.
 */
import { Switch } from '../../ui/Switch'

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
  return <Switch checked={checked} onChange={onChange} ariaLabel={ariaLabel} disabled={disabled} vocabularyMode="factual" />
}
