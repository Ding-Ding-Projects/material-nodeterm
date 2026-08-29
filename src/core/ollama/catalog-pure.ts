// Pure decision layer for the exhaustive Ollama model catalog: parsing, merging, completeness,
// staleness and fetch planning. No I/O, no clock of its own (every function takes `now`), so all of
// it is directly unit-testable — catalog-pure.test.ts. The network side is registry-catalog.ts and
// the orchestration/persistence is catalog-store.ts.
//
// The rule every function here exists to enforce: a fetch that failed, a fetch that has not
// happened yet, and a source that genuinely reported nothing are THREE different outcomes. They may
// never collapse into one another — that collapse is how a store ends up telling a user "these are
// all the models there are" while showing ten of them.

import type {
  CatalogCompleteness,
  CatalogFetchState,
  CatalogIndexState,
  CatalogModel,
  CatalogStaleness,
  CatalogTag
} from './catalog-types'

/** How long a fetched catalog is considered fresh. 12 h: the library gains models on a scale of
 *  days, and a full refresh costs one index page plus one page per model, so re-crawling more often
 *  than this spends real bandwidth on a list that has not moved. */
export const CATALOG_TTL_MS = 12 * 60 * 60 * 1000

/** After a failed tag/manifest fetch, do not retry that exact target for this long. Without a
 *  backoff a permanently-404ing model would be re-fetched on every pass forever, starving the
 *  models that CAN be fetched out of the per-pass budget. */
export const CATALOG_ERROR_BACKOFF_MS = 30 * 60 * 1000

// ---------------------------------------------------------------------------------------------
// Parsing — the library index and a model's tag page
// ---------------------------------------------------------------------------------------------

/** Model names published in Ollama's library index page.
 *
 *  This keys on the LINK TARGETS (`href="/library/<name>"`), not on CSS classes or DOM structure:
 *  the href is the page's actual contract with its own router, while the class names are Tailwind
 *  utility soup that changes with any restyle. A restyle must not silently shrink this app's idea
 *  of "every model".
 *
 *  Only ollama.com's own **first-party library** is enumerable at all: there is no equivalent index
 *  for community models published under a namespace (e.g. "user/model") — see
 *  docs/ollama-manager.md → "Where the catalog comes from" for the live measurement that proves it
 *  (ollama.com/search caps at ~20 results per query and its `page` parameter 303-redirects back to
 *  page 1 instead of paging). This function therefore only ever needs to recognise `/library/<name>`
 *  hrefs, never a namespaced path.
 *
 *  Returns names in the order the page lists them, de-duplicated. An empty result from a page that
 *  really loaded is NOT "there are no models" — the caller (registry-catalog.ts) turns that into a
 *  format error, because the only honest reading is that the page shape changed. */
