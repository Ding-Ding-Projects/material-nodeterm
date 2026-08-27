import { create } from 'zustand'
import { validateVocabularyPayload, type PersonalVocabularyEntries } from '../lib/personalVocabulary/schema'

/**
 * The personal-vocabulary cache. Local-only, renderer-side, no IPC and no network request: the
 * uploaded file is read entirely in the browser (Electron renderer OR the Server Edition tab —
 * identical either way, since `FileReader`/`<input type=file>` are web platform APIs) and the
 * validated result is cached in `localStorage`, scoped to this browser profile.
 *
 * Deliberately NOT wired to `window.nodeTerminal` or `settings.json`: the data must exist only
 * after the user explicitly supplies a valid file, must never enter a synced/exported settings
 * blob, and must purge completely on Clear. Keeping it out of the main-process settings store is
 * what makes "never appears in an export/history snapshot of app settings" true by construction
 * rather than by a filter someone has to remember to apply.
 */
const CACHE_KEY = 'nodeterm.personalVocabulary.v1'
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

interface CachedPayload {
  version: 1
  entries: PersonalVocabularyEntries
  entryCount: number
  savedAt: number
}

function readCache(): CachedPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    // localStorage is hand-editable input too. Reusing the upload validator keeps a forged
    // `__proto__` entry, duplicate key, oversized cache, or stale schema from bypassing the exact
    // contract merely because it arrived on restart rather than through the file picker.
    const validated = validateVocabularyPayload(raw)
    if (!validated.ok) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!Object.hasOwn(parsed, 'savedAt') || typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)) {
      return null
    }
    if (parsed.savedAt <= 0 || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS || parsed.savedAt > Date.now() + 60_000) {
      return null
    }
    return {
      version: 1,
      entries: validated.entries,
      entryCount: validated.entryCount,
      savedAt: parsed.savedAt
    }
  } catch {
    return null
  }
}

function writeCache(payload: CachedPayload | null): void {
  try {
    if (payload) localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // A full/blocked localStorage must not crash the upload flow — the in-memory state (this
    // session) still applies; only the "survive a restart" half degrades.
  }
}

export type PersonalVocabularyStatus = 'no-file' | 'reading' | 'loaded' | 'invalid'

interface PersonalVocabularyState {
  status: PersonalVocabularyStatus
  entries: PersonalVocabularyEntries
  entryCount: number
  loadedAt: number | null
  /** Set only right after a REJECTED upload, cleared on the next successful one/clear. Never
   *  persisted — it exists purely to render the "why was this rejected" message once. */
  lastError: string | null
  beginRead(): void
  reject(error: string): void
  hydrate(): void
  /** Validate `raw` (the uploaded file's full text) and, if valid, replace the cache atomically —
   *  a rejected file never applies partially. Returns the same verdict for the caller's own UI. */
  upload(raw: string): { ok: true; entryCount: number } | { ok: false; error: string }
  /** Purge the cache and restore original shipped wording immediately. */
  clear(): void
}

export const usePersonalVocabulary = create<PersonalVocabularyState>((set) => ({
  status: 'no-file',
  entries: {},
  entryCount: 0,
  loadedAt: null,
  lastError: null,
  beginRead: () => set({ status: 'reading', lastError: null }),
  reject: (error) => set({ status: 'invalid', lastError: error }),

  hydrate: () => {
    const cached = readCache()
    if (cached) {
      set({ status: 'loaded', entries: cached.entries, entryCount: cached.entryCount, loadedAt: cached.savedAt })
    } else {
      try {
        localStorage.removeItem(CACHE_KEY)
      } catch {
        // A blocked storage area remains fail-closed in memory.
      }
    }
  },

  upload: (raw) => {
    const result = validateVocabularyPayload(raw)
    if (!result.ok) {
      set({ status: 'invalid', lastError: result.error })
      return result
    }
    const savedAt = Date.now()
    writeCache({ version: 1, entries: result.entries, entryCount: result.entryCount, savedAt })
    set({ status: 'loaded', entries: result.entries, entryCount: result.entryCount, loadedAt: savedAt, lastError: null })
    return { ok: true, entryCount: result.entryCount }
  },

  clear: () => {
    writeCache(null)
    set({ status: 'no-file', entries: {}, entryCount: 0, loadedAt: null, lastError: null })
  }
}))
