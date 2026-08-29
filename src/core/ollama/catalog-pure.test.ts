// Behavioural tests for the catalog's pure decision layer. The HTML fixtures are VERBATIM excerpts
// of the live pages (captured 2026-08-18) rather than markup invented to match the parser — a
// fixture written from the parser's point of view proves only that the author's belief is
// self-consistent, which is exactly the mistake client.test.ts already records for this subsystem.
//
// Everything here is about the same distinction: "not fetched", "fetch failed" and "genuinely
// empty" are three states, and no function may quietly turn one into another.

import { describe, expect, it } from 'vitest'
import {
  CATALOG_ERROR_BACKOFF_MS,
  applyInstalled,
  applyManifestFacts,
  catalogStaleness,
  deriveCompleteness,
  manifestFacts,
  markFactsError,
  markTagsError,
  mergeIndexNames,
  mergeTags,
  parseLibraryIndex,
  parseTagsPage,
  pendingWork,
  planFactFetches,
  planTagFetches,
  splitRef
} from './catalog-pure'
import type { CatalogIndexState, CatalogModel } from './catalog-types'

/** One verbatim tag block from https://ollama.com/library/llama3.2/tags (2026-08-18). */
const REAL_TAG_BLOCK = `<a href="/library/llama3.2:1b" class="md:hidden flex flex-col space-y-[6px] group">
              <div class="flex items-center font-medium">
                <div class="flex items-center justify-between w-full">
                  <div>
                    <span class="group-hover:underline">llama3.2:1b</span>
                  </div>
                </div>
              </div>
              <div class="flex flex-col text-neutral-500 text-[13px]">
                <span>
                  <span class="font-mono">
                    baf6a787fdff</span> • 1.3GB • 128K context window  •
                  <span class="hidden sm:inline">
                    Text input •
                    1 year ago
                  </span>
                </span>
              </div>
            </a>`

/** Verbatim shape of the library index's model links (2026-08-18). */
const REAL_INDEX = `
  <a href="/library/deepseek-r1" class="group w-full"><span>deepseek-r1</span></a>
  <a href="/library/nomic-embed-text" class="group w-full"><span>nomic-embed-text</span></a>
  <a href="/library/deepseek-r1" class="md:hidden"><span>deepseek-r1</span></a>
  <a href="/blog/whatever">not a model</a>
  <a href="/library/llama3.2:1b">a tag link, not a model</a>
`

function model(partial: Partial<CatalogModel> & { name: string }): CatalogModel {
  return {
    origin: 'registry',
    tagsState: 'unresolved',
    tagsError: null,
    tagsFetchedAt: null,
    tags: [],
    ...partial
  }
}

function tag(name: string, over: Partial<CatalogModel['tags'][number]> = {}) {
  return {
    tag: name,
    sizeBytes: null,
    sizeExact: false,
    revision: null,
    revisionExact: false,
    publishedAt: null,
    installed: false,
    facts: 'unresolved' as const,
    factsError: null,
    fetchedAt: null,
    ...over
  }
}

const RESOLVED_INDEX: CatalogIndexState = { state: 'resolved', fetchedAt: 1000, error: null, count: 2 }

describe('parseLibraryIndex', () => {
  it('takes every model name from the real page shape, de-duplicated, and never mistakes a tag link or a non-library link for a model', () => {
    expect(parseLibraryIndex(REAL_INDEX)).toEqual(['deepseek-r1', 'nomic-embed-text'])
  })

  it('returns nothing for markup with no library links, so the caller can report a format change instead of an empty catalog', () => {
    expect(parseLibraryIndex('<html><body>maintenance</body></html>')).toEqual([])
  })

  it('drops a trailing-slash category-style href instead of capturing a bogus model name', () => {
    // The capture's allow-list character class permits "/", so `href="/library/embedding/"` would
    // otherwise be read as the model name "embedding/" — a real trap distinct from the tag-colon
    // one above (colons can never reach the capture at all; a trailing slash can, and needs its own
    // check). This is the one part of the old dead-guard line that actually does something.
    const html = '<a href="/library/embedding/"><span>category page, not a model</span></a>'
    expect(parseLibraryIndex(html)).toEqual([])
  })
})

