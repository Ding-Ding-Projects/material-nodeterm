import { create } from 'zustand'

import { DEFAULT_KIDS_MODE_NAME } from '@shared/kids-mode-name'
import type { KidsCredentialState } from '@shared/types'

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
  /** A displayed OFF is permission only after core proves a strict read for a live watch epoch. */
  policyStatus: KidsModePolicyStatus
  generation: number
  credentialState: KidsCredentialState | 'loading'
  /** @deprecated Compatibility only for older test fixtures. Read `credentialState` in UI code. */
  hasCredential?: boolean
  init(): Promise<void>
  enable(pin?: string): Promise<{ ok: true } | { ok: false; error: string }>
  disable(pin: string): Promise<{ ok: true } | { ok: false; error: string }>
  rename(name: string): Promise<void>
  changePin(currentPin: string, nextPin: string): Promise<boolean>
  resetCredential(): Promise<{ ok: true } | { ok: false; error: string }>
  refreshCredentialState(): Promise<void>
}

let initStarted = false
let liveSubscriptionReady = false
let latestGeneration = -1
let credentialReadEpoch = 0

function beginCredentialRead(): number {
  credentialReadEpoch += 1
  return credentialReadEpoch
}

function applyCredentialRead(epoch: number, state: KidsCredentialState): void {
  if (epoch !== credentialReadEpoch) return
  setCredentialState(state)
}

let setCredentialState: (state: KidsCredentialState | 'loading') => void = () => {}

/** Destructive callers fail closed while the shared record is loading or unavailable. */
export function kidsDestructiveGateRequired(
  state: Pick<KidsModeState, 'enabled' | 'policyStatus'> = useKidsMode.getState()
): boolean {
  return state.enabled || state.policyStatus !== 'ready'
}

export const useKidsMode = create<KidsModeState>((set) => {
  setCredentialState = (state) => set({ credentialState: state })
  return ({
  enabled: false,
  name: DEFAULT_KIDS_MODE_NAME,
  hydrated: false,
  policyStatus: 'loading',
  generation: -1,
  credentialState: 'loading',

  init: async () => {
    if (initStarted) return
    initStarted = true
    let liveGeneration = 0
    try {
      window.nodeTerminal.kidsMode.onChanged((record) => {
        if (record.generation < latestGeneration) return
        latestGeneration = record.generation
        set({
          enabled: record.enabled,
          name: record.name,
          hydrated: true,
          policyStatus: record.authoritative ? 'ready' : 'unavailable',
          generation: record.generation
        })
        // Credential files are separate from the watched record. Re-read them after every live
        // record event so another process's enrollment, removal, or vault failure converges here
        // before a gate decides which controls to render.
        const epoch = beginCredentialRead()
        void window.nodeTerminal.kidsMode.credentialState().then(
          (state) => applyCredentialRead(epoch, state),
          () => applyCredentialRead(epoch, 'unavailable')
        )
      })
      liveSubscriptionReady = true
    } catch {
      // A one-time load becomes stale as soon as another process edits the shared record. Without
      // the subscription, OFF remains display-only and destructive policy stays unavailable.
      liveSubscriptionReady = false
    }

    try {
      const credentialEpoch = beginCredentialRead()
      const [recordResult, credentialResult] = await Promise.allSettled([
        window.nodeTerminal.kidsMode.load(),
        window.nodeTerminal.kidsMode.credentialState()
      ])
      if (recordResult.status === 'fulfilled' && recordResult.value.generation >= latestGeneration) {
        const record = recordResult.value
        latestGeneration = record.generation
        set({
          enabled: record.enabled,
          name: record.name,
          hydrated: true,
          policyStatus:
            liveSubscriptionReady && record.authoritative ? 'ready' : 'unavailable',
          generation: record.generation
        })
        applyCredentialRead(
          credentialEpoch,
          credentialResult.status === 'fulfilled' ? credentialResult.value : 'unavailable'
        )
      } else if (recordResult.status === 'rejected' && latestGeneration < 0) {
        set({
          hydrated: true,
          policyStatus: 'unavailable'
        })
        applyCredentialRead(
          credentialEpoch,
          credentialResult.status === 'fulfilled' ? credentialResult.value : 'unavailable'
        )
      } else if (credentialResult.status === 'fulfilled') {
        // A newer live event won. Credential existence is independent and can still be merged.
        applyCredentialRead(credentialEpoch, credentialResult.value)
        set({ hydrated: true })
      }
    } catch {
      set({ hydrated: true, policyStatus: 'unavailable' })
    }
  },

  enable: async (pin) => {
    const operationEpoch = beginCredentialRead()
    try {
      const record = await window.nodeTerminal.kidsMode.enable(pin)
      if (record.generation >= latestGeneration) {
        latestGeneration = record.generation
        set({
          enabled: record.enabled,
          name: record.name,
          policyStatus:
            liveSubscriptionReady && record.authoritative ? 'ready' : 'unavailable',
          generation: record.generation
        })
        applyCredentialRead(operationEpoch, 'present')
      } else {
        applyCredentialRead(operationEpoch, 'present')
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'could not turn kids mode on' }
    }
  },

  disable: async (pin) => {
    beginCredentialRead()
    const result = await window.nodeTerminal.kidsMode.disable(pin)
    if (result.ok && result.record.generation >= latestGeneration) {
      latestGeneration = result.record.generation
      set({
        enabled: result.record.enabled,
        name: result.record.name,
        policyStatus:
          liveSubscriptionReady && result.record.authoritative ? 'ready' : 'unavailable',
        generation: result.record.generation
      })
      return { ok: true }
    }
    if (result.ok) return { ok: true }
    return { ok: false, error: result.error }
  },

  rename: async (name) => {
    const record = await window.nodeTerminal.kidsMode.rename(name)
    if (record.generation < latestGeneration) return
    latestGeneration = record.generation
    set({
      enabled: record.enabled,
      name: record.name,
      policyStatus:
        liveSubscriptionReady && record.authoritative ? 'ready' : 'unavailable',
      generation: record.generation
    })
  },

  changePin: async (currentPin, nextPin) => {
    const operationEpoch = beginCredentialRead()
    const ok = await window.nodeTerminal.kidsMode.changePin(currentPin, nextPin)
    if (ok) applyCredentialRead(operationEpoch, 'present')
    return ok
  },

  resetCredential: async () => {
    const operationEpoch = beginCredentialRead()
    const result = await window.nodeTerminal.kidsMode.resetCredential()
    if (result.ok) {
      set({ enabled: false })
      applyCredentialRead(operationEpoch, 'absent')
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  },

  refreshCredentialState: async () => {
    const epoch = beginCredentialRead()
    try {
      applyCredentialRead(epoch, await window.nodeTerminal.kidsMode.credentialState())
    } catch {
      applyCredentialRead(epoch, 'unavailable')
    }
  }
  })
})
