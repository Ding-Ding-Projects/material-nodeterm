import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'
import { setHomeAssistantToken } from './scheduled-settings-secrets'

describe('scheduled-settings credential clear', () => {
  let dir: string
  let rawFile: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-scheduled-secret-'))
    resetPlatformForTests()
    initPlatform(fakePlatform({ userDataDir: dir }))
    rawFile = path.join(dir, 'scheduled-settings-secrets', 'same-rule.bin')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    resetPlatformForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('removes the canonical token but reports a retained credential temp as incomplete', async () => {
    await setHomeAssistantToken('same-rule', 'canonical-secret')
    const crashTemp = `${rawFile}.${process.pid + 1}.7.crash-copy.tmp`
    await fs.writeFile(crashTemp, 'credential-copy', { mode: 0o600 })

    await expect(setHomeAssistantToken('same-rule', null)).rejects.toMatchObject({
      code: 'clear-incomplete'
    })

    expect(existsSync(rawFile)).toBe(false)
    expect(await fs.readFile(crashTemp, 'utf8')).toBe('credential-copy')
  })
})
