// The ONLY part of the Ollama manager that leaves the loopback address, and the reason it has to.
//
// Ollama's local API cannot enumerate the published catalog. `/api/tags` lists what is INSTALLED;
// there is no local endpoint for "every model that exists". The registry Ollama's own CLI pulls
// from does not expose enumeration either — measured on 2026-08-18, both
// `registry.ollama.ai/v2/_catalog` and `registry.ollama.ai/v2/library/<model>/tags/list` answer
// `404 page not found`, so the Docker-Registry-v2 discovery endpoints simply are not implemented
// there. What IS implemented, and is exactly what `ollama pull` fetches, is
// `registry.ollama.ai/v2/<name>/manifests/<tag>` — verified returning a real OCI manifest with
// per-layer byte sizes.
//
// So an exhaustive catalog needs two sources, and this module is explicit about which fact comes
// from which:
//   1. ollama.com/library            → every published model name, and per model every published
//                                      tag with a rounded size and a short revision. This is an
//                                      HTML page, i.e. a scrape; it is parsed by LINK TARGET and by
//                                      value SHAPE (catalog-pure.ts), never by CSS class, and a 200
//                                      that yields nothing is reported as a FORMAT ERROR, never as
//                                      "there are no models".
//   2. registry.ollama.ai/v2/…       → the exact byte size and full manifest digest for one tag.
//                                      A machine API, and the same document the CLI uses.
//
// Trade-off, stated rather than hidden (docs/ollama-manager.md): this widens the manager's network
// surface from "loopback only" to "loopback plus Ollama's own first-party registry and website".
// It is first-party, unauthenticated, and read-only; no credential, model name from a private
// namespace, prompt, or chat content is ever sent. It runs only when the user opens the manager,
// never at boot, and `NT_OLLAMA_NO_REGISTRY=1` turns it off entirely for an air-gapped deployment —
// in which case the panel says the catalog is unavailable, not that it is empty.

import { createHash } from 'node:crypto'
import { manifestFacts, parseLibraryIndex, parseTagsPage, type ParsedTag } from './catalog-pure'

export const OLLAMA_LIBRARY_INDEX_URL = 'https://ollama.com/library'
export const OLLAMA_REGISTRY_HOST = 'registry.ollama.ai'
/** Every host this module may talk to. Checked against the FINAL response url, so a redirect
 *  cannot walk the crawl onto a third-party host. */
const ALLOWED_HOSTS = new Set(['ollama.com', 'www.ollama.com', OLLAMA_REGISTRY_HOST])

const INDEX_TIMEOUT_MS = 20_000
const TAGS_TIMEOUT_MS = 20_000
const MANIFEST_TIMEOUT_MS = 10_000

export type CatalogSourceErrorKind = 'network' | 'http' | 'format' | 'host'

export class CatalogSourceError extends Error {
  constructor(
    message: string,
    public readonly kind: CatalogSourceErrorKind,
    public readonly status: number | null = null
  ) {
    super(message)
  }
}

/** Why registry lookups are switched off, or null when they are on. Pure so the disabled path is
 *  testable without touching process.env at runtime. */
export function registryDisabledReason(env: Record<string, string | undefined>): string | null {
  const off = (v: string | undefined): boolean => v === '1' || v === 'true' || v === 'yes'
  if (off(env.NT_OLLAMA_NO_REGISTRY)) {
    return 'Catalog lookups are disabled by NT_OLLAMA_NO_REGISTRY. Only locally installed models can be listed; the published catalog is unavailable, not empty.'
  }
  if (off(env.NT_OFFLINE)) {
    return 'Catalog lookups are disabled by NT_OFFLINE. Only locally installed models can be listed; the published catalog is unavailable, not empty.'
  }
  return null
}

export interface RegistryCatalogDeps {
  fetchImpl?: typeof fetch
  /** Injectable so tests do not wait on real timeouts. */
  timeouts?: { index?: number; tags?: number; manifest?: number }
}

