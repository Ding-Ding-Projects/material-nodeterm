import { create } from 'zustand'
import { DEFAULT_SCHOOL_MODE_NAME } from '../lib/schoolModeName'

/**
 * Renderer-side mirror of the shared School-mode record (`window.nodeTerminal.schoolMode`,
 * backed by `core/school-mode.ts`). This store is the ONE place every surface should read
 * `enabled`/`name` from — never call `window.nodeTerminal.schoolMode.load()` directly from a
 * component, or that surface won't pick up a change made by another window/app live.
 *
 * Hydration + the live-update subscription are wired ONCE from `App.tsx`
 * (`useSchoolMode.getState().init()`), so every consumer just reads the store.
 */
interface SchoolModeState {
  enabled: boolean
  name: string
  hydrated: boolean
  hasCredential: boolean
  /** Hydrate once and subscribe to live changes (including edits from ANOTHER app/window
   *  watching the same shared file). Idempotent — a second call is a no-op. */
  init(): Promise<void>
  enable(pin?: string): Promise<{ ok: true } | { ok: false; error: string }>
  disable(pin: string): Promise<{ ok: true } | { ok: false; error: string }>
  rename(name: string): Promise<void>
  changePin(currentPin: string, nextPin: string): Promise<boolean>
  refreshHasCredential(): Promise<void>
}

/** A bridge can be temporarily unavailable while a Server Edition tab reconnects. Keep the
 * renderer fail-closed, then retry instead of permanently laundering that transient failure into
 * a confirmed OFF record. */
export const SCHOOL_MODE_HYDRATION_RETRY_MS = 1000

let initInFlight: Promise<void> | null = null
let unsubscribe: (() => void) | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let liveRevision = 0
let initialLoadComplete = false

export const useSchoolMode = create<SchoolModeState>((set, get) => ({
  enabled: false,
  name: DEFAULT_SCHOOL_MODE_NAME,
  hydrated: false,
  hasCredential: false,

  init: async () => {
    if (initInFlight) return initInFlight
    if (initialLoadComplete && unsubscribe) return

    const scheduleRetry = (): void => {
      if (retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        void get().init()
      }, SCHOOL_MODE_HYDRATION_RETRY_MS)
    }
    const clearRetry = (): void => {
      if (!retryTimer) return
      clearTimeout(retryTimer)
      retryTimer = null
    }

    const run = (async (): Promise<void> => {
      let subscriptionReady = unsubscribe !== null
      if (!subscriptionReady) {
        try {
          unsubscribe = window.nodeTerminal.schoolMode.onChanged((record) => {
            liveRevision += 1
            clearRetry()
            set({ enabled: record.enabled, name: record.name, hydrated: true })
          })
          subscriptionReady = true
        } catch {
          // Loading below may still give us a trustworthy snapshot. Retry the live subscription
          // separately so a mid-connect Server tab does not stay frozen on that snapshot forever.
        }
      }

      const revisionAtLoadStart = liveRevision
      try {
        const [record, hasCredential] = await Promise.all([
          window.nodeTerminal.schoolMode.load(),
          window.nodeTerminal.schoolMode.hasCredential()
        ])
        initialLoadComplete = true
        if (revisionAtLoadStart === liveRevision) {
          set({ enabled: record.enabled, name: record.name, hasCredential, hydrated: true })
        } else {
          // A live update that arrived while load() was in flight is newer than its snapshot.
          // Keep that record, but the credential result is independent and still useful.
          set({ hasCredential, hydrated: true })
        }
        if (subscriptionReady) clearRetry()
        else scheduleRetry()
      } catch {
        // Crucially, do NOT set `hydrated: true` here. The default `enabled: false` is not a fact,
        // and every covered capability stays omitted until a retry or live event proves the mode
        // is actually off. If an earlier real record exists, Zustand simply preserves it.
        scheduleRetry()
      }
    })()

    initInFlight = run.finally(() => {
      initInFlight = null
    })
    return initInFlight
  },

  enable: async (pin) => {
    try {
      const record = await window.nodeTerminal.schoolMode.enable(pin)
      set({ enabled: record.enabled, name: record.name, hasCredential: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'could not turn the mode on' }
    }
  },

  disable: async (pin) => {
    const result = await window.nodeTerminal.schoolMode.disable(pin)
    if (result.ok) {
      set({ enabled: result.record.enabled, name: result.record.name })
      return { ok: true }
    }
    return { ok: false, error: result.error }
  },

  rename: async (name) => {
    const record = await window.nodeTerminal.schoolMode.rename(name)
    set({ name: record.name })
  },

  changePin: async (currentPin, nextPin) => {
    const ok = await window.nodeTerminal.schoolMode.changePin(currentPin, nextPin)
    if (ok) set({ hasCredential: true })
    return ok
  },

  refreshHasCredential: async () => {
    const hasCredential = await window.nodeTerminal.schoolMode.hasCredential()
    set({ hasCredential })
  }
}))
