// Orchestration + durable cache for the exhaustive model catalog. All decisions live in
// catalog-pure.ts and all network access in registry-catalog.ts; this file owns the state machine
// that joins them: load the cache, fold in what Ollama actually has installed, run a bounded
// background crawl, and answer every call with an honest snapshot of what is and is not known.
//
// Two rules shape the whole design:
//  1. The answer is never blocked on the crawl. A caller gets what we have now, plus the refresh
//     state, so the panel can say "listing 234 models, still fetching tags for 190 of them" instead
//     of showing a spinner or — much worse — a short list with no caveat.
//  2. Nothing here ever turns a failure into an absence. A failed index leaves the previous models
//     in place and records the error; an unreadable cache file is quarantined and reported, not
//     silently treated as "no cache".

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { renameAtomic, writeFileAtomic } from '../fs-atomic'
import type { OllamaClient } from './client'
import {
  CATALOG_TTL_MS,
  applyInstalled,
  applyManifestFacts,
  catalogStaleness,
  deriveCompleteness,
  markFactsError,
  markTagsError,
  mergeIndexNames,
  mergeTags,
  pendingWork,
  planFactFetches,
  planTagFetches,
  splitRef
} from './catalog-pure'
import type { CatalogIndexState, CatalogModel, CatalogSnapshot } from './catalog-types'
import {
  OLLAMA_LIBRARY_INDEX_URL,
  OLLAMA_REGISTRY_HOST,
  OllamaRegistryCatalog,
  registryDisabledReason
} from './registry-catalog'

/** Per-pass budgets. Small passes with a save between them mean a crash (or a quit) mid-crawl keeps
 *  everything fetched so far, and the next launch resumes instead of starting over. */
const TAGS_PER_PASS = 8
const TAGS_CONCURRENCY = 4
const FACTS_PER_PASS = 20
const FACTS_CONCURRENCY = 5
/** Ceilings for ONE refresh. The tag ceiling comfortably covers the whole library (234 models when
 *  this was written) so a refresh really does reach every model; the manifest ceiling deliberately
 *  does not — there are thousands of tags, each already carrying a rounded size from the library
 *  page, so exact byte counts are refined a few hundred at a time across sessions rather than
 *  hammering the registry with ten thousand requests the first time the panel opens. */
const MAX_TAG_FETCHES_PER_REFRESH = 500
const MAX_FACT_FETCHES_PER_REFRESH = 200
/** Minimum gap between refreshes that have only REFINEMENT work left (exact manifest sizes). The
 *  panel polls this store while a refresh runs, and there are thousands of tags, so without this a
 *  panel left open would restart the manifest crawl on every poll — a permanent request loop
 *  against Ollama's registry for numbers the user already has to two significant figures. Coverage
 *  work (the index and missing tag lists) is deliberately NOT throttled: listing every model and
 *  every tag is the whole point of the feature. */
const REFINEMENT_COOLDOWN_MS = 60_000

interface PersistedCatalog {
  version: 1
  models: CatalogModel[]
  index: CatalogIndexState
  savedAt: number
}

export interface CatalogStoreDeps {
  userDataDir: string
  client: OllamaClient
  registry?: OllamaRegistryCatalog
  env?: Record<string, string | undefined>
  now?: () => number
  ttlMs?: number
  /** Test seam: overrides the per-refresh ceilings so a suite can prove the loop terminates. */
  limits?: { maxTagFetches?: number; maxFactFetches?: number }
}

export class OllamaCatalogStore {
  private readonly file: string
  private readonly registry: OllamaRegistryCatalog
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxTagFetches: number
  private readonly maxFactFetches: number
  private readonly disabledReason: string | null

  private models: CatalogModel[] = []
  private index: CatalogIndexState = { state: 'never', fetchedAt: null, error: null, count: null }
  private cache: CatalogSnapshot['cache'] = { state: 'empty', error: null }
  private installed: CatalogSnapshot['installed'] = { state: 'never', error: null, fetchedAt: null }
  private refresh: CatalogSnapshot['refresh'] = {
    state: 'idle',
    startedAt: null,
    finishedAt: null,
    lastError: null,
    pendingTagFetches: 0,
    pendingFactFetches: 0
  }
  private loaded: Promise<void> | null = null
  private running: Promise<void> | null = null
  /** Set when the cache file exists, could not be read, and could not be moved aside either. */
  private savingBlocked = false

  constructor(private readonly deps: CatalogStoreDeps) {
    this.file = join(deps.userDataDir, 'ollama', 'catalog.json')
    this.registry = deps.registry ?? new OllamaRegistryCatalog()
    this.now = deps.now ?? (() => Date.now())
    this.ttlMs = deps.ttlMs ?? CATALOG_TTL_MS
    this.maxTagFetches = deps.limits?.maxTagFetches ?? MAX_TAG_FETCHES_PER_REFRESH
    this.maxFactFetches = deps.limits?.maxFactFetches ?? MAX_FACT_FETCHES_PER_REFRESH
    this.disabledReason = registryDisabledReason(deps.env ?? process.env)
  }

