import { describe, it, expect } from 'vitest'
import {
  priorReleaseBodiesFromEnvironment,
  readPriorReleaseBodies,
  renderLineCountSection,
} from './release-notes.mjs'
import { renderCodeNameSection, resolveCodeName } from './dim-sum-code-name.mjs'

/**
 * The line-count contract has two halves, and only one of them had a test.
 *
 * `scripts/count-lines.test.mjs` proves the COUNTER is right — the buckets, the exclusions, the
 * attribution split, and the invariant that its own arithmetic agrees with itself. What nothing
 * asserted was that any of those numbers ever reach the release notes. `docs/uh-feature-inventory.md`
 * carried that as an open row for exactly that reason: "Line count in every release" is a claim
 * about the NOTES, and a counter nobody embeds satisfies none of it.
 *
 * So these tests are deliberately about the WIRING, not the arithmetic. They inject a fixture
 * counter and assert its figures appear in the rendered section, which is the half that was
 * missing. Re-deriving the counter's own correctness here would duplicate a suite that already
 * exists and would tell us nothing new.
 */

/** A counter result shaped exactly like `computeLineCounts`, with numbers no real repo would produce. */
function fixtureCounts() {
  return {
    ref: 'fixtureref0123456789abcdef0123456789abcd',
    buckets: {
      source: { total: 111, nonBlank: 101, files: 11 },
      tests: { total: 222, nonBlank: 202, files: 22 },
    },
    byLanguage: [{ language: 'TypeScript', total: 333, nonBlank: 303, files: 33 }],
    projectTotal: { total: 444, nonBlank: 404, files: 44 },
    grandTotal: { total: 555, nonBlank: 505, files: 55 },
    excluded: [{ path: 'upstream/nodeterm', reason: 'vendored upstream snapshot' }],
    // The real shape the renderer reads, verified against `count-lines.mjs:196` and the renderer at
    // `release-notes.mjs:159-165` — flat counters plus a percent and a rule string, NOT nested
    // per-author objects. Getting this wrong is what made these tests red on their first run, which
    // is the useful kind of red: the fixture was lying about the contract, and a fixture that lies
    // is exactly how a test goes green while the wiring underneath it is broken.
    attribution: {
      agentLines: 666,
      agentPercent: 46.2,
      personLines: 777,
      unknownLines: 88,
      rule: 'A commit counts as agent-written when it carries a Co-Authored-By trailer naming an agent.',
    },
  }
}

describe('renderLineCountSection', () => {
  it('embeds the counter figures in the notes — the half of the contract nothing covered', async () => {
    const out = await renderLineCountSection(async () => fixtureCounts())

    expect(out).toContain('## Line count')
    // The ref is what binds the figures to a commit. Without it the numbers describe nothing.
    expect(out).toContain('fixtureref0123456789abcdef0123456789abcd')

    // Per-bucket rows reached the table.
    expect(out).toContain('| source | 111 | 101 | 11 |')
    expect(out).toContain('| tests | 222 | 202 | 22 |')

    // Per-language rows reached their table.
    expect(out).toContain('| TypeScript | 333 | 303 | 33 |')

    // BOTH totals, which the instructions require to be reported side by side: a project total
    // that silently excludes vendored trees, and a grand total of everything counted.
    expect(out).toContain('444')
    expect(out).toContain('555')
  })

  it('names what it excluded rather than dropping it silently', async () => {
    const out = await renderLineCountSection(async () => fixtureCounts())
    expect(out).toContain('upstream/nodeterm')
    expect(out).toContain('vendored upstream snapshot')
  })

  it('reports an empty exclusion list as "(none)" rather than an empty gap', async () => {
    const out = await renderLineCountSection(async () => ({ ...fixtureCounts(), excluded: [] }))
    expect(out).toContain('(none)')
  })

  it('degrades honestly when the counter throws, instead of omitting the section', async () => {
    // A release must not quietly lose its line count. The section stays, and says why it is empty —
    // an absent section reads as "nobody measured", which is indistinguishable from "it was zero".
    const out = await renderLineCountSection(async () => {
      throw new Error('git blame exploded')
    })
    expect(out).toContain('## Line count')
    expect(out).toContain('Could not compute the line count')
    expect(out).toContain('git blame exploded')
  })

  it('names the exact command a reader can run to reproduce the figures', async () => {
    const out = await renderLineCountSection(async () => fixtureCounts())
    expect(out).toContain('node scripts/count-lines.mjs')
  })
})

