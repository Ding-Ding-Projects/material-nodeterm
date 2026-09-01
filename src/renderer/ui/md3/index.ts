/**
 * Shared Material Design 3 primitive components — the vocabulary `design/v2/md3/HANDOFF.md`
 * describes, extracted from the scoped, per-lane BEM classes fourteen parallel lanes each wrote
 * while shipping `styles.md3.css`. Importing anything from this barrel pulls in its stylesheet
 * (`primitives.css`) too, so a consumer needs no separate CSS import to use these.
 *
 * The app's shared controls (`ui/Button`, `ui/Input`, `ui/Select`, `ui/SegmentedPill`) now
 * DELEGATE to these, so most call sites render the design system without importing this barrel
 * directly. What is not migrated is the raw `<button>` population — see docs/md3-primitives.md.
 */
import './primitives.css'

export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'

export { Fab } from './Fab'
export type { FabProps } from './Fab'

export { Switch } from './Switch'

export { TextField } from './TextField'
export type { TextFieldProps } from './TextField'

export { Chip } from './Chip'
export type { ChipProps } from './Chip'

export { StatusChip } from './StatusChip'
export type { StatusChipProps, StatusTone } from './StatusChip'

export { Card } from './Card'
export type { CardProps, CardTone, CardShape } from './Card'

export { ListRow } from './ListRow'
export type { ListRowProps } from './ListRow'

export { Menu } from './Menu'
export type { MenuProps } from './Menu'

export { Dialog } from './Dialog'
export type { DialogProps } from './Dialog'

export { Badge } from './Badge'
export type { BadgeProps } from './Badge'

export { SegmentedButton } from './SegmentedButton'
export type { SegmentedButtonProps } from './SegmentedButton'

export { Checkbox } from './Checkbox'
export type { CheckboxProps } from './Checkbox'

export { TextArea } from './TextArea'
export type { TextAreaProps } from './TextArea'

export { Slider } from './Slider'
export type { SliderProps } from './Slider'

export { NumberField } from './NumberField'
export type { NumberFieldProps } from './NumberField'

export { Radio } from './Radio'
export type { RadioProps } from './Radio'

export { Progress } from './Progress'
export type { ProgressProps } from './Progress'

export { Tabs } from './Tabs'
export type { TabOption, TabsProps } from './Tabs'

export { SearchField } from './SearchField'
export type { SearchFieldProps } from './SearchField'

export { ChipRow } from './ChipRow'
export type { ChipRowProps } from './ChipRow'

export { Snackbar, SnackbarStack } from './Snackbar'
export type { SnackbarProps, SnackbarAction, SnackbarTone } from './Snackbar'

export { Divider } from './Divider'
export type { DividerProps } from './Divider'
