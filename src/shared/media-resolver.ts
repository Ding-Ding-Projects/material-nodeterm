import { normalizeMediaReference, type MediaAssetReference } from './media-catalog'

export interface MediaByteEvidence {
  bytes: number
  sha256: string
}

export type MediaByteProbe = (candidatePath: string, reference: MediaAssetReference) => MediaByteEvidence | undefined

/**
 * Resolve a portable reference against caller-owned roots without accepting an arbitrary path.
 * A syntactically valid candidate is not enough: the caller must prove the file's byte count and
 * SHA-256 before this function returns it. That keeps a stale cache name or an empty bundle slot
 * from masquerading as the content-addressed asset named by the project.
 */
export function resolveMediaReference(
  reference: unknown,
  roots: { cacheRoot: string; bundledRoot?: string },
  probe: MediaByteProbe
):
  | { ok: true; path: string; source: 'cache' | 'bundled'; reference: MediaAssetReference }
  | { ok: false; reason: 'invalid-reference' | 'missing-asset' | 'asset-mismatch' } {
  const normalized = normalizeMediaReference(reference)
  if (!normalized) return { ok: false, reason: 'invalid-reference' }
  const suffix = normalized.portablePath.slice(2)
  const cache = joinRoot(roots.cacheRoot, suffix)
  let mismatch = false
  if (cache) {
    const evidence = probe(cache, normalized)
    if (matches(evidence, normalized)) return { ok: true, path: cache, source: 'cache', reference: normalized }
    mismatch = evidence !== undefined
  }
  const bundled = roots.bundledRoot ? joinRoot(roots.bundledRoot, suffix) : undefined
  if (bundled) {
    const evidence = probe(bundled, normalized)
    if (matches(evidence, normalized)) return { ok: true, path: bundled, source: 'bundled', reference: normalized }
    mismatch = mismatch || evidence !== undefined
  }
  return { ok: false, reason: mismatch ? 'asset-mismatch' : 'missing-asset' }
}

function matches(evidence: MediaByteEvidence | undefined, reference: MediaAssetReference): boolean {
  return evidence !== undefined && evidence.bytes === reference.bytes && evidence.sha256.toLowerCase() === reference.sha256
}

function joinRoot(root: string, suffix: string): string | undefined {
  if (!root || !suffix || suffix.includes('..') || suffix.includes('\\') || suffix.startsWith('/')) return undefined
  return `${root.replace(/[\\/]$/, '')}/${suffix}`
}

export function markMissingMedia(reference: MediaAssetReference): MediaAssetReference {
  const normalized = normalizeMediaReference(reference)
  return normalized ? { ...normalized, missing: true } : reference
}
