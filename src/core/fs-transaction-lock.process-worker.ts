// This fixture is bundled to a standalone CommonJS worker by
// fs-transaction-lock.process.test.ts. Keeping the worker in a separate process is essential:
// two promises in Vitest would exercise only the process-local queue and could never prove the
// SQLite sidecar excludes a second Electron/server process.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { withCrossProcessLock } from './fs-transaction-lock'
import { fakePlatform } from './platform-fake'
import { initPlatform } from './platform'
import { pruneOrphanedTokens, setHomeAssistantToken } from './scheduled-settings-secrets'
import { SecureStore } from './secure-store'

type WorkerMessage =
  | { type: 'entered'; value?: number }
  | { type: 'done'; value?: number }
  | { type: 'error'; code: string; message: string }

const [, , mode, resource, counterPath] = process.argv
const RULE_ID = '11111111-1111-4111-8111-111111111111'

function send(message: WorkerMessage): void {
  if (!process.send) throw new Error('The transaction-lock worker requires an IPC channel.')
  process.send(message)
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'unknown'
}

async function waitForRelease(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('The parent did not release the worker barrier.'))
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

async function readCounter(target: string): Promise<number> {
  try {
    const text = await fs.readFile(target, 'utf8')
    const value = Number(text)
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Counter fixture is corrupt.')
    return value
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0
    throw error
  }
}

async function run(): Promise<void> {
  if (!mode || !resource) throw new Error('Worker mode and resource are required.')

  if (mode === 'increment') {
    if (!counterPath) throw new Error('Increment mode requires a counter path.')
    await withCrossProcessLock(resource, async (lease) => {
      const value = await readCounter(counterPath)
      send({ type: 'entered', value })
      await waitForRelease()
      await lease.fence()
      await fs.writeFile(counterPath, String(value + 1), 'utf8')
      send({ type: 'done', value: value + 1 })
    })
    return
  }

  if (mode === 'hold') {
    await withCrossProcessLock(resource, async (lease) => {
      send({ type: 'entered' })
      await waitForRelease()
      await lease.fence()
      send({ type: 'done' })
    })
    return
  }

  if (mode === 'quick') {
    await withCrossProcessLock(resource, async (lease) => {
      await lease.fence()
      send({ type: 'entered' })
    })
    send({ type: 'done' })
    return
  }

  if (mode === 'timeout') {
    try {
      await withCrossProcessLock(resource, async () => undefined, {
        pollMs: 10,
        waitTimeoutMs: 200
      })
      throw new Error('The competing transaction unexpectedly acquired the lock.')
    } catch (error) {
      send({
        type: 'error',
        code: errorCode(error),
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return
  }

  if (mode === 'secure-add') {
    if (!counterPath) throw new Error('Secure-add mode requires a UUID.')
    initPlatform(fakePlatform({ userDataDir: resource }))
    const store = new SecureStore<{ id: string; label: string }>('secure.json')
    await store.mutate<void>(async (entries) => {
      send({ type: 'entered' })
      await waitForRelease()
      entries.push({ meta: { id: counterPath, label: counterPath }, secretEnc: 'sealed' })
      return { changed: true, result: undefined }
    })
    send({ type: 'done' })
    return
  }

  if (mode === 'scheduled-set') {
    if (!counterPath) throw new Error('Scheduled-set mode requires a token.')
    initPlatform(fakePlatform({ userDataDir: resource }))
    const target = path.join(resource, 'scheduled-settings-secrets', `${RULE_ID}.bin`)
    const realRename = fs.rename.bind(fs)
    let parked = false
    fs.rename = async (from, to) => {
      if (!parked && String(to) === target) {
        parked = true
        send({ type: 'entered' })
        await waitForRelease()
      }
      return realRename(from, to)
    }
    await setHomeAssistantToken(RULE_ID, counterPath)
    send({ type: 'done' })
    return
  }

  if (mode === 'scheduled-clear' || mode === 'scheduled-prune') {
    initPlatform(fakePlatform({ userDataDir: resource }))
    const target = path.join(resource, 'scheduled-settings-secrets', `${RULE_ID}.bin`)
    const realUnlink = fs.unlink.bind(fs)
    let parked = false
    fs.unlink = async (file) => {
      if (!parked && String(file) === target) {
        parked = true
        send({ type: 'entered' })
        await waitForRelease()
      }
      return realUnlink(file)
    }
    if (mode === 'scheduled-clear') await setHomeAssistantToken(RULE_ID, null)
    else await pruneOrphanedTokens([])
    send({ type: 'done' })
    return
  }

  throw new Error(`Unknown worker mode: ${mode}`)
}

void run()
  .then(() => {
    process.disconnect?.()
  })
  .catch((error) => {
    try {
      send({
        type: 'error',
        code: errorCode(error),
        message: error instanceof Error ? error.stack ?? error.message : String(error)
      })
    } finally {
      process.exitCode = 1
      process.disconnect?.()
    }
  })
