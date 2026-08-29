// These stores used `<target>.<pid>.<Date.now()>.tmp`. Two saves started in the same millisecond
// therefore shared one path even though the name looked unique. Freeze the clock and observe the
// temp paths at the filesystem seam: concurrent stores park both renames, while FIFO stores expose
// the two writes sequentially. This is behavior, not an assertion over source text.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

import { fakePlatform } from './platform-fake'
import { initPlatform, resetPlatformForTests } from './platform'
import { AtomicJsonArrayStore } from './atomic-json-store'
import { SecureStore } from './secure-store'
import { setHomeAssistantToken } from './scheduled-settings-secrets'
import { persistFile as persistModeCredential } from './shared-mode-credential'
import { OllamaChatStore } from './ollama/chat-store'
import type { OllamaClient } from './ollama/client'

let dir = ''
const SCHEDULE_RULE_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-atomic-secrets-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
})

afterEach(async () => {
  vi.restoreAllMocks()
  resetPlatformForTests()
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

async function expectDistinctTempWrites(start: () => [Promise<unknown>, Promise<unknown>]): Promise<void> {
  const seen: string[] = []
  let observed!: () => void
  let release!: () => void
  const bothObserved = new Promise<void>((resolve) => { observed = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  const realRename = fs.rename
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    seen.push(String(from))
    if (seen.length === 2) observed()
    await released
    return realRename(from, to)
  })

  const writes = start()
  let assertionError: unknown
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      bothObserved,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('two temp writes were not observed')), 2_000)
      })
    ])
    expect(new Set(seen).size, `both writers selected ${seen.join(' and ')}`).toBe(2)
    expect(seen.every((temp) => temp.includes(`.${process.pid}.`))).toBe(true)
  } catch (error) {
    assertionError = error
  } finally {
    if (timeout) clearTimeout(timeout)
    release()
  }
  const settled = await Promise.allSettled(writes)
  if (assertionError) throw assertionError
  expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
}

/** Stores with a FIFO deliberately never have two renames in flight at once. Observe their temp
 *  writes sequentially instead: the paths still need to differ, because a second process or a
 *  crash-retry can outlive this process-local ordering. */
async function expectDistinctSerializedTempWrites(
  start: () => [Promise<unknown>, Promise<unknown>]
): Promise<void> {
  const seen: string[] = []
  const realWriteFile = fs.writeFile
  const spy = vi.spyOn(fs, 'writeFile').mockImplementation((async (p: any, ...rest: any[]) => {
    // SQLite's sidecar and journal are lock evidence rather than credential publication temps.
    if (String(p).endsWith('.tmp')) seen.push(String(p))
    return (realWriteFile as any)(p, ...rest)
  }) as any)
  let settled: PromiseSettledResult<unknown>[]
  try {
    settled = await Promise.allSettled(start())
  } finally {
    spy.mockRestore()
  }
  expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
  expect(seen).toHaveLength(2)
  expect(new Set(seen).size, `both writers selected ${seen.join(' and ')}`).toBe(2)
  expect(seen.every((temp) => temp.includes(`.${process.pid}.`))).toBe(true)
}

describe('secret stores separate same-millisecond writers', () => {
  it('SecureStore gives overlapping saves different temp files', async () => {
    const store = new SecureStore<{ id: string }>('sealed-list.json')
    await expectDistinctSerializedTempWrites(() => [
      store.save([{ meta: { id: '00000000-0000-4000-8000-000000000001' }, secretEnc: 'A' }]),
      store.save([{ meta: { id: '00000000-0000-4000-8000-000000000002' }, secretEnc: 'B' }])
    ])
  })

  it('scheduled-settings secrets give overlapping token saves different temp files', async () => {
    await expectDistinctSerializedTempWrites(() => [
      setHomeAssistantToken(SCHEDULE_RULE_ID, 'first'),
      setHomeAssistantToken(SCHEDULE_RULE_ID, 'second')
    ])
  })

  it('shared mode credentials give overlapping persistence calls different temp files', async () => {
    const target = path.join(dir, 'mode.credential.json')
    await expectDistinctSerializedTempWrites(() => [
      persistModeCredential(target, 'first'),
      persistModeCredential(target, 'second')
    ])
  })

  it('generic atomic JSON stores give separate instances different temp files', async () => {
    const target = path.join(dir, 'queue.json')
    const first = new AtomicJsonArrayStore<string>(target)
    const second = new AtomicJsonArrayStore<string>(target)
    await expectDistinctTempWrites(() => [first.save(['first']), second.save(['second'])])
  })

  it('Ollama chat stores give overlapping writes to one session different temp files', async () => {
    const first = new OllamaChatStore(dir, {} as OllamaClient, () => {})
    const second = new OllamaChatStore(dir, {} as OllamaClient, () => {})
    const session = await first.create('test-model')
    await expectDistinctTempWrites(() => [
      first.rename(session.id, 'first'),
      second.rename(session.id, 'second')
    ])
  })
})
