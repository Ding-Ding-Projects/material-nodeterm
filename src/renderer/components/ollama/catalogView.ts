// Pure view layer for the Model store's exhaustive catalog: validate whatever the session returned,
// flatten it into rows, then filter / sort / paginate. No React, no DOM — catalogView.test.ts drives
// all of it directly.
//
// Why a validator instead of a shared type: `OllamaApi.popularModels()` is declared in
// src/shared/ollama.ts as `Promise<{name, note}[]>`, and this pass does not own that file. The core
// now answers with a catalog snapshot object over the same channel, so the renderer treats the
// payload as untrusted input and parses it — which is also what the house rule about re-validating
// hand-editable/boundary values asks for. An older core (or a bridge stub) that still returns the
// legacy array keeps working, and is reported as such: a legacy list is NOT a complete catalog and
// must never be presented as one.

export type CatalogFetchState = 'unresolved' | 'resolved' | 'error'

export interface CatalogRow {
  /** Exactly what `ollama pull` takes: "name:tag", or a bare "name" when the tag list has not been
   *  fetched yet (a bare name is Ollama's own spelling of ":latest"). */
  ref: string
  name: string
  /** null while the model's published tag list is still unknown — never guessed as "latest". */
  tag: string | null
  sizeBytes: number | null
  /** false = the number is the library page's rounded figure; the UI prefixes it with "≈". */
  sizeExact: boolean
  revision: string | null
  revisionExact: boolean
  publishedAt: string | null
  installed: boolean
  /** State of THIS model's tag list, so a row can say "tags not fetched yet" rather than implying
   *  this single row is the model's whole published set. */
  tagsState: CatalogFetchState
  tagsError: string | null
  factsError: string | null
}

export interface CatalogViewCompleteness {
  state: 'unavailable' | 'partial' | 'complete' | 'unknown'
  modelsKnown: number
  tagsKnown: number
  reasons: string[]
}

export interface CatalogView {
  /** 'snapshot' = a real catalog with completeness state. 'legacy' = the old `{name, note}[]`
   *  payload, which carries no completeness information at all. 'invalid' = something else. */
  source: 'snapshot' | 'legacy' | 'invalid'
  rows: CatalogRow[]
  completeness: CatalogViewCompleteness
  refreshing: boolean
  refreshError: string | null
  pendingTagFetches: number
  pendingFactFetches: number
  staleness: 'never' | 'fresh' | 'stale' | 'unknown'
  indexFetchedAt: number | null
  registryEnabled: boolean
  registryDisabledReason: string | null
}

