import type { MediaAssetReference, Project } from '@shared/types'

export interface PortableMediaRuntimeApi {
  allow(path: string): Promise<string>
  allowSsh(projectId: string, remotePath: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>
}

/** Resolve an imported archive asset from its private cache without putting the cache path into
 * the portable projection. Local and SSH sources require an explicit runtime path carrier. */
export async function resolvePortableMediaReference(
  project: Project,
  reference: MediaAssetReference,
  api: PortableMediaRuntimeApi
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (reference.source === 'archive') {
    if (!project.cwd || !reference.sha256) return { ok: false, error: 'Imported media has no local cache or content address.' }
    const extension = reference.extension ?? (reference.displayName.includes('.') ? reference.displayName.split('.').pop() : 'bin')
    const target = project.cwd + '/.nodeterm/assets/media/' + reference.sha256 + '.' + extension
    try { return { ok: true, url: await api.allow(target) } } catch { return { ok: false, error: 'Imported media is unavailable on this computer.' } }
  }
  return { ok: false, error: reference.source === 'ssh' ? 'SSH media requires a host-scoped transfer reference.' : 'Local media requires an explicit runtime file selection.' }
}

/** Keep blob URL ownership explicit for image/gallery renderers. */
export function replaceOwnedObjectUrl(previous: string | undefined, next: string | undefined): string | undefined {
  if (previous && previous !== next && previous.startsWith('blob:')) URL.revokeObjectURL(previous)
  return next
}

export function revokeOwnedObjectUrl(value: string | undefined): void {
  if (value?.startsWith('blob:')) URL.revokeObjectURL(value)
}
