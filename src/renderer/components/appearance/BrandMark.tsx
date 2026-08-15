/**
 * The shipped app mark, as a component rather than inlined at each call site — so the logo
 * presets (docs/app-logo.md) and every place that shows the brand mark render the exact same
 * shape. `idSuffix` keeps the gradient id unique when more than one instance is on the page at
 * once (two identical `id="ntg"` defs would make the SECOND one win everywhere).
 */
export function BrandMark({
  idSuffix,
  from,
  to,
  dot,
  center = '#fff',
  size = 26
}: {
  idSuffix: string
  from: string
  to: string
  dot: string
  center?: string
  size?: number
}): React.JSX.Element {
  const gradId = `ntg-${idSuffix}`
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <path
        d="M13 12 L31 24 L13 36"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="13" cy="12" r="3.6" fill={dot} />
      <circle cx="13" cy="36" r="3.6" fill={dot} />
      <circle cx="31" cy="24" r="3.6" fill={center} />
      <rect x="33.5" y="32.5" width="10.5" height="5" rx="2.5" fill={dot} />
    </svg>
  )
}

export interface AppLogoPreset {
  id: string
  label: string
  render: (size?: number) => React.JSX.Element
}

/** Shipped, project-appropriate presets (docs/app-logo.md § Presets) — recolours of the same mark
 *  rather than unrelated artwork, so every preset still reads as "nodeterm" at a glance. */
export const APP_LOGO_PRESETS: AppLogoPreset[] = [
  {
    id: 'shipped',
    label: 'Default (purple)',
    render: (size) => <BrandMark idSuffix="shipped" from="#a38dff" to="#622994" dot="#a38dff" size={size} />
  },
  {
    id: 'ocean',
    label: 'Ocean',
    render: (size) => <BrandMark idSuffix="ocean" from="#6cd4ff" to="#0a5fa8" dot="#6cd4ff" size={size} />
  },
  {
    id: 'ember',
    label: 'Ember',
    render: (size) => <BrandMark idSuffix="ember" from="#ffb37a" to="#a8390a" dot="#ffb37a" size={size} />
  },
  {
    id: 'mono',
    label: 'Monochrome',
    render: (size) => <BrandMark idSuffix="mono" from="#d0d0d5" to="#6a6a70" dot="#d0d0d5" center="#000" size={size} />
  }
]

export function resolveLogoPreset(id: string): AppLogoPreset {
  return APP_LOGO_PRESETS.find((p) => p.id === id) ?? APP_LOGO_PRESETS[0]
}
