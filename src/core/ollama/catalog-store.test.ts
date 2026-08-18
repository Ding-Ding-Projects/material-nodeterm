// The catalog state machine against a real temp directory and fake sources. What is being pinned
// is not "the happy path returns rows" but the four ways this feature could lie: claiming
// completeness it does not have, turning a failed fetch into an empty list, losing a crawl to a
// cache it could not read, and re-crawling forever.

import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OllamaCatalogStore } from './catalog-store'
import type { ParsedTag } from './catalog-pure'
import type { CatalogSnapshot } from './catalog-types'
import type { OllamaClient } from './client'
import type { OllamaRegistryCatalog } from './registry-catalog'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ollama-catalog-'))
  dirs.push(dir)
  return dir
}

interface FakeSources {
  index?: () => Promise<string[]>
  tags?: (model: string) => Promise<ParsedTag[]>
  manifest?: (model: string, tag: string) => Promise<{ sizeBytes: number; revision: string; modelDigest: string | null }>
  installed?: () => Promise<{ name: string; sizeBytes: number; digest: string; modifiedAt: string }[]>
}

function makeStore(dir: string, sources: FakeSources, env: Record<string, string | undefined> = {}) {
  const calls = { index: 0, tags: [] as string[], manifest: [] as string[] }
  const registry = {
    index: async () => {
      calls.index++
      if (!sources.index) throw new Error('no index source')
      return sources.index()
    },
    tags: async (model: string) => {
      calls.tags.push(model)
      if (!sources.tags) throw new Error('no tags source')
      return sources.tags(model)
    },
    manifest: async (model: string, tag: string) => {
      calls.manifest.push(`${model}:${tag}`)
      if (!sources.manifest) throw new Error('no manifest source')
      return sources.manifest(model, tag)
    }
  } as unknown as OllamaRegistryCatalog
  const client = {
    tags: async () => (sources.installed ? sources.installed() : [])
  } as unknown as OllamaClient
  const store = new OllamaCatalogStore({ userDataDir: dir, client, registry, env })
  return { store, calls }
}

/** Drives snapshot() until the background crawl reports idle. Mirrors what the panel does (poll the
 *  same channel), so a crawl that never terminates fails here as a timeout rather than hanging the
 *  app. */
async function settled(store: OllamaCatalogStore, attempts = 200): Promise<CatalogSnapshot> {
  let last = await store.snapshot()
  for (let i = 0; i < attempts; i++) {
    if (last.refresh.state === 'idle' && last.refresh.finishedAt !== null) return last
    await new Promise((resolve) => setTimeout(resolve, 5))
    last = await store.snapshot()
  }
  return last
}

const twoTags = async (model: string): Promise<ParsedTag[]> => [
  { tag: 'latest', sizeBytes: 1_300_000_000, shortRevision: `${model.slice(0, 4)}00000000` },
  { tag: '1b', sizeBytes: null, shortRevision: null }
]

