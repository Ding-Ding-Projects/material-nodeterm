import { promises as fs, readFileSync } from 'fs'
import path from 'path'
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import { renameAtomic, tempNameFor } from './fs-atomic'
import { DEFAULT_ACCENT, DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { normalizeLanguageMode } from '../shared/i18n'
import type { HistoryAction } from '../shared/local-history'

/**
 * Merge a possibly-partial/legacy `Settings` object over `DEFAULT_SETTINGS`. A plain
 * `{ ...DEFAULT_SETTINGS, ...saved }` shallow merge is right for top-level keys (a missing key
 * picks up the default), but WRONG for nested objects: an old `settings.json` that has a
 * `speech` object without a newly-added key (e.g. `shortcut`) would have its whole `speech`
 * object override the default one-for-one, silently dropping the new key. `speech` is merged
 * one level deeper so old files still pick up new nested defaults.
 */
function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...saved }
  merged.speech = { ...DEFAULT_SETTINGS.speech, ...saved?.speech }
  // Windows terminal profiles replaced the old implicit meaning of `defaultShell`. Migrate only
  // when the new key is genuinely ABSENT: an explicit profile id — including a hand-edited or
  // currently unavailable one — must survive byte-for-byte so the trusted resolver can fail
  // closed and the settings UI can explain it. The compatibility path is equally opaque here;
  // never trim or rewrite it, because an absolute Windows executable may contain spaces.
  if (!saved || !Object.prototype.hasOwnProperty.call(saved, 'defaultTerminalProfileId')) {
    merged.defaultTerminalProfileId =
      typeof saved?.defaultShell === 'string' && saved.defaultShell.length > 0 ? 'custom' : 'auto'
  }
  // `shortcuts` is a nested map seeded from DEFAULT_SHORTCUTS. Merge one level deep so an old
  // settings.json that predates a newly-added action still picks up its shipped default, exactly
  // like `speech`. A missing map on old files falls back to the full default map.
  merged.shortcuts = { ...DEFAULT_SETTINGS.shortcuts, ...saved?.shortcuts }
  // Legacy `terminalGpuRendering` was a boolean whose default (true) was merged into every saved
  // file — so a stored `true` is indistinguishable from "never touched" and maps to the new
  // 'auto' (platform-aware) default, while a stored `false` was always an explicit escape-hatch
  // choice and stays 'off'. See the field's doc in shared/types.ts.
  //
  // Every value that is not one of the four known modes ('auto' | 'on' | 'off' | 'shared')
  // normalizes to the DEFAULT: settings.json is hand-editable, and an unrecognised mode must not
  // be handed to the renderer's resolver to interpret.
  const gpu = (saved as { terminalGpuRendering?: unknown } | null | undefined)
    ?.terminalGpuRendering
  if (gpu === false) merged.terminalGpuRendering = 'off'
  else if (gpu !== 'on' && gpu !== 'off' && gpu !== 'auto' && gpu !== 'shared')
    merged.terminalGpuRendering = 'auto'
  // The JSON is hand-editable. A TypeScript `LanguageMode` annotation cannot stop a garbage
  // runtime string from reaching the renderer, where the previously-exhaustive switch then
  // returned `undefined` and took whole localized surfaces down. Normalize both load and save
  // through this merge so Desktop and Server Edition persist the same safe English fallback.
  merged.languageMode = normalizeLanguageMode(saved?.languageMode)
  // The M3-baseline re-seed (2026-08) changed the shipped default accent from systemBlue
  // (`#0a84ff`) to the design's seed purple (`DEFAULT_ACCENT`, `#6750a4`). `{ ...DEFAULT_SETTINGS,
  // ...saved }` above already carries the NEW default forward for an install with no `accent` key
  // at all — but every EXISTING install has `#0a84ff` written into its settings.json byte-for-byte
  // (the app always persists the full object, including untouched defaults), which is
  // indistinguishable from a user who deliberately picked systemBlue on purpose. Same ambiguity,
  // same resolution, as the `terminalGpuRendering` migration just above: treat the old literal
  // default as "never touched" and carry it forward to the new one. A user who really did want
  // systemBlue loses that choice once, and can re-pick it from the swatch row (still shipped,
  // still reachable — see ColorPicker.tsx's QUICK_SWATCHES) after this one-time migration.
  if (saved?.accent === '#0a84ff') merged.accent = DEFAULT_ACCENT
  // These were the old shipped canvas defaults and were persisted even when untouched. Carry
  // existing installs to the mouse-first interaction: wheel rotation zooms and dragging empty
  // canvas pans. Both remain ordinary Settings controls after this one-time default migration.
  if (saved?.wheelZoom === false && saved?.canvasDragMode === 'select') {
    merged.wheelZoom = true
    merged.canvasDragMode = 'pan'
  }
  return merged
}

/**
 * Stores user settings in settings.json. Keeps a synchronous cache so the PtyManager
 * can read shell/tmux preferences immediately at terminal creation.
 */
