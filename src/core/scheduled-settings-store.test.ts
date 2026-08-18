import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'
import { ScheduledSettingsStore } from './scheduled-settings-store'
import {
  SCHEDULE_LIMITS,
  defaultScheduledSettingsFile,
  newScheduleRule,
  type ScheduleRule,
  type ScheduledSettingsFile
} from '../shared/scheduled-settings'

const RULE_ID = '18d73e9b-2af4-481e-91bf-443d44c8e569'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function validFile(): ScheduledSettingsFile {
  return {
    ...defaultScheduledSettingsFile(),
    timezone: 'UTC',
    rules: [newScheduleRule(RULE_ID)]
  }
}

describe('ScheduledSettingsStore', () => {
  let userData: string
  let filePath: string

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-scheduled-store-'))
    filePath = path.join(userData, 'scheduled-settings.json')
    resetPlatformForTests()
    initPlatform(fakePlatform({ userDataDir: userData }))
  })

  afterEach(async () => {
    resetPlatformForTests()
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('treats only ENOENT as a normal empty schedule and permits its first save', async () => {
    const absent = new ScheduledSettingsStore()
    expect(absent.init()).toMatchObject({ ok: true, file: { rules: [] }, error: null })
    expect(await absent.save(validFile())).toEqual({ ok: true })
  })

  it('keeps corrupt JSON as recovery evidence, disables every rule, and refuses overwrite', async () => {
    const original = '{broken json'
    await fs.writeFile(filePath, original, 'utf8')
    const store = new ScheduledSettingsStore()
    let listenerCalls = 0
    store.onChange(() => {
      listenerCalls += 1
    })

    expect(store.init()).toMatchObject({
      ok: false,
      file: { rules: [] },
      error: { kind: 'corrupt', path: filePath }
    })
    expect(store.get().rules).toEqual([])
    const lockedResult = await store.save(validFile())
    expect(lockedResult.ok).toBe(false)
    expect(lockedResult).not.toHaveProperty('persisted')
    expect(lockedResult).not.toHaveProperty('warning')
    expect(listenerCalls).toBe(0)
    expect(await fs.readFile(filePath, 'utf8')).toBe(original)
  })

  it('keeps a directory-at-path as unreadable evidence instead of aborting startup', async () => {
    await fs.mkdir(filePath)
    const store = new ScheduledSettingsStore()

    expect(store.init()).toMatchObject({
      ok: false,
      file: { rules: [] },
      error: { kind: 'unreadable', path: filePath }
    })
    expect((await fs.stat(filePath)).isDirectory()).toBe(true)
    expect((await store.save(validFile())).ok).toBe(false)
    expect((await fs.stat(filePath)).isDirectory()).toBe(true)
  })

  it('loads malformed external rules disabled instead of converting them into active local rules', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        timezone: 'UTC',
        rules: [{ ...newScheduleRule(RULE_ID), source: { kind: 'api' }, enabled: 'yes' }]
      }),
      'utf8'
    )

    const store = new ScheduledSettingsStore()
    store.init()
    expect(store.get().rules[0]).toMatchObject({ enabled: false, source: { kind: 'api', url: '' } })
  })

  it('awaits every post-save listener and distinctly reports cleanup failure after durable publication', async () => {
    const store = new ScheduledSettingsStore()
    const listenerStarted = deferred<void>()
    const releaseListener = deferred<void>()
    const events: string[] = []
    store.onChange(async () => {
      events.push('cleanup-started')
      listenerStarted.resolve(undefined)
      await releaseListener.promise
      events.push('cleanup-failed')
      throw new Error('simulated credential cleanup failure')
    })
    store.onChange(async () => {
      events.push('sibling-finished')
    })

    let settled = false
    const saving = store.save(validFile()).then((result) => {
      settled = true
      return result
    })
    await listenerStarted.promise

    expect(settled).toBe(false)
    expect(events).toEqual(['cleanup-started'])
    releaseListener.resolve(undefined)

    await expect(saving).resolves.toEqual({
      ok: false,
      persisted: true,
      warning: 'credential-cleanup-incomplete',
      error: 'The schedule was saved, but related credentials could not be fully cleared.'
    })
    expect(events).toEqual(['cleanup-started', 'cleanup-failed', 'sibling-finished'])
    expect(store.get().rules.map((rule) => rule.id)).toEqual([RULE_ID])
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).rules.map((rule: ScheduleRule) => rule.id)).toEqual([
      RULE_ID
    ])
  })

  it('serializes later saves behind the complete listener phase of the prior save', async () => {
    const store = new ScheduledSettingsStore()
    const firstListenerStarted = deferred<void>()
    const releaseFirstListener = deferred<void>()
    const observedLabels: string[] = []
    store.onChange(async (file) => {
      const label = file.rules[0]?.label ?? ''
      observedLabels.push(label)
      if (label === 'first') {
        firstListenerStarted.resolve(undefined)
        await releaseFirstListener.promise
      }
    })
    const first = validFile()
    first.rules[0].label = 'first'
    const second = validFile()
    second.rules[0].label = 'second'

    const firstSave = store.save(first)
    await firstListenerStarted.promise
    const secondSave = store.save(second)

    expect(store.get().rules[0]?.label).toBe('first')
    expect(observedLabels).toEqual(['first'])
    releaseFirstListener.resolve(undefined)

    await expect(firstSave).resolves.toEqual({ ok: true })
    await expect(secondSave).resolves.toEqual({ ok: true })
    expect(observedLabels).toEqual(['first', 'second'])
    expect(store.get().rules[0]?.label).toBe('second')
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).rules[0].label).toBe('second')
  })

  it('recovers the save queue after a post-publication cleanup failure', async () => {
    const store = new ScheduledSettingsStore()
    const previousLabels: string[] = []
    let listenerCalls = 0
    store.onChange((_file, previous) => {
      listenerCalls += 1
      previousLabels.push(previous.rules[0]?.label ?? 'empty')
      if (listenerCalls === 1) throw new Error('simulated first cleanup failure')
    })
    const first = validFile()
    first.rules[0].label = 'published-first'
    const second = validFile()
    second.rules[0].label = 'published-second'

    await expect(store.save(first)).resolves.toMatchObject({
      ok: false,
      persisted: true,
      warning: 'credential-cleanup-incomplete',
      error: 'The schedule was saved, but related credentials could not be fully cleared.'
    })
    await expect(store.save(second)).resolves.toEqual({ ok: true })

    expect(previousLabels).toEqual(['empty', 'published-first'])
    expect(store.get().rules[0]?.label).toBe('published-second')
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).rules[0].label).toBe('published-second')
  })

  it('does not mark a disk-write failure as persisted or attach a cleanup warning', async () => {
    const store = new ScheduledSettingsStore()
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })

    const result = await store.save(validFile())

    expect(result).toEqual({ ok: false, error: 'Could not write the schedule to disk.' })
    expect(result).not.toHaveProperty('persisted')
    expect(result).not.toHaveProperty('warning')
    expect(store.get().rules).toEqual([])
  })

  it.each([
    [
      'too many rules',
      () => ({
        ...validFile(),
        rules: Array.from({ length: SCHEDULE_LIMITS.maxRules + 1 }, (_, index) =>
          newScheduleRule(`${RULE_ID}-${index}`)
        )
      })
    ],
    [
      'an over-limit label',
      () => {
        const file = validFile()
        file.rules[0].label = 'x'.repeat(SCHEDULE_LIMITS.maxLabelLength + 1)
        return file
      }
    ],
    [
      'a non-boolean enabled value',
      () => {
        const file = validFile() as unknown as { rules: Array<Record<string, unknown>> }
        file.rules[0].enabled = 'false'
        return file as unknown as ScheduledSettingsFile
      }
    ],
    [
      'a malformed external source',
      () => {
        const file = validFile() as unknown as { rules: Array<Record<string, unknown>> }
        file.rules[0].source = { kind: 'api' }
        return file as unknown as ScheduledSettingsFile
      }
    ]
  ])('rejects %s without changing cache or disk', async (_label, invalidFile) => {
    const store = new ScheduledSettingsStore()
    expect(await store.save(validFile())).toEqual({ ok: true })
    const cacheBefore = store.get()
    const bytesBefore = await fs.readFile(filePath, 'utf8')

    const result = await store.save(invalidFile())

    expect(result.ok).toBe(false)
    expect(store.get()).toBe(cacheBefore)
    expect(await fs.readFile(filePath, 'utf8')).toBe(bytesBefore)
  })
})
