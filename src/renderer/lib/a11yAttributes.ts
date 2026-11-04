/** The accessibility tool modes as they reach the DOM: one `data-a11y-*` attribute each on <html>,
 *  present only while the mode is on. ui/md3/primitives.css keys every rule off these. */
export interface A11yModes {
  contrast: boolean
  motion: boolean
  focus: boolean
  targets: boolean
}

const ATTRIBUTES: Record<keyof A11yModes, string> = {
  contrast: 'a11yContrast',
  motion: 'a11yMotion',
  focus: 'a11yFocus',
  targets: 'a11yTargets'
}

/** Set or clear each attribute so the root reflects exactly the given modes. An off mode removes
 *  its attribute rather than writing a falsy value, so no rule can match on a stale `"off"`. */
export function applyA11yAttributes(root: Pick<HTMLElement, 'dataset'>, modes: A11yModes): void {
  for (const key of Object.keys(ATTRIBUTES) as (keyof A11yModes)[]) {
    const name = ATTRIBUTES[key]
    if (modes[key]) root.dataset[name] = key === 'motion' ? 'reduced' : 'on'
    else delete root.dataset[name]
  }
}
