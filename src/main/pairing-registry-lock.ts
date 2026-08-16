import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

const DEFAULT_RETRY_MS = 25
const DEFAULT_TIMEOUT_MS = 10_000

export interface PairingRegistryLockOptions {
  retryMs?: number
  timeoutMs?: number
  /** Deterministic contention barrier for the real two-process contract Chut. */
  onContended?(): void
}

/** The shared lock name every agent.json writer, including the companion host agent, must use. */
export function pairingRegistryLockPath(agentJsonPath: string): string {
  return `${agentJsonPath}.lock`
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Serialize a complete agent.json read-modify-write transaction across processes.
 *
 * Acquisition is an O_EXCL create, so observing the lock happens before the authoritative read.
 * A timeout fails closed: this helper never guesses that an existing lock is stale, because
 * deleting a live writer's lock would let a second process publish a stale credential snapshot.
 * The lock carries no credentials, only diagnostic ownership metadata.
 */
export async function withPairingRegistryLock<T>(
  agentJsonPath: string,
  fn: () => Promise<T>,
  options: PairingRegistryLockOptions = {}
): Promise<T> {
  const lockPath = pairingRegistryLockPath(agentJsonPath)
  const retryMs = Math.max(1, options.retryMs ?? DEFAULT_RETRY_MS)
  const timeoutMs = Math.max(retryMs, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const startedAt = Date.now()
  const owner = JSON.stringify({ v: 1, pid: process.pid, nonce: randomUUID(), startedAt }) + '\n'
  let contended = false

  await fs.mkdir(path.dirname(agentJsonPath), { recursive: true, mode: 0o700 })
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(owner, 'utf8')
        await handle.close()
      } catch (error) {
        await handle.close().catch(() => undefined)
        await fs.rm(lockPath, { force: true }).catch(() => undefined)
        throw error
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
      if (!contended) {
        contended = true
        options.onContended?.()
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          'Timed out waiting for the pairing registry lock; no credential files were changed.'
        )
      }
      await delay(retryMs)
    }
  }

  let operationFailed = false
  let operationError: unknown
  try {
    return await fn()
  } catch (error) {
    operationFailed = true
    operationError = error
    throw error
  } finally {
    try {
      await fs.rm(lockPath)
    } catch (releaseError) {
      if (operationFailed) {
        throw new AggregateError(
          [operationError, releaseError],
          'Pairing registry mutation and lock release both failed.'
        )
      }
      throw releaseError
    }
  }
}