describe('parseTagsPage', () => {
  it('reads the tag, its short revision and its rounded size out of the real page block', () => {
    expect(parseTagsPage(REAL_TAG_BLOCK, 'llama3.2')).toEqual([
      { tag: '1b', sizeBytes: 1_300_000_000, shortRevision: 'baf6a787fdff' }
    ])
  })

  it('still lists a tag whose metadata block cannot be parsed, with unknown facts rather than dropping it', () => {
    const parsed = parseTagsPage('<a href="/library/llama3.2:3b-future-layout">3b</a>', 'llama3.2')
    expect(parsed).toEqual([{ tag: '3b-future-layout', sizeBytes: null, shortRevision: null }])
  })

  it('does not attribute another model\'s tags to this one', () => {
    const html = `<a href="/library/qwen2.5:7b">x</a>${REAL_TAG_BLOCK}`
    expect(parseTagsPage(html, 'llama3.2').map((t) => t.tag)).toEqual(['1b'])
    expect(parseTagsPage(html, 'qwen2.5').map((t) => t.tag)).toEqual(['7b'])
  })

  it('keeps the block that actually carried the facts when the page renders a tag twice', () => {
    const html = `${REAL_TAG_BLOCK}<a href="/library/llama3.2:1b" class="hidden md:flex">llama3.2:1b</a>`
    expect(parseTagsPage(html, 'llama3.2')[0].sizeBytes).toBe(1_300_000_000)
  })
})

describe('manifestFacts', () => {
  const real = {
    schemaVersion: 2,
    config: { digest: 'sha256:4f65', size: 485 },
    layers: [
      { mediaType: 'application/vnd.ollama.image.model', digest: 'sha256:7470', size: 1_321_082_688 },
      { mediaType: 'application/vnd.ollama.image.template', digest: 'sha256:966d', size: 1429 },
      { mediaType: 'application/vnd.ollama.image.license', digest: 'sha256:fcc5', size: 7711 }
    ]
  }

  it('totals config plus every layer — the bytes a pull actually downloads', () => {
    expect(manifestFacts(real)).toEqual({
      sizeBytes: 485 + 1_321_082_688 + 1429 + 7711,
      modelDigest: 'sha256:7470'
    })
  })

  it('throws rather than reporting a size of zero for a document that is not a manifest', () => {
    expect(() => manifestFacts({ errors: [{ code: 'MANIFEST_UNKNOWN' }] })).toThrow()
    expect(() => manifestFacts({ layers: [{ mediaType: 'x' }] })).toThrow()
  })
})

describe('mergeIndexNames', () => {
  it('keeps everything already known about a model that is still published', () => {
    const before = [model({ name: 'llama3.2', tagsState: 'resolved', tagsFetchedAt: 5, tags: [tag('1b')] })]
    const after = mergeIndexNames(before, ['llama3.2', 'qwen2.5'])
    expect(after.find((m) => m.name === 'llama3.2')).toMatchObject({ tagsState: 'resolved', tagsFetchedAt: 5 })
    expect(after.find((m) => m.name === 'qwen2.5')).toMatchObject({ tagsState: 'unresolved', tags: [] })
  })

  it('drops a registry model the index no longer publishes but never a locally installed one', () => {
    const before = [
      model({ name: 'unpublished', origin: 'registry' }),
      model({ name: 'my-own-build', origin: 'local', tags: [tag('latest', { installed: true })] })
    ]
    expect(mergeIndexNames(before, ['llama3.2']).map((m) => m.name)).toEqual(['llama3.2', 'my-own-build'])
  })
})

