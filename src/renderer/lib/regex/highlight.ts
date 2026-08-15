import type { RegexMatchResult } from './matcher'

export interface HighlightSegment {
  text: string
  /** Index into `matches` when this segment IS a match, else undefined for plain text. */
  matchIndex?: number
}

/** Splits `sample` into alternating plain/match segments for rendering — pure, so it can be unit
 *  tested and reused by both the builder's preview and (later) any other match viewer. Assumes
 *  `matches` are sorted and non-overlapping, which `runMatches` always produces. */
export function highlightSegments(sample: string, matches: RegexMatchResult[]): HighlightSegment[] {
  if (matches.length === 0) return sample ? [{ text: sample }] : []
  const segments: HighlightSegment[] = []
  let cursor = 0
  matches.forEach((m, i) => {
    if (m.start > cursor) segments.push({ text: sample.slice(cursor, m.start) })
    // A zero-width match still gets its own (empty-looking) marker so the user can see WHERE it
    // landed — rendered with a visible caret glyph by the component, not here.
    segments.push({ text: sample.slice(m.start, m.end), matchIndex: i })
    cursor = m.end
  })
  if (cursor < sample.length) segments.push({ text: sample.slice(cursor) })
  return segments
}
