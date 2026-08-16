import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultScheduledSettingsFile,
  type ScheduledSettingsFile
} from '@shared/scheduled-settings'
import type { ScheduledSettingsSaveResult } from '@shared/types'
import { ScheduledSettingsSaveQueue } from './scheduled-settings-save'

function file(timezone: string): ScheduledSettingsFile {
  return { ...defaultScheduledSettingsFile(), timezone }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ScheduledSettingsSaveQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('releases a rejected in-flight owner and drains the newest pending save', async () => {
    const first = deferred<ScheduledSettingsSaveResult>()
    const save = vi
      .fn<(file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ok: true })
    const results: Array<string | null> = []
    const queue = new ScheduledSettingsSaveQueue(save, 500)

    queue.enqueue(file('UTC'), (error) => results.push(error))
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)

    // This edit arrives while the first IPC promise owns the lane. It must survive that owner's
    // rejection and be armed only after the barrier releases.
    queue.enqueue(file('Europe/London'), (error) => results.push(error))
    first.reject(new Error('bridge dropped'))
    await Promise.resolve()
    await Promise.resolve()
    expect(results).toEqual(['Could not reach the app to save the schedule.'])
    expect(save).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].timezone).toBe('Europe/London')
    expect(results).toEqual(['Could not reach the app to save the schedule.', null])
  })

  it('joins the current owner and publishes the captured pending edit before a barrier resolves', async () => {
    const first = deferred<ScheduledSettingsSaveResult>()
    const second = deferred<ScheduledSettingsSaveResult>()
    const save = vi
      .fn<(file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const queue = new ScheduledSettingsSaveQueue(save, 500)

    queue.enqueue(file('UTC'), () => {})
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)

    queue.enqueue(file('America/Toronto'), () => {})
    const barrier = queue.flushPending()
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].timezone).toBe('America/Toronto')

    let settled = false
    void barrier.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    second.resolve({ ok: true })
    await expect(barrier).resolves.toBeNull()
  })

  it('reports the captured revision failure and keeps the queue available for a later edit', async () => {
    const save = vi
      .fn<(file: ScheduledSettingsFile) => Promise<ScheduledSettingsSaveResult>>()
      .mockResolvedValueOnce({ ok: false, error: 'The owning rule was not saved.' })
      .mockResolvedValueOnce({ ok: true })
    const queue = new ScheduledSettingsSaveQueue(save, 500)

    queue.enqueue(file('UTC'), () => {})
    await expect(queue.flushPending()).resolves.toBe('The owning rule was not saved.')

    queue.enqueue(file('Europe/London'), () => {})
    await expect(queue.flushPending()).resolves.toBeNull()
    expect(save).toHaveBeenCalledTimes(2)
  })
})
