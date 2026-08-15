// These stores used `<target>.<pid>.<Date.now()>.tmp`. Two saves started in the same millisecond
// therefore shared one path even though the name looked unique. Freeze the clock, pause both calls
// at their actual rename boundary, and observe the temp paths they chose before allowing either
// publication to continue. This is behavior at the filesystem seam, not an assertion over source
// text.

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

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-atomic-secrets-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
})

afterEach(async () => {
  vi.restoreAllMocks()
  resetPlatformForTests()
  await fs.rm(dir, { recursive: true, force: true })
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

describe('secret stores separate same-millisecond writers', () => {
  it('SecureStore gives overlapping saves different temp files', async () => {
    const store = new SecureStore<{ id: string }>('sealed-list.json')
    await expectDistinctTempWrites(() => [
      store.save([{ meta: { id: 'a' }, secretEnc: 'A' }]),
      store.save([{ meta: { id: 'b' }, secretEnc: 'B' }])
    ])
  })

  it('scheduled-settings secrets give overlapping token saves different temp files', async () => {
    await expectDistinctTempWrites(() => [
      setHomeAssistantToken('same-rule', 'first'),
      setHomeAssistantToken('same-rule', 'second')
    ])
  })

  it('shared mode credentials give overlapping persistence calls different temp files', async () => {
    const target = path.join(dir, 'mode.credential.json')
    await expectDistinctTempWrites(() => [
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