const EMPTY_COMPLETENESS: CatalogViewCompleteness = {
  state: 'unknown',
  modelsKnown: 0,
  tagsKnown: 0,
  reasons: []
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function fetchState(value: unknown): CatalogFetchState {
  return value === 'resolved' || value === 'error' ? value : 'unresolved'
}

/** Parses the catalog payload. Never throws: a shape we do not recognise becomes an explicitly
 *  'invalid' view with a reason, because "the session sent something we cannot read" is a different
 *  fact from "there are no models" and the panel prints them differently. */
export function parseCatalogPayload(raw: unknown): CatalogView {
  if (Array.isArray(raw)) {
    const rows: CatalogRow[] = []
    for (const item of raw) {
      const name = str((item as { name?: unknown })?.name)
      if (!name) continue
      rows.push({
        ref: name,
        name,
        tag: null,
        sizeBytes: null,
        sizeExact: false,
        revision: null,
        revisionExact: false,
        publishedAt: null,
        installed: false,
        tagsState: 'unresolved',
        tagsError: null,
        factsError: null
      })
    }
    return {
      source: 'legacy',
      rows,
      completeness: {
        state: 'unknown',
        modelsKnown: rows.length,
        tagsKnown: 0,
        reasons: [
          'This session answered with the older short model list, which carries no catalog state. It is not known whether it is complete — treat it as a starting point and use the exact-reference field for anything missing.'
        ]
      },
      refreshing: false,
      refreshError: null,
      pendingTagFetches: 0,
      pendingFactFetches: 0,
      staleness: 'unknown',
      indexFetchedAt: null,
      registryEnabled: false,
      registryDisabledReason: null
    }
  }

  const snap = raw as Record<string, unknown> | null
  if (!snap || typeof snap !== 'object' || snap.kind !== 'ollama-catalog' || !Array.isArray(snap.models)) {
    return {
      source: 'invalid',
      rows: [],
      completeness: {
        ...EMPTY_COMPLETENESS,
        reasons: ['The catalog could not be read from this session — this is a load failure, not an empty catalog.']
      },
      refreshing: false,
      refreshError: null,
      pendingTagFetches: 0,
      pendingFactFetches: 0,
      staleness: 'unknown',
      indexFetchedAt: null,
      registryEnabled: false,
      registryDisabledReason: null
    }
  }

  const rows: CatalogRow[] = []
  for (const rawModel of snap.models as unknown[]) {
    const model = rawModel as Record<string, unknown>
    const name = str(model?.name)
    if (!name) continue
    const tagsState = fetchState(model.tagsState)
    const tagsError = str(model.tagsError)
    const tags = Array.isArray(model.tags) ? (model.tags as Record<string, unknown>[]) : []
    if (tags.length === 0) {
      // Still list the model. Its tags are not known yet, and saying so beside the name is the
      // honest form — dropping it would quietly shrink "every published model".
      rows.push({
        ref: name,
        name,
        tag: null,
        sizeBytes: null,
        sizeExact: false,
        revision: null,
        revisionExact: false,
        publishedAt: null,
        installed: false,
        tagsState,
        tagsError,
        factsError: null
      })
      continue
    }
    for (const tag of tags) {
      const tagName = str(tag?.tag)
      if (!tagName) continue
      rows.push({
        ref: `${name}:${tagName}`,
        name,
        tag: tagName,
        sizeBytes: num(tag.sizeBytes),
        sizeExact: tag.sizeExact === true,
        revision: str(tag.revision),
        revisionExact: tag.revisionExact === true,
        publishedAt: str(tag.publishedAt),
        installed: tag.installed === true,
        tagsState,
        tagsError,
        factsError: str(tag.factsError)
      })
    }
  }

  const completenessRaw = (snap.completeness ?? {}) as Record<string, unknown>
  const state = completenessRaw.state
  const refresh = (snap.refresh ?? {}) as Record<string, unknown>
  const index = (snap.index ?? {}) as Record<string, unknown>
  const registry = (snap.registry ?? {}) as Record<string, unknown>
  const staleness = snap.staleness
  return {
    source: 'snapshot',
    rows,
    completeness: {
      state:
        state === 'complete' || state === 'partial' || state === 'unavailable' ? state : 'unknown',
      modelsKnown: num(completenessRaw.modelsKnown) ?? 0,
      tagsKnown: num(completenessRaw.tagsKnown) ?? 0,
      reasons: Array.isArray(completenessRaw.reasons)
        ? (completenessRaw.reasons as unknown[]).filter((r): r is string => typeof r === 'string')
        : []
    },
    refreshing: refresh.state === 'running',
    refreshError: str(refresh.lastError),
    pendingTagFetches: num(refresh.pendingTagFetches) ?? 0,
    pendingFactFetches: num(refresh.pendingFactFetches) ?? 0,
    staleness:
      staleness === 'never' || staleness === 'fresh' || staleness === 'stale' ? staleness : 'unknown',
    indexFetchedAt: num(index.fetchedAt),
    registryEnabled: registry.enabled === true,
    registryDisabledReason: str(registry.disabledReason)
  }
}

// ---------------------------------------------------------------------------------------------
// Filter / sort / paginate
// ---------------------------------------------------------------------------------------------

export type CatalogFilter = 'all' | 'installed' | 'not-installed' | 'with-size'
export type CatalogSort = 'name' | 'size-desc' | 'size-asc' | 'installed-first'

export interface CatalogPageRequest {
  query: string
  filter: CatalogFilter
  sort: CatalogSort
  /** 1-based. Clamped, so a filter change that shortens the list cannot strand the user on an
   *  empty page that looks like "no results". */
  page: number
  pageSize: number
}

export interface CatalogPage {
  rows: CatalogRow[]
  total: number
  page: number
  pageCount: number
  /** 1-based inclusive positions of the rows on this page, for "showing 51–100 of 9,412". */
  from: number
  to: number
}

function matches(row: CatalogRow, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return row.ref.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)
}

function keep(row: CatalogRow, filter: CatalogFilter): boolean {
  switch (filter) {
    case 'installed':
      return row.installed
    case 'not-installed':
      return !row.installed
    case 'with-size':
      return row.sizeBytes !== null
    default:
      return true
  }
}

/** Sorts nulls LAST in both size directions on purpose: an unknown size is not a small size, and
 *  putting unknowns at the top of "smallest first" would read as a recommendation. */
function bySize(direction: 1 | -1) {
  return (a: CatalogRow, b: CatalogRow): number => {
    if (a.sizeBytes === null && b.sizeBytes === null) return a.ref.localeCompare(b.ref)
    if (a.sizeBytes === null) return 1
    if (b.sizeBytes === null) return -1
    return direction * (a.sizeBytes - b.sizeBytes) || a.ref.localeCompare(b.ref)
  }
}

