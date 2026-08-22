/**
 * Re-exports `ui/md3/SegmentedButton` under this component's historical name. Its prop shape
 * (`{ value, options, onChange, ariaLabel }`, generic over `T extends string`) is byte-identical
 * to what this file used to declare itself, so there is no call site to migrate — every existing
 * `<SegmentedPill .../>` usage now renders the MD3 primitive (40px pill, `--md-outline` border,
 * `secondary-container` selected segment) instead of the old `.seg-pill`/`.seg-pill-opt` classes
 * in `styles.css`, which stayed on the app's pre-MD3 `--tint-rgb` palette rather than the token
 * set the rest of the app moved onto.
 */
export { SegmentedButton as SegmentedPill } from './md3/SegmentedButton'
