import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'

/** One measured point. `t` is epoch ms, `v` the value in the chart's own unit. */
export interface LivePoint {
  t: number
  v: number
}

/** What the chart can honestly say about its data. Nothing here is ever drawn as live unless the
 *  source actually sent the point. */
export type LiveChartStatus = 'loading' | 'live' | 'paused' | 'stale' | 'unavailable'

export interface LiveChartProps {
  points: readonly LivePoint[]
  status: LiveChartStatus
  /** Accessible name of the series, e.g. "RAM in use". */
  label: string
  /** Formats a value for the badge, tooltip and summary, e.g. `(v) => \`${v.toFixed(0)}%\``. */
  format: (v: number) => string
  /** Fixed value range. Omit to fit the data with a little headroom. */
  domain?: [number, number]
  width?: number
  height?: number
  /** Status copy, supplied by the caller so it is localized there. */
  statusText: Record<Exclude<LiveChartStatus, 'live'>, string>
}

const PAD_X = 4
const PAD_Y = 8

/** Smooth path through the points: a Catmull-Rom spline turned into cubic Béziers, the shape the
 *  Liveline style draws. Exported for tests. */
export function smoothPath(xy: readonly (readonly [number, number])[]): string {
  if (xy.length === 0) return ''
  if (xy.length === 1) return `M${xy[0][0]},${xy[0][1]}`
  let d = `M${xy[0][0]},${xy[0][1]}`
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i]
    const p1 = xy[i]
    const p2 = xy[i + 1]
    const p3 = xy[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(p2[0])},${round(p2[1])}`
  }
  return d
}

const round = (n: number) => Math.round(n * 100) / 100

/** The value range to draw: the fixed domain, or the data's range with 10% headroom (never a
 *  zero-height range, which would divide by zero). */
export function chartDomain(points: readonly LivePoint[], domain?: [number, number]): [number, number] {
  if (domain) return domain
  if (points.length === 0) return [0, 1]
  let lo = Math.min(...points.map((p) => p.v))
  let hi = Math.max(...points.map((p) => p.v))
  if (hi - lo < 1e-9) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.1
  return [lo - pad, hi + pad]
}

/**
 * A live line chart in the Liveline style (design/v3 `Status.dc.html`, @uh `live-charts`): an
 * easing line with a fill gradient from the series colour, a quiet grid, a value badge, a pulsing
 * dot on the newest point while the source is live, and a scrub crosshair driven by the pointer or
 * the arrow keys. A screen reader gets a one-line summary and the scrubbed value.
 *
 * Honest states: no points and `loading` says so; `paused`, `stale` and `unavailable` say so and
 * stop the pulse. Under reduced motion (the OS setting, the app's own switch or Low stimulation)
 * the line snaps instead of easing and the dot does not pulse; every value stays readable.
 */
export function LiveChart({
  points,
  status,
  label,
  format,
  domain,
  width = 320,
  height = 96,
  statusText
}: LiveChartProps) {
  const gradientId = useId()
  const [scrub, setScrub] = useState<number | null>(null)
  const [lo, hi] = useMemo(() => chartDomain(points, domain), [points, domain])

  const xy = useMemo(() => {
    if (points.length === 0) return []
    const t0 = points[0].t
    const span = Math.max(1, points[points.length - 1].t - t0)
    return points.map((p) => {
      const x = points.length === 1 ? width - PAD_X : PAD_X + ((p.t - t0) / span) * (width - PAD_X * 2)
      const y = PAD_Y + (1 - (p.v - lo) / (hi - lo)) * (height - PAD_Y * 2)
      return [x, Math.min(height - PAD_Y, Math.max(PAD_Y, y))] as const
    })
  }, [points, width, height, lo, hi])

  const line = smoothPath(xy)
  const last = points[points.length - 1]
  const lastXy = xy[xy.length - 1]
  const area = xy.length > 1 ? `${line} L${round(lastXy[0])},${height} L${round(xy[0][0])},${height} Z` : ''
  const scrubIndex = scrub === null ? null : Math.min(points.length - 1, Math.max(0, scrub))
  const scrubPoint = scrubIndex === null ? null : points[scrubIndex]
  const scrubXy = scrubIndex === null ? null : xy[scrubIndex]
  const empty = points.length === 0

  const summary = empty
    ? status === 'loading'
      ? statusText.loading
      : statusText.unavailable
    : `${label}: ${format(last.v)}${status === 'live' ? '' : ` — ${statusText[status as Exclude<LiveChartStatus, 'live'>]}`}`

  const indexFromPointer = (e: PointerEvent<SVGSVGElement>): number | null => {
    if (empty) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * width
    let best = 0
    for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i][0] - x) < Math.abs(xy[best][0] - x)) best = i
    return best
  }

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (empty) return
    const current = scrubIndex ?? points.length - 1
    if (e.key === 'ArrowLeft') setScrub(Math.max(0, current - 1))
    else if (e.key === 'ArrowRight') setScrub(Math.min(points.length - 1, current + 1))
    else if (e.key === 'Home') setScrub(0)
    else if (e.key === 'End') setScrub(points.length - 1)
    else if (e.key === 'Escape') setScrub(null)
    else return
    e.preventDefault()
  }

  return (
    <figure className={`md3-live-chart md3-live-chart--${status}`} style={{ width }}>
      <div className="md3-live-chart__head">
        <span className="md3-live-chart__label">{label}</span>
        {!empty && (
          <span className="md3-live-chart__badge">
            {status === 'live' && <span className="md3-live-chart__badge-dot" aria-hidden />}
            {format(scrubPoint ? scrubPoint.v : last.v)}
          </span>
        )}
      </div>
      <svg
        className="md3-live-chart__plot"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        tabIndex={empty ? -1 : 0}
        onKeyDown={onKey}
        onPointerMove={(e) => setScrub(indexFromPointer(e))}
        onPointerLeave={() => setScrub(null)}
        onBlur={() => setScrub(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="md3-live-chart__fill-top" />
            <stop offset="1" className="md3-live-chart__fill-bottom" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="md3-live-chart__grid" x1={0} x2={width} y1={height * f} y2={height * f} />
        ))}
        {area && <path className="md3-live-chart__area" d={area} fill={`url(#${gradientId})`} />}
        {line && <path className="md3-live-chart__line" d={line} />}
        {lastXy && (
          <g className="md3-live-chart__head-dot" transform={`translate(${round(lastXy[0])},${round(lastXy[1])})`}>
            {status === 'live' && <circle className="md3-live-chart__pulse" r={10} />}
            <circle className="md3-live-chart__dot" r={4} />
          </g>
        )}
        {scrubXy && (
          <line className="md3-live-chart__crosshair" x1={scrubXy[0]} x2={scrubXy[0]} y1={0} y2={height} />
        )}
      </svg>
      <figcaption className="md3-live-chart__caption" aria-live="polite">
        {scrubPoint
          ? `${new Date(scrubPoint.t).toLocaleTimeString()} · ${format(scrubPoint.v)}`
          : empty
            ? status === 'loading'
              ? statusText.loading
              : statusText.unavailable
            : status === 'live'
              ? ''
              : statusText[status]}
      </figcaption>
    </figure>
  )
}
