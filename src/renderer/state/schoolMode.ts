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

let initStarted = false

export const useSchoolMode = create<SchoolModeState>((set) => ({
  enabled: false,
  name: DEFAULT_SCHOOL_MODE_NAME,
  hydrated: false,
  hasCredential: false,

  init: async () => {
    if (initStarted) return
    initStarted = true
    try {
      const [record, hasCredential] = await Promise.all([
        window.nodeTerminal.schoolMode.load(),
        window.nodeTerminal.schoolMode.hasCredential()
      ])
      set({ enabled: record.enabled, name: record.name, hasCredential, hydrated: true })
    } catch {
      // A shell that can't reach the school-mode IPC (a very old bridge, mid-connect) leaves the
      // default (off) in place rather than blocking boot.
      set({ hydrated: true })
    }
    window.nodeTerminal.schoolMode.onChanged((record) => {
      set({ enabled: record.enabled, name: record.name })
    })
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
