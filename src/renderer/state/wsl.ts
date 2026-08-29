import { create } from 'zustand'
import { resolveWslApi, type WslCatalogueEntry, type WslInstanceSummary } from '../wsl/wslCoreApi'
import type { WslCatalogueError } from '@shared/wsl'
import type { WslExternalFactError, WslCopyKey } from '../wsl/wslCopy'

function isWslCatalogueError(value: unknown): value is WslCatalogueError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WslCatalogueError>
  return (candidate.code === 'not-installed' || candidate.code === 'command-failed' || candidate.code === 'parse-failed') &&
    (candidate.messageId === 'catalogueNotInstalled' || candidate.messageId === 'catalogueCommandFailed' || candidate.messageId === 'catalogueParseFailed') &&
    Array.isArray(candidate.facts)
}

function wslCatalogueErrorPayload(value: unknown): unknown {
  if (value instanceof Error && 'details' in value) return (value as Error & { details?: unknown }).details
  return value
}

function catalogueTemplateFor(error: WslCatalogueError['messageId']): WslCopyKey {
  if (error === 'catalogueNotInstalled') return 'catalogueNotInstalled'
  if (error === 'catalogueCommandFailed') return 'catalogueCommandFailed'
  return 'catalogueParseFailed'
}

/**
 * The live WSL facts a canvas frame's chip and the create dialog need: which distributions
 * actually exist on THIS machine right now, their running/stopped state, their memory, and —
 * critically — whether THIS app's own durable record says it created each one. `instances` is
 * always a fresh read from `resolveWslApi().list()`; nothing here is ever derived from a
 * persisted/shared canvas binding, which is the whole point (see `@shared/wsl-binding`).
 */
interface WslState {
  instances: Record<string, WslInstanceSummary>
  loading: boolean
  error: string | null
  loaded: boolean
  catalogue: WslCatalogueEntry[]
  catalogueLoading: boolean
  catalogueError: WslExternalFactError | null
  refresh: () => Promise<void>
  loadCatalogue: () => Promise<void>
  /** Every currently enumerated distro name — the exact set `revalidateWslBinding` and
   *  `canManageWslDistro` must be checked against before a binding is trusted for anything. */
  enumeratedNames: () => ReadonlySet<string>
  ownedByApp: (name: string) => boolean
}

export const useWsl = create<WslState>((set, get) => ({
  instances: {},
  loading: false,
  error: null,
  loaded: false,
  catalogue: [],
  catalogueLoading: false,
  catalogueError: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const list = await resolveWslApi().list()
      const next: Record<string, WslInstanceSummary> = {}
      for (const item of list) next[item.name] = item
      set({ instances: next, loading: false, loaded: true })
    } catch (e) {
      set({
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  },

  loadCatalogue: async () => {
    set({ catalogueLoading: true, catalogueError: null })
    try {
      const catalogue = await resolveWslApi().catalogue()
      set({ catalogue, catalogueLoading: false })
    } catch (e) {
      const payload = wslCatalogueErrorPayload(e)
      const detail = isWslCatalogueError(payload) ? payload.detail ?? '' : e instanceof Error ? e.message : String(e)
      set({
        catalogueLoading: false,
        catalogueError: isWslCatalogueError(payload)
          ? {
              ownership: 'external-factual',
              text: detail,
              facts: payload.facts,
              authoredTemplate: catalogueTemplateFor(payload.messageId)
            }
          : {
              ownership: 'external-factual',
              text: detail,
              facts: [detail],
              authoredPrefix: 'catalogueErrorPrefix'
            }
      })
    }
  },

  enumeratedNames: () => new Set(Object.keys(get().instances)),

  // Fail closed: an instance never seen by `refresh()` yet reads as not-owned, never as owned.
  ownedByApp: (name: string) => get().instances[name]?.ownedByApp === true
}))
