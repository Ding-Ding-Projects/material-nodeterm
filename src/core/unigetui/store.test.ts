import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UniGetUiUniverseStore } from './store'

describe('UniGetUiUniverseStore persistence', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nt-unigetui-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('continues saving after one rejected publication', async () => {
    const blockedUserDataDir = join(dir, 'user-data')
    await writeFile(blockedUserDataDir, 'not a directory')
    const store = new UniGetUiUniverseStore(blockedUserDataDir)

    await expect(store.save({ schemaVersion: 1, selectedPage: 'installed', search: 'first', regexEnabled: false, regexPattern: '', regexFlags: '', updatedAt: 0 })).rejects.toThrow()

    await rm(blockedUserDataDir)
    await store.save({ schemaVersion: 1, selectedPage: 'updates', search: 'second', regexEnabled: true, regexPattern: 'pkg', regexFlags: 'i', updatedAt: 0 })
    const saved = JSON.parse(await readFile(join(blockedUserDataDir, 'unigetui-global-universe.json'), 'utf8'))
    expect(saved.selectedPage).toBe('updates')
    expect(saved.search).toBe('second')
  })
})