describe('mergeTags', () => {
  it('keeps an exact manifest size instead of replacing it with the page\'s rounded figure', () => {
    const before = model({
      name: 'llama3.2',
      tags: [tag('1b', { sizeBytes: 1_321_098_329, sizeExact: true, facts: 'resolved', revision: 'sha256:abc', revisionExact: true })]
    })
    const after = mergeTags(before, [{ tag: '1b', sizeBytes: 1_300_000_000, shortRevision: 'baf6a787fdff' }], 100)
    expect(after.tags[0]).toMatchObject({
      sizeBytes: 1_321_098_329,
      sizeExact: true,
      revision: 'sha256:abc',
      revisionExact: true
    })
  })

  it('takes the page figure for a tag that has no size yet, marked inexact', () => {
    const after = mergeTags(model({ name: 'llama3.2' }), [{ tag: '1b', sizeBytes: 1_300_000_000, shortRevision: 'baf' }], 100)
    expect(after.tags[0]).toMatchObject({ sizeBytes: 1_300_000_000, sizeExact: false, revision: 'baf' })
    expect(after.tagsState).toBe('resolved')
  })

  it('keeps an installed tag the registry no longer publishes, and drops an uninstalled one', () => {
    const before = model({
      name: 'llama3.2',
      tags: [tag('retired', { installed: true }), tag('also-retired')]
    })
    const after = mergeTags(before, [{ tag: '1b', sizeBytes: null, shortRevision: null }], 100)
    expect(after.tags.map((t) => t.tag).sort()).toEqual(['1b', 'retired'])
  })
})

describe('markTagsError / markFactsError', () => {
  it('records the failure without deleting the tags the previous successful fetch found', () => {
    const before = model({ name: 'llama3.2', tagsState: 'resolved', tags: [tag('1b')] })
    const after = markTagsError(before, 'HTTP 503', 200)
    expect(after.tags).toHaveLength(1)
    expect(after).toMatchObject({ tagsState: 'error', tagsError: 'HTTP 503', tagsFetchedAt: 200 })
  })

  it('leaves a tag\'s size unknown rather than zero when its manifest fetch fails', () => {
    const after = markFactsError(model({ name: 'x', tags: [tag('1b')] }), '1b', 'HTTP 404', 200)
    expect(after.tags[0]).toMatchObject({ facts: 'error', factsError: 'HTTP 404', sizeBytes: null })
  })
})

describe('splitRef', () => {
  it('applies Ollama\'s own rule that a bare name means :latest, and keeps a namespace intact', () => {
    expect(splitRef('llama3.2')).toEqual({ name: 'llama3.2', tag: 'latest' })
    expect(splitRef('llama3.2:1b')).toEqual({ name: 'llama3.2', tag: '1b' })
    expect(splitRef('someone/model')).toEqual({ name: 'someone/model', tag: 'latest' })
    expect(splitRef('someone/model:q4')).toEqual({ name: 'someone/model', tag: 'q4' })
  })
})

describe('applyInstalled', () => {
  const installed = [
    { name: 'llama3.2:1b', sizeBytes: 1_321_098_329, modifiedAt: '2026-08-15T00:00:00.000Z', digest: 'deadbeef' }
  ]

  it('marks the matching published tag installed with its exact on-disk size and real timestamp', () => {
    const after = applyInstalled([model({ name: 'llama3.2', tags: [tag('1b'), tag('3b')] })], installed, 500)
    const tags = after[0].tags
    expect(tags.find((t) => t.tag === '1b')).toMatchObject({
      installed: true,
      sizeBytes: 1_321_098_329,
      sizeExact: true,
      publishedAt: '2026-08-15T00:00:00.000Z'
    })
    expect(tags.find((t) => t.tag === '3b')).toMatchObject({ installed: false, sizeBytes: null })
  })

  it('adds a local-origin entry for a model the published index does not carry', () => {
    const after = applyInstalled([], [{ ...installed[0], name: 'my-own-build:latest' }], 500)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ name: 'my-own-build', origin: 'local' })
    expect(after[0].tags[0]).toMatchObject({ tag: 'latest', installed: true })
  })

  it('clears an installed mark that is no longer true instead of leaving a deleted model marked', () => {
    const before = [model({ name: 'llama3.2', tags: [tag('1b', { installed: true })] })]
    expect(applyInstalled(before, [], 500)[0].tags[0].installed).toBe(false)
  })
})

