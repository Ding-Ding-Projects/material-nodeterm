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
  /** Missing status is not `false`: this tracks rules whose credential file could not be read. */
  tokenStatusUnknown: Record<string, boolean>
  /** Per-rule credential mutation failures. Token calls are fired from button handlers, so the
   *  store consumes their rejection and gives the owning rule an inline, non-secret error. */
  tokenErrors: Record<string, string>
  hydrate(): Promise<void>
  /** Replace the whole file and persist it (debounced, mirroring `useSettings.update`). */
  update(next: ScheduledSettingsFile): void
  /** True only after both the mutation and the write-only status refresh succeed. */
  setHomeAssistantToken(ruleId: string, token: string | null): Promise<boolean>
  /** The "Retry" action next to a failed external source. */
  refreshRule(ruleId: string): Promise<void>
}

const SAVE_COALESCE_MS = 500
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: ScheduledSettingsFile | null = null
let pendingSaveCallback: ((error: string | null) => void) | null = null
let saveInFlight: Promise<string | null> | null = null

async function persistPendingSave(): Promise<string | null> {
  if (saveInFlight) {
    const prior = saveInFlight
    const priorError = await prior
    if (saveInFlight === prior) saveInFlight = null
    if (priorError) return priorError
    return persistPendingSave()
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const toSave = pendingSave
  const onSaved = pendingSaveCallback
  pendingSave = null
  pendingSaveCallback = null
  if (!toSave) return null
  const run = (async (): Promise<string | null> => {
    let error: string | null
    try {
      const result = await window.nodeTerminal.scheduledSettings.save(toSave)
      error = result.ok ? null : (result.error ?? 'Could not save the schedule.')
    } catch {
      error = 'Could not reach the app to save the schedule.'
    }
    onSaved?.(error)
    return error
  })()
  saveInFlight = run
  try {
    return await run
  } finally {
    if (saveInFlight === run) saveInFlight = null
  }
}

function scheduleSave(next: ScheduledSettingsFile, onSaved: (error: string | null) => void): void {
  pendingSave = next
  pendingSaveCallback = onSaved
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    void persistPendingSave()
  }, SAVE_COALESCE_MS)
}

function withoutRuleError<T>(errors: Record<string, T>, ruleId: string): Record<string, T> {
  const next = { ...errors }
  delete next[ruleId]
  return next
}

function tokenMutationError(token: string | null, reason: unknown): string {
  const detail = reason instanceof Error && reason.message.trim() ? ` ${reason.message}` : ''
  return token === null
    ? `Could not clear the Home Assistant token. It may still be stored.${detail}`
    : `Could not save the Home Assistant token.${detail}`
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
  tokenStatusUnknown: {},
  tokenErrors: {},

  async hydrate() {
    const [file, active] = await Promise.all([
      window.nodeTerminal.scheduledSettings.load(),
      window.nodeTerminal.scheduledSettings.activeState()
    ])
    let tokenStatus: Record<string, boolean> = {}
    let tokenStatusUnknown: Record<string, boolean> = {}
    let tokenErrors: Record<string, string> = {}
    try {
      tokenStatus = await window.nodeTerminal.scheduledSettings.tokenStatus()
    } catch {
      const ids = file.rules
        .filter((rule) => rule.source.kind === 'home-assistant')
        .map((rule) => rule.id)
      tokenStatusUnknown = Object.fromEntries(ids.map((id) => [id, true]))
      tokenErrors = Object.fromEntries(
        ids.map((id) => [id, 'Could not check whether a Home Assistant token is stored.'])
      )
    }
    set({ file, active, tokenStatus, tokenStatusUnknown, tokenErrors, hydrated: true })
  },

  update(next) {
    set({ file: next, saveError: null })
    scheduleSave(next, (error) => set({ saveError: error }))
  },

  async setHomeAssistantToken(ruleId, token) {
    set((state) => ({ tokenErrors: withoutRuleError(state.tokenErrors, ruleId) }))
    // Token mutation is immediate while schedule edits are coalesced. Publish the owning rule
    // first, otherwise startup/background orphan pruning can authoritatively delete the new token
    // while the core store still contains the previous rule set.
    const pendingError = await persistPendingSave()
    if (pendingError) {
      set((state) => ({
        tokenErrors: {
          ...state.tokenErrors,
          [ruleId]: `Could not save the owning schedule rule before changing its token. ${pendingError}`
        }
      }))
      return false
    }
    try {
      await window.nodeTerminal.scheduledSettings.setHomeAssistantToken(ruleId, token)
    } catch (reason) {
      set((state) => ({
        tokenErrors: { ...state.tokenErrors, [ruleId]: tokenMutationError(token, reason) }
      }))
      return false
    }

    try {
      const tokenStatus = await window.nodeTerminal.scheduledSettings.tokenStatus()
      set((state) => {
        const tokenErrors = { ...state.tokenErrors }
        for (const id of Object.keys(state.tokenStatusUnknown)) delete tokenErrors[id]
        delete tokenErrors[ruleId]
        return { tokenStatus, tokenStatusUnknown: {}, tokenErrors }
      })
      return true
    } catch (reason) {
      const detail = reason instanceof Error && reason.message.trim() ? ` ${reason.message}` : ''
      // Do not guess whether a clear succeeded. Keeping the old status is the conservative state;
      // a false "cleared" is especially dangerous for a bearer credential. The status call is
      // aggregate, so its rejection cannot identify which rule failed: mark every HA rule unknown.
      set((state) => {
        const ids = state.file.rules
          .filter((rule) => rule.source.kind === 'home-assistant')
          .map((rule) => rule.id)
        const tokenStatusUnknown = { ...state.tokenStatusUnknown }
        const tokenErrors = { ...state.tokenErrors }
        for (const id of ids) {
          tokenStatusUnknown[id] = true
          tokenErrors[id] =
            id === ruleId
              ? `The Home Assistant token change may have succeeded, but its stored status could not be verified.${detail}`
              : 'Could not check whether a Home Assistant token is stored.'
        }
        return { tokenStatusUnknown, tokenErrors }
      })
      return false
    }
  },

  async refreshRule(ruleId) {
    await window.nodeTerminal.scheduledSettings.refreshRule(ruleId)
    const active = await window.nodeTerminal.scheduledSettings.activeState()
    set({ active })
  }
}))
