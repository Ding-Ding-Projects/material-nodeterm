import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TorrentService } from './service'

const TORRENT_BYTES = new TextEncoder().encode('d4:infod6:lengthi3e4:name3:foo12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee')

function fakeRuntime() {
  return class {
    add() {
      return { files: [], on() { undefined }, pause() { undefined }, resume() { undefined } }
    }
  }
}

describe('TorrentService safety boundaries', () => {
  it('does not construct the runtime while checking availability', async () => {
    let constructed = 0
    class Runtime {
      constructor() { constructed++ }
    }
    const dir = await mkdtemp(join(tmpdir(), 'torrent-service-'))
    try {
      const service = new TorrentService({ userDataDir: dir, runtimeCtor: Runtime as never })
      await expect(service.runtime()).resolves.toMatchObject({ available: true, origin: 'bundled' })
      expect(constructed).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('validates a local torrent in inspect without constructing a client or contacting peers', async () => {
    let constructed = 0
    class Runtime {
      constructor() { constructed++ }
    }
    const dir = await mkdtemp(join(tmpdir(), 'torrent-service-'))
    const source = join(dir, 'sample.torrent')
    await writeFile(source, TORRENT_BYTES)
    try {
      const service = new TorrentService({ userDataDir: dir, runtimeCtor: Runtime as never })
      const task = await service.inspect({ sourceKind: 'torrent-file', sourceRef: source })
      expect(task.status).toBe('paused')
      expect(task.sourceRef).toBe('local torrent file')
      expect(task.files).toMatchObject([{ path: 'foo', selected: false, sizeBytes: 3 }])
      expect(constructed).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('requires explicit network disclosure before add', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'torrent-service-'))
    try {
      const service = new TorrentService({ userDataDir: dir, runtimeCtor: fakeRuntime() as never })
      await expect(service.add({ nodeId: 'n', sourceKind: 'magnet', sourceRef: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567', destination: dir })).rejects.toThrow(/disclos|consent/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('distinguishes a missing store from a corrupt store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'torrent-service-'))
    try {
      const missing = new TorrentService({ userDataDir: dir, runtimeCtor: fakeRuntime() as never })
      await expect(missing.persistence()).resolves.toMatchObject({ status: 'missing' })
      const stateDir = join(dir, 'torrent-downloader')
      await (await import('node:fs/promises')).mkdir(stateDir, { recursive: true })
      await writeFile(join(stateDir, 'tasks.json'), '{not-json')
      const corrupt = new TorrentService({ userDataDir: dir, runtimeCtor: fakeRuntime() as never })
      await expect(corrupt.persistence()).resolves.toMatchObject({ status: 'corrupt' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs the two-stage add only after preflight and redacts the staged source', async () => {
    let constructed = 0
    class Runtime {
      constructor() { constructed++ }
      add() { return { files: [], on() { undefined }, pause() { undefined }, resume() { undefined } } }
    }
    const dir = await mkdtemp(join(tmpdir(), 'torrent-service-'))
    const source = join(dir, 'sample.torrent')
    await writeFile(source, TORRENT_BYTES)
    try {
      const service = new TorrentService({ userDataDir: dir, runtimeCtor: Runtime as never })
      const task = await service.add({
        nodeId: 'n',
        sourceKind: 'torrent-file',
        sourceRef: source,
        destination: dir,
        selectedPaths: ['foo'],
        networkConsent: { accepted: true, acceptedAt: Date.now(), activationId: crypto.randomUUID(), disclosed: 'trackers-dht-peers-ip-seeding-destination' }
      })
      expect(task.sourceRef).toBe('local torrent file')
      expect(task.files[0]).toMatchObject({ path: 'foo', selected: true })
      expect(constructed).toBe(1)
      expect(await readFile(join(dir, 'torrent-downloader', 'history.jsonl'), 'utf8')).toContain('created')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
