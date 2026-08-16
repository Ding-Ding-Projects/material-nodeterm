import { ScheduledSettingsService } from './scheduled-settings-service'
import { ScheduledSettingsStore } from './scheduled-settings-store'
import type { ScheduledSettingsLoadState } from '../shared/scheduled-settings'

/**
 * The single scheduled-settings boot boundary used by BOTH the Desktop and Server shells.
 * Keeping load + IPC registration + evaluator start in one object prevents one shell from
 * accidentally keeping the old fatal-read behavior while the other boots into recovery mode.
 */
export class ScheduledSettingsRuntime {
  readonly store: ScheduledSettingsStore
  readonly service: ScheduledSettingsService
  private started = false
  private registered = false

  constructor(store = new ScheduledSettingsStore(), service?: ScheduledSettingsService) {
    this.store = store
    this.service = service ?? new ScheduledSettingsService(store)
  }

  start(): ScheduledSettingsLoadState {
    if (this.started) return this.store.loadState()
    const state = this.store.init()
    if (!this.registered) {
      this.store.registerIpc()
      this.registered = true
    }
    this.service.start()
    this.started = true
    return state
  }

  stop(): void {
    if (!this.started) return
    this.service.stop()
    this.started = false
  }
}
