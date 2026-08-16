import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { build } from 'esbuild'
import type { MirrorFile } from './agent-status-mirror'

interface ChildMessage {
  type: 'temp-written' | 'lock-held' | 'flushed' | 'error'
  generation?: number
  state?: string
  message?: string
}

interface ChildResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

let fixtureDir = ''
let fixtureBundle = ''
const children = new Set<ChildProcess>()

function spawnFixture(mode: string, file: string): ChildProcess {
  const child = spawn(process.execPath, [fixtureBundle, mode, file], {
    // If the crash-recovery fixture emits a platform crash dump, keep it inside the disposable
    // fixture directory rather than the repository under test.
    cwd: path.dirname(fixtureBundle),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

function waitForMessage(child: ChildProcess, type: ChildMessage['type'], timeoutMs = 10_000): Promise<ChildMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for child message ${type}`))
    }, timeoutMs)
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(new Error(`child exited before ${type}: code=${code} signal=${signal}`))
    }
    const onMessage = (raw: unknown): void => {
      if (!raw || typeof raw !== 'object') return
      const message = raw as ChildMessage
      if (message.type === 'error') {
        cleanup()
        reject(new Error(message.message ?? 'fixture error'))
        return
      }
      if (message.type !== type) return
      cleanup()
      resolve(message)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
  })
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<ChildResult> {
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
  return new Promise((resolve, reject) => {
    // A fixture sends its final IPC message immediately before disconnecting. On a fast machine it
    // can exit in the gap before this function is called; exitCode/signalCode preserve that result.
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode, stdout, stderr })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`child exit timed out\nstdout: ${stdout}\nstderr: ${stderr}`))
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-mirror-process-'))
  fixtureBundle = path.join(fixtureDir, 'mirror-fixture.cjs')
  await build({
    absWorkingDir: process.cwd(),
    entryPoints: ['src/core/testing/agent-status-mirror-process-fixture.ts'],
    outfile: fixtureBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: { '@shared': path.join(process.cwd(), 'src/shared') },
    logLevel: 'silent'
  })
})

afterAll(async () => {
  const liveChildren = [...children]
  const exits = liveChildren.map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise<void>((resolve) => child.once('exit', () => resolve()))
  })
  for (const child of liveChildren) child.kill('SIGKILL')
  await Promise.all(exits)
  if (fixtureDir) {
    fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('agent-status mirror cross-process publication', () => {
  it('fences an older parked snapshot after a newer process publishes', async () => {
    const dir = fs.mkdtempSync(path.join(fixtureDir, 'race-'))
    const file = path.join(dir, 'agent-status.json')

    const older = spawnFixture('working-barrier', file)
    const parked = await waitForMessage(older, 'temp-written')
    expect(parked.generation).toBe(1)

    const newer = spawnFixture('done', file)
    const published = await waitForMessage(newer, 'flushed')
    expect(published).toMatchObject({ generation: 2, state: 'done' })
    const newerExit = await waitForExit(newer)
    expect(newerExit, newerExit.stderr).toMatchObject({ code: 0, signal: null })

    // A wrote generation 1's complete temp before generation 2 existed. Releasing it now is the
    // exact stale-snapshot resurrection: without the locked generation comparison it wins last.
    older.send({ type: 'release' })
    const olderFinished = await waitForMessage(older, 'flushed')
    expect(olderFinished).toMatchObject({ generation: 2, state: 'done' })
    const olderExit = await waitForExit(older)
    expect(olderExit, olderExit.stderr).toMatchObject({ code: 0, signal: null })

    const finalDoc = JSON.parse(fs.readFileSync(file, 'utf8')) as MirrorFile
    expect(finalDoc.generation).toBe(2)
    expect(finalDoc.nodes['shared-node']?.state).toBe('done')
  }, 20_000)

  it('waits for a live lock owner and recovers immediately after that process crashes', async () => {
    const dir = fs.mkdtempSync(path.join(fixtureDir, 'crash-'))
    const file = path.join(dir, 'agent-status.json')
    const holder = spawnFixture('hold-lock', file)
    await waitForMessage(holder, 'lock-held')

    const recovery = spawnFixture('done', file)
    let recoverySettled = false
    const recoveryMessage = waitForMessage(recovery, 'flushed').then((message) => {
      recoverySettled = true
      return message
    }, (error: unknown) => {
      recoverySettled = true
      throw error
    })
    void recoveryMessage.catch(() => {})
    // Observe genuine contention before the crash. A timeout-based lease could steal from this
    // still-live owner; the SQLite transaction must keep the peer out for as long as it is held.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(recoverySettled).toBe(false)
    expect(fs.existsSync(file)).toBe(false)

    const holderExit = waitForExit(holder)
    holder.send({ type: 'abort' })
    await holderExit

    const flushed = await recoveryMessage
    expect(flushed).toMatchObject({ generation: 1, state: 'done' })
    const recoveryExit = await waitForExit(recovery)
    expect(recoveryExit, recoveryExit.stderr).toMatchObject({ code: 0, signal: null })
  }, 20_000)
})
