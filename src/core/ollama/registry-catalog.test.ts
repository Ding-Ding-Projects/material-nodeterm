// The catalog's only network module, driven through an injected fetch. The manifest fixture is a
// verbatim (trimmed) response from registry.ollama.ai/v2/library/llama3.2/manifests/1b captured
// 2026-08-18, so the size arithmetic is checked against a document the real registry actually
// served rather than one shaped to fit the parser.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CatalogSourceError, OllamaRegistryCatalog, registryDisabledReason } from './registry-catalog'

const REAL_MANIFEST = JSON.stringify({
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: { mediaType: 'application/vnd.docker.container.image.v1+json', digest: 'sha256:4f659a1e', size: 485 },
  layers: [
    { mediaType: 'application/vnd.ollama.image.model', digest: 'sha256:74701a8c', size: 1_321_082_688 },
    { mediaType: 'application/vnd.ollama.image.template', digest: 'sha256:966de95c', size: 1429 },
    { mediaType: 'application/vnd.ollama.image.license', digest: 'sha256:fcc5a6be', size: 7711 },
    { mediaType: 'application/vnd.ollama.image.license', digest: 'sha256:a70ff7e5', size: 6016 }
  ]
})

function harness(handler: (url: string) => Response | Promise<Response>) {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    return handler(url)
  }) as unknown as typeof fetch
  return { urls, source: new OllamaRegistryCatalog({ fetchImpl, timeouts: { index: 50, tags: 50, manifest: 50 } }) }
}

const html = (body: string): Response => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })

describe('registryDisabledReason', () => {
  it('is null by default and a stated reason when an operator switched lookups off', () => {
    expect(registryDisabledReason({})).toBeNull()
    expect(registryDisabledReason({ NT_OLLAMA_NO_REGISTRY: '1' })).toContain('unavailable, not empty')
    expect(registryDisabledReason({ NT_OFFLINE: 'true' })).toContain('NT_OFFLINE')
    expect(registryDisabledReason({ NT_OLLAMA_NO_REGISTRY: '0' })).toBeNull()
  })
})

describe('OllamaRegistryCatalog.index', () => {
  it('asks Ollama\'s own library index and returns every model name', async () => {
    const { source, urls } = harness(() => html('<a href="/library/llama3.2">x</a><a href="/library/qwen2.5">y</a>'))
    await expect(source.index()).resolves.toEqual(['llama3.2', 'qwen2.5'])
    expect(urls).toEqual(['https://ollama.com/library'])
  })

  it('treats a 200 with no parseable models as a FORMAT error — never as "there are no models"', async () => {
    const { source } = harness(() => html('<html><body>we redesigned the page</body></html>'))
    await expect(source.index()).rejects.toMatchObject({ kind: 'format' })
  })

  it('reports HTTP and transport failures as themselves', async () => {
    const { source: http } = harness(() => new Response('nope', { status: 503 }))
    await expect(http.index()).rejects.toMatchObject({ kind: 'http', status: 503 })
    const { source: net } = harness(() => {
      throw new Error('getaddrinfo ENOTFOUND ollama.com')
    })
    await expect(net.index()).rejects.toMatchObject({ kind: 'network' })
  })

  it('refuses a response that ended up on a host this app never chose to talk to', async () => {
    const { source } = harness(() => {
      const res = html('<a href="/library/llama3.2">x</a>')
      Object.defineProperty(res, 'url', { value: 'https://cdn.example.invalid/library' })
      return res
    })
    await expect(source.index()).rejects.toMatchObject({ kind: 'host' })
  })
})

