/**
 * A display sentence may contain both application copy and a value that must remain exact.
 * Keeping those pieces typed prevents the mapper from rewriting model names, paths, colours,
 * revisions, diagnostics, or other facts merely because they happen to contain a vocabulary key.
 */
export type DisplaySegment =
  | { kind: 'copy'; text: string }
  | { kind: 'fact'; text: string }

export const copy = (text: string): DisplaySegment => ({ kind: 'copy', text })
export const fact = (text: string): DisplaySegment => ({ kind: 'fact', text })

export function mapOwnedSentence(
  map: (text: string) => string,
  segments: readonly DisplaySegment[]
): string {
  return segments.map((segment) => (segment.kind === 'copy' ? map(segment.text) : segment.text)).join('')
}
