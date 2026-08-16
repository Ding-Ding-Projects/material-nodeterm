// Bundled to CommonJS by kids-mode.process.test.ts. A real child process is load-bearing here:
// two KidsModeStore instances in Vitest would still share the process-local queue that production
// Desktop/Server processes do not share.

import { KidsModeStore, type KidsModeStoreDeps } from '../kids-mode'
import { fakePlatform } from '../platform-fake'
import { initPlatform } from '../platform'
import type { SharedRecordWatch, SharedRecordWatchToken } from '../shared-record-watch'

type WorkerMessage =
  | { type: 'ready'; enabled: boolean }
  | { type: 'done'; enabled: boolean; name: string; authoritative: boolean }
  | { type: 'error'; code: string; message: string }

const [, , mode, dataDir] = process.argv

function send(message: WorkerMessage): void {
  if (!process.send) throw new Error('Kids-mode process fixture requires an IPC channel.')
  process.send(message)
}

/** Suppress external fs events so CAS, rather than eventual watcher delivery, must preserve ON.
 * Local writes still perform the production invalidate -> strict reread handshake. */
function localWriteWatcher(
  _file: string,
  onSync: (token: SharedRecordWatchToken) => void,
  onHealth: (healthy: boolean) => void
): SharedRecordWatch {
  let syncEpoch = 1
  let disposed = false
  const token = (): SharedRecordWatchToken => ({ handleGeneration: 1, syncEpoch })
  return {
    start: token,
    recordWritten: () => {
      syncEpoch += 1
      onHealth(false)
      onSync(token())
    },
    isCurrent: (candidate) =>
      !disposed && candidate.handleGeneration === 1 && candidate.syncEpoch === syncEpoch,
    acknowledge: (candidate) => {
      const current =
        !disposed && candidate.handleGeneration === 1 && candidate.syncEpoch === syncEpoch
      if (current) onHealth(true)
      return current
    },
    dispose: () => {
      disposed = true
      onHealth(false)
    }
  }
}

function waitForRelease(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Parent did not release stale Kids-mode worker.'))
    }, 15_000)
    const onMessage = (message: unknown): void => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type: unknown }).type === 'release'
      ) {
        cleanup()
        resolve()
      }
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      process.off('message', onMessage)
    }
    process.on('message', onMessage)
  })
}

async function run(): Promise<void> {
  if (!mode || !dataDir) throw new Error('Worker mode and data directory are required.')
  initPlatform(fakePlatform({ userDataDir: dataDir }))
  const deps: KidsModeStoreDeps = { createWatcher: localWriteWatcher }
  const store = new KidsModeStore(deps)
  await store.init()

  if (mode === 'stale-rename') {
    send({ type: 'ready', enabled: store.get().enabled })
    await waitForRelease()
    const result = await store.rename('Renamed by stale process')
    send({
      type: 'done',
      enabled: result.enabled,
      name: result.name,
      authoritative: result.authoritative
    })
    store.dispose()
    return
  }

  if (mode === 'enable') {
    const result = await store.enable('1234')
    send({
      type: 'done',
      enabled: result.enabled,
      name: result.name,
      authoritative: result.authoritative
    })
    store.dispose()
    return
  }

  throw new Error(`Unknown worker mode: ${mode}`)
}

void run().catch((error: unknown) => {
  send({
    type: 'error',
    code:
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown',
    message: error instanceof Error ? error.message : String(error)
  })
  process.exitCode = 1
})
