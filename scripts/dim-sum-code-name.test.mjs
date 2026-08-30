import { describe, expect, it } from 'vitest'
import {
  readCatalog,
  renderCodeNameSection,
  resolveCodeName,
  usedDishIds
} from './dim-sum-code-name.mjs'

const dish = (n, published = true) => ({
  id: `hk-dish-${String(n).padStart(4, '0')}`,
  name: { en: `Dish ${n}`, zhHant: `點心${n}` },
  image: { path: `images/hk-dish-${String(n).padStart(4, '0')}-dish.png`, alt: { en: `Photo ${n}` } },
  published
})

/** A fetch stand-in: serves the index, and 200s only for the dishes marked published. */
const fakeFetch = (dishes, { indexStatus = 200, volumeThrows = false } = {}) =>
  async (url) => {
    if (String(url).includes('catalog/index.json')) {
      if (indexStatus !== 200) return { ok: false, status: indexStatus, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => dishes }
    }
    if (volumeThrows) throw new Error('network down')
    const hit = dishes.find((d) => String(url).endsWith((d.image ?? d.asset).path.split('/').pop()))
    return { ok: Boolean(hit?.published), status: hit?.published ? 200 : 404 }
  }

describe('dim sum code name', () => {
  it('picks the first dish whose photo is actually published', async () => {
    const dishes = [dish(1, false), dish(2, true), dish(3, true)]
    const got = await resolveCodeName({ fetchImpl: fakeFetch(dishes) })
    expect(got?.id).toBe('hk-dish-0002')
    expect(got?.assetName).toBe('hk-dish-0002-dish.png')
  })

  it('skips a dish a previous release already used', async () => {
    const dishes = [dish(1), dish(2)]
    const got = await resolveCodeName({
      fetchImpl: fakeFetch(dishes),
      releaseBodies: ['... attached as `hk-dish-0001-classic-har-gow.png` ...']
    })
    expect(got?.id).toBe('hk-dish-0002')
  })

  it('skips a dish when a prior release records its catalog name without the id', async () => {
    const dishes = [dish(1), dish(2)]
    const got = await resolveCodeName({
      fetchImpl: fakeFetch(dishes),
      releaseBodies: ['**Dish 1 · 點心1**']
    })
    expect(got?.id).toBe('hk-dish-0002')
  })

  it('treats a failed prior-release history read as unavailable, not as a first release', async () => {
    expect(await resolveCodeName({ releaseBodies: null, fetchImpl: fakeFetch([dish(1)]) })).toBeNull()
  })

  // Fail-open is the whole safety of this feature: a release must never be blocked, delayed or
  // renamed because a picture could not be fetched.
  it('returns null rather than blocking when the catalog cannot be read', async () => {
    expect(await resolveCodeName({ fetchImpl: fakeFetch([], { indexStatus: 500 }) })).toBeNull()
    expect(await resolveCodeName({ fetchImpl: async () => { throw new Error('offline') } })).toBeNull()
  })

  it('returns null when no photo is published, without walking the whole catalog', async () => {
    const dishes = Array.from({ length: 500 }, (_, i) => dish(i + 1, false))
    let probes = 0
    const counting = async (url) => {
      if (!String(url).includes('index.json')) probes++
      return fakeFetch(dishes)(url)
    }
    expect(await resolveCodeName({ fetchImpl: counting, maxProbes: 4 })).toBeNull()
    // 4 candidates x 3 volumes is the ceiling — nowhere near 500.
    expect(probes).toBeLessThanOrEqual(12)
  })

  it('warns and stops at the bounded photo-probe budget', async () => {
    const warnings = []
    const dishes = [dish(1, false), dish(2, true)]
    const got = await resolveCodeName({
      fetchImpl: fakeFetch(dishes),
      maxProbes: 1,
      onPoolExhausted: (details) => warnings.push(details)
    })
    expect(got).toBeNull()
    expect(warnings).toEqual([{ unusedCount: 2, probes: 1, maxProbes: 1 }])
  })

  it('warns when every catalog dish has already been used', async () => {
    const warnings = []
    const got = await resolveCodeName({
      fetchImpl: fakeFetch([dish(1)]),
      releaseBodies: ['hk-dish-0001'],
      onPoolExhausted: (details) => warnings.push(details)
    })
    expect(got).toBeNull()
    expect(warnings).toEqual([{ unusedCount: 0, probes: 0, maxProbes: 8 }])
  })

  it('uses HEAD probes and does not paginate catalog release assets', async () => {
    const calls = []
    const dishes = [dish(1, true)]
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET' })
      return fakeFetch(dishes)(url)
    }
    const got = await resolveCodeName({ fetchImpl, volumes: ['catalog-v1', 'catalog-v1-part-002'] })
    expect(got?.id).toBe('hk-dish-0001')
    expect(calls.filter((call) => !call.url.includes('index.json')).map((call) => call.method)).toEqual(['HEAD'])
  })

  it('treats an unreachable volume as no evidence about the next one', async () => {
    const dishes = [dish(1)]
    expect(await resolveCodeName({ fetchImpl: fakeFetch(dishes, { volumeThrows: true }) })).toBeNull()
  })

  it('drops malformed records instead of emitting a half-named release', async () => {
    const raw = [{ id: 'hk-dish-0001' }, { name: { en: 'x', zhHant: 'y' } }, dish(9)]
    const got = await readCatalog({ fetchImpl: fakeFetch(raw) })
    expect(got.map((d) => d.id)).toEqual(['hk-dish-0009'])
  })

  it('reads used ids case-insensitively out of prior bodies', () => {
    expect([...usedDishIds(['HK-DISH-0007 and hk-dish-0008'])].sort()).toEqual([
      'hk-dish-0007',
      'hk-dish-0008'
    ])
  })


  // A record copied VERBATIM from the live catalog, trimmed only of prose fields. Every other
  // fixture in this file was written from the implementation's own assumption, which is exactly
  // why they all passed while the module read the wrong field name and resolved nothing at all
  // against the real catalog. A fixture that agrees with the code by construction cannot disagree
  // with it. This one comes from outside.
  const REAL_RECORD = {
    id: 'hk-dish-0001',
    slug: 'classic-har-gow',
    name: { en: 'Classic Har Gow', zhHant: '蝦餃' },
    jyutping: 'haa1 gaau2',
    category: 'steamed-dim-sum',
    image: {
      path: 'images/hk-dish-0001-classic-har-gow.png',
      alt: {
        en: 'Warm tea-house photograph of Classic Har Gow',
        yue: '港式茶樓木枱上嘅蝦餃'
      }
    }
  }

  it('reads the live catalog shape — `image`, inside a `dishes` array', async () => {
    const got = await readCatalog({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ dishes: [REAL_RECORD] }) })
    })
    expect(got).toEqual([
      {
        id: 'hk-dish-0001',
        nameEn: 'Classic Har Gow',
        nameZh: '蝦餃',
        assetPath: 'images/hk-dish-0001-classic-har-gow.png',
        alt: 'Warm tea-house photograph of Classic Har Gow'
      }
    ])
  })

  it('still accepts an `asset`-shaped record, so an older catalog keeps working', async () => {
    const legacy = { ...REAL_RECORD, image: undefined, asset: REAL_RECORD.image }
    const got = await readCatalog({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ dishes: [legacy] }) })
    })
    expect(got[0]?.assetPath).toBe('images/hk-dish-0001-classic-har-gow.png')
  })

  it('renders nothing at all when there is no code name', () => {
    expect(renderCodeNameSection(null)).toBe('')
  })

  it('renders the dish, its id and its photo when there is one', () => {
    const out = renderCodeNameSection({
      id: 'hk-dish-0001',
      nameEn: 'Classic Har Gow',
      nameZh: '蝦餃',
      // The photo is LINKED from the catalog release now, not attached to ours — the section
      // says so in as many words. The filename still has to reach the reader, so it is
      // asserted through the URL that carries it rather than as a bare name.
      assetUrl:
        'https://github.com/Ding-Ding-Projects/dim-sum-photos/releases/download/catalog-v1/hk-dish-0001-classic-har-gow.png',
      alt: 'Warm tea-house photograph'
    })
    expect(out).toContain('Classic Har Gow · 蝦餃')
    expect(out).toContain('hk-dish-0001-classic-har-gow.png')
    expect(out).toContain('Warm tea-house photograph')
  })
})
