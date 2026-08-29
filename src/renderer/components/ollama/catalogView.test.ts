// The Model store's view layer. Every case here is a way the panel could mislead: presenting a
// legacy short list as the catalog, presenting a failed load as an empty catalog, sorting unknown
// sizes as if they were small ones, or stranding the user on an empty page after a filter change.

import { describe, expect, it } from 'vitest'
import {
  catalogPollDelayMs,
  catalogPollShouldContinue,
  completenessHeadline,
  parseCatalogPayload,
  selectCatalogPage,
  stalenessSentence,
  type CatalogRow
} from './catalogView'

function snapshot(over: Record<string, unknown> = {}): unknown {
  return {
    kind: 'ollama-catalog',
    version: 1,
    models: [
      {
        name: 'llama3.2',
        origin: 'registry',
        tagsState: 'resolved',
        tagsError: null,
        tagsFetchedAt: 10,
        tags: [
          {
            tag: 'latest',
            sizeBytes: 2_000_000_000,
            sizeExact: false,
            revision: 'a80c4f17acd5',
            revisionExact: false,
            publishedAt: null,
            installed: false,
            facts: 'unresolved',
            factsError: null,
            fetchedAt: 10
          },
          {
            tag: '1b',
            sizeBytes: 1_321_098_329,
            sizeExact: true,
            revision: 'sha256:aa',
            revisionExact: true,
            publishedAt: '2026-08-15T00:00:00.000Z',
            installed: true,
            facts: 'resolved',
            factsError: null,
            fetchedAt: 10
          }
        ]
      },
      {
        name: 'qwen2.5',
        origin: 'registry',
        tagsState: 'unresolved',
        tagsError: null,
        tagsFetchedAt: null,
        tags: []
      }
    ],
    index: { state: 'resolved', fetchedAt: 1000, error: null, count: 2 },
    installed: { state: 'resolved', error: null, fetchedAt: 1000 },
    registry: { enabled: true, disabledReason: null, indexUrl: 'https://ollama.com/library', manifestHost: 'registry.ollama.ai' },
    refresh: { state: 'running', startedAt: 1, finishedAt: null, lastError: null, pendingTagFetches: 1, pendingFactFetches: 3 },
    cache: { state: 'loaded', error: null },
    completeness: { state: 'partial', modelsKnown: 2, tagsKnown: 2, reasons: ['1 of 2 models have not had their tag list fetched yet.'] },
    staleness: 'fresh',
    ttlMs: 1000,
    computedAt: 2000,
    ...over
  }
}

function row(over: Partial<CatalogRow> & { ref: string }): CatalogRow {
  return {
    name: over.ref.split(':')[0],
    tag: over.ref.includes(':') ? over.ref.split(':')[1] : null,
    sizeBytes: null,
    sizeExact: false,
    revision: null,
    revisionExact: false,
    publishedAt: null,
    installed: false,
    tagsState: 'resolved',
    tagsError: null,
    factsError: null,
    ...over
  }
}

describe('parseCatalogPayload', () => {
  it('flattens every model and tag into pullable references, carrying the facts each source really had', () => {
    const view = parseCatalogPayload(snapshot())
    expect(view.source).toBe('snapshot')
    expect(view.rows.map((r) => r.ref)).toEqual(['llama3.2:latest', 'llama3.2:1b', 'qwen2.5'])
    expect(view.rows[1]).toMatchObject({ installed: true, sizeExact: true, publishedAt: '2026-08-15T00:00:00.000Z' })
    expect(view.refreshing).toBe(true)
    expect(view.pendingTagFetches).toBe(1)
  })

  it('still lists a model whose tag list has not been fetched, with no tag rather than an invented "latest"', () => {
    const pending = parseCatalogPayload(snapshot()).rows.find((r) => r.ref === 'qwen2.5')!
    expect(pending.tag).toBeNull()
    expect(pending.tagsState).toBe('unresolved')
  })

  it('marks the legacy short list as such — an unknown completeness, never a complete catalog', () => {
    const view = parseCatalogPayload([{ name: 'llama3.2', note: 'general purpose' }])
    expect(view.source).toBe('legacy')
    expect(view.rows.map((r) => r.ref)).toEqual(['llama3.2'])
    expect(view.completeness.state).toBe('unknown')
    expect(completenessHeadline(view)).toContain('completeness unknown')
  })

  it('reports an unreadable payload as a load failure, not as an empty catalog', () => {
    for (const bad of [null, undefined, 42, { kind: 'something-else' }, { kind: 'ollama-catalog' }]) {
      const view = parseCatalogPayload(bad)
      expect(view.source).toBe('invalid')
      expect(view.rows).toEqual([])
      expect(view.completeness.reasons.join(' ')).toContain('not an empty catalog')
    }
  })

  it('an empty but VALID catalog is distinguishable from a failed one', () => {
    const view = parseCatalogPayload(
      snapshot({ models: [], completeness: { state: 'unavailable', modelsKnown: 0, tagsKnown: 0, reasons: ['index fetch failed'] } })
    )
    expect(view.source).toBe('snapshot')
    expect(completenessHeadline(view)).toContain('load failure, not an empty catalog')
  })
})

describe('completenessHeadline', () => {
  it('claims completeness only for a complete catalog', () => {
    const complete = parseCatalogPayload(
      snapshot({ completeness: { state: 'complete', modelsKnown: 234, tagsKnown: 9412, reasons: [] } })
    )
    expect(completenessHeadline(complete)).toContain('Complete first-party library')
    // The claim is deliberately scoped to Ollama's own library — it must never read as "every
    // model", since community (namespaced) models have no enumerable index at all.
    expect(completenessHeadline(complete)).not.toContain('every published model')
    const partial = parseCatalogPayload(snapshot())
    expect(completenessHeadline(partial)).toContain('not yet the whole catalog')
  })
})

