import { DIM_SUM_CATALOG, type DimSumDish } from './catalog'
import { readLocal, writeLocal } from '../localStore'

export const PUBLIC_DIM_SUM_CATALOG_URL =
  'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json'
const CACHE_KEY = 'nodeterm.dim-sum.public-catalog.v1'

type PublicDish = { id?: unknown; name?: { en?: unknown; zhHant?: unknown }; imageUrl?: unknown; image?: unknown }
export type ResolvedDimSum = DimSumDish & { revision: string }

function validDish(value: PublicDish): value is { id: string; name: { en: string; zhHant: string }; imageUrl?: string; image?: string } {
  return typeof value.id === 'string' && typeof value.name?.en === 'string' && typeof value.name?.zhHant === 'string'
}

function publishedImage(value: unknown): string {
  return typeof value === 'string' && value.startsWith('https://github.com/Ding-Ding-Projects/dim-sum-photos/releases/download/catalog-v1') ? value : ''
}

function fallback(): ResolvedDimSum {
  const d = DIM_SUM_CATALOG[0]
  return { ...d, revision: 'bundled-fallback' }
}

function readCache(): ResolvedDimSum[] | null {
  try {
    const parsed = JSON.parse(readLocal(CACHE_KEY) ?? '') as { revision?: unknown; dishes?: PublicDish[] }
    if (typeof parsed.revision !== 'string' || !Array.isArray(parsed.dishes)) return null
    const revision = parsed.revision
    const dishes = parsed.dishes.filter(validDish).map((d) => ({
      id: d.id, name: { en: d.name.en, zhHant: d.name.zhHant },
      image: publishedImage(typeof d.imageUrl === 'string' ? d.imageUrl : d.image),
      revision
    }))
    return dishes.length ? dishes : null
  } catch { return null }
}

/** Resolve the public catalog once, caching only bounded metadata. Import and hydration never call this. */
export async function resolvePublicDimSumCatalog(): Promise<ResolvedDimSum[]> {
  const cached = readCache()
  if (cached) return cached
  try {
    const response = await fetch(PUBLIC_DIM_SUM_CATALOG_URL, { cache: 'no-store' })
    if (!response.ok) return [fallback()]
    const raw = (await response.json()) as { revision?: unknown; dishes?: PublicDish[]; records?: PublicDish[] }
    const revision = typeof raw.revision === 'string' ? raw.revision : `catalog-${response.headers.get('etag') ?? 'live'}`
    const entries = (Array.isArray(raw.dishes) ? raw.dishes : Array.isArray(raw.records) ? raw.records : []).filter(validDish)
    const dishes = entries.map((d) => ({ id: d.id, name: { en: d.name.en, zhHant: d.name.zhHant }, image: publishedImage(typeof d.imageUrl === 'string' ? d.imageUrl : d.image), revision }))
    if (!dishes.length) return [fallback()]
    writeLocal(CACHE_KEY, JSON.stringify({ revision, dishes: dishes.slice(0, 1000) }))
    return dishes
  } catch { return [fallback()] }
}
