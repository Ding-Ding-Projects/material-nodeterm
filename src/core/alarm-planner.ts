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
