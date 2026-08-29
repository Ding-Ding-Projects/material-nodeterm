import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WHISPER_PART_STALE_MS, WhisperModelStore } from './whisper-models'

function fakeFetch(body: Uint8Array, opts: { delayMs?: number; chunks?: number } = {}) {
  const { delayMs = 0, chunks = 2 } = opts
  return (async (_url: any, init?: any) => {
    const size = Math.ceil(body.length / chunks)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (init?.signal?.aborted) { controller.error(new Error('aborted')); return }
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        if (sent >= body.length) { controller.close(); return }
        controller.enqueue(body.subarray(sent, sent + size))
        sent += size
      },
    })
    return {
      ok: true, status: 200,
      headers: new Headers({ 'content-length': String(body.length) }),
      body: stream,
    } as unknown as Response
  }) as typeof fetch
}

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for a model part file')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('WhisperModelStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wms-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) })

  it('downloads a model, reports progress, and lists it', async () => {
    const seen: number[] = []
    const store = new WhisperModelStore({
      dir, fetchFn: fakeFetch(new Uint8Array(64).fill(7)),
      onProgress: (_id, pct) => seen.push(pct),
    })
    await store.download('tiny')
    expect(await store.has('tiny')).toBe(true)
    expect(readFileSync(store.modelPath('tiny')).length).toBe(64)
    expect(seen.at(-1)).toBe(100)
    const listed = (await store.list()).find((m) => m.id === 'tiny')
    expect(listed?.downloaded).toBe(true)
  })

  it('rejects unknown model ids', async () => {
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(1)) })
    await expect(store.download('nope')).rejects.toThrow(/unknown/i)
  })

  it('dedupes a concurrent download of the same id onto one promise', async () => {
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(64), { delayMs: 20 }) })
    const a = store.download('tiny')
    const b = store.download('tiny')
    expect(a).toBe(b)
    await a
  })

  it('does not sweep a live part owned by another store sharing the model directory', async () => {
    const firstStore = new WhisperModelStore({
      dir,
      fetchFn: fakeFetch(new Uint8Array(512), { delayMs: 30, chunks: 16 }),
    })
    const secondStore = new WhisperModelStore({
      dir,
      fetchFn: fakeFetch(new Uint8Array(512), { delayMs: 30, chunks: 16 }),
    })

    const first = firstStore.download('tiny')
    await waitUntil(() => readdirSync(dir).some((entry) => entry.startsWith('ggml-tiny.bin.part.')))
    const livePart = join(dir, readdirSync(dir).find((entry) => entry.startsWith('ggml-tiny.bin.part.'))!)

    const second = secondStore.download('tiny')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(existsSync(livePart), 'a second process must not unlink a live foreign download').toBe(true)

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
  })

  it('delete mid-download cancels — no file, no resurrection', async () => {
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(1024), { delayMs: 30, chunks: 8 }) })
    const dl = store.download('tiny')
    await new Promise((r) => setTimeout(r, 40)) // let the first chunk land
    await store.delete('tiny')
    await expect(dl).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 120)) // late chunks must not revive anything
    expect(await store.has('tiny')).toBe(false)
    expect(readdirSync(dir).some((entry) => entry.startsWith('ggml-tiny.bin.part.'))).toBe(false)
  })

  it('delete followed by immediate re-download does not kill the new download', async () => {
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(64), { delayMs: 20, chunks: 4 }) })
    const first = store.download('tiny')
    await new Promise((r) => setTimeout(r, 30))
    const del = store.delete('tiny') // not awaited before the re-download
    const second = store.download('tiny')
    await del
    await expect(second).resolves.toBeUndefined()
    expect(await store.has('tiny')).toBe(true)
  })

  it('sweeps an aged foreign/legacy part on download', async () => {
    const now = 2_000_000_000_000
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(64)), now: () => now })
    const orphan = join(dir, 'ggml-tiny.bin.part.deadbeef')
    const legacyOrphan = join(dir, 'ggml-tiny.bin.part')
    writeFileSync(orphan, 'junk')
    writeFileSync(legacyOrphan, 'older junk')
    const staleAt = new Date(now - WHISPER_PART_STALE_MS - 1_000)
    utimesSync(orphan, staleAt, staleAt)
    utimesSync(legacyOrphan, staleAt, staleAt)
    expect(existsSync(orphan)).toBe(true)

    await store.download('tiny')

    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(legacyOrphan)).toBe(false)
    expect(await store.has('tiny')).toBe(true)
  })

  it('reserves a collision-proof part name instead of truncating an existing fragment', async () => {
    const owner = 'store-owner'
    const collision = join(dir, `ggml-tiny.bin.part.${owner}.collision`)
    const ids = ['collision', 'unique']
    const baseFetch = fakeFetch(new Uint8Array(64).fill(9))
    const fetchFn = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      // run() already swept before fetch. Make the colliding name appear in the remaining gap so
      // only exclusive reservation — not cleanup ordering — can prevent truncation.
      writeFileSync(collision, 'leave this fragment intact')
      return baseFetch(url, init)
    }) as typeof fetch
    const store = new WhisperModelStore({
      dir,
      fetchFn,
      partOwnerId: owner,
      nextPartId: () => ids.shift() ?? 'unexpected-extra-id',
    })

    await store.download('tiny')

    expect(readFileSync(collision, 'utf8')).toBe('leave this fragment intact')
    expect(readFileSync(store.modelPath('tiny'))).toEqual(Buffer.alloc(64, 9))
  })

  it('delete() rejects an unknown model id', async () => {
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(1)) })
    await expect(store.delete('nope')).rejects.toThrow(/unknown/i)
  })

  it('delete() rejects a path-traversal-looking id without touching the fs', async () => {
    const store = new WhisperModelStore({ dir, fetchFn: fakeFetch(new Uint8Array(1)) })
    // Pre-create a file just outside `dir` that a naive `${id}.bin` join could otherwise reach.
    const outside = join(dir, '..', 'traversal-canary.bin')
    writeFileSync(outside, 'do not delete me')
    try {
      await expect(store.delete('../traversal-canary')).rejects.toThrow(/unknown/i)
      expect(existsSync(outside)).toBe(true)
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('delete() removes a recent inactive part owned by this store', async () => {
    const owner = 'delete-owner'
    const store = new WhisperModelStore({
      dir,
      fetchFn: fakeFetch(new Uint8Array(64)),
      partOwnerId: owner,
    })
    writeFileSync(store.modelPath('tiny'), 'model')
    const ownOrphan = `${store.modelPath('tiny')}.part.${owner}.orphan123`
    writeFileSync(ownOrphan, 'junk')
    expect(await store.has('tiny')).toBe(true)

    await store.delete('tiny')

    expect(await store.has('tiny')).toBe(false)
    expect(existsSync(ownOrphan)).toBe(false)
  })
})