describe('catalogPollShouldContinue', () => {
  it('keeps polling after a FAILED load attempt (null) — a transient failure must never end the loop', () => {
    // This is the exact bug: the old panel effect was keyed on the `catalog` object, which a failed
    // load never replaces, so it silently stopped re-arming. A load failure is evidence about that
    // one attempt, not about whether the refresh it was checking on is still running.
    expect(catalogPollShouldContinue(null)).toBe(true)
  })

  it('keeps polling while a successfully-loaded view still reports the refresh running', () => {
    const view = parseCatalogPayload(snapshot({ refresh: { state: 'running', startedAt: 1, finishedAt: null, lastError: null, pendingTagFetches: 1, pendingFactFetches: 1 } }))
    expect(catalogPollShouldContinue(view)).toBe(true)
  })

  it('stops once a successfully-loaded view reports the refresh has gone idle', () => {
    const view = parseCatalogPayload(snapshot({ refresh: { state: 'idle', startedAt: 1, finishedAt: 2, lastError: null, pendingTagFetches: 0, pendingFactFetches: 0 } }))
    expect(catalogPollShouldContinue(view)).toBe(false)
  })
})

describe('catalogPollDelayMs', () => {
  it('uses the base interval with no consecutive failures', () => {
    expect(catalogPollDelayMs(0, 3000)).toBe(3000)
  })

  it('backs off exponentially, capped at 8x the base interval, as failures accumulate', () => {
    expect(catalogPollDelayMs(1, 3000)).toBe(6000)
    expect(catalogPollDelayMs(2, 3000)).toBe(12000)
    expect(catalogPollDelayMs(3, 3000)).toBe(24000)
    expect(catalogPollDelayMs(9, 3000)).toBe(24000) // capped, not unbounded
  })
})

describe('stalenessSentence', () => {
  it('separates "never fetched" from "stale" from "fresh"', () => {
    const never = parseCatalogPayload(snapshot({ staleness: 'never', index: { state: 'never', fetchedAt: null, error: null, count: null } }))
    expect(stalenessSentence(never, 5000)).toContain('never been fetched')
    const stale = parseCatalogPayload(snapshot({ staleness: 'stale' }))
    expect(stalenessSentence(stale, 1000 + 7_200_000)).toContain('out of date')
    const fresh = parseCatalogPayload(snapshot())
    expect(stalenessSentence(fresh, 1000 + 120_000)).toContain('2 minutes ago')
  })
})

describe('selectCatalogPage', () => {
  const rows = [
    row({ ref: 'a:1', sizeBytes: 3 }),
    row({ ref: 'b:1', sizeBytes: null }),
    row({ ref: 'c:1', sizeBytes: 1, installed: true }),
    row({ ref: 'd:1', sizeBytes: 2 })
  ]
  const base = { query: '', filter: 'all' as const, sort: 'name' as const, page: 1, pageSize: 2 }

  it('paginates with honest counters', () => {
    const first = selectCatalogPage(rows, base)
    expect(first.rows.map((r) => r.ref)).toEqual(['a:1', 'b:1'])
    expect(first).toMatchObject({ total: 4, page: 1, pageCount: 2, from: 1, to: 2 })
    const second = selectCatalogPage(rows, { ...base, page: 2 })
    expect(second.rows.map((r) => r.ref)).toEqual(['c:1', 'd:1'])
    expect(second).toMatchObject({ from: 3, to: 4 })
  })

  it('clamps a page past the end instead of showing an empty page that reads as "no results"', () => {
    const page = selectCatalogPage(rows, { ...base, page: 99 })
    expect(page.page).toBe(2)
    expect(page.rows).toHaveLength(2)
  })

  it('searches the full reference, not just the model name', () => {
    const page = selectCatalogPage([row({ ref: 'llama3.2:1b-instruct-q4_K_M' }), row({ ref: 'qwen2.5:7b' })], {
      ...base,
      query: 'q4_k_m',
      pageSize: 50
    })
    expect(page.rows.map((r) => r.ref)).toEqual(['llama3.2:1b-instruct-q4_K_M'])
    expect(page.total).toBe(1)
  })

  it('filters by installed state and by whether a size is actually known', () => {
    expect(selectCatalogPage(rows, { ...base, filter: 'installed', pageSize: 50 }).rows.map((r) => r.ref)).toEqual(['c:1'])
    expect(selectCatalogPage(rows, { ...base, filter: 'not-installed', pageSize: 50 }).total).toBe(3)
    expect(selectCatalogPage(rows, { ...base, filter: 'with-size', pageSize: 50 }).rows.map((r) => r.ref)).toEqual([
      'a:1',
      'c:1',
      'd:1'
    ])
  })

  it('sorts unknown sizes LAST in both directions — an unknown size is not a small one', () => {
    const asc = selectCatalogPage(rows, { ...base, sort: 'size-asc', pageSize: 50 })
    expect(asc.rows.map((r) => r.ref)).toEqual(['c:1', 'd:1', 'a:1', 'b:1'])
    const desc = selectCatalogPage(rows, { ...base, sort: 'size-desc', pageSize: 50 })
    expect(desc.rows.map((r) => r.ref)).toEqual(['a:1', 'd:1', 'c:1', 'b:1'])
  })

  it('sorts installed references first when asked', () => {
    expect(selectCatalogPage(rows, { ...base, sort: 'installed-first', pageSize: 50 }).rows[0].ref).toBe('c:1')
  })

  it('reports an empty result set without inventing a page', () => {
    const page = selectCatalogPage(rows, { ...base, query: 'nothing-matches-this' })
    expect(page).toMatchObject({ total: 0, page: 1, pageCount: 1, from: 0, to: 0 })
  })
})
