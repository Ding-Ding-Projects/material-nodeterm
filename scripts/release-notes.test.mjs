import { describe, it, expect } from 'vitest'
import { readPriorReleaseBodies, renderLineCountSection } from './release-notes.mjs'

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
  it("reads every body from the workflow's paginated release inventory", async () => {
    const bodies = await readPriorReleaseBodies('releases.json', async () => JSON.stringify([
      [{ body: 'hk-dish-0001' }, { body: null }],
      [{ body: 'hk-dish-0002' }],
    ]))
    expect(bodies).toEqual(['hk-dish-0001', 'hk-dish-0002'])
  })

  it('rejects malformed release-inventory JSON instead of inventing a prior-body list', async () => {
    await expect(readPriorReleaseBodies('releases.json', async () => '{not json')).rejects.toThrow()
  })
})