export class SettingsStore {
  private cache: Settings = DEFAULT_SETTINGS
  private listeners = new Set<(s: Settings) => void>()
  /** In-flight save chain: saves run FIFO (same idiom as WorkspaceStore.saveChain). The handler
   *  has overlapping callers in both builds (the renderer's coalesced timer save, the
   *  `beforeunload` flush, concurrent WS frames on the Server Edition); unordered, the last RENAME
   *  wins the disk while the last CALL wins the cache — and they can disagree until next boot.
   *  Each caller still sees only ITS OWN save's failure. */
  private saveChain: Promise<unknown> = Promise.resolve()
  /** Local, git-backed version history hook (see core/local-history.ts, wired in
   *  src/main/index.ts / src/server/handlers/index.ts). Optional so this store keeps working —
   *  identically to before this feature existed — when no recorder is wired (e.g. in tests). Never
   *  allowed to fail a save: see the try/catch around every call site below. */
  private historyRecorder?: (
    before: Settings,
    after: Settings,
    override?: { action: HistoryAction; label: string }
  ) => void | Promise<void>

  private get filePath(): string {
    return path.join(platform().userDataDir, 'settings.json')
  }

  /** Subscribe to saves (fires after each successful `settings:save`). Additive; used by the
   *  desktop shell to create/destroy runtime-toggled subsystems (e.g. the Notch HUD). Returns an
   *  unsubscribe. Never throws into a save. */
  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Wire a local-history recorder. Called once at boot (both shells) — see
   *  local-history-handlers.ts's restore hook, which is the OTHER half of this: a restore calls
   *  `applyRestoredSettings`, which reaches `saveNow` with an explicit override so the new
   *  revision is labelled "Restored…" instead of running back through the generic diff. */
  setHistoryRecorder(
    fn: (
      before: Settings,
      after: Settings,
      override?: { action: HistoryAction; label: string }
    ) => void | Promise<void>
  ): void {
    this.historyRecorder = fn
  }

  /** Apply a restored settings object as a NEW save (never a history rewrite — see
   *  core/local-history.ts's append-only rule). `label` is normally "Restored settings to
   *  <shortsha>"; the action is always 'restored' regardless of what the generic diff would have
   *  said, so the history's own action filter can find restores as their own category. */
  async applyRestoredSettings(settings: Settings, label: string): Promise<void> {
    const run = this.saveChain.then(() => this.saveNow(settings, { action: 'restored', label }))
    this.saveChain = run.catch(() => {})
    return run
  }

  /** Load synchronously into cache (call after app is ready). */
  init(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      this.cache = mergeSettings(JSON.parse(raw))
    } catch {
      this.cache = DEFAULT_SETTINGS
    }
  }

  get(): Settings {
    return this.cache
  }

  registerIpc(): void {
    platform().handle(IPC.settingsLoad, () => this.cache)
    platform().handle(IPC.settingsSave, (settings: Settings) => {
      const run = this.saveChain.then(() => this.saveNow(settings))
      this.saveChain = run.catch(() => {})
      return run
    })
  }

  private async saveNow(
    settings: Settings,
    historyOverride?: { action: HistoryAction; label: string }
  ): Promise<void> {
    {
      const before = this.cache
      this.cache = mergeSettings(settings)
      // Atomic write (temp + rename) so a mid-write crash can't corrupt settings.json. The temp
      // name is unique per call because nothing serializes this handler and its callers overlap:
      // on the desktop the renderer's coalesced timer save, the `beforeunload` flush that fires
      // outside that window, and any still-in-flight earlier save are all fire-and-forget
      // (src/renderer/state/settings.ts); on the Server Edition every WS frame is dispatched
      // concurrently (src/server/ws.ts), so even one browser tab can have two saves in the air.
      // With a shared name, one writer's rename publishes the other's half-written bytes, or moves
      // the file out from under it entirely. `tempNameFor` also keeps two
      // `nodeterm-server --data-dir X` processes sharing one data dir from choosing the same
      // staging path.
      const tmp = tempNameFor(this.filePath)
      try {
        // 0600 at open(2), before any bytes land, and the rename carries it onto settings.json.
        // Every writer in this family creates its staging file owner-only; this one used to be
        // the outlier, which is exactly what CodeQL's js/insecure-temporary-file was pointing at.
        await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), { encoding: 'utf-8', mode: 0o600 })
        // Retries briefly on Windows if the destination is momentarily held open (AV/indexer/sync) — see fs-atomic.ts.
        await renameAtomic(tmp, this.filePath)
      } catch (e) {
        // A unique name never self-heals the way the fixed one did (the next save just reused it),
        // so a failed write has to remove its own temp. The error still propagates, so a failed
        // save stays a failed save — and the listeners below still only run on success. There is
        // deliberately no sweep of orphans from killed processes as provider-cookie does: an
        // orphaned settings temp is config litter, not a live credential.
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
      for (const cb of this.listeners) {
        try {
          cb(this.cache)
        } catch {
          // A listener must never break a settings save (or its siblings).
        }
      }
      // Rule 1 from local-history.ts's header: a history write must never fail the save itself.
      // The recorder function is ALSO wrapped internally (LocalHistoryStore.record never throws),
      // but this catch covers a bad recorder implementation too — belt and braces around the one
      // guarantee this feature is not allowed to break.
      try {
        await this.historyRecorder?.(before, this.cache, historyOverride)
      } catch {
        // See above.
      }
    }
  }
}
