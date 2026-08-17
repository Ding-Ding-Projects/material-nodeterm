import { fork, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

type WorkerMessage =
  | { type: 'ready'; enabled: boolean }
  | { type: 'done'; enabled: boolean; name: string; authoritative: boolean }
  | { type: 'error'; code: string; message: string }

interface TrackedChild {
  child: ChildProcess
  stderr: string
  queued: WorkerMessage[]
}

let suiteDir = ''
let caseHome = ''
let workerBundle = ''
const children = new Set<TrackedChild>()

function spawnWorker(mode: 'stale-rename' | 'enable'): TrackedChild {
  const child = fork(workerBundle, [mode, caseHome], {
    cwd: caseHome,
    execArgv: [],
    silent: true,
    env: { ...process.env, HOME: caseHome, USERPROFILE: caseHome }
  })
  const tracked = { child, stderr: '', queued: [] as WorkerMessage[] }
  children.add(tracked)
  child.stderr?.on('data', (chunk: Buffer | string) => {
    tracked.stderr += chunk.toString()
  })
  child.on('message', (message: WorkerMessage) => tracked.queued.push(message))
  return tracked
}

function waitForMessage(
  tracked: TrackedChild,
  type: WorkerMessage['type'],
  timeoutMs = 5_000
): Promise<WorkerMessage> {
  const queued = tracked.queued.findIndex((message) => message.type === type)
  if (queued >= 0) return Promise.resolve(tracked.queued.splice(queued, 1)[0]!)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${type}. Worker stderr: ${tracked.stderr}`))
    }, timeoutMs)
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return
      const typed = message as WorkerMessage
      if (typed.type === 'error') {
        cleanup()
        reject(new Error(`${typed.code}: ${typed.message}. Worker stderr: ${tracked.stderr}`))
      } else if (typed.type === type) {
        cleanup()
        resolve(typed)
      }
    }
    const onExit = (code: number | null): void => {
      cleanup()
      reject(new Error(`Worker exited (${String(code)}) before ${type}. ${tracked.stderr}`))
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      tracked.child.off('message', onMessage)
      tracked.child.off('exit', onExit)
    }
    tracked.child.on('message', onMessage)
    tracked.child.on('exit', onExit)
  })
}

function waitForExit(tracked: TrackedChild): Promise<void> {
  if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => tracked.child.once('exit', () => resolve()))
}

async function terminate(tracked: TrackedChild): Promise<void> {
  if (tracked.child.exitCode === null && tracked.child.signalCode === null) tracked.child.kill()
  await waitForExit(tracked)
  children.delete(tracked)
}

beforeAll(async () => {
  suiteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodeterm-kids-process-chut-'))
  workerBundle = path.join(suiteDir, 'worker.cjs')
  await build({
    entryPoints: [
      fileURLToPath(new URL('./testing/kids-mode-process-worker.ts', import.meta.url))
    ],
    outfile: workerBundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node24',
    logLevel: 'silent'
  })
}, 30_000)

beforeEach(async () => {
  caseHome = await fs.mkdtemp(path.join(suiteDir, 'case-'))
})

afterEach(async () => {
  await Promise.all([...children].map(terminate))
})

afterAll(async () => {
  await Promise.all([...children].map(terminate))
  await fs.rm(suiteDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('Kids mode across real processes', () => {
  it('preserves external ON when a process with stale OFF renames later', async () => {
    const stale = spawnWorker('stale-rename')
    await expect(waitForMessage(stale, 'ready')).resolves.toMatchObject({ enabled: false })

    const writer = spawnWorker('enable')
    await expect(waitForMessage(writer, 'done')).resolves.toMatchObject({ enabled: true })
    await waitForExit(writer)
    children.delete(writer)

    stale.child.send({ type: 'release' })
    await expect(waitForMessage(stale, 'done')).resolves.toMatchObject({
      enabled: true,
      name: 'Renamed by stale process',
      authoritative: false
    })
    await waitForExit(stale)
    children.delete(stale)

    const canonical = JSON.parse(
      await fs.readFile(path.join(caseHome, '.nodeterm', 'shared', 'kids-mode.json'), 'utf8')
    )
    expect(canonical).toEqual({
      version: 1,
      enabled: true,
      name: 'Renamed by stale process'
    })
  }, 20_000)
})
