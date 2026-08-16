import { create } from 'zustand'

import { DEFAULT_KIDS_MODE_NAME } from '@shared/kids-mode-name'

/**
 * Renderer-side mirror of the shared Kids-mode record (`window.nodeTerminal.kidsMode`, backed by
 * `core/kids-mode.ts`). Deliberately the same shape as `state/schoolMode.ts`, because the two
 * modes have the same lifecycle even though they mean near-opposite things.
 *
 * This store is the ONE place a surface should read `enabled`/`name` from. Calling
 * `window.nodeTerminal.kidsMode.load()` from a component means that surface will not pick up a
 * change made by another window — or by another app on the machine, since the record is shared —
 * and a mode whose restrictions apply in one window but not the next is worse than no mode.
 *
 * Hydration and the live subscription are wired ONCE from App.tsx.
 */
export type KidsModePolicyStatus = 'loading' | 'ready' | 'unavailable'

export interface KidsModeState {
  enabled: boolean
  name: string
  hydrated: boolean
  /**
   * Whether destructive callers have a live, authoritative record.
   *
   * `enabled: false` alone is not enough: before `load()` answers, after it rejects, or when the
   * live subscription cannot be installed, OFF is only the renderer's display default. Those
   * states must use the two-key gate rather than spending an unknown as permission to delete.
   */
  policyStatus: KidsModePolicyStatus
  hasCredential: boolean
  init(): Promise<void>
  enable(pin?: string): Promise<{ ok: true } | { ok: false; error: string }>
  disable(pin: string): Promise<{ ok: true } | { ok: false; error: string }>
  rename(name: string): Promise<void>
  changePin(currentPin: string, nextPin: string): Promise<boolean>
  refreshHasCredential(): Promise<void>
}

let initStarted = false
let liveSubscriptionReady = false
let liveSubscriptionAuthoritative = false

/**
 * The verdict every destructive surface consumes. Permission-mode presentation still reads
 * `enabled` directly: this fail-closed overlay is deliberately narrow and never pretends the
 * terminal has been sandboxed merely because IPC is unavailable.
 */
export function kidsDestructiveGateRequired(
  state: Pick<KidsModeState, 'enabled' | 'policyStatus'> = useKidsMode.getState()
): boolean {
  return state.enabled || state.policyStatus !== 'ready'
}

export const useKidsMode = create<KidsModeState>((set) => ({
  enabled: false,
  name: DEFAULT_KIDS_MODE_NAME,
  hydrated: false,
  policyStatus: 'loading',
  hasCredential: false,

  init: async () => {
    if (initStarted) return
    initStarted = true
    let liveGeneration = 0
    try {
      window.nodeTerminal.kidsMode.onChanged((record) => {
        liveGeneration += 1
        liveSubscriptionAuthoritative = record.authoritative
        // A live record is authoritative even if the first load failed. It also outranks an older
        // in-flight load snapshot; the generation check below prevents that snapshot overwriting it.
        set({
          enabled: record.enabled,
          name: record.name,
          policyStatus: record.authoritative ? 'ready' : 'unavailable',
          hydrated: true
        })
      })
      liveSubscriptionReady = true
    } catch {
      // A successful one-time load without its subscription becomes stale the moment another app
      // flips the shared record. Keep destructive policy unavailable in that shape.
      liveSubscriptionReady = false
      liveSubscriptionAuthoritative = false
    }

    const generationBeforeLoad = liveGeneration
    const [recordResult, credentialResult] = await Promise.allSettled([
      window.nodeTerminal.kidsMode.load(),
      window.nodeTerminal.kidsMode.hasCredential()
    ])

    if (recordResult.status === 'fulfilled' && liveGeneration === generationBeforeLoad) {
      set({
        enabled: recordResult.value.enabled,
        name: recordResult.value.name,
        hasCredential:
          credentialResult.status === 'fulfilled'
            ? credentialResult.value
            : useKidsMode.getState().hasCredential,
        hydrated: true,
        policyStatus:
          liveSubscriptionReady && recordResult.value.authoritative ? 'ready' : 'unavailable'
      })
      return
    }

    if (recordResult.status === 'rejected' && liveGeneration === generationBeforeLoad) {
      // OFF remains the display default, but destructive callers see `unavailable` and gate. A
      // failed read is not proof the shared record is absent or disabled.
      set({
        hydrated: true,
        policyStatus: 'unavailable',
        ...(credentialResult.status === 'fulfilled'
          ? { hasCredential: credentialResult.value }
          : {})
      })
      return
    }

    // A live event won the race with the load. Preserve its newer record and only merge the
    // independent credential fact.
    set({
      hydrated: true,
      ...(credentialResult.status === 'fulfilled'
        ? { hasCredential: credentialResult.value }
        : {})
    })
  },

  enable: async (pin) => {
    try {
      const record = await window.nodeTerminal.kidsMode.enable(pin)
      set({
        enabled: record.enabled,
        name: record.name,
        hasCredential: true,
        policyStatus:
          liveSubscriptionReady && liveSubscriptionAuthoritative ? 'ready' : 'unavailable'
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'could not turn kids mode on' }
    }
  },

  disable: async (pin) => {
    const result = await window.nodeTerminal.kidsMode.disable(pin)
    if (result.ok) {
      set({
        enabled: result.record.enabled,
        name: result.record.name,
        policyStatus:
          liveSubscriptionReady && liveSubscriptionAuthoritative ? 'ready' : 'unavailable'
      })
      return { ok: true }
    }
    return { ok: false, error: result.error }
  },

  rename: async (name) => {
    const record = await window.nodeTerminal.kidsMode.rename(name)
    set({ name: record.name })
  },

  changePin: async (currentPin, nextPin) => {
    const ok = await window.nodeTerminal.kidsMode.changePin(currentPin, nextPin)
    if (ok) set({ hasCredential: true })
    return ok
  },

  refreshHasCredential: async () => {
    set({ hasCredential: await window.nodeTerminal.kidsMode.hasCredential() })
  }
}))
