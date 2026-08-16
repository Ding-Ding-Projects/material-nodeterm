import { fork, type ChildProcess } from 'child_process'
import { promises as fs, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { pairingRegistryLockPath, withPairingRegistryLock } from './pairing-registry-lock'

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nt-pairing-lock-'))
const workerBundle = path.join(tempDir, 'pairing-lock-worker.cjs')
const testDir = path.dirname(fileURLToPath(import.meta.url))

function waitForMessage(child: ChildProcess, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker did not report ${type}`)), 3_000)
    const onMessage = (message: unknown): void => {
      if ((message as { type?: unknown } | null)?.type !== type) return
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('error', onError)
      child.off('exit', onExit)
      resolve()
    }
    const onError = (error: Error): void => {
      clearTimeout(timer)
      child.off('message', onMessage)
      reject(error)
    }
    const onExit = (code: number | null): void => {
      clearTimeout(timer)
      child.off('message', onMessage)
      reject(new Error(`worker exited ${String(code)} before ${type}`))
    }
    child.on('message', onMessage)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`worker exited with ${String(code)}`))
    })
  })
}

function spawnWorker(agentJsonPath: string, role: 'host' | 'desktop'): ChildProcess {
  return fork(workerBundle, [agentJsonPath, role], {
    silent: true
  })
}

beforeAll(async () => {
  await build({
    entryPoints: [path.join(testDir, 'pairing-registry-lock.worker.ts')],
    outfile: workerBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent'
  })
})

afterAll(() => {
  if (!path.basename(tempDir).startsWith('nt-pairing-lock-')) {
    throw new Error(`refusing to remove unexpected lock-test path: ${tempDir}`)
  }
  rmSync(tempDir, { recursive: true, force: true })
})

describe('pairing registry cross-process lock', () => {
  it('preserves a host-agent write and a desktop device write across real processes', async () => {
    const agentJsonPath = path.join(tempDir, 'agent.json')
    await fs.writeFile(agentJsonPath, JSON.stringify({ v: 1, port: 1000 }) + '\n')

    const host = spawnWorker(agentJsonPath, 'host')
    await waitForMessage(host, 'entered')
    const desktop = spawnWorker(agentJsonPath, 'desktop')
    await waitForMessage(desktop, 'contended')

    const hostExit = waitForExit(host)
    const desktopExit = waitForExit(desktop)
    host.send('release')
    await Promise.all([hostExit, desktopExit])

    const final = JSON.parse(await fs.readFile(agentJsonPath, 'utf8')) as Record<string, unknown>
    expect(final).toMatchObject({ v: 1, port: 4321, lastHostWrite: 'preserved' })
    expect(final.devices).toEqual([
      { id: 'new-phone', token: 'test-token' }
    ])
    await expect(fs.stat(pairingRegistryLockPath(agentJsonPath))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('times out closed without running a mutation when another owner holds the lock', async () => {
    const agentJsonPath = path.join(tempDir, 'timeout-agent.json')
    await fs.writeFile(agentJsonPath, '{}\n')
    await fs.writeFile(pairingRegistryLockPath(agentJsonPath), 'occupied\n')
    const mutate = vi.fn(async () => undefined)

    await expect(
      withPairingRegistryLock(agentJsonPath, mutate, { retryMs: 5, timeoutMs: 25 })
    ).rejects.toThrow(/no credential files were changed/)

    expect(mutate).not.toHaveBeenCalled()
    await expect(fs.readFile(pairingRegistryLockPath(agentJsonPath), 'utf8')).resolves.toBe(
      'occupied\n'
    )
  })
})
