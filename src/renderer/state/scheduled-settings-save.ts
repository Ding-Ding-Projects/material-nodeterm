import type { ScheduledSettingsFile } from '@shared/scheduled-settings'

type SaveResult = { ok: boolean; error?: string }
type Save = (file: ScheduledSettingsFile) => Promise<SaveResult>
type OnSaved = (error: string | null) => void

interface PendingSave {
  file: ScheduledSettingsFile
  onSaved: OnSaved
}

/**
 * One-owner debounced save lane. Edits made while a save is in flight remain pending; completion
 * (success OR failure) releases the owner and arms the newest pending edit. The explicit finally
 * release is the important invariant: a rejected IPC promise must not wedge every later edit.
 */
export class ScheduledSettingsSaveQueue {
  private pendingSave: PendingSave | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false

  constructor(
    private readonly save: Save,
    private readonly coalesceMs: number
  ) {}

  enqueue(file: ScheduledSettingsFile, onSaved: OnSaved): void {
    this.pendingSave = { file, onSaved }
    this.armIfNeeded()
  }

  /** Best-effort last write during unload, matching the ordinary settings store. The core store
   * owns serialization, so a currently in-flight request and this final request cannot reorder on
   * disk even though the page cannot wait for either promise. */
  flushPendingForUnload(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const pending = this.pendingSave
    this.pendingSave = null
    if (pending) void this.save(pending.file).catch(() => {})
  }

  private armIfNeeded(): void {
    if (this.saveTimer || this.inFlight || !this.pendingSave) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flushOne()
    }, this.coalesceMs)
  }

  private flushOne(): void {
    if (this.inFlight || !this.pendingSave) return
    const pending = this.pendingSave
    this.pendingSave = null
    this.inFlight = true
    void this.run(pending)
  }

  private async run(pending: PendingSave): Promise<void> {
    let error: string | null
    try {
      const result = await this.save(pending.file)
      error = result.ok ? null : (result.error ?? 'Could not save the schedule.')
    } catch {
      error = 'Could not reach the app to save the schedule.'
    }

    try {
      pending.onSaved(error)
    } catch {
      // The state subscriber is presentation-only. Its exception must not become an unhandled
      // rejection or prevent the persistence lane from accepting later edits.
    } finally {
      // Release on BOTH outcomes. Keeping this in `finally` also prevents an unexpected rendering
      // callback error from owning the lane forever.
      this.inFlight = false
      this.armIfNeeded()
    }
  }
}
