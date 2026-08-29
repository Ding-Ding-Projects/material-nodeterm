import { fork, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readAtomicFileSnapshot,
  withCrossProcessLock,
  writeAtomicFileCompared,
  type CrossProcessLease
} from './fs-transaction-lock'

type WorkerMessage =
  | { type: 'entered'; value?: number }
  | { type: 'done'; value?: number }
  | { type: 'error'; code: string; message: string }

interface MessageWaiter {
  type: WorkerMessage['type']
  resolve(message: WorkerMessage): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface TrackedChild {
  child: ChildProcess
  stderr: string
  messages: WorkerMessage[]
  waiters: Set<MessageWaiter>
}

const children = new Set<TrackedChild>()
let suiteDir = ''
let caseDir = ''
let workerBundle = ''

function isWorkerMessage(message: unknown): message is WorkerMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    ['entered', 'done', 'error'].includes(String((message as { type: unknown }).type))
  )
}

function describeChild(tracked: TrackedChild): string {
  const stderr = tracked.stderr.trim()
  return stderr ? `\nWorker stderr:\n${stderr}` : '\nWorker produced no stderr.'
}

function spawnWorker(mode: string, resource: string, counterPath?: string): TrackedChild {
  const child = fork(workerBundle, [mode, resource, ...(counterPath ? [counterPath] : [])], {
    cwd: caseDir,
    execArgv: [],
    silent: true
  })
  const tracked: TrackedChild = { child, stderr: '', messages: [], waiters: new Set() }
  children.add(tracked)
  child.stderr?.on('data', (chunk: Buffer | string) => {
    tracked.stderr += chunk.toString()
  })
  child.on('message', (message: unknown) => {
    if (!isWorkerMessage(message)) return
    const waiter = [...tracked.waiters].find((candidate) => candidate.type === message.type)
    if (waiter) {
      tracked.waiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    } else {
      tracked.messages.push(message)
    }
  })
  child.on('exit', (code, signal) => {
    for (const waiter of tracked.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(
        new Error(
          `Worker exited before ${waiter.type} (code=${String(code)}, signal=${String(signal)}).${describeChild(tracked)}`
        )
      )
    }
    tracked.waiters.clear()
  })
  return tracked
}

function waitForMessage(
  tracked: TrackedChild,
  type: WorkerMessage['type'],
  timeoutMs = 3_000
): Promise<WorkerMessage> {
  const queued = tracked.messages.findIndex((message) => message.type === type)
  if (queued >= 0) return Promise.resolve(tracked.messages.splice(queued, 1)[0]!)
  if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) {
    return Promise.reject(new Error(`Worker already exited before ${type}.${describeChild(tracked)}`))
  }
  return new Promise((resolve, reject) => {
    const waiter: MessageWaiter = {
      type,
      resolve,
      reject,
      timer: setTimeout(() => {
        tracked.waiters.delete(waiter)
        reject(new Error(`Timed out waiting for worker ${type}.${describeChild(tracked)}`))
      }, timeoutMs)
    }
    tracked.waiters.add(waiter)
  })
}

