import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import os from 'os'
import path from 'path'

import { IPC } from '../shared/ipc'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'
import { ScheduledSettingsRuntime } from './scheduled-settings-runtime'

describe('Desktop + Server scheduled-settings runtime startup', () => {
  let userData: string
  let filePath: string
  let shell: FakePlatform
  let runtime: ScheduledSettingsRuntime | null

  beforeEach(async () => {
    userData = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'nt-scheduled-runtime-'))
    filePath = path.join(userData, 'scheduled-settings.json')
    resetPlatformForTests()
    shell = fakePlatform({ userDataDir: userData })
    initPlatform(shell)
    runtime = null
  })

  afterEach(async () => {
    await runtime?.stop()
    vi.restoreAllMocks()
    resetPlatformForTests()
    await fsPromises.rm(userData, { recursive: true, force: true })
  })

  it.each(['EACCES', 'EIO'] as const)('keeps shell boot alive and publishes a distinct %s read failure', (code) => {
    const realRead = fs.readFileSync.bind(fs)
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (path.resolve(String(target)) === path.resolve(filePath)) {
        throw Object.assign(new Error(`synthetic ${code}`), { code })
      }
      return realRead(target, options as never)
    }) as typeof fs.readFileSync)

    runtime = new ScheduledSettingsRuntime()
    expect(() => runtime!.start()).not.toThrow()
    expect(runtime.store.get().rules).toEqual([])
    expect(shell.handlers[IPC.scheduledSettingsLoad]()).toMatchObject({
      ok: false,
      file: { rules: [] },
      error: { kind: 'unreadable', code, path: filePath }
    })
  })

  it('registers a successful ENOENT load as normal absence, not a recovery warning', () => {
    runtime = new ScheduledSettingsRuntime()
    expect(runtime.start()).toMatchObject({ ok: true, file: { rules: [] }, error: null })
    expect(shell.handlers[IPC.scheduledSettingsLoad]()).toMatchObject({
      ok: true,
      file: { rules: [] },
      error: null
    })
  })
})
