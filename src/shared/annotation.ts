/**
 * Shared bounds for canvas annotation presentation fields.
 *
 * Labels and stroke widths are user-authored display intent. Keeping their bounds here lets the
 * renderer, project persistence, and schema 3 importer agree without importing renderer code into
 * the platform-free core.
 */

export const ANNOTATION_DEFAULT_THICKNESS = 3
export const ANNOTATION_MIN_THICKNESS = 1
export const ANNOTATION_MAX_THICKNESS = 16
export const ANNOTATION_MAX_LABEL_LENGTH = 120

export function normalizeAnnotationThickness(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ANNOTATION_DEFAULT_THICKNESS
  return Math.min(ANNOTATION_MAX_THICKNESS, Math.max(ANNOTATION_MIN_THICKNESS, Math.round(value)))
}

/** Empty labels are represented by omission so an empty annotation carries no extra project data. */
export function normalizeAnnotationLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const label = [...value.trim()].slice(0, ANNOTATION_MAX_LABEL_LENGTH).join('')
  return label || undefined
}
