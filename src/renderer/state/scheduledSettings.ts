import { create } from 'zustand'
import {
  defaultScheduledSettingsFile,
  type ScheduledSettingsActiveState,
  type ScheduledSettingsFile,
  type ScheduledSettingsLoadError
} from '@shared/scheduled-settings'
import { ScheduledSettingsSaveQueue } from './scheduled-settings-save'

interface ScheduledSettingsState {
  file: ScheduledSettingsFile
  hydrated: boolean
  /** Present when the shell could not read scheduled-settings.json. `file` is then the safe empty
   * fallback, not proof that no rules existed; the Settings panel shows the preserved recovery
   * path and exposes no editing controls until restart after repair. */
  loadError: ScheduledSettingsLoadError | null
  /** The last save attempt's rejection reason (the bounded-schema validator in main), or `null`
   *  while nothing has failed. Shown inline in the Schedule section rather than thrown — a save
   *  failure here is a user-correctable mistake (too many rules, a malformed window), not a bug. */
  saveError: string | null
  /** The live resolved schedule (which rule is active, and every external source's status),
   *  pushed from main/server. `null` before the first read/push lands. Kept up to date by the
   *  Canvas.tsx apply-controller effect, which is the ONE subscriber to the underlying IPC event —
   *  see its comment for why. */
  active: ScheduledSettingsActiveState | null
  tokenStatus: Record<string, boolean>
  hydrate(): Promise<void>
  /** Replace the whole file and persist it (debounced, mirroring `useSettings.update`). */
  update(next: ScheduledSettingsFile): void
  setHomeAssistantToken(ruleId: string, token: string | null): Promise<void>
  /** The "Retry" action next to a failed external source. */
  refreshRule(ruleId: string): Promise<void>
}

const SAVE_COALESCE_MS = 500
const saveQueue = new ScheduledSettingsSaveQueue(
  (file) => window.nodeTerminal.scheduledSettings.save(file),
  SAVE_COALESCE_MS
)

// Reload/quit inside the coalesce window must not lose the last edit — same discipline as
// state/settings.ts. Guarded: this module is transitively importable from a node-environment test.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    saveQueue.flushPendingForUnload()
  })
}

export const useScheduledSettings = create<ScheduledSettingsState>((set) => ({
  file: defaultScheduledSettingsFile(),
  hydrated: false,
  loadError: null,
  saveError: null,
  active: null,
  tokenStatus: {},

  async hydrate() {
    const [loaded, active, tokenStatus] = await Promise.all([
      window.nodeTerminal.scheduledSettings.load(),
      window.nodeTerminal.scheduledSettings.activeState(),
      window.nodeTerminal.scheduledSettings.tokenStatus()
    ])
    set({
      file: loaded.file,
      loadError: loaded.error,
      active,
      tokenStatus,
      hydrated: true
    })
  },

  update(next) {
    set({ file: next, saveError: null })
    saveQueue.enqueue(next, (error) => set({ saveError: error }))
  },

  async setHomeAssistantToken(ruleId, token) {
    await window.nodeTerminal.scheduledSettings.setHomeAssistantToken(ruleId, token)
    const tokenStatus = await window.nodeTerminal.scheduledSettings.tokenStatus()
    set({ tokenStatus })
  },

  async refreshRule(ruleId) {
    await window.nodeTerminal.scheduledSettings.refreshRule(ruleId)
    const active = await window.nodeTerminal.scheduledSettings.activeState()
    set({ active })
  }
}))
