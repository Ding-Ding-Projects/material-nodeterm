import { normalizeMediaReference, type MediaAssetReference } from './media-catalog'

/** Resolve a portable reference against a caller-owned cache/bundle root without accepting paths. */
export function resolveMediaReference(reference: unknown, roots: { cacheRoot: string; bundledRoot?: string }): { ok: true; path: string; source: 'cache' | 'bundled' } | { ok: false; reason: 'invalid-reference' | 'missing-asset' } {
  const normalized = normalizeMediaReference(reference)
  if (!normalized) return { ok: false, reason: 'invalid-reference' }
  const suffix = normalized.portablePath.slice(2)
  const cache = joinRoot(roots.cacheRoot, suffix)
  if (cache) return { ok: true, path: cache, source: 'cache' }
  const bundled = roots.bundledRoot ? joinRoot(roots.bundledRoot, suffix) : undefined
  if (bundled) return { ok: true, path: bundled, source: 'bundled' }
  return { ok: false, reason: 'missing-asset' }
}

function joinRoot(root: string, suffix: string): string | undefined {
  if (!root || !suffix || suffix.includes('..') || suffix.includes('\\') || suffix.startsWith('/')) return undefined
  return `${root.replace(/[\\/]$/, '')}/${suffix}`
}

export function markMissingMedia(reference: MediaAssetReference): MediaAssetReference {
  const normalized = normalizeMediaReference(reference)
  return normalized ? { ...normalized, missing: true } : reference
}
