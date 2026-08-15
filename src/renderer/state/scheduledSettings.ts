import { create } from 'zustand'
import {
  defaultScheduledSettingsFile,
  type ScheduledSettingsActiveState,
  type ScheduledSettingsFile
} from '@shared/scheduled-settings'

interface ScheduledSettingsState {
  file: ScheduledSettingsFile
  hydrated: boolean
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
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: ScheduledSettingsFile | null = null

function scheduleSave(next: ScheduledSettingsFile, onSaved: (error: string | null) => void): void {
  pendingSave = next
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const toSave = pendingSave
    pendingSave = null
    if (!toSave) return
    void window.nodeTerminal.scheduledSettings
      .save(toSave)
      .then((res) => onSaved(res.ok ? null : (res.error ?? 'Could not save the schedule.')))
      .catch(() => onSaved('Could not reach the app to save the schedule.'))
  }, SAVE_COALESCE_MS)
}

// Reload/quit inside the coalesce window must not lose the last edit — same discipline as
// state/settings.ts. Guarded: this module is transitively importable from a node-environment test.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (pendingSave) void window.nodeTerminal.scheduledSettings.save(pendingSave)
    pendingSave = null
  })
}

export const useScheduledSettings = create<ScheduledSettingsState>((set) => ({
  file: defaultScheduledSettingsFile(),
  hydrated: false,
  saveError: null,
  active: null,
  tokenStatus: {},

  async hydrate() {
    const [file, active, tokenStatus] = await Promise.all([
      window.nodeTerminal.scheduledSettings.load(),
      window.nodeTerminal.scheduledSettings.activeState(),
      window.nodeTerminal.scheduledSettings.tokenStatus()
    ])
    set({ file, active, tokenStatus, hydrated: true })
  },

  update(next) {
    set({ file: next, saveError: null })
    scheduleSave(next, (error) => set({ saveError: error }))
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
