// Pure decision logic for the machine-local "which unpacked extensions load into which browser
// profile's Electron session" store. The disk read/write wrapper lives in
// `browser-extensions-store.ts`; the Electron `session.extensions.loadExtension` calls live in
// `browser-extensions.ts`. This file is Electron-free so it is unit-testable without spinning up
// the app.
//
// WHY MACHINE-LOCAL, NOT GIT-SHARED: an unpacked extension is a filesystem directory path on THIS
// machine (`~/dev/some-extension`, `C:\Users\me\Downloads\ext\`). It has no meaning on a
// teammate's machine, and injecting one from a cloned `.nodeterm/project.json` would be exactly
// the "cloned repository must never inject an executable path" hazard `Project.settingsOverrides`
// already exists to avoid (see CLAUDE.md). So this rides `browser-extensions.json` in the app's
// userData dir, keyed by the SAME partition string `browserPartitionFor` derives — never
// `Project.browserProfiles`, and never `.nodeterm/project.json`.

/** One persisted "load this unpacked extension into this partition" entry. Only the directory
 *  path is stored; the extension's id/name/version are read live from Electron at load time
 *  (they belong to the extension's own manifest, not to our store, and Electron reassigns the id
 *  per-install anyway). */
export interface BrowserExtensionEntry {
  /** Absolute path to the unpacked extension directory (contains manifest.json). */
  path: string
}

/** The persisted shape of <userData>/browser-extensions.json: partition string -> its extension
 *  directory paths. The DEFAULT (unpartitioned) session is keyed by the literal string
 *  `'default'` — never `undefined`, which JSON cannot express as an object key. */
export type BrowserExtensionsStore = Readonly<Record<string, readonly BrowserExtensionEntry[]>>

/** The key `'default'` is reserved for the app's default/unpartitioned session so a persisted
 *  store round-trips through JSON without an `undefined` key. `browserExtensionsKeyFor` is the
 *  ONE place that decision lives — never inline the literal elsewhere. */
export function browserExtensionsKeyFor(partition: string | undefined): string {
  return partition ?? 'default'
}

export function emptyBrowserExtensionsStore(): BrowserExtensionsStore {
  return {}
}

/** Coerce arbitrary parsed JSON into a well-formed store, dropping anything malformed rather than
 *  throwing — used for the in-memory merge path. `parsePersistedBrowserExtensions` below is the
 *  strict form used on a direct file read, per the same "corruption is not absence" rule the
 *  approved-devices store follows. */
export function parseBrowserExtensionsStore(raw: unknown): BrowserExtensionsStore {
  if (!raw || typeof raw !== 'object') return emptyBrowserExtensionsStore()
  const out: Record<string, BrowserExtensionEntry[]> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (!Array.isArray(value)) continue
    const entries: BrowserExtensionEntry[] = []
    const seen = new Set<string>()
    for (const item of value) {
      const p = (item as { path?: unknown } | null)?.path
      if (typeof p !== 'string' || p.length === 0 || seen.has(p)) continue
      seen.add(p)
      entries.push({ path: p })
    }
    if (entries.length > 0) out[key] = entries
  }
  return out
}

/** Strict decoder for a direct file read — throws on a shape that isn't a valid store, so a
 *  corrupt file is never silently treated as "no extensions configured" (which would then get
 *  overwritten on the next save, destroying the only evidence of the corruption). */
export function parsePersistedBrowserExtensions(raw: unknown): BrowserExtensionsStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Browser-extensions data is not a valid store.')
  }
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) throw new Error('Browser-extensions data has a malformed entry.')
    for (const item of value) {
      if (typeof (item as { path?: unknown } | null)?.path !== 'string') {
        throw new Error('Browser-extensions data has an entry with no path.')
      }
    }
  }
  return parseBrowserExtensionsStore(raw)
}

/** Return a store with `path` added under `key` (idempotent — a path already present for this
 *  key is left alone rather than duplicated). */
export function addBrowserExtension(
  store: BrowserExtensionsStore,
  key: string,
  path: string
): BrowserExtensionsStore {
  const existing = store[key] ?? []
  if (existing.some((e) => e.path === path)) return store
  return { ...store, [key]: [...existing, { path }] }
}

/** Return a store with `path` removed from `key`. Idempotent; drops the key entirely once its
 *  list is empty so the persisted file doesn't accumulate empty arrays forever. */
export function removeBrowserExtension(
  store: BrowserExtensionsStore,
  key: string,
  path: string
): BrowserExtensionsStore {
  const existing = store[key]
  if (!existing) return store
  const filtered = existing.filter((e) => e.path !== path)
  if (filtered.length === existing.length) return store
  const next = { ...store }
  if (filtered.length === 0) delete next[key]
  else next[key] = filtered
  return next
}

/** Every `[key, path]` pair in the store, for the app-boot reload pass — order preserved so a
 *  deterministic load order is testable. */
export function allBrowserExtensionEntries(
  store: BrowserExtensionsStore
): Array<{ key: string; path: string }> {
  const out: Array<{ key: string; path: string }> = []
  for (const [key, entries] of Object.entries(store)) {
    for (const e of entries) out.push({ key, path: e.path })
  }
  return out
}
