// Toy-lock records + the EPHEMERAL "is this surface unlocked right now" state (docs/toy-locks.md).
//
// `records` mirrors the core's list (non-secret metadata only — no credential ever reaches the
// renderer). `unlockedUntil` is deliberately session-only, in-memory, NEVER persisted: that is
// what "locked on launch" means, and it is also why this store never writes to localStorage the
// way most other renderer stores do — a lock that survived in localStorage would defeat its own
// "locked again after a restart" default.
//
//   - `'until-close'` and `'minutes'` locks set a real (possibly `Infinity`) expiry timestamp;
//     `isUnlocked` re-evaluates it on every read, so a minutes-timer needs no setInterval anywhere.
//   - `'session'` locks are unlocked indefinitely UNTIL the surface that owns them calls `relock()`
//     on its own "I'm being left" moment (a tab switching away, a node losing selection, the
//     Settings window closing) — see the doc comment on `ToyLockDurationMode` in shared/toylock.ts.

import { create } from 'zustand'
import type { ToyLockRecord } from '@shared/toylock'

interface ToyLocksState {
  records: ToyLockRecord[]
  loaded: boolean
  loadError: string | null
  unlockedUntil: Record<string, number>
  refresh(): Promise<void>
  byTarget(kind: string, id: string): ToyLockRecord | undefined
  byId(id: string): ToyLockRecord | undefined
  isUnlocked(lockId: string): boolean
  markUnlocked(record: ToyLockRecord): void
  relock(lockId: string): void
  upsert(record: ToyLockRecord): void
  drop(lockId: string): void
}

export const useToyLocks = create<ToyLocksState>((set, get) => ({
  records: [],
  loaded: false,
  loadError: null,
  unlockedUntil: {},

  async refresh() {
    try {
      const records = await window.nodeTerminal.toylock.list()
      set({ records, loaded: true, loadError: null })
    } catch {
      // Retain any last-known records; an unreadable credential store is not an empty lock list.
      set({ loaded: true, loadError: 'Could not read the toy-lock credential store.' })
    }
  },

  byTarget(kind, id) {
    return get().records.find((r) => r.target.kind === kind && r.target.id === id)
  },

  byId(id) {
    return get().records.find((r) => r.id === id)
  },

  isUnlocked(lockId) {
    const until = get().unlockedUntil[lockId]
    return until !== undefined && Date.now() < until
  },

  markUnlocked(record) {
    const until =
      record.duration === 'minutes'
        ? Date.now() + Math.max(1, record.durationMinutes ?? 5) * 60_000
        : Infinity // 'until-close' really means until the app quits; 'session' until relock() fires
    set((s) => ({ unlockedUntil: { ...s.unlockedUntil, [record.id]: until } }))
  },

  relock(lockId) {
    set((s) => {
      if (!(lockId in s.unlockedUntil)) return s
      const next = { ...s.unlockedUntil }
      delete next[lockId]
      return { unlockedUntil: next }
    })
  },

  upsert(record) {
    set((s) => ({ records: [...s.records.filter((r) => r.id !== record.id), record] }))
  },

  drop(lockId) {
    set((s) => {
      const unlockedUntil = { ...s.unlockedUntil }
      delete unlockedUntil[lockId]
      return { records: s.records.filter((r) => r.id !== lockId), unlockedUntil }
    })
  }
}))
