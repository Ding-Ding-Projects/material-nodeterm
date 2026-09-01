import type { PortableMediaExportPlan } from '@shared/portable-media'

/**
 * What "Save project as one file…" should do about portable media.
 *
 * The plain save row must NEVER open a file picker: the archive is complete without media (main's
 * `projectArchiveExport` treats the plan as optional), and a user who clicked "Save" and was
 * answered with an OS *Open* dialog read it as the wrong dialog — which it was. Media is opt-in
 * through the separate "… with media…" row, and only that row runs the picker.
 */
export type PortableMediaResolution =
  | { kind: 'none' }
  | { kind: 'plan'; plan: PortableMediaExportPlan }
  | { kind: 'cancelled' }

export async function resolvePortableMediaForSave(
  includeMedia: boolean,
  choose: () => Promise<PortableMediaExportPlan | null>
): Promise<PortableMediaResolution> {
  if (!includeMedia) return { kind: 'none' }
  const plan = await choose()
  return plan ? { kind: 'plan', plan } : { kind: 'cancelled' }
}
