// The date-range filter shared by LocalHistoryPanel and the changelog viewer — a native
// `<input type="date">` pair plus a small set of named presets, rather than a bespoke anchored
// calendar widget. Extracted out of LocalHistoryPanel.tsx so both panels apply the exact same
// parsing and preset rules; see docs/local-history.md and docs/changelog-viewer.md.
//
// Composes rather than overrides: nothing here decides what a caller does with the result — the
// caller ANDs `from`/`to` together with whatever else it's filtering by (text search, category
// checkboxes, version). Narrowing one filter must never reset another.

export type DateRangePreset = 'today' | '7d' | '30d' | '90d' | 'all'

export interface DateRangeBoundary {
  /** Epoch ms this boundary resolves to, or `undefined` for an open/empty boundary. */
  ms: number | undefined
  /** Set when `raw` was non-empty but unparseable — the caller echoes this back rather than
   *  silently discarding what was typed. */
  error: string | null
}

export function toDateInputValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Parse a date-range boundary input. Accepts the browser's native `yyyy-mm-dd` (from
 * `<input type="date">`) AND a full ISO timestamp typed by hand — reports invalid input via the
 * returned `error` WITHOUT discarding what was typed, so the caller can echo it back inline
 * instead of silently clearing the field.
 */
export function parseBoundary(raw: string, endOfDay: boolean): DateRangeBoundary {
  if (raw.trim() === '') return { ms: undefined, error: null }
  // A bare `yyyy-mm-dd` has no time component — give it one so a `to` boundary includes the
  // whole day rather than stopping at midnight. Anything longer (a full ISO timestamp typed by
  // hand) is parsed as-is.
  const parsed = Date.parse(raw.length === 10 ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : raw)
  if (Number.isNaN(parsed)) return { ms: undefined, error: `"${raw}" is not a date I can read.` }
  return { ms: parsed, error: null }
}

const DAY_MS = 24 * 60 * 60 * 1000

export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time'
}

/** The `{from, to}` `<input type="date">` values a preset resolves to, as of `now`. Pure — the
 *  caller decides what to do with the result (usually two `setState` calls), which is what lets
 *  LocalHistoryPanel and the changelog viewer each keep their own from/to state while sharing this
 *  one rule for what each preset means. */
export function applyDateRangePreset(preset: DateRangePreset, now: number = Date.now()): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' }
  if (preset === 'today') return { from: toDateInputValue(now), to: toDateInputValue(now) }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return { from: toDateInputValue(now - days * DAY_MS), to: toDateInputValue(now) }
}
