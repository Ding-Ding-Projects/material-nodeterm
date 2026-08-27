export const PUBLIC_DIM_SUM_CATALOG_URL =
  'https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json'

export const PUBLIC_DIM_SUM_CATALOG_MAX_BYTES = 12 * 1024 * 1024
export const PUBLIC_DIM_SUM_CATALOG_MAX_DISHES = 4_000

export interface PublicDimSumSelection {
  id: string
  slug: string
  name: { en: string; zhHant: string }
  category: string
  subcategory: string
  description: { en: string; yue: string }
  image: { path: string; alt: { en: string; yue: string } }
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

export function normalizePublicDimSumSelection(value: unknown): PublicDimSumSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = record.name as Record<string, unknown> | undefined
  const description = record.description as Record<string, unknown> | undefined
  const image = record.image as Record<string, unknown> | undefined
  const alt = image?.alt as Record<string, unknown> | undefined
  const id = boundedText(record.id, 32)
  const slug = boundedText(record.slug, 160)
  const en = boundedText(name?.en, 160)
  const zhHant = boundedText(name?.zhHant, 160)
  const category = boundedText(record.category, 100)
  const subcategory = boundedText(record.subcategory, 100)
  const descriptionEn = boundedText(description?.en, 1_000)
  const descriptionYue = boundedText(description?.yue, 1_000)
  const imagePath = boundedText(image?.path, 220)
  const altEn = boundedText(alt?.en, 240)
  const altYue = boundedText(alt?.yue, 240)
  if (!id || !/^hk-dish-\d{4}$/.test(id) || !slug || !/^[a-z0-9-]+$/.test(slug)) return null
  if (!en || !zhHant || !category || !subcategory || !descriptionEn || !descriptionYue) return null
  if (!imagePath || !/^images\/hk-dish-\d{4}-[a-z0-9-]+\.png$/.test(imagePath)) return null
  if (!altEn || !altYue) return null
  return { id, slug, name: { en, zhHant }, category, subcategory, description: { en: descriptionEn, yue: descriptionYue }, image: { path: imagePath, alt: { en: altEn, yue: altYue } } }
}

export function parsePublicDimSumCatalog(value: unknown): PublicDimSumSelection[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The public catalog response is not an object.')
  const dishes = (value as Record<string, unknown>).dishes
  if (!Array.isArray(dishes)) throw new Error('The public catalog response has no dishes list.')
  if (dishes.length > PUBLIC_DIM_SUM_CATALOG_MAX_DISHES) throw new Error('The public catalog contains more dishes than this version supports.')
  const normalized = dishes.map(normalizePublicDimSumSelection)
  if (normalized.some((dish) => dish === null)) throw new Error('The public catalog contains an invalid dish record.')
  return normalized as PublicDimSumSelection[]
}

export function publicDimSumImageUrl(selection: PublicDimSumSelection): string {
  const numericId = Number(selection.id.slice('hk-dish-'.length))
  const tag = numericId <= 995 ? 'catalog-v1' : numericId <= 1985 ? 'catalog-v1-part-002' : 'catalog-v1-part-003'
  const filename = selection.image.path.slice('images/'.length)
  return `https://github.com/Ding-Ding-Projects/dim-sum-photos/releases/download/${tag}/${encodeURIComponent(filename)}`
}
