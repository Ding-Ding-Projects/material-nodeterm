import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AtomicJsonArrayStore } from './atomic-json-store'

/**
 * `AtomicJsonArrayStore` serializes whole-document publications behind one promise chain. The
 * chain is what makes concurrent savers FIFO instead of racing; it must NOT also be the thing
 * that decides whether a later save runs at all.
 *
 * The failure these pin: a rejected promise's `.then(onFulfilled)` skips `onFulfilled`, so a
 * chain built as `this.writing = this.writing.then(() => write(items))` stays rejected forever
 * after ONE failed write, and every later save is silently dropped without touching the disk.
 * That is reachable on the delivery platform — `renameAtomic` exists precisely because Windows
 * fails a publish with EPERM while Defender/the indexer/OneDrive holds the target — and the
 * damage is invisible: the in-memory queue looks fine and simply stops surviving restarts.
 *
 * Surfaces: this is `src/core`, so it is Desktop and Server Edition alike. The mobile companion
 * does not own these queues; not applicable there.
 */
describe('AtomicJsonArrayStore write serialization', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nt-atomic-json-store-'))
  })

  afterEach(async () => {
    // Awaited, not `rmSync`: a synchronous retry loop blocks the event loop and so can never let
    // this process's own in-flight write release the file it is waiting on.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  /** A real filesystem obstruction: the target's parent exists as a FILE, so `mkdir` fails. */
  async function blockedStore(): Promise<{ store: AtomicJsonArrayStore<string>; obstacle: string; file: string }> {
    const obstacle = join(dir, 'queue-dir')
    await writeFile(obstacle, 'this is a file, not a directory', 'utf8')
    return { store: new AtomicJsonArrayStore<string>(join(obstacle, 'queue.json')), obstacle, file: join(obstacle, 'queue.json') }
  }

  it('surfaces a failed publication to the caller that asked for it', async () => {
    const { store } = await blockedStore()
    await expect(store.save(['first'])).rejects.toThrow()
  })

  it('lets the next save reach disk after a transient failure', async () => {
    const { store, obstacle, file } = await blockedStore()

    await expect(store.save(['first'])).rejects.toThrow()

    // The holder goes away, exactly as a virus scanner releasing the path would.
    await rm(obstacle)

    await store.save(['second'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['second'])
  })

  it('keeps publishing every later save, not just the first one after a failure', async () => {
    const { store, obstacle, file } = await blockedStore()

    await expect(store.save(['first'])).rejects.toThrow()
    await rm(obstacle)

    await store.save(['second'])
    await store.save(['third'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['third'])
  })

  it('publishes concurrently queued saves in call order', async () => {
    const file = join(dir, 'queue.json')
    const store = new AtomicJsonArrayStore<string>(file)

    // Both are queued before either completes; the last one CALLED must be the last one PUBLISHED,
    // otherwise a slow earlier snapshot could overwrite a newer queue state.
    await Promise.all([store.save(['one']), store.save(['two']), store.save(['three'])])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(['three'])
  })
})
