import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { DEFAULT_FUNNY_LEVEL, normalizeFunnyLevel } from '@shared/i18n'
import type { SchedulableSettingsPatch } from '@shared/scheduled-settings'
import type { HistoryRestoreResult } from '@shared/local-history'
import {
  applyResolvedCodexAccounts,
  discoverResolvedCodexAccounts
} from './codexAccountReconcile'
import { useProjects } from './projects'

export type SettingsScope = 'global' | 'project'

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
  scope: SettingsScope
  activeProjectId: string
  projectOverrides: Partial<Settings>
  hydrate(): Promise<void>
  update(patch: Partial<Settings>): void
  setScope(scope: SettingsScope): void
  setProjectContext(projectId: string, overrides?: Partial<Settings>): void
  resetProjectKey(key: keyof Settings): void
  resetProjectSection(keys: readonly (keyof Settings)[]): void
  resetProjectAll(): void
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
let saveGeneration = 0
let savesSuspended = false
let pendingSave: { settings: Settings; generation: number } | null = null
let saveTail: Promise<void> = Promise.resolve()

function dispatchSave(next: Settings): void {
  // Track dispatched writes as well as the timer. A history restore first joins this tail, so a
  // save that already crossed IPC cannot wake after the restored revision and put stale renderer
  // state back on disk. Each failure stays fire-and-forget for the ordinary settings UI, while
  // the next operation can still advance past it.
  const run = saveTail.catch(() => {}).then(() => window.nodeTerminal.settings.save(next))
  saveTail = run
  void run.catch(() => {})
}

function scheduleSave(next: Settings): void {
  pendingSave = { settings: next, generation: saveGeneration }
  if (saveTimer || savesSuspended) return
  // Same guard as the beforeunload flush below: this module is transitively imported by
  // node-environment unit tests, where `window` doesn't exist and the timer would throw.
  if (typeof window === 'undefined') return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const queued = pendingSave
    pendingSave = null
    if (queued && queued.generation === saveGeneration && !savesSuspended) {
      dispatchSave(queued.settings)
    }
  }, SAVE_COALESCE_MS)
}

/** Cancel every not-yet-dispatched snapshot and make any callback already copied out of the old
 * generation inert. Returns whether a user edit was waiting, so a failed restore can resume it. */
function invalidateQueuedSave(): boolean {
  const hadPending = pendingSave !== null
  saveGeneration += 1
  pendingSave = null
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  return hadPending
}
// Reload/quit inside the coalesce window must not lose the last edit. (Guarded: this module
// is transitively imported by node-environment unit tests, where `window` doesn't exist.)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    const queued = pendingSave
    pendingSave = null
    if (queued && queued.generation === saveGeneration && !savesSuspended) {
      dispatchSave(queued.settings)
    }
  })
}

// The currently-active scheduled-settings override, applied on top of `base` to produce
// `settings`. Module-level (not store state) for the same reason `saveTimer`/`pendingSave` are:
// it is re-applied by `hydrate()` below regardless of whether the schedule's first push arrives
// before or after settings finish loading from disk — two independently-timed async starts that
// must agree on the end state whichever order they land in.
let currentOverride: SchedulableSettingsPatch | null = null