export interface RegistryManifestFacts {
  sizeBytes: number
  /** sha256 of the manifest bytes — the OCI content digest, i.e. the published revision of this
   *  exact tag. Computed here rather than read from a header because registry.ollama.ai does not
   *  send `Docker-Content-Digest` (measured), and a digest we computed from the bytes we actually
   *  received is stronger evidence than one the server asserts anyway. */
  revision: string
  modelDigest: string | null
}

export class OllamaRegistryCatalog {
  private readonly fetchImpl: typeof fetch
  private readonly timeouts: { index: number; tags: number; manifest: number }

  constructor(deps: RegistryCatalogDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    this.timeouts = {
      index: deps.timeouts?.index ?? INDEX_TIMEOUT_MS,
      tags: deps.timeouts?.tags ?? TAGS_TIMEOUT_MS,
      manifest: deps.timeouts?.manifest ?? MANIFEST_TIMEOUT_MS
    }
  }

  private async get(url: string, timeoutMs: number, accept: string): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        signal: ctrl.signal,
        headers: { accept, 'user-agent': 'nodeterm-ollama-catalog' },
        // No cookies, no auth: these are public documents and this app has no account here.
        credentials: 'omit',
        redirect: 'follow'
      })
    } catch (e) {
      const detail = (e as Error)?.message || 'request failed'
      throw new CatalogSourceError(
        ctrl.signal.aborted ? `timed out after ${timeoutMs} ms` : detail,
        'network'
      )
    } finally {
      clearTimeout(timer)
    }
    // A redirect must not be able to move the crawl onto a host this app never decided to talk to.
    const finalHost = safeHost(res.url) ?? safeHost(url)
    if (finalHost !== null && !ALLOWED_HOSTS.has(finalHost)) {
      throw new CatalogSourceError(`refused a redirect to ${finalHost}`, 'host')
    }
    if (!res.ok) throw new CatalogSourceError(`HTTP ${res.status}`, 'http', res.status)
    return res
  }

  /** Every published model name. Throws `format` on a 200 whose body yields none: the library is
   *  never actually empty, so that combination means the page changed shape — and reporting it as
   *  an error is the whole point (an empty list rendered as "the catalog" is the exact failure this
   *  feature exists to remove). */
  async index(): Promise<string[]> {
    const res = await this.get(OLLAMA_LIBRARY_INDEX_URL, this.timeouts.index, 'text/html')
    const names = parseLibraryIndex(await res.text())
    if (names.length === 0) {
      throw new CatalogSourceError(
        'the library index answered 200 but no model links could be parsed from it — treating this as a page-format change, not as an empty catalog',
        'format'
      )
    }
    return names
  }

  /** Every published tag for one model, with the rounded size/short revision the page prints.
   *  Same format-error rule: every published model has at least a `latest` tag. */
  async tags(model: string): Promise<ParsedTag[]> {
    const url = `${OLLAMA_LIBRARY_INDEX_URL}/${encodeURI(model)}/tags`
    const res = await this.get(url, this.timeouts.tags, 'text/html')
    const parsed = parseTagsPage(await res.text(), model)
    if (parsed.length === 0) {
      throw new CatalogSourceError(
        `${model}'s tag page answered 200 but no tags could be parsed from it — treating this as a page-format change, not as a model with no tags`,
        'format'
      )
    }
    return parsed
  }

  /** Exact size + revision for one tag, from the manifest `ollama pull` itself downloads. */
  async manifest(model: string, tag: string): Promise<RegistryManifestFacts> {
    const namespaced = model.includes('/') ? model : `library/${model}`
    const url = `https://${OLLAMA_REGISTRY_HOST}/v2/${encodeURI(namespaced)}/manifests/${encodeURIComponent(tag)}`
    const res = await this.get(
      url,
      this.timeouts.manifest,
      'application/vnd.docker.distribution.manifest.v2+json, application/json'
    )
    const body = await res.text()
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      throw new CatalogSourceError('manifest response was not JSON', 'format')
    }
    let facts
    try {
      facts = manifestFacts(json)
    } catch (e) {
      throw new CatalogSourceError((e as Error).message, 'format')
    }
    return {
      sizeBytes: facts.sizeBytes,
      revision: `sha256:${createHash('sha256').update(body).digest('hex')}`,
      modelDigest: facts.modelDigest
    }
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}
