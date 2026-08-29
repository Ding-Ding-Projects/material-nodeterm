import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TorrentService, webTorrentClientOptions } from './service'

class FakeWebTorrentClient extends EventEmitter {
  static lastOptions: Record<string, unknown> | undefined
  destroyed = false
  utp = true

  constructor(options?: Record<string, unknown>) {
    super()
    FakeWebTorrentClient.lastOptions = options
    this.utp = options?.utp !== false
  }

  add(): never {
    throw new Error('not used by this focused runtime test')
  }
}

async function service(client: FakeWebTorrentClient, options: { isPackaged?: boolean; platform?: NodeJS.Platform } = {}): Promise<TorrentService> {
  const root = await mkdtemp(join(tmpdir(), 'nodeterm-torrent-runtime-'))
  return new TorrentService({
    userDataDir: root,
    ...options,
    runtimeResolver: async () => ({
      ctor: class {
        constructor(options?: Record<string, unknown>) {
          FakeWebTorrentClient.lastOptions = options
          client.utp = options?.utp !== false
          return client
        }
      } as never,
      origin: 'bundled'
    })
  })
}

describe('TorrentService WebTorrent startup containment', () => {
  it('disables optional uTP in packaged Windows builds while retaining DHT and TCP startup', () => {
    expect(webTorrentClientOptions({ isPackaged: true, platform: 'win32' })).toEqual({ dht: true, utp: false })
    expect(webTorrentClientOptions({ isPackaged: false, platform: 'win32' })).toEqual({ dht: true, utp: true })
    expect(webTorrentClientOptions({ isPackaged: true, platform: 'linux' })).toEqual({ dht: true, utp: true })
  })

  it('contains the asynchronous uTP bind error and keeps the TCP runtime available', async () => {
    const client = new FakeWebTorrentClient()
    const torrent = await service(client)

    await expect(torrent.runtime()).resolves.toMatchObject({ available: true, origin: 'bundled' })
    client.utp = false

    expect(() => client.emit('error', new Error('permission denied'))).not.toThrow()
    await expect(torrent.runtime()).resolves.toEqual({
      available: true,
      origin: 'bundled',
      detail: 'uTP unavailable; using TCP: permission denied'
    })
  })

  it('contains fatal client errors and reports the runtime unavailable', async () => {
    const client = new FakeWebTorrentClient()
    const torrent = await service(client, { isPackaged: true, platform: 'win32' })

    await torrent.runtime()
    expect(client.utp).toBe(false)

    expect(() => client.emit('error', new Error('network listener failed'))).not.toThrow()
    await expect(torrent.runtime()).resolves.toEqual({
      available: false,
      origin: 'unavailable',
      detail: 'network listener failed'
    })
  })
})