function waitForExit(tracked: TrackedChild, timeoutMs = 3_000): Promise<void> {
  if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for worker exit.${describeChild(tracked)}`))
    }, timeoutMs)
    const onExit = (): void => {
      cleanup()
      resolve()
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      tracked.child.off('exit', onExit)
    }
    tracked.child.on('exit', onExit)
  })
}

async function terminate(tracked: TrackedChild): Promise<void> {
  if (tracked.child.exitCode === null && tracked.child.signalCode === null) tracked.child.kill()
  await waitForExit(tracked, 3_000).catch(() => undefined)
  children.delete(tracked)
}

function release(tracked: TrackedChild): void {
  tracked.child.send({ type: 'release' })
}

function sidecarFor(resource: string): string {
  return path.join(path.dirname(resource), `.${path.basename(resource)}.transaction.sqlite3`)
}

beforeAll(async () => {
  suiteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodeterm-lock-process-check-'))
  workerBundle = path.join(suiteDir, 'worker.cjs')
  await build({
    entryPoints: [
      fileURLToPath(new URL('./fs-transaction-lock.process-worker.ts', import.meta.url))
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
  caseDir = await fs.mkdtemp(path.join(suiteDir, 'case-'))
})

afterEach(async () => {
  await Promise.all([...children].map(terminate))
})

afterAll(async () => {
  await Promise.all([...children].map(terminate))
  const resolvedSuite = path.resolve(suiteDir)
  const resolvedSystemTemp = path.resolve(os.tmpdir())
  if (resolvedSuite.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
    await fs.rm(resolvedSuite, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

describe('cross-process transaction lock', () => {
  it('serializes two real processes and prevents a stale read from losing an increment', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    const counter = path.join(caseDir, 'counter.txt')
    await fs.writeFile(counter, '0', 'utf8')

    const first = spawnWorker('increment', resource, counter)
    await expect(waitForMessage(first, 'entered')).resolves.toMatchObject({ value: 0 })

    const second = spawnWorker('increment', resource, counter)
    await expect(waitForMessage(second, 'entered', 250)).rejects.toThrow(/Timed out/)

    release(first)
    await expect(waitForMessage(first, 'done')).resolves.toMatchObject({ value: 1 })
    await waitForExit(first)

    await expect(waitForMessage(second, 'entered')).resolves.toMatchObject({ value: 1 })
    release(second)
    await expect(waitForMessage(second, 'done')).resolves.toMatchObject({ value: 2 })
    await waitForExit(second)

    await expect(fs.readFile(counter, 'utf8')).resolves.toBe('2')
  }, 15_000)

  it('serializes real SecureStore mutations so both UUID entries survive', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111'
    const secondId = '22222222-2222-4222-8222-222222222222'
    const target = path.join(caseDir, 'secure.json')

    const first = spawnWorker('secure-add', caseDir, firstId)
    await waitForMessage(first, 'entered')
    const second = spawnWorker('secure-add', caseDir, secondId)
    await expect(waitForMessage(second, 'entered', 250)).rejects.toThrow(/Timed out/)

    release(first)
    await waitForMessage(first, 'done')
    await waitForExit(first)
    await waitForMessage(second, 'entered')
    release(second)
    await waitForMessage(second, 'done')
    await waitForExit(second)

    const document = JSON.parse(await fs.readFile(target, 'utf8')) as {
      entries: Array<{ meta: { id: string } }>
    }
    expect(document.entries.map((entry) => entry.meta.id)).toEqual([firstId, secondId])
  }, 15_000)

  it.each([
    ['scheduled-clear', 'clear'],
    ['scheduled-prune', 'prune']
  ])('keeps scheduled set ahead of a real-process %s mutation', async (mode, _label) => {
    const target = path.join(
      caseDir,
      'scheduled-settings-secrets',
      '11111111-1111-4111-8111-111111111111.bin'
    )
    const setter = spawnWorker('scheduled-set', caseDir, 'home-assistant-secret')
    await waitForMessage(setter, 'entered')
    const remover = spawnWorker(mode, caseDir)
    await expect(waitForMessage(remover, 'entered', 250)).rejects.toThrow(/Timed out/)

    release(setter)
    await waitForMessage(setter, 'done')
    await waitForExit(setter)
    await waitForMessage(remover, 'entered')
    release(remover)
    await waitForMessage(remover, 'done')
    await waitForExit(remover)

    await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it('releases the kernel lock when the owning process crashes', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    const crashed = spawnWorker('hold', resource)
    await waitForMessage(crashed, 'entered')

    crashed.child.kill()
    await waitForExit(crashed)

    const successor = spawnWorker('quick', resource)
    await expect(waitForMessage(successor, 'entered')).resolves.toMatchObject({ type: 'entered' })
    await expect(waitForMessage(successor, 'done')).resolves.toMatchObject({ type: 'done' })
    await waitForExit(successor)
  }, 15_000)

  it('returns a bounded lock-timeout while another process still owns the transaction', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    const owner = spawnWorker('hold', resource)
    await waitForMessage(owner, 'entered')

    const contender = spawnWorker('timeout', resource)
    await expect(waitForMessage(contender, 'error', 3_000)).resolves.toMatchObject({
      type: 'error',
      code: 'lock-timeout'
    })
    await waitForExit(contender)

    release(owner)
    await waitForMessage(owner, 'done')
    await waitForExit(owner)
  }, 15_000)

  it('preserves a corrupt SQLite sidecar as evidence and fails closed', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    const sidecar = sidecarFor(resource)
    const evidence = Buffer.from('not-a-sqlite-database\u0000retain-this-evidence')
    await fs.writeFile(sidecar, evidence)

    await expect(withCrossProcessLock(resource, async () => undefined)).rejects.toMatchObject({
      code: 'lock-evidence-unreadable'
    })
    await expect(fs.readFile(sidecar)).resolves.toEqual(evidence)
  })

  it('surfaces EACCES while hardening a sidecar instead of treating it as a usable lock', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    const sidecar = sidecarFor(resource)
    const realChmod = fs.chmod.bind(fs)
    vi.spyOn(fs, 'chmod').mockImplementation(async (file, mode) => {
      if (path.resolve(String(file)) === path.resolve(sidecar)) {
        throw Object.assign(new Error('EACCES: lock evidence cannot be hardened'), { code: 'EACCES' })
      }
      return realChmod(file, mode)
    })

    await expect(withCrossProcessLock(resource, async () => undefined)).rejects.toMatchObject({
      code: 'lock-evidence-unreadable',
      cause: expect.objectContaining({ code: 'EACCES' })
    })
    expect((await fs.lstat(sidecar)).isFile()).toBe(true)
  })

  it('fails closed on hard-linked resource and sidecar bindings', async () => {
    const source = path.join(caseDir, 'foreign-evidence')
    const resource = path.join(caseDir, 'credentials.json')
    await fs.writeFile(source, 'preserve-resource-binding', 'utf8')
    await fs.link(source, resource)

    await expect(withCrossProcessLock(resource, async () => undefined)).rejects.toMatchObject({
      code: 'lock-evidence-unreadable'
    })
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('preserve-resource-binding')
    await expect(fs.readFile(resource, 'utf8')).resolves.toBe('preserve-resource-binding')

    await fs.unlink(resource)
    const sidecar = sidecarFor(resource)
    await fs.link(source, sidecar)
    await expect(withCrossProcessLock(resource, async () => undefined)).rejects.toMatchObject({
      code: 'lock-evidence-unreadable'
    })
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('preserve-resource-binding')
    await expect(fs.readFile(sidecar, 'utf8')).resolves.toBe('preserve-resource-binding')
  })

  it('rejects a stale snapshot when an out-of-protocol edit appears before publish', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    await fs.writeFile(resource, 'original', 'utf8')

    await withCrossProcessLock(resource, async (lease) => {
      const snapshot = await readAtomicFileSnapshot(resource)
      await fs.writeFile(resource, 'foreign-edit', 'utf8')
      await expect(
        writeAtomicFileCompared(resource, 'stale-successor', snapshot.revision, lease, {
          encoding: 'utf8',
          mode: 0o600
        })
      ).rejects.toMatchObject({ code: 'atomic-revision-conflict' })
    })

    await expect(fs.readFile(resource, 'utf8')).resolves.toBe('foreign-edit')
    expect((await fs.readdir(caseDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('recovers its process-local FIFO after an operation rejects', async () => {
    const resource = path.join(caseDir, 'credentials.json')
    const expected = new Error('deliberate operation failure')
    let firstLease: CrossProcessLease | undefined

    await expect(
      withCrossProcessLock(resource, async (lease) => {
        firstLease = lease
        throw expected
      })
    ).rejects.toBe(expected)
    await expect(firstLease?.fence()).rejects.toMatchObject({ code: 'lock-lease-lost' })

    await expect(
      withCrossProcessLock(resource, async (lease) => {
        await lease.fence()
        return 'queue recovered'
      })
    ).resolves.toBe('queue recovered')
  })

  it('maps a directory alias to the same physical transaction', async ({ skip }) => {
    const physicalDir = path.join(caseDir, 'physical')
    const aliasDir = path.join(caseDir, 'alias')
    await fs.mkdir(physicalDir)
    try {
      await fs.symlink(physicalDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      const code = errorCode(error)
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        skip(`Directory aliases are unavailable on this host (${code}).`)
        return
      }
      throw error
    }

    const counter = path.join(physicalDir, 'counter.txt')
    const physicalResource = path.join(physicalDir, 'credentials.json')
    const aliasResource = path.join(aliasDir, 'credentials.json')
    await fs.writeFile(counter, '0', 'utf8')

    const physical = spawnWorker('increment', physicalResource, counter)
    await waitForMessage(physical, 'entered')
    const alias = spawnWorker('increment', aliasResource, counter)
    await expect(waitForMessage(alias, 'entered', 250)).rejects.toThrow(/Timed out/)

    release(physical)
    await expect(waitForMessage(physical, 'done')).resolves.toMatchObject({ value: 1 })
    await waitForExit(physical)
    await expect(waitForMessage(alias, 'entered')).resolves.toMatchObject({ value: 1 })
    release(alias)
    await expect(waitForMessage(alias, 'done')).resolves.toMatchObject({ value: 2 })
    await waitForExit(alias)

    await expect(fs.readFile(counter, 'utf8')).resolves.toBe('2')
  }, 15_000)
})

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}
