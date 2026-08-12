import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import {
  applyResolvedCodexAccounts,
  discoverResolvedCodexAccounts
} from './codexAccountReconcile'

interface SettingsState {
  settings: Settings
  /** True once settings have been loaded from disk (so first-run logic can wait). */
  hydrated: boolean
  hydrate(): Promise<void>
  update(patch: Partial<Settings>): void
}

// Coalesce disk writes: the settings inputs fire update() per keystroke/step-click, and each
// save is a full temp-file write + rename in main. The in-memory store stays synchronous (UI
// and xterm/Monaco react immediately); only the persistence trails, at most one write per
// window, always with the latest snapshot.
const SAVE_COALESCE_MS = 300
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Settings | null = null
function scheduleSave(next: Settings): void {
  pendingSave = next
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (pendingSave) void window.nodeTerminal.settings.save(pendingSave)
    pendingSave = null
  }, SAVE_COALESCE_MS)
}
// Reload/quit inside the coalesce window must not lose the last edit. (Guarded: this module
// is transitively imported by node-environment unit tests, where `window` doesn't exist.)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingSave) void window.nodeTerminal.settings.save(pendingSave)
    pendingSave = null
  })
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  async hydrate() {
    const s = await window.nodeTerminal.settings.load()
    const settings = { ...DEFAULT_SETTINGS, ...s }
    set({ settings, hydrated: true })
    // Pending is renderer persistence, while auth.json/app-server identity is authoritative.
    // Reconcile at application startup so a completed login becomes selectable without requiring
    // the user to discover and reopen Settings after every restart.
    void discoverResolvedCodexAccounts(
      settings.codexAccounts,
      (id) => window.nodeTerminal.codexAccounts.identity(id)
    ).then((resolved) => {
      if (resolved.length === 0) return
      const current = get().settings
      const codexAccounts = applyResolvedCodexAccounts(current.codexAccounts, resolved)
      get().update({ codexAccounts })
    })
  },

  update(patch) {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    scheduleSave(next)
  }
}))