function withOverride(base: Settings, project: Partial<Settings>): Settings {
  const effective = { ...base, ...project }
  const normalized = {
    ...effective,
    settingsSchemaVersion: 2 as const,
    funnyLevelEn: normalizeFunnyLevel(effective.funnyLevelEn, DEFAULT_FUNNY_LEVEL),
    funnyLevelYue: normalizeFunnyLevel(effective.funnyLevelYue, DEFAULT_FUNNY_LEVEL)
  }
  return currentOverride ? { ...normalized, ...currentOverride } : normalized
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  base: DEFAULT_SETTINGS,
  hydrated: false,
  scope: 'global',
  activeProjectId: '',
  projectOverrides: {},

  async hydrate() {
    const s = await window.nodeTerminal.settings.load()
    const base = withOverride({ ...DEFAULT_SETTINGS, ...s }, {})
    set({ base, settings: withOverride(base, get().projectOverrides), hydrated: true })
    // Pending is renderer persistence, while auth.json/app-server identity is authoritative.
    // Reconcile at application startup so a completed login becomes selectable without requiring
    // the user to discover and reopen Settings after every restart.
    void discoverResolvedCodexAccounts(
      base.codexAccounts,
      (id) => window.nodeTerminal.codexAccounts.identity(id)
    ).then((resolved) => {
      if (resolved.length === 0) return
      // Reconcile the persisted layer. Reading the effective scheduled-settings layer here would
      // let a transient override leak into the user's saved account inventory.
      const current = get().base
      const codexAccounts = applyResolvedCodexAccounts(current.codexAccounts, resolved)
      get().update({ codexAccounts })
    })
  },

  update(patch) {
    if (get().scope === 'project' && get().activeProjectId) {
      const projectOverrides = { ...get().projectOverrides, ...patch }
      useProjects.getState().setProjectSettingsOverrides(get().activeProjectId, projectOverrides)
      set({ projectOverrides, settings: withOverride(get().base, projectOverrides) })
      return
    }
    const base = { ...get().base, ...patch }
    set({ base, settings: withOverride(base, get().projectOverrides) })
    // Only ever `base` — see `SettingsState.base`'s doc. An active scheduled override must never
    // be able to overwrite the user's own edits on disk, and a user edit while an override is
    // active must not silently discard the override either (it's re-applied on the very next line).
    scheduleSave(base)
  },

  setScope(scope) {
    set({ scope })
  },

  setProjectContext(activeProjectId, projectOverrides = {}) {
    set({ activeProjectId, projectOverrides, settings: withOverride(get().base, projectOverrides) })
  },

  resetProjectKey(key) {
    const projectOverrides = { ...get().projectOverrides }
    delete projectOverrides[key]
    if (get().activeProjectId) useProjects.getState().setProjectSettingsOverrides(get().activeProjectId, projectOverrides)
    set({ projectOverrides, settings: withOverride(get().base, projectOverrides) })
  },

  resetProjectSection(keys) {
    const projectOverrides = { ...get().projectOverrides }
    for (const key of keys) delete projectOverrides[key]
    if (get().activeProjectId) useProjects.getState().setProjectSettingsOverrides(get().activeProjectId, projectOverrides)
    set({ projectOverrides, settings: withOverride(get().base, projectOverrides) })
  },

  resetProjectAll() {
    if (get().activeProjectId) useProjects.getState().setProjectSettingsOverrides(get().activeProjectId, {})
    set({ projectOverrides: {}, settings: withOverride(get().base, {}) })
  },

  applyScheduleOverride(patch) {
    currentOverride = patch
    set({ settings: withOverride(get().base, get().projectOverrides) })
  }
}))

let restoreTail: Promise<HistoryRestoreResult> = Promise.resolve({ ok: true })

/**
 * Run a settings-history restore as one renderer transaction.
 *
 * The local-history IPC applies the old document in core, but that alone leaves Zustand rendering
 * the pre-restore object. Worse, its 300 ms coalesced save can then overwrite the revision the user
 * just chose. Suspend and epoch pending callbacks, wait for any already-dispatched save, apply the
 * restore, and immediately load the authoritative settings back into both `base` and `settings`.
 * A failed restore resumes a canceled user edit; a successful one deliberately discards it because
 * choosing the revision superseded that state.
 */
export function restoreSettingsRevision(
  restore: () => Promise<HistoryRestoreResult>
): Promise<HistoryRestoreResult> {
  const run = restoreTail.catch(() => ({ ok: true }) as HistoryRestoreResult).then(async () => {
    const hadPendingBeforeRestore = invalidateQueuedSave()
    savesSuspended = true
    await saveTail.catch(() => {})

    let result: HistoryRestoreResult
    try {
      result = await restore()
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    if (!result.ok) {
      const needsResave = hadPendingBeforeRestore || pendingSave !== null
      pendingSave = null
      savesSuspended = false
      if (needsResave) scheduleSave(useSettings.getState().base)
      return result
    }

    try {
      const loaded = await window.nodeTerminal.settings.load()
      // A modal restore is the winner. Drop updates queued while either IPC was in flight before
      // publishing the restored object to the live UI; otherwise that callback is merely delayed,
      // not canceled, and can resurrect the state on the next timer turn.
      invalidateQueuedSave()
      const base = withOverride({ ...DEFAULT_SETTINGS, ...loaded }, {})
      useSettings.setState({
        base,
        settings: withOverride(base, useSettings.getState().projectOverrides),
        hydrated: true
      })
      return result
    } catch (e) {
      return {
        ok: false,
        error: `The revision was restored, but the live settings view could not reload it: ${e instanceof Error ? e.message : String(e)}`
      }
    } finally {
      pendingSave = null
      savesSuspended = false
    }
  })

  restoreTail = run
  return run
}
