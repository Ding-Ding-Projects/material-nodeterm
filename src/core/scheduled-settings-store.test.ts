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
  type ScheduledSettingsFile
} from '../shared/scheduled-settings'

const RULE_ID = '18d73e9b-2af4-481e-91bf-443d44c8e569'

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
    await fs.rm(userData, { recursive: true, force: true })
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

    expect(store.init()).toMatchObject({
      ok: false,
      file: { rules: [] },
      error: { kind: 'corrupt', path: filePath }
    })
    expect(store.get().rules).toEqual([])
    expect((await store.save(validFile())).ok).toBe(false)
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
