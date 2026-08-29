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
  /** Missing status is not `false`: these rules had credential evidence the shell could not read. */
  tokenStatusUnknown: Record<string, boolean>
  /** Per-rule credential/status failures. Button handlers consume their promise rejections here so
   * the owning rule keeps a visible, current error instead of producing an unhandled rejection. */
  tokenErrors: Record<string, string>
  hydrate(): Promise<void>
  /** Replace the whole file and persist it (debounced, mirroring `useSettings.update`). */
  update(next: ScheduledSettingsFile): void
  /** True only after the mutation and its authoritative status refresh both succeed. */
  setHomeAssistantToken(ruleId: string, token: string | null): Promise<boolean>
  /** The "Retry" action next to a failed external source. */
  refreshRule(ruleId: string): Promise<void>
}

const SAVE_COALESCE_MS = 500
const saveQueue = new ScheduledSettingsSaveQueue(
  (file) => window.nodeTerminal.scheduledSettings.save(file),
  SAVE_COALESCE_MS
)
let tokenActionTail: Promise<void> = Promise.resolve()

function serializeTokenAction<T>(action: () => Promise<T>): Promise<T> {
  const result = tokenActionTail.catch(() => {}).then(action)
  tokenActionTail = result.then(
    () => {},
    () => {}
  )
  return result
}

function withoutRuleError<T>(errors: Record<string, T>, ruleId: string): Record<string, T> {
  const next = { ...errors }
  delete next[ruleId]
  return next
}

function errorDetail(reason: unknown): string {
  return reason instanceof Error && reason.message.trim() ? ` ${reason.message}` : ''
}

function tokenMutationError(token: string | null, reason: unknown): string {
  const detail = errorDetail(reason)
  return token === null
    ? `Could not clear the Home Assistant token. It may still be stored.${detail}`
    : `Could not save the Home Assistant token.${detail}`
}

// Reload/quit inside the coalesce window must not lose the last edit — same discipline as
// state/settings.ts. Guarded: this module is transitively importable from a node-environment test.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    saveQueue.flushPendingForUnload()
  })
}

export const useScheduledSettings = create<ScheduledSettingsState>((set, get) => ({
  file: defaultScheduledSettingsFile(),
  hydrated: false,
  loadError: null,
  saveError: null,
  active: null,
  tokenStatus: {},
  tokenStatusUnknown: {},
  tokenErrors: {},

  async hydrate() {
    const activePromise = window.nodeTerminal.scheduledSettings.activeState().catch(() => get().active)
    const loaded = await window.nodeTerminal.scheduledSettings.load()
    if (loaded.error) saveQueue.cancelPending()
    const active = await activePromise
    const prior = get()
    let tokenStatus: Record<string, boolean> = { ...prior.tokenStatus }
    let tokenStatusUnknown: Record<string, boolean> = { ...prior.tokenStatusUnknown }
    let tokenErrors: Record<string, string> = { ...prior.tokenErrors }
    if (!loaded.error) {
      try {
        tokenStatus = await window.nodeTerminal.scheduledSettings.tokenStatus()
        for (const id of Object.keys(tokenStatusUnknown)) delete tokenErrors[id]
        tokenStatusUnknown = {}
      } catch {
        const ids = loaded.file.rules
          .filter((rule) => rule.source.kind === 'home-assistant')
          .map((rule) => rule.id)
        for (const id of ids) {
          tokenStatusUnknown[id] = true
          tokenErrors[id] = 'Could not check whether a Home Assistant token is stored.'
        }
      }
    }
    set({
      file: loaded.file,
      loadError: loaded.error,
      active,
      tokenStatus,
      tokenStatusUnknown,
      tokenErrors,
      hydrated: true
    })
  },

  update(next) {
    if (get().loadError) return
    set({ file: next, saveError: null })
    saveQueue.enqueue(next, (error) => set({ saveError: error }))
  },

  setHomeAssistantToken(ruleId, token) {
    return serializeTokenAction(async () => {
      set((state) => ({ tokenErrors: withoutRuleError(state.tokenErrors, ruleId) }))

      if (token !== null && get().loadError) {
        set((state) => ({
          tokenErrors: {
            ...state.tokenErrors,
            [ruleId]: 'Could not save the Home Assistant token while scheduled settings are locked for recovery.'
          }
        }))
        return false
      }

      // Save needs a durable owning rule before credential publication. Clear is deliberately
      // independent: a failed/unreadable schedule must never prevent removing possible bearer
      // evidence, and no owning rule is needed to make absence safe.
      if (token !== null) {
        const pendingError = await saveQueue.flushPending()
        if (pendingError) {
          set((state) => ({
            tokenErrors: {
              ...state.tokenErrors,
              [ruleId]: `Could not save the owning schedule rule before changing its token. ${pendingError}`
            }
          }))
          return false
        }
      }

      try {
        await window.nodeTerminal.scheduledSettings.setHomeAssistantToken(ruleId, token)
      } catch (reason) {
        set((state) => ({
          tokenStatusUnknown: { ...state.tokenStatusUnknown, [ruleId]: true },
          tokenErrors: { ...state.tokenErrors, [ruleId]: tokenMutationError(token, reason) }
        }))
        return false
      }

      try {
        const tokenStatus = await window.nodeTerminal.scheduledSettings.tokenStatus()
        const expected = token !== null
        const verified =
          Object.prototype.hasOwnProperty.call(tokenStatus, ruleId) &&
          tokenStatus[ruleId] === expected
        if (!verified) {
          set((state) => {
            const nextStatus = { ...tokenStatus }
            if (Object.prototype.hasOwnProperty.call(state.tokenStatus, ruleId)) {
              nextStatus[ruleId] = state.tokenStatus[ruleId]
            } else {
              delete nextStatus[ruleId]
            }
            const tokenErrors = { ...state.tokenErrors }
            for (const id of Object.keys(state.tokenStatusUnknown)) delete tokenErrors[id]
            tokenErrors[ruleId] =
              'The Home Assistant token change may have succeeded, but its stored status did not verify the requested result.'
            return {
              tokenStatus: nextStatus,
              tokenStatusUnknown: { [ruleId]: true },
              tokenErrors
            }
          })
          return false
        }

        set((state) => {
          const tokenErrors = { ...state.tokenErrors }
          for (const id of Object.keys(state.tokenStatusUnknown)) delete tokenErrors[id]
          delete tokenErrors[ruleId]
          return { tokenStatus, tokenStatusUnknown: {}, tokenErrors }
        })
        return true
      } catch (reason) {
        const detail = errorDetail(reason)
        // The aggregate status call cannot identify one failed rule. Keep every prior boolean and
        // mark every current Home Assistant rule unknown; especially after Clear, `false` would be
        // a fabricated claim that bearer evidence is gone.
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
    })
  },

  async refreshRule(ruleId) {
    await window.nodeTerminal.scheduledSettings.refreshRule(ruleId)
    const active = await window.nodeTerminal.scheduledSettings.activeState()
    set({ active })
  }
}))
