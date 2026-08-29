// Types for the exhaustive Ollama model catalog. Deliberately NOT in src/shared/ollama.ts: this
// pass does not own that file, so the renderer re-declares the shape it needs and validates the
// payload at its boundary (src/renderer/components/ollama/catalogView.ts). See
// docs/ollama-manager.md → "Where the catalog comes from" for the whole trade-off.
//
// Every "unknown" here is a real unknown. Nothing in this file may ever be defaulted to 0, to an
// empty list, or to a guessed timestamp: "we could not fetch it" and "there is none" are different
// facts and the UI must be able to tell the user which one it is.

/** Whether a piece of the catalog has actually been fetched. `unresolved` = never attempted or
 *  still pending; `error` = attempted and failed, which is NEVER the same as "empty". */
export type CatalogFetchState = 'unresolved' | 'resolved' | 'error'

export interface CatalogTag {
  /** The published tag, e.g. "3b-instruct-q4_K_M". Combined with the model name this is the exact
   *  reference `ollama pull` takes. */
  tag: string
  /** Total download size in bytes, or null when genuinely unknown. Never 0 as a stand-in. */
  sizeBytes: number | null
  /** false when the source rounded the number (the library page prints "1.3GB"), true when it is an
   *  exact byte count (a registry manifest, or the local /api/tags entry for an installed model).
   *  The UI shows "≈" for the rounded case rather than implying byte accuracy it does not have. */
  sizeExact: boolean
  /** The published revision: the full manifest digest once a manifest has been fetched, otherwise
   *  the 12-hex-character short digest the library page prints. Null = not known. */
  revision: string | null
  revisionExact: boolean
  /** ISO-8601, and only ever copied from a source that really reports one — that is currently only
   *  an installed model's /api/tags `modified_at`. Neither registry.ollama.ai's manifest API nor the
   *  library pages expose a machine-readable publish time, so this stays null for catalog-only tags
   *  instead of inventing one from the page's relative "1 year ago" text. */
  publishedAt: string | null
  /** True when this exact reference is installed on the Ollama host right now (/api/tags). */
  installed: boolean
  /** Manifest-level refinement state (exact size + full digest). Bounded per refresh pass, so most
   *  tags legitimately sit at 'unresolved' with a rounded size from the library page. */
  facts: CatalogFetchState
  factsError: string | null
  /** When this tag's newest fact was observed. Null = never observed. */
  fetchedAt: number | null
}

export interface CatalogModel {
  /** Model name without a tag, e.g. "llama3.2". Namespaced community models keep their
   *  "namespace/name" spelling. */
  name: string
  /** 'registry' = published in Ollama's library index. 'local' = only ever seen through the local
   *  /api/tags (a hand-built or third-party model). A local-origin model is never pruned by a
   *  successful index refresh — it exists, the library just does not publish it. */
  origin: 'registry' | 'local'
  tagsState: CatalogFetchState
  tagsError: string | null
  tagsFetchedAt: number | null
  /** Exhaustive for this model ONLY when tagsState === 'resolved'. */
  tags: CatalogTag[]
}

export interface CatalogIndexState {
  state: 'never' | 'resolved' | 'error'
  fetchedAt: number | null
  error: string | null
  /** How many model names the last SUCCESSFUL index fetch returned. Null when there has never been
   *  one — distinct from 0, which would mean the source really answered with nothing. */
  count: number | null
}

export interface CatalogCompleteness {
  /** 'unavailable' = we have no catalog at all and must say so. 'partial' = we have some of it and
   *  know it is not all of it. 'complete' = the index resolved and every model's tag list resolved,
   *  so this really is every model and every tag in Ollama's own first-party library
   *  (ollama.com/library) — scoped deliberately, because that library is the only enumerable
   *  source. Community models published under a namespace (e.g. "user/model") have no enumerable
   *  index (ollama.com/search caps at ~20 results per query with no working pagination — measured
   *  live, see catalog-pure.ts's COMMUNITY_SCOPE_NOTE), so 'complete' never claims them; a
   *  community model is always reachable by exact reference instead. */
  state: 'unavailable' | 'partial' | 'complete'
  modelsKnown: number
  modelsWithTags: number
  modelsWithTagErrors: number
  modelsPendingTags: number
  tagsKnown: number
  tagsWithSize: number
  tagsWithExactFacts: number
  /** Plain sentences naming exactly what is missing and why. Rendered verbatim by the panel so the
   *  user is never shown a bare list that silently implies completeness. */
  reasons: string[]
}

export type CatalogStaleness = 'never' | 'fresh' | 'stale'

export interface CatalogRefreshState {
  state: 'idle' | 'running'
  startedAt: number | null
  finishedAt: number | null
  lastError: string | null
  /** Work the next passes still owe: models whose tag list has never been fetched, and tags whose
   *  exact manifest facts have never been fetched. */
  pendingTagFetches: number
  pendingFactFetches: number
}

export interface CatalogSnapshot {
  /** Discriminator so the renderer can tell this payload apart from the legacy
   *  `{name, note}[]` array the popular-models channel used to return. */
  kind: 'ollama-catalog'
  version: 1
  models: CatalogModel[]
  index: CatalogIndexState
  installed: {
    state: 'never' | 'resolved' | 'error'
    error: string | null
    fetchedAt: number | null
  }
  registry: {
    enabled: boolean
    /** Why registry lookups are off, when they are. Never null while `enabled` is false. */
    disabledReason: string | null
    indexUrl: string
    manifestHost: string
  }
  refresh: CatalogRefreshState
  cache: {
    state: 'empty' | 'loaded' | 'unreadable'
    /** Set when the on-disk cache existed but could not be read/parsed. The file is quarantined
     *  rather than overwritten, and this is surfaced instead of pretending the cache was empty. */
    error: string | null
  }
  completeness: CatalogCompleteness
  staleness: CatalogStaleness
  ttlMs: number
  computedAt: number
}
