import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OPEN_WEBUI_IMAGE, type OpenWebUiLocalBinding } from '../shared/open-webui-hosting'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeAllListeners: vi.fn() } }))

import { OpenWebUiStore } from './open-webui-hosting'

describe('OpenWebUiStore persistence', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nt-open-webui-store-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('continues saving after one rejected publication', async () => {
    const blockedUserDataDir = join(dir, 'user-data')
    await writeFile(blockedUserDataDir, 'not a directory')
    const store = new OpenWebUiStore(blockedUserDataDir)
    const binding: OpenWebUiLocalBinding = {
      context: 'default',
      containerName: 'open-webui',
      volumeName: 'open-webui-data',
      endpoint: 'http://127.0.0.1:3000',
      image: OPEN_WEBUI_IMAGE,
      updatedAt: 1
    }

    await expect(store.set('node-one', binding)).rejects.toThrow()

    await rm(blockedUserDataDir)
    await store.set('node-two', binding)
    const saved = JSON.parse(await readFile(join(blockedUserDataDir, 'open-webui-bindings.json'), 'utf8'))
    expect(saved.bindings['node-two']).toMatchObject({ containerName: 'open-webui' })
  })
})
