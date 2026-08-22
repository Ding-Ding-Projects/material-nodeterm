import { create } from 'zustand'

/**
 * Kids mode's activity ledger and the grown-up screen's own settings.
 *
 * This is deliberately separate from `state/kidsMode.ts` (the shared, cross-app record that
 * turns the mode on and off): everything here is LOCAL to this machine's renderer, private to
 * this app, and has no security meaning — turning "Allow the real terminal" off does not need a
 * PIN to flip back, because it is a parenting dial, not a lock. The one thing that IS
 * security-relevant (the grown-up PIN itself) never lives here; see `state/kidsMode.ts` and
 * `window.nodeTerminal.kidsMode.verifyPin`.
 *
 * WHAT IS HONEST HERE, and why "Words typed" from the design mock is gone: this store only
 * counts things the app can honestly count without reading what was typed. A running tally of
 * keystrokes inside a REAL terminal — the very thing "Allow the real terminal" is guarding — is a
 * keylogger shape, and this mode's whole defensibility rests on KIDS_DISCLOSURE being true. So the
 * stat is "Sessions today": how many times an activity was opened, derived from `entries` below,
 * never from anything captured inside a session.
 *
 * Persisted the same way `state/explorer.ts` persists expanded folders: a plain localStorage
 * blob, loaded once at module init and re-saved on every mutation. No IPC, no shared file — this
 * is this window's own idle chatter, not a cross-app record.
 */

export type KidsActivityKind = 'beep' | 'terminal' | 'draw' | 'sticker'

export interface KidsActivityEntry {
  id: string
  kind: KidsActivityKind
  /** Short past-tense label, e.g. "Talked to Beep" — what the grown-up screen's list shows. */
  what: string
  detail: string
  /** Epoch ms. */
  when: number
}

const STORAGE_KEY = 'nodeterm.kidsActivity'
/** A ledger, not a database — cap it so a machine that never clears kids mode doesn't grow an
 *  unbounded localStorage blob. Oldest entries fall off first. */
const MAX_ENTRIES = 300
/** How long a kid has to stay in an activity before it earns a sticker (ms). Short enough that
 *  trying something briefly still counts, long enough that opening and immediately leaving does
 *  not turn into a sticker farm. */
const STICKER_THRESHOLD_MS = 20_000
/** The daily limit a fresh "Daily time limit" toggle turns on with, matching the design mock's
 *  own "Daily limit: 60 min" stat card. A grown-up who wants a different number changes it in
 *  Settings → Kids mode (follow-up; see docs/kids-mode.md) — this store's contract is "on or off
 *  with a sane default", not a full picker, for v1. */
const DEFAULT_DAILY_LIMIT_MINUTES = 60

interface PersistedShape {
  entries: KidsActivityEntry[]
  stickers: number
  allowRealTerminal: boolean
  dailyLimitMinutes: number | null
  lockOnLaunch: boolean
  /** Date string (YYYY-MM-DD, local) → minutes accumulated that day. Only today's key is ever
   *  read; older keys are harmless history nobody trims (a handful of small integers). */
  minutesByDate: Record<string, number>
}

function todayKey(now = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaults(): PersistedShape {
  return {
    entries: [],
    stickers: 0,
    allowRealTerminal: true,
    dailyLimitMinutes: null,
    lockOnLaunch: false,
    minutesByDate: {}
  }
}

function load(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw) as Partial<PersistedShape>
    const base = defaults()
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries.slice(0, MAX_ENTRIES) : base.entries,
      stickers: typeof parsed.stickers === 'number' && parsed.stickers >= 0 ? parsed.stickers : base.stickers,
      allowRealTerminal:
        typeof parsed.allowRealTerminal === 'boolean' ? parsed.allowRealTerminal : base.allowRealTerminal,
      dailyLimitMinutes:
        typeof parsed.dailyLimitMinutes === 'number' && parsed.dailyLimitMinutes > 0
          ? parsed.dailyLimitMinutes
          : null,
      lockOnLaunch: typeof parsed.lockOnLaunch === 'boolean' ? parsed.lockOnLaunch : base.lockOnLaunch,
      minutesByDate:
        parsed.minutesByDate && typeof parsed.minutesByDate === 'object' ? parsed.minutesByDate : {}
    }
  } catch {
    return defaults()
  }
}

function save(v: PersistedShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    // Quota/private-mode: the activity ledger is a nicety, never worth failing the UI over.
  }
}

function randomId(): string {
  return `kact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface KidsActivityState extends PersistedShape {
  /** Append one activity entry (newest first), trimmed to MAX_ENTRIES. */
  logActivity(kind: KidsActivityKind, what: string, detail: string): void
  /** Award one sticker, logged as its own activity entry. */
  addSticker(reason: string): void
  setAllowRealTerminal(v: boolean): void
  setDailyLimitEnabled(v: boolean): void
  setLockOnLaunch(v: boolean): void
  /** Add one minute to today's tally. Called on a 60s interval while a kid is actively in the
   *  shell (Home/activity/stickers — never while the grown-up screen or gate is open, since
   *  those are not "kid time"). */
  tickMinute(): void
  /** Today's entries, newest first. */
  todayEntries(): KidsActivityEntry[]
  /** How many activities were opened today — the honest replacement for a typed-character count. */
  sessionsToday(): number
  minutesToday(): number
  /** Whether today's tracked minutes have reached the active daily limit (always false when the
   *  limit is off). */
  overDailyLimit(): boolean
}

export const useKidsActivity = create<KidsActivityState>((set, get) => ({
  ...load(),

  logActivity: (kind, what, detail) =>
    set((s) => {
      const entries = [{ id: randomId(), kind, what, detail, when: Date.now() }, ...s.entries].slice(
        0,
        MAX_ENTRIES
      )
      const next = { ...s, entries }
      save(next)
      return next
    }),

  addSticker: (reason) =>
    set((s) => {
      const stickers = s.stickers + 1
      const entries = [
        { id: randomId(), kind: 'sticker' as const, what: 'Earned a sticker', detail: reason, when: Date.now() },
        ...s.entries
      ].slice(0, MAX_ENTRIES)
      const next = { ...s, stickers, entries }
      save(next)
      return next
    }),

  setAllowRealTerminal: (v) =>
    set((s) => {
      const next = { ...s, allowRealTerminal: v }
      save(next)
      return next
    }),

  setDailyLimitEnabled: (v) =>
    set((s) => {
      const next = { ...s, dailyLimitMinutes: v ? DEFAULT_DAILY_LIMIT_MINUTES : null }
      save(next)
      return next
    }),

  setLockOnLaunch: (v) =>
    set((s) => {
      const next = { ...s, lockOnLaunch: v }
      save(next)
      return next
    }),

  tickMinute: () =>
    set((s) => {
      const key = todayKey()
      const minutesByDate = { ...s.minutesByDate, [key]: (s.minutesByDate[key] ?? 0) + 1 }
      const next = { ...s, minutesByDate }
      save(next)
      return next
    }),

  todayEntries: () => {
    const key = todayKey()
    return get().entries.filter((e) => todayKey(e.when) === key)
  },

  sessionsToday: () => get().todayEntries().filter((e) => e.kind !== 'sticker').length,

  minutesToday: () => get().minutesByDate[todayKey()] ?? 0,

  overDailyLimit: () => {
    const { dailyLimitMinutes } = get()
    return dailyLimitMinutes != null && get().minutesToday() >= dailyLimitMinutes
  }
}))

/** For a caller that only wants the number, without subscribing to the whole store. */
export function stickerThresholdMs(): number {
  return STICKER_THRESHOLD_MS
}
