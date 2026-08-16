import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultScheduledSettingsFile,
  type ScheduledSettingsFile
} from '@shared/scheduled-settings'
import { ScheduledSettingsSaveQueue } from './scheduled-settings-save'

function file(timezone: string): ScheduledSettingsFile {
  return { ...defaultScheduledSettingsFile(), timezone }
}

describe('ScheduledSettingsSaveQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('releases a rejected in-flight owner and drains the newest pending save', async () => {
    let rejectFirst!: (reason: Error) => void
    const first = new Promise<{ ok: boolean }>((_resolve, reject) => {
      rejectFirst = reject
    })
    const save = vi
      .fn<(file: ScheduledSettingsFile) => Promise<{ ok: boolean; error?: string }>>()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ ok: true })
    const results: Array<string | null> = []
    const queue = new ScheduledSettingsSaveQueue(save, 500)

    queue.enqueue(file('UTC'), (error) => results.push(error))
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)

    // This edit arrives while the first IPC promise owns the lane. It must survive that owner's
    // rejection and be armed only after the barrier releases.
    queue.enqueue(file('Europe/London'), (error) => results.push(error))
    rejectFirst(new Error('bridge dropped'))
    await Promise.resolve()
    await Promise.resolve()
    expect(results).toEqual(['Could not reach the app to save the schedule.'])
    expect(save).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].timezone).toBe('Europe/London')
    expect(results).toEqual(['Could not reach the app to save the schedule.', null])
  })
})
