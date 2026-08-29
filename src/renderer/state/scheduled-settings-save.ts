import type { ScheduledSettingsFile } from '@shared/scheduled-settings'
import type { ScheduledSettingsSaveResult } from '@shared/types'

type Save = (file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult>
type OnSaved = (error: string | null) => void

interface PendingSave {
  file: ScheduledSettingsFile
  onSaved: OnSaved
  revision: number
}

/**
 * One-owner debounced save lane. Edits made while a save is in flight remain pending; completion
 * (success OR failure) releases the owner and arms the newest pending edit. The explicit finally
 * release is the important invariant: a rejected IPC promise must not wedge every later edit.
 */
export class ScheduledSettingsSaveQueue {
  private pendingSave: PendingSave | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private nextRevision = 0
  private settledRevision = 0
  private settledError: string | null = null
  private lastAttempt: PendingSave | null = null

  constructor(
    private readonly save: Save,
    private readonly coalesceMs: number
  ) {}

  enqueue(file: ScheduledSettingsFile, onSaved: OnSaved): void {
    this.pendingSave = { file, onSaved, revision: ++this.nextRevision }
    this.armIfNeeded()
  }

  /** Persist every edit that existed when this barrier began, without allowing an immediate
   * credential mutation to overtake its owning rule. A newer whole-file edit may supersede the
   * captured revision while an older request is in flight; saving that newer revision also
   * satisfies the captured barrier. */
  async flushPending(): Promise<string | null> {
    let targetRevision = this.nextRevision
    if (targetRevision === 0) return null

    // A disk failure retains the complete latest file. A later credential-Save click explicitly
    // retries that same revision rather than remaining blocked forever or proceeding without proof.
    if (
      this.settledRevision >= targetRevision &&
      this.settledError &&
      this.lastAttempt &&
      !this.pendingSave &&
      !this.inFlight
    ) {
      this.pendingSave = { ...this.lastAttempt, revision: ++this.nextRevision }
      targetRevision = this.nextRevision
    }

    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null

    while (this.settledRevision < targetRevision) {
      const owner = this.inFlight ?? this.flushOne()
      if (!owner) break
      await owner

      // A pending revision captured behind the previous owner must cross the barrier immediately,
      // not after another debounce interval. This is still one owner: flushOne refuses overlap.
      if (this.settledRevision < targetRevision && this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
    }

    return this.settledRevision >= targetRevision
      ? this.settledError
      : 'Could not save the schedule.'
  }

  /** Best-effort last write during unload, matching the ordinary settings store. The core store
   * owns serialization, so a currently in-flight request and this final request cannot reorder on
   * disk even though the page cannot wait for either promise. */
  flushPendingForUnload(): void {
    // Join the published owner instead of directly firing a newer request that could overtake its
    // deferred bridge call. beforeunload is best-effort, but invocation order is still exact.
    void this.flushPending().catch(() => {})
  }

  /** Recovery hydration must fence a safe-default edit that was queued before the shell reported
   * preserved unreadable/corrupt evidence. Core also rejects writes, but the renderer must not send
   * a stale mutation after it knows editing is locked. */
  cancelPending(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.pendingSave = null
  }

  private armIfNeeded(): void {
    if (this.saveTimer || this.inFlight || !this.pendingSave) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flushOne()
    }, this.coalesceMs)
  }

  private flushOne(): Promise<void> | null {
    if (this.inFlight || !this.pendingSave) return this.inFlight
    const pending = this.pendingSave
    this.pendingSave = null
    // Start on the next microtask so even an incorrectly synchronous bridge throw cannot finish
    // run() before this owner promise is published.
    const run = Promise.resolve().then(() => this.run(pending))
    this.inFlight = run
    return run
  }

  private async run(pending: PendingSave): Promise<void> {
    let displayError: string | null
    let persistenceError: string | null
    this.lastAttempt = pending
    try {
      const result = await this.save(pending.file)
      displayError = result.ok ? null : (result.error ?? 'Could not save the schedule.')
      const persistedWarning =
        result.persisted === true && result.warning === 'credential-cleanup-incomplete'
      persistenceError = result.ok || persistedWarning ? null : displayError
    } catch {
      displayError = 'Could not reach the app to save the schedule.'
      persistenceError = displayError
    }

    try {
      pending.onSaved(displayError)
    } catch {
      // The state subscriber is presentation-only. Its exception must not become an unhandled
      // rejection or prevent the persistence lane from accepting later edits.
    } finally {
      this.settledRevision = pending.revision
      this.settledError = persistenceError
      // Release on BOTH outcomes. Keeping this in `finally` also prevents an unexpected rendering
      // callback error from owning the lane forever.
      this.inFlight = null
      this.armIfNeeded()
    }
  }
}