describe('deriveCompleteness', () => {
  it('is "unavailable" — never "complete" — when nothing has been fetched', () => {
    const c = deriveCompleteness([], { state: 'never', fetchedAt: null, error: null, count: null })
    expect(c.state).toBe('unavailable')
    expect(c.reasons.join(' ')).toContain('has not been fetched')
  })

  it('reports a failed index as a failure to look, not as an empty catalog', () => {
    const c = deriveCompleteness([], { state: 'error', fetchedAt: 5, error: 'HTTP 503', count: null })
    expect(c.state).toBe('unavailable')
    expect(c.reasons.join(' ')).toContain('HTTP 503')
    expect(c.reasons.join(' ')).toContain('not evidence that there are no models')
  })

  it('is "partial" while any model still owes a tag list', () => {
    const models = [
      model({ name: 'a', tagsState: 'resolved', tags: [tag('latest')] }),
      model({ name: 'b' })
    ]
    const c = deriveCompleteness(models, RESOLVED_INDEX)
    expect(c.state).toBe('partial')
    expect(c.modelsPendingTags).toBe(1)
  })

  it('is "partial" when a tag list failed, even though every other model resolved', () => {
    const models = [
      model({ name: 'a', tagsState: 'resolved', tags: [tag('latest')] }),
      model({ name: 'b', tagsState: 'error', tagsError: 'HTTP 500' })
    ]
    expect(deriveCompleteness(models, RESOLVED_INDEX).state).toBe('partial')
  })

  it('is "complete" only once the index and every tag list resolved — rounded sizes are a caveat, not incompleteness', () => {
    const models = [
      model({ name: 'a', tagsState: 'resolved', tags: [tag('latest', { sizeBytes: 1e9 })] }),
      model({ name: 'b', tagsState: 'resolved', tags: [tag('latest', { sizeBytes: 2e9, sizeExact: true })] })
    ]
    const c = deriveCompleteness(models, RESOLVED_INDEX)
    expect(c.state).toBe('complete')
    expect(c.tagsKnown).toBe(2)
    expect(c.reasons.join(' ')).toContain('rounded figures')
  })

  it('names the first-party-library scope on "complete" — it must never read as "every model Ollama can pull"', () => {
    // This is the central defect a live-site review found: ollama.com/library is enumerable (234
    // models, measured), but community models published under a namespace (e.g. "user/model") are
    // NOT — ollama.com/search caps at ~20 results per query and its `page` param redirects back to
    // page 1 instead of paging (measured live 2026-08-18, docs/ollama-manager.md). 'complete' must
    // say so every time it fires, not just sometimes.
    const models = [model({ name: 'a', tagsState: 'resolved', tags: [tag('latest', { sizeBytes: 1e9 })] })]
    const c = deriveCompleteness(models, RESOLVED_INDEX)
    expect(c.state).toBe('complete')
    expect(c.reasons.join(' ')).toContain('have no enumerable index')
    expect(c.reasons.join(' ')).toContain('exact reference')
    // The claim itself must be scoped to the library, not phrased as unconditional totality.
    expect(c.reasons.join(' ')).not.toContain('every model Ollama can pull')
  })

  it('does not repeat the community-scope note on "partial" — it belongs to the completeness claim, not every state', () => {
    const models = [model({ name: 'a', tagsState: 'resolved', tags: [tag('latest')] }), model({ name: 'b' })]
    const c = deriveCompleteness(models, RESOLVED_INDEX)
    expect(c.state).toBe('partial')
    expect(c.reasons.join(' ')).not.toContain('have no enumerable index')
  })
})

describe('catalogStaleness', () => {
  it('separates "never fetched" from "old", because they need different sentences', () => {
    expect(catalogStaleness(null, 1_000_000, 1000)).toBe('never')
    expect(catalogStaleness(999_500, 1_000_000, 1000)).toBe('fresh')
    expect(catalogStaleness(999_000, 1_000_000, 1000)).toBe('stale')
  })
})