describe('OllamaRegistryCatalog.tags', () => {
  it('fetches the model\'s own tag page and returns every published tag', async () => {
    const { source, urls } = harness(() =>
      html('<a href="/library/llama3.2:1b">a</a><a href="/library/llama3.2:3b">b</a>')
    )
    await expect(source.tags('llama3.2')).resolves.toEqual([
      { tag: '1b', sizeBytes: null, shortRevision: null },
      { tag: '3b', sizeBytes: null, shortRevision: null }
    ])
    expect(urls).toEqual(['https://ollama.com/library/llama3.2/tags'])
  })

  it('treats a 200 with no tags as a format change — every published model has at least :latest', async () => {
    const { source } = harness(() => html('<div>nothing here</div>'))
    await expect(source.tags('llama3.2')).rejects.toMatchObject({ kind: 'format' })
  })
})

describe('OllamaRegistryCatalog.manifest', () => {
  it('reads the exact download size and derives the revision from the exact bytes received', async () => {
    const { source, urls } = harness(() => new Response(REAL_MANIFEST, { status: 200 }))
    await expect(source.manifest('llama3.2', '1b')).resolves.toEqual({
      sizeBytes: 485 + 1_321_082_688 + 1429 + 7711 + 6016,
      revision: `sha256:${createHash('sha256').update(REAL_MANIFEST).digest('hex')}`,
      modelDigest: 'sha256:74701a8c'
    })
    expect(urls).toEqual(['https://registry.ollama.ai/v2/library/llama3.2/manifests/1b'])
  })

  it('keeps a namespaced model\'s namespace instead of forcing it under library/', async () => {
    const { source, urls } = harness(() => new Response(REAL_MANIFEST, { status: 200 }))
    await source.manifest('someone/model', 'q4_K_M')
    expect(urls).toEqual(['https://registry.ollama.ai/v2/someone/model/manifests/q4_K_M'])
  })

  it('refuses to turn a non-manifest response into a size', async () => {
    const { source: notJson } = harness(() => new Response('<html>404</html>', { status: 200 }))
    await expect(notJson.manifest('llama3.2', '1b')).rejects.toMatchObject({ kind: 'format' })
    const { source: wrongDoc } = harness(() => new Response(JSON.stringify({ errors: [] }), { status: 200 }))
    await expect(wrongDoc.manifest('llama3.2', '1b')).rejects.toMatchObject({ kind: 'format' })
  })

  it('surfaces an unknown manifest as an HTTP failure carrying its status', async () => {
    const { source } = harness(() => new Response('{"errors":[]}', { status: 404 }))
    const error = await source.manifest('llama3.2', 'nope').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CatalogSourceError)
    expect(error).toMatchObject({ kind: 'http', status: 404 })
  })
})

// The only check that can catch Ollama redesigning its pages out from under the parser. It makes
// real requests, so it is opt-in (`NT_OLLAMA_LIVE_CATALOG=1 npx vitest run registry-catalog`) and
// is NOT part of the normal suite: a test that fails because a laptop is offline teaches nothing.
// Last run by hand 2026-08-18 — 234 models in the index, 63 tags for llama3.2, every tag carrying a
// size and a short revision.
describe.skipIf(process.env.NT_OLLAMA_LIVE_CATALOG !== '1')('live sources (opt-in)', () => {
  const live = new OllamaRegistryCatalog()

  it('the library index still yields a plausible number of models', { timeout: 60_000 }, async () => {
    const names = await live.index()
    expect(names.length).toBeGreaterThan(100)
    expect(names).toContain('llama3.2')
  })

  it('a tag page still yields every tag with a size and a short revision', { timeout: 60_000 }, async () => {
    const tags = await live.tags('llama3.2')
    expect(tags.length).toBeGreaterThan(20)
    expect(tags.some((t) => t.tag === 'latest')).toBe(true)
    expect(tags.filter((t) => t.sizeBytes === null)).toEqual([])
    expect(tags.filter((t) => t.shortRevision === null)).toEqual([])
  })

  it('the registry manifest endpoint the CLI pulls from still answers with real byte sizes', { timeout: 60_000 }, async () => {
    const facts = await live.manifest('llama3.2', '1b')
    expect(facts.sizeBytes).toBeGreaterThan(1e9)
    expect(facts.revision).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(facts.modelDigest).toMatch(/^sha256:/)
  })
})
