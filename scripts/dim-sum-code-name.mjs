/**
 * dim-sum-code-name.mjs — resolve one release code name, and the photo that goes with it, from the
 * public dim-sum catalog.
 *
 * Every release carries a dim sum code name and links its public catalog photo. That contract had never been
 * implemented here: v0.4.0, v0.4.1 and v0.4.2 all shipped without one, because nothing in the
 * release tooling knew about it and it depended on somebody remembering. v0.4.3 was resolved by
 * hand; this module is what stops the next release losing it again.
 *
 * THREE RULES, each of which exists because the obvious implementation gets it wrong:
 *
 * 1. NEVER paginate the catalog's release assets to find a photo. The catalog holds thousands of
 *    dishes across several volumes; listing them all to pick one is minutes of API calls for a
 *    decorative label. Read the index once, skip the names already used, and HEAD only the next
 *    candidate across the volumes.
 * 2. A dish is only usable if its photo is ACTUALLY PUBLISHED. A catalog record whose asset has
 *    not been released yet is not a candidate — hence the HEAD, not an assumption.
 * 3. FAIL OPEN, ALWAYS. A code name is decoration with a purpose, never a gate. An unreachable
 *    catalog, an unpublished photo, a malformed index — every one of them returns null and the
 *    release ships with its version alone. A release must never be blocked, delayed or renamed
 *    because a picture of a dumpling could not be fetched.
 */

const CATALOG_REPO = 'Ding-Ding-Projects/dim-sum-photos'
const INDEX_URL = `https://raw.githubusercontent.com/${CATALOG_REPO}/main/catalog/index.json`
/** Published photo volumes, newest last. A dish's asset lives in exactly one of them. */
export const CATALOG_VOLUMES = ['catalog-v1', 'catalog-v1-part-002', 'catalog-v1-part-003']

const DEFAULT_TIMEOUT_MS = 15_000

async function fetchWithTimeout(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Catalog records, normalised. Returns [] for anything we cannot read or understand. */
export async function readCatalog({ fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const res = await fetchWithTimeout(INDEX_URL, {}, timeoutMs, fetchImpl)
    if (!res.ok) return []
    const body = await res.json()
    const items = Array.isArray(body) ? body : (body.items ?? body.dishes ?? body.records ?? [])
    if (!Array.isArray(items)) return []
    return items
      .map((d) => {
        // The catalog's field is `image`. This module first read `asset`, and every one of its
        // unit tests passed anyway — because the fixtures were written from the same wrong
        // assumption as the code, so nothing in the suite could ever disagree with it. Only a
        // record captured from the real catalog catches that, which is why one now sits in the
        // tests. `asset` is still accepted in case the catalog ever grows it.
        const image = d?.image ?? d?.asset
        return {
          id: typeof d?.id === 'string' ? d.id : '',
          nameEn: typeof d?.name?.en === 'string' ? d.name.en : '',
          nameZh: typeof d?.name?.zhHant === 'string' ? d.name.zhHant : '',
          assetPath: typeof image?.path === 'string' ? image.path : '',
          alt: typeof image?.alt?.en === 'string' ? image.alt.en : ''
        }
      })
      .filter((d) => d.id && d.nameEn && d.nameZh && d.assetPath)
  } catch {
    return []
  }
}

/** Normalize release prose before matching catalog ids or names. */
function normalizeReleaseText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}

function containsReleaseToken(text, value) {
  const needle = normalizeReleaseText(value)
  if (!needle) return false
  const start = text.indexOf(needle)
  if (start < 0) return false
  const before = text[start - 1]
  const after = text[start + needle.length]
  const isWord = (char) => !!char && /[\p{L}\p{N}]/u.test(char)
  return !isWord(before) && !isWord(after)
}

/** The catalog ids a previous release already used, read out of release bodies. */
export function usedDishIds(releaseBodies, catalog = []) {
  const used = new Set()
  for (const body of releaseBodies ?? []) {
    for (const m of String(body ?? '').matchAll(/hk-dish-\d+/gi)) used.add(m[0].toLowerCase())
  }
  const priorText = (releaseBodies ?? []).map((body) => normalizeReleaseText(body)).join(' ')
  for (const dish of catalog) {
    if (
      used.has(dish.id.toLowerCase()) ||
      containsReleaseToken(priorText, dish.nameEn) ||
      containsReleaseToken(priorText, dish.nameZh)
    ) {
      used.add(dish.id.toLowerCase())
    }
  }
  return used
}

/**
 * Pick the first unused dish whose photo is actually published.
 *
 * `maxProbes` bounds the HEAD requests: without it, a catalog whose photos are all unpublished
 * would walk thousands of records one request at a time. Exhausting the budget is a null, which is
 * the same fail-open answer as every other failure here.
 */
export async function resolveCodeName({
  releaseBodies = [],
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxProbes = 8,
  volumes = CATALOG_VOLUMES,
  onPoolExhausted = () => {}
} = {}) {
  // A failed prior-release read must not look like a first release. Omitting the code name is
  // safer than publishing a duplicate when the history boundary cannot be inspected.
  if (releaseBodies == null) return null
  const catalog = await readCatalog({ fetchImpl, timeoutMs })
  if (catalog.length === 0) return null
  const used = usedDishIds(releaseBodies, catalog)
  const warnPoolExhausted = (details) => {
    try {
      onPoolExhausted(details)
    } catch {
      // Warning output is advisory and must never turn optional code-name resolution into a gate.
    }
  }

  let probes = 0
  let unusedCount = 0
  for (const dish of catalog) {
    if (used.has(dish.id.toLowerCase())) continue
    unusedCount++
    if (probes >= maxProbes) {
      warnPoolExhausted({ unusedCount, probes, maxProbes })
      return null
    }
    probes++
    const assetName = dish.assetPath.split('/').pop()
    if (!assetName) continue
    for (const volume of volumes) {
      const url = `https://github.com/${CATALOG_REPO}/releases/download/${volume}/${assetName}`
      try {
        const res = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs, fetchImpl)
        if (res.ok) return { ...dish, assetName, assetUrl: url, volume }
      } catch {
        // An unreachable volume is not evidence about the next one.
      }
    }
  }
  warnPoolExhausted({ unusedCount, probes, maxProbes })
  return null
}

/** The release-notes section. Empty string when no code name could be resolved — never a lie. */
export function renderCodeNameSection(codeName) {
  if (!codeName) return ''
  return [
    '## Code name',
    '',
    `**${codeName.nameEn} · ${codeName.nameZh}** (\`${codeName.id}\`)`,
    '',
    `From the public [dim-sum-photos](https://github.com/${CATALOG_REPO}) catalog.`,
    `[View the published catalog photo](${codeName.assetUrl})${codeName.alt ? ` — *${codeName.alt}*` : ''}.`,
    `The photo is hosted by the catalog release and is not attached to this consumer release.`
  ].join('\n')
}