describe('readPriorReleaseBodies', () => {
  it('rejects a missing snapshot path instead of inventing an empty release history', async () => {
    await expect(readPriorReleaseBodies(undefined)).rejects.toThrow(/RELEASE_PRIOR_BODIES_FILE is required/)
  })

  it("reads every body from the exact nested page shape emitted by gh api --paginate --slurp", async () => {
    const bodies = await readPriorReleaseBodies('releases.json', async () => JSON.stringify([
      [{ body: 'hk-dish-0001' }, { body: null }],
      [{ body: 'hk-dish-0002' }],
    ]))
    expect(bodies).toEqual(['hk-dish-0001', 'hk-dish-0002'])
  })

  it('rejects malformed release-inventory JSON instead of inventing a prior-body list', async () => {
    await expect(readPriorReleaseBodies('releases.json', async () => '{not json')).rejects.toThrow()
  })

  it('rejects flat, object, malformed-entry, and empty snapshots for a non-first release', async () => {
    const payloads = [
      JSON.stringify([{ body: 'hk-dish-0001' }]),
      JSON.stringify({ body: 'hk-dish-0001' }),
      JSON.stringify([[null]]),
      JSON.stringify([]),
      JSON.stringify([[]]),
    ]
    for (const payload of payloads) {
      await expect(readPriorReleaseBodies('releases.json', async () => payload)).rejects.toThrow()
    }
  })

  it('accepts an empty successful snapshot only with an explicit first-release proof', async () => {
    await expect(
      readPriorReleaseBodies('releases.json', async () => JSON.stringify([[]]), { allowEmpty: true }),
    ).resolves.toEqual([])
  })
})

const releaseDish = (n) => ({
  id: `hk-dish-${String(n).padStart(4, '0')}`,
  name: { en: `Release Dish ${n}`, zhHant: `發佈點心${n}` },
  image: {
    path: `images/hk-dish-${String(n).padStart(4, '0')}-release-dish.png`,
    alt: { en: `Release photo ${n}` },
  },
})

const workflowFetch = (dishes) => async (url) => {
  if (String(url).includes('catalog/index.json')) {
    return { ok: true, status: 200, json: async () => ({ dishes }) }
  }
  const hit = dishes.find((entry) => String(url).endsWith(entry.image.path.split('/').pop()))
  return { ok: Boolean(hit), status: hit ? 200 : 404 }
}

async function workflowCodeName(snapshot, dishes) {
  const warnings = []
  const environment = {
    RELEASE_PRIOR_BODIES_FILE: 'releases-for-plan.json',
    RELEASE_IS_FIRST_RELEASE: 'false',
  }
  const releaseBodies = await priorReleaseBodiesFromEnvironment({
    environment,
    read: async () => JSON.stringify(snapshot),
    warn: (message) => warnings.push(message),
  })
  const codeName = await resolveCodeName({
    releaseBodies,
    fetchImpl: workflowFetch(dishes),
    volumes: ['catalog-v1'],
  })
  return { codeName, warnings }
}

describe('release code-name workflow boundary', () => {
  it('omits the optional name when non-first history is missing, malformed, or empty', async () => {
    const cases = [
      { environment: { RELEASE_IS_FIRST_RELEASE: 'false' }, read: async () => JSON.stringify([[{ body: 'ignored' }]]) },
      { environment: { RELEASE_PRIOR_BODIES_FILE: 'releases.json', RELEASE_IS_FIRST_RELEASE: 'false' }, read: async () => '{bad json' },
      { environment: { RELEASE_PRIOR_BODIES_FILE: 'releases.json', RELEASE_IS_FIRST_RELEASE: 'false' }, read: async () => JSON.stringify([[]]) },
    ]
    for (const testCase of cases) {
      const warnings = []
      const releaseBodies = await priorReleaseBodiesFromEnvironment({
        ...testCase,
        warn: (message) => warnings.push(message),
      })
      expect(releaseBodies).toBeNull()
      expect(renderCodeNameSection(await resolveCodeName({
        releaseBodies,
        fetchImpl: workflowFetch([releaseDish(1)]),
        volumes: ['catalog-v1'],
      }))).toBe('')
      expect(warnings).toHaveLength(1)
    }
  })

  it('keeps initial and final note generation on the same code name from one workflow snapshot', async () => {
    const dishes = [releaseDish(1), releaseDish(2), releaseDish(3)]
    const snapshot = [[{ tag_name: 'v1.0.0', body: 'hk-dish-0001' }]]
    const initial = await workflowCodeName(snapshot, dishes)
    const final = await workflowCodeName(snapshot, dishes)
    expect(initial.codeName?.id).toBe('hk-dish-0002')
    expect(final.codeName?.id).toBe(initial.codeName?.id)
    expect(initial.warnings).toEqual([])
    expect(final.warnings).toEqual([])
  })

  it('selects different names for two consecutive workflow-style release inventories', async () => {
    const dishes = [releaseDish(1), releaseDish(2), releaseDish(3)]
    const firstSnapshot = [
      [{ tag_name: 'v1.0.0', body: 'hk-dish-0001' }],
      [],
    ]
    const first = await workflowCodeName(firstSnapshot, dishes)
    expect(first.codeName?.id).toBe('hk-dish-0002')

    const secondSnapshot = [
      [{ tag_name: 'v1.0.1', body: renderCodeNameSection(first.codeName) }],
      [{ tag_name: 'v1.0.0', body: 'hk-dish-0001' }],
    ]
    const second = await workflowCodeName(secondSnapshot, dishes)
    expect(second.codeName?.id).toBe('hk-dish-0003')
    expect(second.codeName?.id).not.toBe(first.codeName?.id)
    expect(first.warnings).toEqual([])
    expect(second.warnings).toEqual([])
  })
})