describe('OllamaCatalogStore', () => {
  it('lists every model and every tag, and only then calls itself complete', async () => {
    const dir = await tempDir()
    const { store } = makeStore(dir, {
      index: async () => ['llama3.2', 'qwen2.5'],
      tags: twoTags,
      manifest: async () => ({ sizeBytes: 1_321_098_329, revision: 'sha256:aa', modelDigest: 'sha256:bb' })
    })
    const snap = await settled(store)
    expect(snap.completeness.state).toBe('complete')
    expect(snap.models.map((m) => m.name).sort()).toEqual(['llama3.2', 'qwen2.5'])
    expect(snap.completeness.tagsKnown).toBe(4)
    expect(snap.staleness).toBe('fresh')
  })

  it('never claims completeness when a tag list failed, and keeps the models it did get', async () => {
    const dir = await tempDir()
    const { store } = makeStore(dir, {
      index: async () => ['llama3.2', 'broken'],
      tags: async (model) => {
        if (model === 'broken') throw new Error('HTTP 503')
        return twoTags(model)
      },
      manifest: async () => ({ sizeBytes: 1, revision: 'sha256:aa', modelDigest: null })
    })
    const snap = await settled(store)
    expect(snap.completeness.state).toBe('partial')
    expect(snap.models.map((m) => m.name)).toContain('broken')
    expect(snap.models.find((m) => m.name === 'broken')).toMatchObject({ tagsState: 'error', tagsError: 'HTTP 503' })
    expect(snap.completeness.reasons.join(' ')).toContain('failed to fetch')
  })

  it('reports a failed index as unavailable, never as an empty catalog', async () => {
    const dir = await tempDir()
    const { store } = makeStore(dir, {
      index: async () => {
        throw new Error('getaddrinfo ENOTFOUND ollama.com')
      }
    })
    const snap = await settled(store)
    expect(snap.completeness.state).toBe('unavailable')
    expect(snap.index.state).toBe('error')
    expect(snap.completeness.reasons.join(' ')).toContain('ENOTFOUND')
    expect(snap.completeness.reasons.join(' ')).toContain('not evidence that there are no models')
  })

  it('keeps a previously crawled catalog when a later index refresh fails', async () => {
    const dir = await tempDir()
    const first = makeStore(dir, {
      index: async () => ['llama3.2'],
      tags: twoTags,
      manifest: async () => ({ sizeBytes: 1, revision: 'sha256:aa', modelDigest: null })
    })
    await settled(first.store)

    const second = makeStore(dir, {
      index: async () => {
        throw new Error('HTTP 502')
      },
      tags: twoTags,
      manifest: async () => ({ sizeBytes: 1, revision: 'sha256:aa', modelDigest: null })
    })
    // Force the refresh: the cached index is fresh, so nothing would be re-fetched otherwise.
    const cache = JSON.parse(await readFile(join(dir, 'ollama', 'catalog.json'), 'utf8'))
    cache.index.fetchedAt = 1
    await writeFile(join(dir, 'ollama', 'catalog.json'), JSON.stringify(cache))
    const snap = await settled(second.store)
    expect(snap.models.map((m) => m.name)).toEqual(['llama3.2'])
    expect(snap.index.state).toBe('error')
    expect(snap.completeness.state).toBe('partial')
    expect(snap.completeness.reasons.join(' ')).toContain('last one that was fetched successfully')
  })

  it('resumes from the on-disk cache instead of re-crawling every model', async () => {
    const dir = await tempDir()
    const first = makeStore(dir, {
      index: async () => ['llama3.2', 'qwen2.5'],
      tags: twoTags,
      manifest: async () => ({ sizeBytes: 1, revision: 'sha256:aa', modelDigest: null })
    })
    await settled(first.store)

    const second = makeStore(dir, { index: async () => ['llama3.2', 'qwen2.5'], tags: twoTags })
    const snap = await settled(second.store)
    expect(second.calls.tags).toEqual([])
    expect(second.calls.index).toBe(0)
    expect(snap.completeness.state).toBe('complete')
    expect(snap.cache.state).toBe('loaded')
  })

  it('quarantines an unreadable cache and says so, rather than presenting an empty catalog as the truth', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'ollama'), { recursive: true })
    await writeFile(join(dir, 'ollama', 'catalog.json'), '{ this is not json')
    const { store } = makeStore(dir, {
      index: async () => {
        throw new Error('offline')
      }
    })
    const snap = await settled(store)
    expect(snap.cache.state).toBe('unreadable')
    expect(snap.completeness.reasons.join(' ')).toContain('could not be read')
    expect(snap.completeness.state).toBe('unavailable')
    // The bytes are kept: they may be the only copy of a long crawl, and this build being unable to
    // parse them is not permission to delete them.
    const setAside = (await readdir(join(dir, 'ollama'))).filter((f) => f.includes('.corrupt-'))
    expect(setAside).toHaveLength(1)
    expect(await readFile(join(dir, 'ollama', setAside[0]), 'utf8')).toBe('{ this is not json')
  })

  it('sets a cache it could not READ aside before saving again, instead of writing over it in place', async () => {
    const dir = await tempDir()
    // A directory where the cache file should be: the read fails with something other than ENOENT,
    // which is "we do not know what is in there", not "there is nothing".
    await mkdir(join(dir, 'ollama', 'catalog.json'), { recursive: true })
    await writeFile(join(dir, 'ollama', 'catalog.json', 'keep-me'), 'evidence')
    const { store } = makeStore(dir, { index: async () => ['llama3.2'], tags: twoTags })
    const snap = await settled(store)
    expect(snap.cache.state).toBe('unreadable')
    const setAside = (await readdir(join(dir, 'ollama'))).find((e) => e.includes('.unreadable-'))!
    expect(await readdir(join(dir, 'ollama', setAside))).toEqual(['keep-me'])
  })

  it('refuses to save at all when the unreadable cache could not even be moved aside', async () => {
    const dir = await tempDir()
    // The cache is a perfectly writable file whose CONTENTS could not be parsed, and its set-aside
    // name (pinned by the injected clock) is already an occupied directory, so the rename fails.
    // A plain save would therefore succeed here and destroy the bytes — which is precisely what the
    // refusal exists to prevent, and what makes this fixture able to tell the two behaviours apart.
    await mkdir(join(dir, 'ollama'), { recursive: true })
    await writeFile(join(dir, 'ollama', 'catalog.json'), 'evidence that must survive')
    await mkdir(join(dir, 'ollama', 'catalog.json.corrupt-1'), { recursive: true })
    await writeFile(join(dir, 'ollama', 'catalog.json.corrupt-1', 'occupied'), 'x')
    const client = { tags: async () => [] } as unknown as OllamaClient
    const registry = { index: async () => ['llama3.2'], tags: twoTags } as unknown as OllamaRegistryCatalog
    const store = new OllamaCatalogStore({ userDataDir: dir, client, registry, env: {}, now: () => 1 })
    const snap = await settled(store)
    expect(snap.cache.state).toBe('unreadable')
    expect(snap.cache.error).toContain('saving is paused')
    expect(snap.models.map((m) => m.name)).toEqual(['llama3.2']) // the crawl still ran, in memory
    expect(await readFile(join(dir, 'ollama', 'catalog.json'), 'utf8')).toBe('evidence that must survive')
  })

  it('an Ollama that is down does not erase installed marks or fake an empty install set', async () => {
    const dir = await tempDir()
    const first = makeStore(dir, {
      index: async () => ['llama3.2'],
      tags: twoTags,
      manifest: async () => ({ sizeBytes: 1, revision: 'sha256:aa', modelDigest: null }),
      installed: async () => [
        { name: 'llama3.2:latest', sizeBytes: 42, digest: 'deadbeef', modifiedAt: '2026-08-15T00:00:00.000Z' }
      ]
    })
    const before = await settled(first.store)
    expect(before.models[0].tags.find((t) => t.tag === 'latest')).toMatchObject({ installed: true, sizeBytes: 42 })

    const second = makeStore(dir, {
      index: async () => ['llama3.2'],
      tags: twoTags,
      installed: async () => {
        throw new Error('ECONNREFUSED')
      }
    })
    const after = await settled(second.store)
    expect(after.installed).toMatchObject({ state: 'error', error: 'ECONNREFUSED' })
    expect(after.models[0].tags.find((t) => t.tag === 'latest')?.installed).toBe(true)
    expect(after.completeness.reasons.join(' ')).toContain('may be out of date')
  })

  it('makes no network call at all when catalog lookups are disabled, and says the catalog is unavailable rather than empty', async () => {
    const dir = await tempDir()
    const { store, calls } = makeStore(
      dir,
      { index: async () => ['llama3.2'], tags: twoTags },
      { NT_OLLAMA_NO_REGISTRY: '1' }
    )
    const snap = await settled(store, 5)
    expect(calls.index).toBe(0)
    expect(calls.tags).toEqual([])
    expect(snap.registry.enabled).toBe(false)
    expect(snap.completeness.state).toBe('unavailable')
    expect(snap.completeness.reasons.join(' ')).toContain('NT_OLLAMA_NO_REGISTRY')
  })

  it('still lists a locally installed model the published index does not carry, marked as such', async () => {
    const dir = await tempDir()
    const { store } = makeStore(dir, {
      index: async () => ['llama3.2'],
      tags: twoTags,
      manifest: async () => ({ sizeBytes: 1, revision: 'sha256:aa', modelDigest: null }),
      installed: async () => [
        { name: 'my-own-build:latest', sizeBytes: 7, digest: 'abc', modifiedAt: '2026-08-15T00:00:00.000Z' }
      ]
    })
    const snap = await settled(store)
    const mine = snap.models.find((m) => m.name === 'my-own-build')
    expect(mine).toMatchObject({ origin: 'local' })
    expect(mine?.tags[0]).toMatchObject({ installed: true, sizeExact: true, publishedAt: '2026-08-15T00:00:00.000Z' })
  })

  it('stops asking the registry for a tag whose manifest keeps failing, instead of looping on it', async () => {
    const dir = await tempDir()
    const { store, calls } = makeStore(dir, {
      index: async () => ['llama3.2'],
      tags: twoTags,
      manifest: async () => {
        throw new Error('HTTP 404')
      }
    })
    const snap = await settled(store)
    expect(calls.manifest.sort()).toEqual(['llama3.2:1b', 'llama3.2:latest'])
    const tags = snap.models[0].tags
    expect(tags.find((t) => t.tag === '1b')).toMatchObject({ facts: 'error', sizeBytes: null })
    // The rounded size from the tag page survives a failed manifest — it was real evidence.
    expect(tags.find((t) => t.tag === 'latest')).toMatchObject({ facts: 'error', sizeBytes: 1_300_000_000, sizeExact: false })
  })
})