export function parseLibraryIndex(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  // The capture group is an ALLOW-list (`[a-zA-Z0-9._\-/]`), not a negated class — it simply never
  // contains ":". So a tag link (`href="/library/llama3.2:1b"`) can never produce a match here at
  // all: the capture stops at "llama3.2", and the regex then requires a literal `"` immediately
  // after the capture, which the following ":" is not — the whole match fails and the loop moves on.
  // (An earlier version of this comment described a `[^"]` class that was never actually here, and
  // carried a redundant `name.includes(':')` runtime check below that could never fire given this
  // character class — a guard that read as protection while providing none.) The remaining
  // `endsWith('/')` check is real: the same allow-list permits "/", so a category-style href like
  // `href="/library/embedding/"` would otherwise be captured as the bogus model name "embedding/".
  const re = /href="\/library\/([a-zA-Z0-9][a-zA-Z0-9._\-/]*)"/g
  for (;;) {
    const m = re.exec(html)
    if (!m) break
    const name = m[1]
    if (name.endsWith('/')) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export interface ParsedTag {
  tag: string
  /** Rounded size as printed by the page, in bytes, or null when the row did not carry one. */
  sizeBytes: number | null
  /** The 12-hex short digest the page prints beside each tag, or null when absent. */
  shortRevision: string | null
}

const SIZE_UNITS: Record<string, number> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }

/** Parses one model's tag page into every published tag, with the rounded size and short revision
 *  the page prints beside each one.
 *
 *  Same reasoning as parseLibraryIndex: the tag itself comes from the href (stable), while size and
 *  digest are matched by SHAPE inside that tag's own anchor — a 12-hex digest followed by a number
 *  and a byte unit — never by class name or column position. When the shape is not found the fields
 *  stay null (unknown), which is the honest degrade: the tag is still listed, it just has no size
 *  yet. Sizes are decimal (the page prints "1.3GB" for 1_321_098_329 bytes) and are recorded as
 *  inexact so the UI can show "≈". */
export function parseTagsPage(html: string, model: string): ParsedTag[] {
  const esc = model.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const byTag = new Map<string, ParsedTag>()

  const anchor = new RegExp(`<a href="/library/${esc}:([^"]+)"([\\s\\S]*?)</a>`, 'g')
  for (;;) {
    const m = anchor.exec(html)
    if (!m) break
    const tag = m[1]
    const body = m[2]
    const facts = /([0-9a-f]{12})<\/span>[^<]*?([0-9.]+)\s*(TB|GB|MB|KB)/.exec(body)
    const existing = byTag.get(tag)
    const parsed: ParsedTag = {
      tag,
      sizeBytes: facts ? Math.round(parseFloat(facts[2]) * SIZE_UNITS[facts[3]]) : null,
      shortRevision: facts ? facts[1] : null
    }
    // The page renders each tag twice (a mobile and a desktop block). Keep whichever block actually
    // carried the facts rather than letting the second, sparser one blank them out.
    if (!existing || (existing.sizeBytes === null && parsed.sizeBytes !== null)) byTag.set(tag, parsed)
  }

  // A tag can also appear only as a bare link (no anchor block matched, e.g. a future layout that
  // moves the metadata out of the <a>). Listing it with unknown facts is strictly better than
  // dropping it: exhaustiveness is the point of this feature.
  const bare = new RegExp(`href="/library/${esc}:([^"]+)"`, 'g')
  for (;;) {
    const m = bare.exec(html)
    if (!m) break
    if (!byTag.has(m[1])) byTag.set(m[1], { tag: m[1], sizeBytes: null, shortRevision: null })
  }
  return [...byTag.values()]
}

export interface ManifestFacts {
  sizeBytes: number
  modelDigest: string | null
}

/** Exact download size + the weights-layer digest from a registry manifest — the same document
 *  `ollama pull` fetches. Total size is config + every layer, because that is what actually gets
 *  downloaded. Throws on a document that is not a manifest, so the caller records a format error
 *  rather than a size of 0. */
export function manifestFacts(json: unknown): ManifestFacts {
  const doc = json as {
    config?: { size?: unknown; digest?: unknown }
    layers?: { size?: unknown; digest?: unknown; mediaType?: unknown }[]
  }
  if (!doc || !Array.isArray(doc.layers)) throw new Error('not an OCI manifest (no layers array)')
  let total = typeof doc.config?.size === 'number' ? doc.config.size : 0
  let modelDigest: string | null = null
  for (const layer of doc.layers) {
    if (typeof layer?.size !== 'number' || !Number.isFinite(layer.size)) {
      throw new Error('manifest layer has no numeric size')
    }
    total += layer.size
    if (layer.mediaType === 'application/vnd.ollama.image.model' && typeof layer.digest === 'string') {
      modelDigest = layer.digest
    }
  }
  return { sizeBytes: total, modelDigest }
}

// ---------------------------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------------------------

function emptyModel(name: string, origin: CatalogModel['origin']): CatalogModel {
  return { name, origin, tagsState: 'unresolved', tagsError: null, tagsFetchedAt: null, tags: [] }
}

/** Folds a successful index fetch into the known models.
 *
 *  Existing models keep every fact they already have (tag lists, sizes, revisions) — a refresh of
 *  the NAME index says nothing about the tags. Models that the index no longer lists are dropped
 *  ONLY when they came from the registry: a 'local' model is one the local Ollama actually has and
 *  the library simply does not publish, so pruning it would delete a true row on the strength of an
 *  unrelated source. */
export function mergeIndexNames(models: CatalogModel[], names: string[]): CatalogModel[] {
  const byName = new Map(models.map((m) => [m.name, m]))
  const out: CatalogModel[] = []
  for (const name of names) {
    const existing = byName.get(name)
    out.push(existing ? { ...existing, origin: 'registry' } : emptyModel(name, 'registry'))
    byName.delete(name)
  }
  // Whatever the index did not list: keep it only if the local Ollama is the reason we know about
  // it. A registry-origin model the index has stopped publishing really is gone.
  for (const leftover of byName.values()) if (leftover.origin === 'local') out.push(leftover)
  return out
}

/** Folds a model's freshly fetched tag list in, preserving per-tag facts we already resolved.
 *
 *  A tag that disappears from the published list is dropped unless it is installed — an installed
 *  reference is a fact about this machine and stays visible (and deletable) even after the registry
 *  stops publishing it. */
export function mergeTags(model: CatalogModel, parsed: ParsedTag[], now: number): CatalogModel {
  const previous = new Map(model.tags.map((t) => [t.tag, t]))
  const tags: CatalogTag[] = parsed.map((p) => {
    const old = previous.get(p.tag)
    previous.delete(p.tag)
    // An exact size we already earned (a fetched manifest, or the installed model's on-disk bytes)
    // outranks the page's rounded figure; downgrading it would make the UI's "≈" a lie in reverse.
    const keepExact = old !== undefined && old.sizeExact && (old.facts === 'resolved' || old.installed)
    let sizeBytes: number | null
    let sizeExact: boolean
    if (keepExact) {
      sizeBytes = old!.sizeBytes
      sizeExact = true
    } else if (p.sizeBytes !== null) {
      sizeBytes = p.sizeBytes
      sizeExact = false
    } else {
      sizeBytes = old?.sizeBytes ?? null
      sizeExact = old?.sizeExact ?? false
    }
    return {
      tag: p.tag,
      sizeBytes,
      sizeExact,
      revision: old?.revisionExact ? old.revision : (p.shortRevision ?? old?.revision ?? null),
      revisionExact: old?.revisionExact ?? false,
      publishedAt: old?.publishedAt ?? null,
      installed: old?.installed ?? false,
      facts: old?.facts ?? 'unresolved',
      factsError: old?.factsError ?? null,
      fetchedAt: p.sizeBytes !== null || p.shortRevision !== null ? now : (old?.fetchedAt ?? null)
    }
  })
  for (const orphan of previous.values()) if (orphan.installed) tags.push(orphan)
  return { ...model, tags, tagsState: 'resolved', tagsError: null, tagsFetchedAt: now }
}

/** Records a failed tag fetch WITHOUT touching whatever tags were already known. A failure is
 *  evidence about the fetch, never about the model. */
export function markTagsError(model: CatalogModel, error: string, now: number): CatalogModel {
  return { ...model, tagsState: 'error', tagsError: error, tagsFetchedAt: now }
}

/** Applies exact manifest facts to one tag. */
export function applyManifestFacts(
  model: CatalogModel,
  tag: string,
  facts: { sizeBytes: number; revision: string; modelDigest: string | null },
  now: number
): CatalogModel {
  return {
    ...model,
    tags: model.tags.map((t) =>
      t.tag === tag
        ? {
            ...t,
            sizeBytes: facts.sizeBytes,
            sizeExact: true,
            revision: facts.revision,
            revisionExact: true,
            facts: 'resolved' as CatalogFetchState,
            factsError: null,
            fetchedAt: now
          }
        : t
    )
  }
}

export function markFactsError(model: CatalogModel, tag: string, error: string, now: number): CatalogModel {
  return {
    ...model,
    tags: model.tags.map((t) =>
      t.tag === tag ? { ...t, facts: 'error' as CatalogFetchState, factsError: error, fetchedAt: now } : t
    )
  }
}

export interface InstalledRef {
  /** Exactly as /api/tags reports it, e.g. "llama3.2:latest". */
  name: string
  sizeBytes: number
  modifiedAt: string
  digest: string
}

/** Splits "name:tag" the way Ollama's own reference grammar does. A bare name means ":latest" —
 *  that is Ollama's rule, not a guess. A namespaced name ("user/model:tag") keeps its slash, and
 *  only the LAST colon separates the tag, so a digest-shaped reference cannot corrupt the name. */
export function splitRef(ref: string): { name: string; tag: string } {
  const at = ref.lastIndexOf(':')
  const slash = ref.lastIndexOf('/')
  if (at > 0 && at > slash) return { name: ref.slice(0, at), tag: ref.slice(at + 1) }
  return { name: ref, tag: 'latest' }
}

/** Folds the locally installed models (real, exact, from Ollama's own /api/tags) into the catalog:
 *  marks matching tags installed with their exact on-disk size and real modified timestamp, and
 *  adds a 'local' model/tag for anything the registry index does not publish. This is the ONLY
 *  source in the whole catalog that can supply a real timestamp. */
export function applyInstalled(models: CatalogModel[], installed: InstalledRef[], now: number): CatalogModel[] {
  const byName = new Map(models.map((m) => [m.name, { ...m, tags: m.tags.map((t) => ({ ...t, installed: false })) }]))
  for (const entry of installed) {
    const { name, tag } = splitRef(entry.name)
    let model = byName.get(name)
    if (!model) {
      model = emptyModel(name, 'local')
      byName.set(name, model)
    }
    const existing = model.tags.find((t) => t.tag === tag)
    const merged: CatalogTag = {
      tag,
      sizeBytes: entry.sizeBytes,
      sizeExact: true,
      revision: existing?.revisionExact ? existing.revision : (entry.digest ?? existing?.revision ?? null),
      revisionExact: existing?.revisionExact ?? false,
      publishedAt: entry.modifiedAt,
      installed: true,
      facts: existing?.facts ?? 'unresolved',
      factsError: existing?.factsError ?? null,
      fetchedAt: now
    }
    model.tags = existing ? model.tags.map((t) => (t.tag === tag ? merged : t)) : [...model.tags, merged]
  }
  return [...byName.values()]
}

// ---------------------------------------------------------------------------------------------
// Completeness + staleness
// ---------------------------------------------------------------------------------------------

/** The one sentence 'complete' is allowed to lean on for what it covers. Ollama's own first-party
 *  library (ollama.com/library) is the only enumerable source this catalog has: there is no
 *  equivalent index for community models published under a namespace (e.g. "user/model").
 *  ollama.com/search — the only other surface that could plausibly serve as one — caps results at
 *  about 20 per query and its `page` query parameter 303-redirects back to page 1 instead of paging
 *  (measured live 2026-08-18: `curl 'https://ollama.com/search?q=llama'` and `?q=llama&page=2` both
 *  return exactly 20 model links, and the `page=2` request itself redirects to the page-less URL).
 *  So 'complete' below can only ever be a claim about the library — never "every model Ollama can
 *  pull" — and a community model is always reached by typing its exact reference, never by browsing
 *  this catalog to the end. */
const COMMUNITY_SCOPE_NOTE =
  'This catalog covers Ollama\'s own library (ollama.com/library) only. Community models — published under a namespace, e.g. "user/model" — have no enumerable index: Ollama\'s own search caps results at about 20 per query and does not support paging past that. Any community model can still be reached by typing its exact reference.'

/** Turns raw counts into the one thing the panel is allowed to claim. 'complete' requires a
 *  successful index AND a resolved tag list for every model in it: anything less is 'partial' with
 *  the exact reason, and no index at all is 'unavailable'. Note that 'complete' is a claim about
 *  COVERAGE of Ollama's first-party library (every model in it, every tag), never about precision —
 *  the size caveat is a reason, not a downgrade, because a rounded size does not make the list
 *  incomplete — and never about community models, which this source cannot enumerate at all (see
 *  COMMUNITY_SCOPE_NOTE, always included below so "complete" never reads as "everything Ollama can
 *  pull"). */
export function deriveCompleteness(models: CatalogModel[], index: CatalogIndexState): CatalogCompleteness {
  let modelsWithTags = 0
  let modelsWithTagErrors = 0
  let modelsPendingTags = 0
  let tagsKnown = 0
  let tagsWithSize = 0
  let tagsWithExactFacts = 0
  for (const m of models) {
    if (m.tagsState === 'resolved') modelsWithTags++
    else if (m.tagsState === 'error') modelsWithTagErrors++
    else modelsPendingTags++
    for (const t of m.tags) {
      tagsKnown++
      if (t.sizeBytes !== null) tagsWithSize++
      if (t.sizeExact) tagsWithExactFacts++
    }
  }
  const reasons: string[] = []
  let state: CatalogCompleteness['state']
  if (index.state !== 'resolved' && models.length === 0) {
    state = 'unavailable'
    reasons.push(
      index.state === 'error'
        ? `The published model index could not be fetched (${index.error ?? 'unknown error'}). This is not evidence that there are no models — it means we could not look.`
        : 'The published model index has not been fetched yet.'
    )
  } else if (index.state === 'resolved' && modelsPendingTags === 0 && modelsWithTagErrors === 0) {
    state = 'complete'
    reasons.push(
      `Every model in Ollama's published library index (${index.count ?? models.length}) has had its full tag list fetched: ${tagsKnown} tags in total.`
    )
    // 'complete' must never be read as "every model Ollama can pull" — see COMMUNITY_SCOPE_NOTE.
    reasons.push(COMMUNITY_SCOPE_NOTE)
  } else {
    state = 'partial'
    if (index.state === 'error') {
      reasons.push(
        `The model index refresh failed (${index.error ?? 'unknown error'}); the list below is the last one that was fetched successfully.`
      )
    } else if (index.state === 'never') {
      reasons.push('The published model index has not been fetched yet — only locally installed models are listed.')
    }
    if (modelsPendingTags > 0) {
      reasons.push(
        `${modelsPendingTags} of ${models.length} models have not had their tag list fetched yet, so their published tags are not listed.`
      )
    }
    if (modelsWithTagErrors > 0) {
      reasons.push(`${modelsWithTagErrors} models' tag lists failed to fetch and will be retried.`)
    }
  }
  if (tagsKnown > 0 && tagsWithSize < tagsKnown) {
    reasons.push(`${tagsKnown - tagsWithSize} listed tags have no size yet — unknown, not zero.`)
  }
  if (tagsWithSize > tagsWithExactFacts) {
    reasons.push(
      `${tagsWithSize - tagsWithExactFacts} sizes are the rounded figures the library page prints (shown with "≈"); exact byte counts come from the registry manifest and are fetched a few at a time.`
    )
  }
  return {
    state,
    modelsKnown: models.length,
    modelsWithTags,
    modelsWithTagErrors,
    modelsPendingTags,
    tagsKnown,
    tagsWithSize,
    tagsWithExactFacts,
    reasons
  }
}

/** 'never' when nothing has ever been fetched — deliberately distinct from 'stale', because "we
 *  have never looked" and "what we have is old" lead to different sentences in the UI. */
export function catalogStaleness(fetchedAt: number | null, now: number, ttlMs: number = CATALOG_TTL_MS): CatalogStaleness {
  if (fetchedAt === null) return 'never'
  return now - fetchedAt >= ttlMs ? 'stale' : 'fresh'
}

// ---------------------------------------------------------------------------------------------
// Fetch planning
// ---------------------------------------------------------------------------------------------

/** Which models still owe a tag-list fetch, in priority order, capped at `budget`.
 *
 *  Priority: models with something installed first (the user demonstrably cares about those), then
 *  never-fetched models, then the ones whose tag list is stale. A model whose last attempt failed
 *  inside the backoff window is skipped entirely so one broken name cannot eat the whole budget on
 *  every pass. */
export function planTagFetches(
  models: CatalogModel[],
  now: number,
  budget: number,
  ttlMs: number = CATALOG_TTL_MS,
  backoffMs: number = CATALOG_ERROR_BACKOFF_MS
): string[] {
  const candidates: { name: string; rank: number; age: number }[] = []
  for (const m of models) {
    if (m.tagsState === 'error' && m.tagsFetchedAt !== null && now - m.tagsFetchedAt < backoffMs) continue
    const stale = m.tagsState === 'resolved' && m.tagsFetchedAt !== null && now - m.tagsFetchedAt >= ttlMs
    if (m.tagsState === 'resolved' && !stale) continue
    const installed = m.tags.some((t) => t.installed)
    candidates.push({
      name: m.name,
      rank: installed ? 0 : m.tagsState === 'unresolved' ? 1 : 2,
      age: m.tagsFetchedAt ?? 0
    })
  }
  candidates.sort((a, b) => a.rank - b.rank || a.age - b.age || a.name.localeCompare(b.name))
  return candidates.slice(0, Math.max(0, budget)).map((c) => c.name)
}

export interface FactTarget {
  name: string
  tag: string
}

/** Which tags still owe an exact-manifest fetch, capped at `budget`. Installed references first
 *  (their fit verdict is the one the user is looking at), then tags with no size at all, then tags
 *  whose size is only the page's rounded figure. Errors respect the same backoff. */
export function planFactFetches(
  models: CatalogModel[],
  now: number,
  budget: number,
  backoffMs: number = CATALOG_ERROR_BACKOFF_MS
): FactTarget[] {
  const candidates: { target: FactTarget; rank: number }[] = []
  for (const m of models) {
    if (m.origin === 'local') continue // not published in the registry; there is no manifest to ask for
    for (const t of m.tags) {
      if (t.facts === 'resolved') continue
      if (t.facts === 'error' && t.fetchedAt !== null && now - t.fetchedAt < backoffMs) continue
      candidates.push({
        target: { name: m.name, tag: t.tag },
        rank: t.installed ? 0 : t.sizeBytes === null ? 1 : 2
      })
    }
  }
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.target.name.localeCompare(b.target.name) ||
      a.target.tag.localeCompare(b.target.tag)
  )
  return candidates.slice(0, Math.max(0, budget)).map((c) => c.target)
}

/** Total outstanding work, for the honest "still fetching …" line in the panel. Unlike the planners
 *  this ignores budgets and backoff — it answers "how much is still missing", not "what will we do
 *  next". */
export function pendingWork(models: CatalogModel[]): { tags: number; facts: number } {
  let tags = 0
  let facts = 0
  for (const m of models) {
    if (m.tagsState !== 'resolved') tags++
    if (m.origin === 'local') continue
    for (const t of m.tags) if (t.facts !== 'resolved') facts++
  }
  return { tags, facts }
}
