import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import type { SchedulableSettingsPatch } from '@shared/scheduled-settings'

interface SettingsState {
  /** What actually RENDERS: `base` with the currently-active scheduled-settings override (if
   *  any) merged on top. Every existing consumer in the app reads THIS field, unchanged — that is
   *  what makes scheduled overrides reach the whole renderer without touching every consumer:
   *  the override is applied once, here, rather than at each of the many places a setting is read. */
  settings: Settings
  /** The persisted settings — what Settings → * edits, what `save()` writes to disk, and what
   *  `settings` reverts to the instant a scheduled override ends. Scheduling something NEVER
   *  writes to `base` or to disk: "base user settings remain recoverable" (see
   *  docs/scheduled-settings.md) is implemented by simply never letting the override touch this
   *  field. */
  base: Settings
  /** True once settings have been loaded from disk (so first-run logic can wait). */
  hydrated: boolean
  hydrate(): Promise<void>
  update(patch: Partial<Settings>): void
  /** Called by the scheduled-settings apply-controller (Canvas.tsx) whenever the resolved
   *  schedule changes. `null` = no rule is active right now → `settings` reverts to `base`
   *  exactly. Purely in-memory: never persisted, never round-tripped through `settings.save()`. */
  applyScheduleOverride(patch: SchedulableSettingsPatch | null): void
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

// The currently-active scheduled-settings override, applied on top of `base` to produce
// `settings`. Module-level (not store state) for the same reason `saveTimer`/`pendingSave` are:
// it is re-applied by `hydrate()` below regardless of whether the schedule's first push arrives
// before or after settings finish loading from disk — two independently-timed async starts that
// must agree on the end state whichever order they land in.
let currentOverride: SchedulableSettingsPatch | null = null

function withOverride(base: Settings): Settings {
  return currentOverride ? { ...base, ...currentOverride } : base
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  base: DEFAULT_SETTINGS,
  hydrated: false,

  async hydrate() {
    const s = await window.nodeTerminal.settings.load()
    const base = { ...DEFAULT_SETTINGS, ...s }
    set({ base, settings: withOverride(base), hydrated: true })
  },

  update(patch) {
    const base = { ...get().base, ...patch }
    set({ base, settings: withOverride(base) })
    // Only ever `base` — see `SettingsState.base`'s doc. An active scheduled override must never
    // be able to overwrite the user's own edits on disk, and a user edit while an override is
    // active must not silently discard the override either (it's re-applied on the very next line).
    scheduleSave(base)
  },

  applyScheduleOverride(patch) {
    currentOverride = patch
    set({ settings: withOverride(get().base) })
  }
}))