export function selectCatalogPage(rows: CatalogRow[], request: CatalogPageRequest): CatalogPage {
  const query = request.query.trim()
  const filtered = rows.filter((row) => keep(row, request.filter) && matches(row, query))
  const sorted = filtered.slice()
  switch (request.sort) {
    case 'size-desc':
      sorted.sort(bySize(-1))
      break
    case 'size-asc':
      sorted.sort(bySize(1))
      break
    case 'installed-first':
      sorted.sort((a, b) => Number(b.installed) - Number(a.installed) || a.ref.localeCompare(b.ref))
      break
    default:
      sorted.sort((a, b) => a.ref.localeCompare(b.ref))
  }
  const pageSize = Math.max(1, Math.floor(request.pageSize))
  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Math.floor(request.page) || 1), pageCount)
  const start = (page - 1) * pageSize
  const pageRows = sorted.slice(start, start + pageSize)
  return {
    rows: pageRows,
    total,
    page,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + pageRows.length
  }
}

// ---------------------------------------------------------------------------------------------
// Honest sentences
// ---------------------------------------------------------------------------------------------

/** The one line the store puts above the list. It must never imply completeness the view does not
 *  have — that claim is exactly what this whole feature exists to make truthful. */
export function completenessHeadline(view: CatalogView): string {
  switch (view.completeness.state) {
    case 'complete':
      // Deliberately scoped: this is a claim about Ollama's own first-party library only, never
      // about "every model Ollama can pull" — community models (namespaced, e.g. "user/model")
      // have no enumerable index at all (see catalog-pure.ts's COMMUNITY_SCOPE_NOTE and
      // docs/ollama-manager.md for the live measurement). Saying "every published model" here was
      // the false claim this headline used to make.
      return `Complete first-party library: all ${view.completeness.modelsKnown} models and all ${view.completeness.tagsKnown} tags on ollama.com/library. Community models aren't enumerable — add one by exact reference.`
    case 'partial':
      return `Partial catalog: ${view.completeness.tagsKnown} tags across ${view.completeness.modelsKnown} models fetched so far — this is not yet the whole catalog.`
    case 'unavailable':
      return 'The published catalog could not be loaded. This is a load failure, not an empty catalog — the exact-reference field below still reaches any model.'
    default:
      return view.source === 'legacy'
        ? 'Short model list from this session — completeness unknown.'
        : 'Catalog state is unknown for this session.'
  }
}

export function stalenessSentence(view: CatalogView, now: number): string | null {
  switch (view.staleness) {
    case 'never':
      return view.registryEnabled ? 'The catalog has never been fetched on this machine.' : null
    case 'stale':
      return view.indexFetchedAt === null
        ? 'The cached catalog is out of date and is being refreshed.'
        : `The cached catalog is out of date (last fetched ${formatAge(now - view.indexFetchedAt)} ago) and is being refreshed.`
    case 'fresh':
      return view.indexFetchedAt === null ? null : `Catalog fetched ${formatAge(now - view.indexFetchedAt)} ago.`
    default:
      return null
  }
}

// ---------------------------------------------------------------------------------------------
// Progress-poll scheduling
// ---------------------------------------------------------------------------------------------
//
// The catalog rides an argument-less channel with no push event (see
// core/ollama/register-ipc.ts), so the panel polls it while a refresh is in flight. The bug this
// pair of pure functions exists to prevent: re-arming the NEXT poll only on a SUCCESSFUL load
// (i.e. keying a `useEffect` on the freshly replaced `catalog` object) means one transient
// rejection — a dropped connection, a session hiccup — leaves `catalogError` set, `catalog`
// untouched, and the loop permanently dead: the panel is stuck on a stale "Still fetching…"
// counter until the user manually reloads. A failed load attempt is evidence about THAT attempt,
// never about whether the underlying refresh is still running — so it must not stop the loop.

/** Whether the panel's progress poll should schedule another attempt after this one. `null` means
 *  the load attempt itself failed (network/session error) — that is never reason to stop, only a
 *  successfully parsed view that reports the refresh has gone idle (or the effect's own unmount)
 *  may end the loop. */
export function catalogPollShouldContinue(view: CatalogView | null): boolean {
  return view === null || view.refreshing
}

/** Delay before the next poll, in ms, given how many consecutive load attempts have failed.
 *  `failures = 0` (the common case: this attempt succeeded, or it is the very first attempt) uses
 *  the plain base interval. Repeated failures back off exponentially, capped at 8x the base
 *  interval, so a sustained outage (Ollama's host unreachable, the session itself down) does not
 *  hammer the channel at the crawl's normal cadence forever. */
export function catalogPollDelayMs(failures: number, baseMs: number): number {
  const capped = Math.min(Math.max(0, Math.floor(failures)), 3)
  return baseMs * 2 ** capped
}

function formatAge(ms: number): string {
  if (ms < 60_000) return 'less than a minute'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.floor(hours / 24)} days`
}
