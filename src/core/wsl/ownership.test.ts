import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { fileWslOwnershipStore, inMemoryWslOwnershipStore } from './ownership'

const tempFiles: string[] = []

async function tempLedgerPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-ownership-test-'))
  const file = path.join(dir, 'wsl-owned-distributions.json')
  tempFiles.push(dir)
  return file
}

afterEach(async () => {
  while (tempFiles.length > 0) {
    const dir = tempFiles.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

describe('inMemoryWslOwnershipStore', () => {
  it('reports nothing owned until recorded', async () => {
    const store = inMemoryWslOwnershipStore()
    expect(await store.isOwned('my-project')).toBe(false)
  })

  it('reports ownership case-insensitively after recording', async () => {
    const store = inMemoryWslOwnershipStore()
    await store.record('My-Project')
    expect(await store.isOwned('my-project')).toBe(true)
    expect(await store.isOwned('MY-PROJECT')).toBe(true)
  })

  it('forgets a recorded name', async () => {
    const store = inMemoryWslOwnershipStore(['my-project'])
    await store.forget('MY-PROJECT')
    expect(await store.isOwned('my-project')).toBe(false)
  })

  it('never reports a real, pre-existing distribution as owned', async () => {
    const store = inMemoryWslOwnershipStore()
    expect(await store.isOwned('docker-desktop')).toBe(false)
    expect(await store.isOwned('ding-pbx-console')).toBe(false)
    expect(await store.isOwned('ding-pbx-test')).toBe(false)
  })
})

describe('fileWslOwnershipStore', () => {
  it('reports an empty, healthy ledger when the file does not exist yet', async () => {
    const store = fileWslOwnershipStore(await tempLedgerPath())
    expect(await store.isOwned('my-project')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('records and reads back ownership across independent store instances (proves the write is durable)', async () => {
    const filePath = await tempLedgerPath()
    await fileWslOwnershipStore(filePath).record('my-project')
    const reopened = fileWslOwnershipStore(filePath)
    expect(await reopened.isOwned('my-project')).toBe(true)
    expect(await reopened.list()).toEqual(['my-project'])
  })

  it('is case-insensitive for isOwned but preserves original casing in list', async () => {
    const filePath = await tempLedgerPath()
    const store = fileWslOwnershipStore(filePath)
    await store.record('My-Project')
    expect(await store.isOwned('my-project')).toBe(true)
    expect(await store.list()).toEqual(['My-Project'])
  })

  it('forgets a recorded name so it is no longer owned', async () => {
    const filePath = await tempLedgerPath()
    const store = fileWslOwnershipStore(filePath)
    await store.record('my-project')
    await store.forget('my-project')
    expect(await store.isOwned('my-project')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('re-recording the same name does not duplicate it', async () => {
    const filePath = await tempLedgerPath()
    const store = fileWslOwnershipStore(filePath)
    await store.record('my-project')
    await store.record('my-project')
    expect(await store.list()).toEqual(['my-project'])
  })

  it('fails closed (not owned) when the ledger file is corrupt JSON', async () => {
    const filePath = await tempLedgerPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, '{ this is not valid json', 'utf8')
    const store = fileWslOwnershipStore(filePath)
    expect(await store.isOwned('my-project')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('fails closed when the ledger file has the wrong shape', async () => {
    const filePath = await tempLedgerPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ hello: 'world' }), 'utf8')
    const store = fileWslOwnershipStore(filePath)
    expect(await store.isOwned('my-project')).toBe(false)
  })

  it('fails closed when a ledger entry is missing its name field', async () => {
    const filePath = await tempLedgerPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, distributions: [{ createdAt: '2026-01-01T00:00:00.000Z' }] }),
      'utf8'
    )
    const store = fileWslOwnershipStore(filePath)
    expect(await store.isOwned('anything')).toBe(false)
  })

  it('never resolves a real pre-existing distribution as owned when the ledger is empty', async () => {
    const store = fileWslOwnershipStore(await tempLedgerPath())
    expect(await store.isOwned('docker-desktop')).toBe(false)
    expect(await store.isOwned('ding-pbx-console')).toBe(false)
    expect(await store.isOwned('ding-pbx-test')).toBe(false)
  })

  it('serializes concurrent record calls without dropping one', async () => {
    const filePath = await tempLedgerPath()
    const store = fileWslOwnershipStore(filePath)
    await Promise.all([store.record('one'), store.record('two'), store.record('three')])
    const names = (await store.list()).sort()
    expect(names).toEqual(['one', 'three', 'two'])
  })
})
