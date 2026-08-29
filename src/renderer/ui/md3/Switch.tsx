/**
 * The MD3 switch (52×32 track, 16px→24px knob — HANDOFF's literal recipe) already exists at
 * `ui/Switch.tsx` and already implements this exactly, styled by `.md3-switch`/`.md3-switch__knob`
 * in `styles.md3.css`. Re-exported here rather than duplicated so `ui/md3` is a complete barrel
 * without a second, competing implementation of the same control.
 */
export { Switch } from '../Switch'
