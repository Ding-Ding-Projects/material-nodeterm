// A QR code, drawn ENTIRELY in-process from local code — never a third-party QR web service,
// never a remote chart API, no network call anywhere in this component. `qrcode` (MIT-licensed,
// already a project dependency — see usePhonePairing.ts for its other use) does the actual
// encoding synchronously in memory; this file only turns its module matrix into inline SVG.
//
// Deliberately black-on-white ALWAYS, regardless of the app's light/dark theme: a themed QR code
// is a scannability bug waiting to happen (low-contrast accent colors, dark mode inverting the
// finder patterns), and the whole point of a code this small is that a phone camera can read it
// under bad lighting. See docs/authenticator.md and docs/toy-locks.md.
import { useMemo } from 'react'
// The `qrcode` package's browser build (what Vite resolves here — see its `browser` package.json
// field) exports a synchronous `create()` alongside the async `toDataURL`/`toString` renderers.
// Its own type declarations may describe a slightly different shape than we rely on below, so we
// pin our OWN minimal interface for the two things we actually read (`modules.size`,
// `modules.get(row, col)`) rather than trust a moving target.
import { create as createQr } from 'qrcode'

interface QrModules {
  size: number
  get(row: number, col: number): number
}
interface QrCodeData {
  modules: QrModules
}

/** Modules of quiet (blank) margin around the symbol, per the QR spec's minimum recommendation —
 *  omitting it is a common cause of a code that a phone camera refuses to lock onto. */
const QUIET_ZONE = 4

export function QrCode({
  text,
  size = 220,
  label
}: {
  /** The exact payload to encode (an `otpauth://totp/...` URI). */
  text: string
  /** Rendered pixel size (square). */
  size?: number
  /** Real text alternative — what this code pairs — read by screen readers and shown as the
   *  SVG's own `<title>`, never a decorative empty alt. */
  label: string
}): React.JSX.Element {
  const data = useMemo(() => {
    try {
      return createQr(text, { errorCorrectionLevel: 'M' }) as unknown as QrCodeData
    } catch {
      return null
    }
  }, [text])

  if (!data) {
    return (
      <div className="toylock-qr toylock-qr--error" role="img" aria-label={`${label} — failed to render`}>
        Could not render a QR code for this secret — use the manual key below instead.
      </div>
    )
  }

  const { modules } = data
  const dim = modules.size + QUIET_ZONE * 2
  const cells: React.JSX.Element[] = []
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) {
        cells.push(<rect key={row * modules.size + col} x={col + QUIET_ZONE} y={row + QUIET_ZONE} width={1} height={1} />)
      }
    }
  }

  return (
    <svg
      className="toylock-qr"
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <title>{label}</title>
      <rect x={0} y={0} width={dim} height={dim} fill="#ffffff" />
      <g fill="#000000">{cells}</g>
    </svg>
  )
}
