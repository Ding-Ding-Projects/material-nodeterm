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
interface KidsModeState {
  enabled: boolean
  name: string
  hydrated: boolean
  hasCredential: boolean
  init(): Promise<void>
  enable(pin?: string): Promise<{ ok: true } | { ok: false; error: string }>
  disable(pin: string): Promise<{ ok: true } | { ok: false; error: string }>
  rename(name: string): Promise<void>
  changePin(currentPin: string, nextPin: string): Promise<boolean>
  refreshHasCredential(): Promise<void>
}

let initStarted = false

export const useKidsMode = create<KidsModeState>((set) => ({
  enabled: false,
  name: DEFAULT_KIDS_MODE_NAME,
  hydrated: false,
  hasCredential: false,

  init: async () => {
    if (initStarted) return
    initStarted = true
    try {
      const [record, hasCredential] = await Promise.all([
        window.nodeTerminal.kidsMode.load(),
        window.nodeTerminal.kidsMode.hasCredential()
      ])
      set({ enabled: record.enabled, name: record.name, hasCredential, hydrated: true })
    } catch {
      // A shell that cannot reach the IPC leaves the default (OFF) in place rather than blocking
      // boot. Which way this fails matters: defaulting to ON would apply restrictions nobody
      // asked for and, worse, imply a protection that is not actually in force.
      set({ hydrated: true })
    }
    window.nodeTerminal.kidsMode.onChanged((record) => {
      set({ enabled: record.enabled, name: record.name })
    })
  },

  enable: async (pin) => {
    try {
      const record = await window.nodeTerminal.kidsMode.enable(pin)
      set({ enabled: record.enabled, name: record.name, hasCredential: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'could not turn kids mode on' }
    }
  },

  disable: async (pin) => {
    const result = await window.nodeTerminal.kidsMode.disable(pin)
    if (result.ok) {
      set({ enabled: result.record.enabled, name: result.record.name })
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