describe('planTagFetches', () => {
  it('puts models with something installed first, then never-fetched ones', () => {
    const models = [
      model({ name: 'zeta' }),
      model({ name: 'alpha', tags: [tag('latest', { installed: true })] })
    ]
    expect(planTagFetches(models, 1000, 10, 100)).toEqual(['alpha', 'zeta'])
  })

  it('skips a model whose tag fetch just failed, so one broken name cannot eat every pass', () => {
    const models = [model({ name: 'broken', tagsState: 'error', tagsFetchedAt: 1000 }), model({ name: 'fine' })]
    expect(planTagFetches(models, 1000 + CATALOG_ERROR_BACKOFF_MS - 1, 10)).toEqual(['fine'])
    expect(planTagFetches(models, 1000 + CATALOG_ERROR_BACKOFF_MS, 10)).toEqual(['fine', 'broken'])
  })

  it('leaves a freshly resolved model alone and returns to it once its tags go stale', () => {
    const models = [model({ name: 'a', tagsState: 'resolved', tagsFetchedAt: 1000, tags: [tag('latest')] })]
    expect(planTagFetches(models, 1500, 10, 1000)).toEqual([])
    expect(planTagFetches(models, 2500, 10, 1000)).toEqual(['a'])
  })

  it('respects the budget', () => {
    const models = ['a', 'b', 'c'].map((name) => model({ name }))
    expect(planTagFetches(models, 1000, 2)).toEqual(['a', 'b'])
  })
})

describe('planFactFetches', () => {
  it('asks for installed tags first, then tags with no size at all, then merely rounded ones', () => {
    const models = [
      model({
        name: 'a',
        tags: [tag('rounded', { sizeBytes: 1e9 }), tag('unknown'), tag('here', { installed: true })]
      })
    ]
    expect(planFactFetches(models, 1000, 10).map((t) => t.tag)).toEqual(['here', 'unknown', 'rounded'])
  })

  it('never asks the registry for a local-only model, which has no published manifest', () => {
    const models = [model({ name: 'mine', origin: 'local', tags: [tag('latest', { installed: true })] })]
    expect(planFactFetches(models, 1000, 10)).toEqual([])
  })

  it('does not re-ask for a tag already resolved, and backs off after an error', () => {
    const models = [
      model({
        name: 'a',
        tags: [tag('done', { facts: 'resolved' }), tag('failed', { facts: 'error', fetchedAt: 1000 })]
      })
    ]
    expect(planFactFetches(models, 1000 + CATALOG_ERROR_BACKOFF_MS - 1, 10)).toEqual([])
    expect(planFactFetches(models, 1000 + CATALOG_ERROR_BACKOFF_MS, 10)).toEqual([{ name: 'a', tag: 'failed' }])
  })
})

describe('applyManifestFacts + pendingWork', () => {
  it('promotes the tag to an exact size and revision, and retires it from the outstanding work', () => {
    const before = model({ name: 'a', tagsState: 'resolved', tags: [tag('1b', { sizeBytes: 1_300_000_000 })] })
    expect(pendingWork([before])).toEqual({ tags: 0, facts: 1 })
    const after = applyManifestFacts(before, '1b', { sizeBytes: 1_321_098_329, revision: 'sha256:aa', modelDigest: 'sha256:bb' }, 900)
    expect(after.tags[0]).toMatchObject({
      sizeBytes: 1_321_098_329,
      sizeExact: true,
      revision: 'sha256:aa',
      revisionExact: true,
      facts: 'resolved'
    })
    expect(pendingWork([after])).toEqual({ tags: 0, facts: 0 })
  })

  it('counts a model whose tag list has never been fetched as outstanding work', () => {
    expect(pendingWork([model({ name: 'a' })])).toEqual({ tags: 1, facts: 0 })
  })
})
