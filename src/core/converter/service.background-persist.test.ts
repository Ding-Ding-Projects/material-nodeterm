import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConverterService } from './service'
import { ConverterStore } from './store'

/**
 * The converter queue snapshot is written in the BACKGROUND — the UI must not wait on the disk
 * for a status change. That makes the rejection handling load-bearing rather than tidy: an
 * unhandled promise rejection terminates the process by default on every Node this project
 * supports, so `void this.store.save(...)` turns one failed advisory write into "the Electron
 * main process (or the Server Edition) exited". The write really can fail — `renameAtomic` gives
 * up after its bounded retries when something on Windows holds `queue.json`, and a userData
 * directory can vanish under a long-running app.
 *
 * A full suite run surfaced exactly this: an ENOENT rename escaping as an unhandled rejection
 * from a background queue save. In a test that is a red run; in the packaged app it is a crash.
 *
 * Surfaces: `src/core`, so Desktop and Server Edition both. Not applicable to the mobile
 * companion, which does not run the converter queue.
 */
describe('ConverterService background queue persistence', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nt-converter-bg-persist-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // Awaited rather than `rmSync`: synchronous retries block the event loop and so cannot let
    // this process's own in-flight writes release what they hold.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('reports a failed snapshot instead of letting it escape as an unhandled rejection', async () => {
    const dataDir = join(root, 'data')
    const sourceDir = join(root, 'src')
    const destDir = join(root, 'out')
    await mkdir(sourceDir, { recursive: true })
    await mkdir(destDir, { recursive: true })
    const input = join(sourceDir, 'a.txt')
    await writeFile(input, 'hello\r\n', 'utf8')

    const service = new ConverterService({ userDataDir: dataDir })
    const added = await service.addFiles([input], destDir, 'text-to-lf')
    expect(added.rejected).toEqual([])
    expect(added.added).toHaveLength(1)

    // Only now does the disk turn hostile, so the enqueue above is a normal successful one and
    // the failure under test is a BACKGROUND save, which is the path with no caller to reject to.
    const injected = Object.assign(new Error('EPERM: injected queue snapshot failure'), {
      code: 'EPERM'
    })
    vi.spyOn(ConverterStore.prototype, 'save').mockRejectedValue(injected)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const escaped: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      escaped.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      // Synchronous, fire-and-forget, and it persists: exactly the shape that crashed.
      expect(() => service.cancelItem(added.added[0].id)).not.toThrow()
      // Node reports an unhandled rejection one turn after the promise settles unobserved.
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(escaped).toEqual([])
    // "Could not measure" and "there is nothing" must stay distinguishable: the loss is reported,
    // not swallowed silently.
    expect(warn).toHaveBeenCalled()

    // And the queue itself is still authoritative in memory — a failed snapshot loses the RESTART,
    // never the running session.
    const state = await service.state(0, 10)
    expect(state.items.map((item) => item.status)).toEqual(['cancelled'])
  })
})