  /** The one public entry point: returns the current snapshot immediately and, if the catalog is
   *  missing or stale and registry lookups are enabled, kicks off a background refresh whose
   *  progress later calls will observe. Deliberately never awaits that refresh. */
  async snapshot(): Promise<CatalogSnapshot> {
    await this.ensureLoaded()
    await this.refreshInstalled()
    this.maybeStartRefresh()
    return this.build()
  }

  /** The published download size for one exact reference, or null when it is not known.
   *
   *  Read-only on purpose: it awaits the cache load but never starts a fetch, because its caller is
   *  the hardware-fit evaluation, which runs on every page turn and must not turn a scroll into a
   *  crawl. `exact: false` means the number is the library page's rounded figure, and the caller is
   *  responsible for saying so — a rounded size presented as a measurement is the kind of quiet
   *  overstatement the fit evaluator exists to avoid. */
  async publishedSize(ref: string): Promise<{ sizeBytes: number; exact: boolean } | null> {
    await this.ensureLoaded()
    const { name, tag } = splitRef(ref)
    const found = this.models.find((m) => m.name === name)?.tags.find((t) => t.tag === tag)
    if (!found || found.sizeBytes === null) return null
    return { sizeBytes: found.sizeBytes, exact: found.sizeExact }
  }

  // -------------------------------------------------------------------------------------------
  // Cache
  // -------------------------------------------------------------------------------------------

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) this.loaded = this.load()
    return this.loaded
  }

  private async load(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        // The ONLY reading that means "no cache yet". Everything else is evidence, handled below.
        this.cache = { state: 'empty', error: null }
        return
      }
      // Not ENOENT: the bytes exist and we could not read them, so we do not know what they are.
      const setAside = await this.setAside('unreadable')
      this.cache = {
        state: 'unreadable',
        error: setAside
          ? `${(e as Error).message} — the file was set aside for inspection`
          : `${(e as Error).message} — the file could not be set aside either, so saving is paused rather than overwriting it`
      }
      // A file we could not read is not a file we may destroy. Refusing to save keeps the crawl
      // in memory only, which the snapshot already reports, instead of silently replacing evidence.
      this.savingBlocked = !setAside
      return
    }
    try {
      const parsed = JSON.parse(raw) as PersistedCatalog
      if (parsed?.version !== 1 || !Array.isArray(parsed.models)) throw new Error('unexpected cache shape')
      this.models = parsed.models
      this.index = parsed.index ?? this.index
      this.cache = { state: 'loaded', error: null }
    } catch (e) {
      // Quarantine rather than overwrite: the bytes may be the only copy of a long crawl, and a
      // future version may be able to read them. Starting empty is a fact we then REPORT.
      const setAside = await this.setAside('corrupt')
      this.cache = {
        state: 'unreadable',
        error: setAside
          ? `${(e as Error).message} — the file was set aside for inspection`
          : `${(e as Error).message} — the file could not be set aside either, so saving is paused rather than overwriting it`
      }
      this.savingBlocked = !setAside
    }
  }

  private async setAside(kind: 'corrupt' | 'unreadable'): Promise<boolean> {
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await renameAtomic(this.file, `${this.file}.${kind}-${this.now()}`)
      return true
    } catch {
      return false
    }
  }

  private async save(): Promise<void> {
    if (this.savingBlocked) return
    const payload: PersistedCatalog = {
      version: 1,
      models: this.models,
      index: this.index,
      savedAt: this.now()
    }
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, JSON.stringify(payload))
    } catch {
      // A cache write failure must not break the live catalog — the snapshot in memory is still
      // correct, it just will not survive a restart.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Local truth
  // -------------------------------------------------------------------------------------------

  private async refreshInstalled(): Promise<void> {
    try {
      const models = await this.deps.client.tags()
      this.models = applyInstalled(
        this.models,
        models.map((m) => ({
          name: m.name,
          sizeBytes: m.sizeBytes,
          modifiedAt: m.modifiedAt,
          digest: m.digest
        })),
        this.now()
      )
      this.installed = { state: 'resolved', error: null, fetchedAt: this.now() }
    } catch (e) {
      // Ollama being down says nothing about the published catalog, and it certainly does not mean
      // no models are installed — keep the previous installed marks and say the check failed.
      this.installed = { state: 'error', error: (e as Error).message, fetchedAt: this.now() }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------------------------

  private maybeStartRefresh(): void {
    if (this.disabledReason !== null || this.running) return
    const stale = catalogStaleness(this.index.fetchedAt, this.now(), this.ttlMs) !== 'fresh'
    const work = pendingWork(this.models)
    if (!stale && work.tags === 0 && work.facts === 0) return
    const refinementOnly = !stale && work.tags === 0
    if (
      refinementOnly &&
      this.refresh.finishedAt !== null &&
      this.now() - this.refresh.finishedAt < REFINEMENT_COOLDOWN_MS
    ) {
      return
    }
    this.running = this.runRefresh().finally(() => {
      this.running = null
    })
    void this.running
  }

  private async runRefresh(): Promise<void> {
    this.refresh = {
      ...this.refresh,
      state: 'running',
      startedAt: this.now(),
      finishedAt: null,
      lastError: null
    }
    try {
      if (catalogStaleness(this.index.fetchedAt, this.now(), this.ttlMs) !== 'fresh') {
        await this.fetchIndex()
      }
      await this.crawlTags()
      await this.crawlFacts()
    } catch (e) {
      this.refresh = { ...this.refresh, lastError: (e as Error).message }
    } finally {
      const work = pendingWork(this.models)
      // Persist BEFORE reporting idle. Callers treat idle as "this refresh is fully settled" — the
      // panel stops polling on it — and a trailing write landing after that is a write nobody is
      // expecting any more, which can clobber a cache file that was changed in between.
      await this.save()
      this.refresh = {
        ...this.refresh,
        state: 'idle',
        finishedAt: this.now(),
        pendingTagFetches: work.tags,
        pendingFactFetches: work.facts
      }
    }
  }

  private async fetchIndex(): Promise<void> {
    try {
      const names = await this.registry.index()
      this.models = mergeIndexNames(this.models, names)
      this.index = { state: 'resolved', fetchedAt: this.now(), error: null, count: names.length }
    } catch (e) {
      // Keep every previously known model: a failed index is a fact about the fetch, not about the
      // library. `count` keeps the last successful number for the same reason.
      this.index = { ...this.index, state: 'error', error: (e as Error).message, fetchedAt: this.now() }
    }
    await this.save()
  }

  private async crawlTags(): Promise<void> {
    let fetched = 0
    for (;;) {
      if (fetched >= this.maxTagFetches) return
      const targets = planTagFetches(
        this.models,
        this.now(),
        Math.min(TAGS_PER_PASS, this.maxTagFetches - fetched),
        this.ttlMs
      )
      if (targets.length === 0) return
      fetched += targets.length
      await mapBounded(targets, TAGS_CONCURRENCY, async (name) => {
        try {
          const parsed = await this.registry.tags(name)
          this.updateModel(name, (m) => mergeTags(m, parsed, this.now()))
        } catch (e) {
          this.updateModel(name, (m) => markTagsError(m, (e as Error).message, this.now()))
        }
      })
      await this.save()
    }
  }

  private async crawlFacts(): Promise<void> {
    let fetched = 0
    for (;;) {
      if (fetched >= this.maxFactFetches) return
      const targets = planFactFetches(
        this.models,
        this.now(),
        Math.min(FACTS_PER_PASS, this.maxFactFetches - fetched)
      )
      if (targets.length === 0) return
      fetched += targets.length
      await mapBounded(targets, FACTS_CONCURRENCY, async (target) => {
        try {
          const facts = await this.registry.manifest(target.name, target.tag)
          this.updateModel(target.name, (m) => applyManifestFacts(m, target.tag, facts, this.now()))
        } catch (e) {
          this.updateModel(target.name, (m) => markFactsError(m, target.tag, (e as Error).message, this.now()))
        }
      })
      await this.save()
    }
  }

  /** Applies a pure model transform by NAME rather than by index/reference: a concurrent
   *  applyInstalled() (every snapshot call runs one) rebuilds the array while a crawl is in flight,
   *  so a captured object reference would write facts into a detached copy and silently lose them. */
  private updateModel(name: string, fn: (model: CatalogModel) => CatalogModel): void {
    const idx = this.models.findIndex((m) => m.name === name)
    if (idx === -1) return
    const next = this.models.slice()
    next[idx] = fn(next[idx])
    this.models = next
  }

  // -------------------------------------------------------------------------------------------
  // Snapshot assembly
  // -------------------------------------------------------------------------------------------

  private build(): CatalogSnapshot {
    const now = this.now()
    const work = pendingWork(this.models)
    const completeness = deriveCompleteness(this.models, this.index)
    if (this.disabledReason !== null) completeness.reasons.unshift(this.disabledReason)
    if (this.cache.state === 'unreadable') {
      completeness.reasons.unshift(
        `The on-disk catalog cache could not be read (${this.cache.error ?? 'unknown error'}), so anything fetched previously is not shown here.`
      )
    }
    if (this.installed.state === 'error') {
      completeness.reasons.push(
        `Installed models could not be listed (${this.installed.error ?? 'unknown error'}), so the "installed" marks below may be out of date.`
      )
    }
    return {
      kind: 'ollama-catalog',
      version: 1,
      models: this.models,
      index: this.index,
      installed: this.installed,
      registry: {
        enabled: this.disabledReason === null,
        disabledReason: this.disabledReason,
        indexUrl: OLLAMA_LIBRARY_INDEX_URL,
        manifestHost: OLLAMA_REGISTRY_HOST
      },
      refresh: {
        ...this.refresh,
        pendingTagFetches: work.tags,
        pendingFactFetches: work.facts
      },
      cache: this.cache,
      completeness,
      staleness: catalogStaleness(this.index.fetchedAt, now, this.ttlMs),
      ttlMs: this.ttlMs,
      computedAt: now
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. Rejections are the caller's business —
 *  every call site above already catches per item, so one bad model cannot abort a whole pass. */
async function mapBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      await fn(items[index])
    }
  })
  await Promise.all(workers)
}