// Opt-in, because it makes real requests to ollama.com and registry.ollama.ai:
// `NT_OLLAMA_LIVE_CATALOG=1 npx vitest run catalog-store`. The fetch ceilings are tiny so this
// costs one index page and two tag pages, not a full crawl. Last run 2026-08-18.
describe.skipIf(process.env.NT_OLLAMA_LIVE_CATALOG !== '1')('OllamaCatalogStore against the live sources (opt-in)', () => {
  it('really does list the whole published index and fills tags in from the real pages', { timeout: 120_000 }, async () => {
    const dir = await tempDir()
    const client = { tags: async () => [] } as unknown as OllamaClient
    const store = new OllamaCatalogStore({
      userDataDir: dir,
      client,
      env: {},
      limits: { maxTagFetches: 2, maxFactFetches: 2 }
    })
    const done = (s: CatalogSnapshot): boolean =>
      s.completeness.modelsWithTags >= 2 && s.completeness.tagsWithExactFacts >= 2
    let snap = await store.snapshot()
    for (let i = 0; i < 200 && !done(snap); i++) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      snap = await store.snapshot()
    }
    expect(snap.index.state).toBe('resolved')
    expect(snap.models.length).toBeGreaterThan(100)
    // Only a couple of models were crawled, so this is emphatically NOT complete — and it must
    // still say partial while listing the whole index.
    expect(snap.completeness.state).toBe('partial')
    expect(snap.completeness.modelsWithTags).toBeGreaterThanOrEqual(2)
    expect(snap.completeness.modelsWithTags).toBeLessThan(snap.models.length)
    const crawled = snap.models.filter((m) => m.tagsState === 'resolved')
    expect(crawled.every((m) => m.tags.length > 0)).toBe(true)
    expect(crawled.some((m) => m.tags.some((t) => t.sizeBytes !== null))).toBe(true)
    expect(snap.models.some((m) => m.tags.some((t) => t.sizeExact && t.facts === 'resolved'))).toBe(true)
  })
})
