import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import {
  LocalHistoryStore,
  runLocalHistoryGit,
  type LocalHistoryGit
} from './local-history'

interface WorkerResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

interface WorkerRun {
  child: ChildProcessWithoutNullStreams
  result: Promise<WorkerResult>
}

const dirs: string[] = []
const children = new Set<ChildProcessWithoutNullStreams>()
let fixtureDir = ''
let workerPath = ''

function makeDir(prefix = 'nodeterm-local-history-'): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function spawnWorker(
  root: string,
  args: Record<string, string>,
  env: NodeJS.ProcessEnv = {}
): WorkerRun {
  const argv = [workerPath, `--root=${root}`]
  for (const [key, value] of Object.entries(args)) argv.push(`--${key}=${value}`)
  const child = spawn(process.execPath, argv, {
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  children.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf-8')
  child.stderr.setEncoding('utf-8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const result = new Promise<WorkerResult>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      children.delete(child)
      resolve({ code, signal, stdout, stderr })
    })
  })
  return { child, result }
}

async function waitForFile(file: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fs.stat(file)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function workerList(root: string): Promise<Array<{ label: string; sha: string }>> {
  const run = spawnWorker(root, { mode: 'list' })
  const result = await run.result
  expect(result, result.stderr).toMatchObject({ code: 0, signal: null })
  return JSON.parse(result.stdout) as Array<{ label: string; sha: string }>
}

async function directorySnapshot(directory: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  for (const entry of await fs.readdir(directory)) {
    const bytes = await fs.readFile(path.join(directory, entry))
    snapshot.set(entry, createHash('sha256').update(bytes).digest('hex'))
  }
  return snapshot
}

beforeAll(async () => {
  fixtureDir = makeDir('nodeterm-local-history-worker-')
  workerPath = path.join(fixtureDir, 'worker.cjs')
  await build({
    entryPoints: [path.join(__dirname, 'testing', 'local-history-process.ts')],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: false,
    logLevel: 'silent'
  })
}, 30_000)

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const child of children) child.kill('SIGKILL')
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          child.once('close', () => resolve())
          setTimeout(resolve, 1_000)
        })
    )
  )
  children.clear()
  for (const dir of dirs.splice(0)) {
    if (dir === fixtureDir) {
      dirs.push(dir)
      continue
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

afterAll(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

describe('LocalHistoryStore', () => {
  it('reports an initialized but unborn repository as an empty readable history', async () => {
    const store = new LocalHistoryStore(makeDir())

    await expect(store.list('settings')).resolves.toEqual([])
  }, 30_000)

  it('keeps a durable intent and fails reads closed when bounded Git is unavailable', async () => {
    const root = makeDir()
    const timeoutGit: LocalHistoryGit = async () => {
      const error = new Error('simulated bounded Git deadline') as Error & { code: string }
      error.code = 'ETIMEDOUT'
      throw error
    }
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = new LocalHistoryStore(root, timeoutGit)

    await expect(
      store.record({
        domain: 'settings',
        filename: 'settings.json',
        content: '{"kept":true}',
        label: 'save while Git is unavailable',
        action: 'updated'
      })
    ).resolves.toBeUndefined()

    const pendingDir = path.join(root, 'local-history', 'settings', '.nodeterm-history-pending')
    const pending = (await fs.readdir(pendingDir)).filter((entry) => entry.endsWith('.json'))
    expect(pending).toHaveLength(1)
    expect(await fs.readFile(path.join(pendingDir, pending[0]!), 'utf-8')).toContain(
      '{\\"kept\\":true}'
    )
    await expect(store.list('settings')).resolves.toBeNull()
    await expect(
      store.restoreContent('settings', 'a'.repeat(40), 'settings.json')
    ).rejects.toThrow('unavailable')
    expect(errorLog).toHaveBeenCalled()
  }, 30_000)

  it('cannot be redirected into a foreign Git repository by inherited environment variables', async () => {
    const foreignRoot = makeDir('nodeterm-local-history-foreign-')
    const historyRoot = makeDir()
    await runLocalHistoryGit(foreignRoot, ['init', '--quiet'])
    vi.stubEnv('GIT_DIR', path.join(foreignRoot, '.git'))
    vi.stubEnv('GIT_WORK_TREE', foreignRoot)

    const store = new LocalHistoryStore(historyRoot)
    await store.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"inside":"history-only"}',
      label: 'isolated history save',
      action: 'updated'
    })

    vi.unstubAllEnvs()
    await expect(store.list('settings')).resolves.toMatchObject([
      { label: 'isolated history save', filename: 'settings.json' }
    ])
    await expect(
      runLocalHistoryGit(foreignRoot, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    ).rejects.toMatchObject({ code: 1 })
  }, 30_000)

  it('uses two real processes and a ref CAS so every competing label owns its bytes', async () => {
    const root = makeDir()
    const entered = path.join(root, 'a-entered')
    const release = path.join(root, 'a-release')
    const first = spawnWorker(
      root,
      { mode: 'record', label: 'first process save', content: '{"fontSize":11}' },
      { LOCAL_HISTORY_ENTERED: entered, LOCAL_HISTORY_RELEASE: release }
    )
    await waitForFile(entered)

    // B is a separate Node process. It sees A's durable journal, safely publishes A through its
    // own index, then appends B. A remains suspended immediately before its stale CAS attempt.
    const second = spawnWorker(root, {
      mode: 'record',
      label: 'second process save',
      content: '{"fontSize":22}'
    })
    const secondResult = await second.result
    expect(secondResult, secondResult.stderr).toMatchObject({ code: 0, signal: null })
    expect(first.child.exitCode).toBeNull()

    await fs.writeFile(release, 'go')
    const firstResult = await first.result
    expect(firstResult, firstResult.stderr).toMatchObject({ code: 0, signal: null })

    const store = new LocalHistoryStore(root)
    const entries = await store.list('settings')
    expect(entries?.map((entry) => entry.label)).toEqual([
      'second process save',
      'first process save'
    ])
    expect(await store.restoreContent('settings', entries![0].sha, 'settings.json')).toBe(
      '{"fontSize":22}'
    )
    expect(await store.restoreContent('settings', entries![1].sha, 'settings.json')).toBe(
      '{"fontSize":11}'
    )
  }, 60_000)

  it('recovers a killed publisher from its journal without deleting its foreign index', async () => {
    const root = makeDir()
    const entered = path.join(root, 'crash-entered')
    const crashed = spawnWorker(
      root,
      { mode: 'record', label: 'crashed process save', content: '{"theme":"night"}' },
      { LOCAL_HISTORY_ENTERED: entered, LOCAL_HISTORY_CRASH: '1' }
    )
    await waitForFile(entered)
    const crashedResult = await crashed.result
    expect(crashedResult).toMatchObject({ code: 91, signal: null })

    const pendingDir = path.join(root, 'local-history', 'settings', '.nodeterm-history-pending')
    const pending = (await fs.readdir(pendingDir)).filter((entry) => entry.endsWith('.json'))
    expect(pending).toHaveLength(1)
    const crashedId = pending[0]!.slice(0, -'.json'.length)
    const indexDir = path.join(root, 'local-history', 'settings', '.git', 'nodeterm-history-indexes')
    const before = await directorySnapshot(indexDir)
    expect([...before.keys()].some((entry) => entry.includes(crashedId))).toBe(true)

    const recovery = spawnWorker(root, {
      mode: 'record',
      label: 'recovery process save',
      content: '{"theme":"day","fontSize":14}'
    })
    const recoveryResult = await recovery.result
    expect(recoveryResult, recoveryResult.stderr).toMatchObject({ code: 0, signal: null })

    const after = await directorySnapshot(indexDir)
    for (const [filename, digest] of before) {
      expect(after.get(filename)).toBe(digest)
    }
    expect((await fs.readdir(pendingDir)).some((entry) => entry === `${crashedId}.json`)).toBe(
      true
    )
    expect((await workerList(root)).map((entry) => entry.label)).toEqual([
      'recovery process save',
      'crashed process save'
    ])
  }, 60_000)

  it('uses a reader as a recovery barrier while a live foreign publisher and its files remain untouched', async () => {
    const root = makeDir()
    const seed = spawnWorker(root, {
      mode: 'record',
      label: 'seed save',
      content: '{"theme":"day"}'
    })
    expect(await seed.result).toMatchObject({ code: 0, signal: null })

    const entered = path.join(root, 'live-entered')
    const release = path.join(root, 'live-release')
    const live = spawnWorker(
      root,
      { mode: 'record', label: 'live suspended save', content: '{"theme":"night"}' },
      { LOCAL_HISTORY_ENTERED: entered, LOCAL_HISTORY_RELEASE: release }
    )
    await waitForFile(entered)
    const pendingDir = path.join(root, 'local-history', 'settings', '.nodeterm-history-pending')
    const indexDir = path.join(root, 'local-history', 'settings', '.git', 'nodeterm-history-indexes')
    const pendingBefore = await directorySnapshot(pendingDir)
    const indexesBefore = await directorySnapshot(indexDir)

    // The journal is complete even though A is suspended before CAS. list() safely replays it
    // through its own private index, then snapshots the post-recovery OID. A's files stay untouched.
    expect((await workerList(root)).map((entry) => entry.label)).toEqual([
      'live suspended save',
      'seed save'
    ])
    expect(await directorySnapshot(pendingDir)).toEqual(pendingBefore)
    expect(await directorySnapshot(indexDir)).toEqual(indexesBefore)
    expect(live.child.exitCode).toBeNull()

    await fs.writeFile(release, 'go')
    expect(await live.result).toMatchObject({ code: 0, signal: null })
    expect((await workerList(root)).map((entry) => entry.label)).toEqual([
      'live suspended save',
      'seed save'
    ])
  }, 60_000)

  it('keeps a list coherent when the ref advances after its HEAD snapshot', async () => {
    const root = makeDir()
    const seed = new LocalHistoryStore(root)
    await seed.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"value":1}',
      label: 'snapshot one',
      action: 'updated'
    })
    let moved = false
    const gatedGit: LocalHistoryGit = async (cwd, args, options) => {
      if (!moved && args[0] === 'log') {
        moved = true
        await new LocalHistoryStore(root).record({
          domain: 'settings',
          filename: 'settings.json',
          content: '{"value":2}',
          label: 'snapshot two',
          action: 'updated'
        })
      }
      return runLocalHistoryGit(cwd, args, options)
    }

    const entries = await new LocalHistoryStore(root, gatedGit).list('settings')
    expect(entries?.map((entry) => entry.label)).toEqual(['snapshot one'])
    expect((await new LocalHistoryStore(root).list('settings'))?.map((entry) => entry.label)).toEqual([
      'snapshot two',
      'snapshot one'
    ])
  }, 30_000)

  it('fails the whole read when a commit filename cannot be inspected', async () => {
    const root = makeDir()
    const store = new LocalHistoryStore(root)
    await store.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{}',
      label: 'one save',
      action: 'updated'
    })
    const brokenGit: LocalHistoryGit = async (cwd, args, options) => {
      if (args[0] === 'show' && args.includes('--name-only')) {
        const error = new Error('simulated object read failure') as Error & { code: number }
        error.code = 128
        throw error
      }
      return runLocalHistoryGit(cwd, args, options)
    }

    await expect(new LocalHistoryStore(root, brokenGit).list('settings')).resolves.toBeNull()
  }, 30_000)

  it('rejects malformed and foreign restore revisions before reading bytes', async () => {
    const firstRoot = makeDir()
    const secondRoot = makeDir()
    const first = new LocalHistoryStore(firstRoot)
    const second = new LocalHistoryStore(secondRoot)
    await first.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"owner":"first"}',
      label: 'first history',
      action: 'updated'
    })
    await second.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"owner":"second"}',
      label: 'second history',
      action: 'updated'
    })
    const foreign = (await second.list('settings'))![0].sha

    await expect(first.restoreContent('settings', '../HEAD', 'settings.json')).rejects.toThrow(
      'revision id is invalid'
    )
    await expect(first.restoreContent('settings', foreign, 'settings.json')).rejects.toThrow()
  }, 30_000)
})
