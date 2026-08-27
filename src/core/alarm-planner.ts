/** Durable host-side Alarm Clock planner.
 *
 * The renderer node is useful when a canvas is open. This service keeps the same alarm state alive
 * across renderer reloads and app restarts, using only local JSON and the shared planner's bounded
 * transition logic. It intentionally has no power-management or remote-wake capability.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { renameAtomic, writeFileAtomic } from './fs-atomic'
import { DurableAlarmPlanner, type AlarmPlannerSnapshot, type AlarmPlannerStore, type AlarmPlannerOptions } from '../shared/alarm-clock'
import { IPC } from '../shared/ipc'
import { platform } from './platform'

export class FileAlarmPlannerStore implements AlarmPlannerStore {
  constructor(private readonly file: string) {}

  async load(): Promise<AlarmPlannerSnapshot | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { alarms?: unknown }).alarms) || !Array.isArray((value as { history?: unknown }).history)) return null
      return value as AlarmPlannerSnapshot
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        try { await renameAtomic(this.file, `${this.file}.corrupt-${Date.now()}`) } catch { /* preserve the live planner path */ }
      }
      return null
    }
  }

  async save(snapshot: AlarmPlannerSnapshot): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(snapshot))
  }
}

export function createFileAlarmPlanner(file: string, options: Omit<AlarmPlannerOptions, 'store'> = {}): DurableAlarmPlanner {
  return new DurableAlarmPlanner({ ...options, store: new FileAlarmPlannerStore(file) })
}

/** Owns the host-process lifecycle for the durable alarm planner.
 *
 * Keeping this wrapper in core makes Desktop and Server Edition consume the same file-backed
 * planner. Renderer nodes remain the portable source of safe alarm intent, while this runtime is
 * the machine-local clock that can continue evaluating an already-synchronised snapshot after the
 * renderer closes. It deliberately exposes no wake-from-power-off claim or machine scheduler.
 */
export class AlarmPlannerRuntime {
  readonly planner: DurableAlarmPlanner
  private started = false
  private registered = false

  constructor(file: string, options: Omit<AlarmPlannerOptions, 'store'> = {}) {
    const notify = options.onDue
    this.planner = createFileAlarmPlanner(file, {
      ...options,
      onDue: async (event) => {
        platform().broadcast(IPC.alarmPlannerDue, event)
        await notify?.(event)
      }
    })
  }

  async start(): Promise<AlarmPlannerSnapshot> {
    if (!this.registered) {
      this.registerIpc()
      this.registered = true
    }
    if (!this.started) {
      await this.planner.start()
      this.started = true
    }
    return this.planner.state
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.planner.stop()
  }

  private registerIpc(): void {
    platform().handle(IPC.alarmPlannerState, () => this.planner.state)
    platform().handle(IPC.alarmPlannerUpsert, async (input) => {
      await this.planner.upsert(input)
      return this.planner.state
    })
    platform().handle(IPC.alarmPlannerRemove, (alarmId: string) => this.planner.remove(alarmId))
    platform().handle(IPC.alarmPlannerSnooze, async (occurrenceId: string, minutes: number) => {
      await this.planner.snooze(occurrenceId, minutes)
      return this.planner.state
    })
    platform().handle(IPC.alarmPlannerDismiss, async (occurrenceId: string) => {
      await this.planner.dismiss(occurrenceId)
      return this.planner.state
    })
  }
}
