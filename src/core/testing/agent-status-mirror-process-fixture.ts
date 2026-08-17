import fs from 'fs'
import {
  _cancelScheduledWriteForTest,
  flush,
  initAgentStatusMirror,
  recordAgentEvent,
  type MirrorFile
} from '../agent-status-mirror'
import { loadNodeSqlite } from '../node-runtime'
import type { NormalizedAgentEvent } from '@shared/agents/normalize'

type FixtureMessage =
  | { type: 'temp-written'; generation: number }
  | { type: 'lock-held' }
  | { type: 'flushed'; generation: number; state?: string }
  | { type: 'error'; message: string }

function send(message: FixtureMessage): void {
  if (!process.connected || !process.send) return
  // A debounced callback can lose a race with the parent's teardown. Supplying a callback keeps a
  // closed IPC channel from becoming an unhandled process error in the behavior test itself.
  process.send(message, () => {})
}

function waitForRelease(): Promise<void> {
  return new Promise((resolve) => {
    const listener = (message: unknown): void => {
      if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'release') return
      process.off('message', listener)
      resolve()
    }
    process.on('message', listener)
  })
}

async function holdPublicationLock(file: string): Promise<void> {
  // This mode exists only for the crash-recovery test. BEGIN IMMEDIATE takes the same SQLite
  // writer transaction used by production without changing the otherwise-empty lock database.
  // process.abort then proves the OS releases it without any application cleanup or stale timer.
  const { DatabaseSync } = loadNodeSqlite()
  const database = new DatabaseSync(`${file}.publication.sqlite3`)
  database.exec('BEGIN IMMEDIATE')
  send({ type: 'lock-held' })
  await new Promise<never>(() => {
    process.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'abort') {
        // process.abort bypasses JS cleanup. SQLite must lose its kernel lock solely because the OS
        // closes this process's database handle, exactly as it does after a host/process crash.
        // Keep the handle observably reachable until that instant: Node 22 can otherwise finalize
        // an unreferenced DatabaseSync while this process remains alive and release the test lock.
        database.exec('SELECT 1')
        process.abort()
      }
    })
  })
}

async function writeGeneration(file: string, state: 'working' | 'done', barrier: boolean): Promise<void> {
  initAgentStatusMirror(file)

  if (barrier) {
    const originalWrite = fs.promises.writeFile.bind(fs.promises)
    fs.promises.writeFile = async (target, data, options): Promise<void> => {
      await originalWrite(target, data, options)
      const text = typeof data === 'string' ? data : data.toString()
      // The counter sidecar also contains a generation. Only the mirror document has nodes.
      if (String(target).startsWith(`${file}.`) && text.includes('"nodes"')) {
        const generation = (JSON.parse(text) as MirrorFile).generation
        send({ type: 'temp-written', generation: generation ?? -1 })
        await waitForRelease()
      }
    }
  }

  recordAgentEvent({
    nodeId: 'shared-node',
    agentId: 'claude',
    kind: 'state',
    state,
    ...(state === 'working' ? { newTurn: true } : {})
  } as NormalizedAgentEvent)
  // This fixture controls exactly one flush per worker. Leaving the production 300 ms debounce
  // armed would create a third generation under a loaded full suite and change the scenario from
  // "older invocation returns" to "the old process legitimately invoked a newer flush".
  _cancelScheduledWriteForTest()
  await flush()
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as MirrorFile
  send({ type: 'flushed', generation: doc.generation ?? -1, state: doc.nodes['shared-node']?.state })
}

async function main(): Promise<void> {
  const [, , mode, file] = process.argv
  if (!mode || !file) throw new Error('usage: fixture <hold-lock|working-barrier|done> <mirror>')
  if (mode === 'hold-lock') return holdPublicationLock(file)
  if (mode === 'working-barrier') return writeGeneration(file, 'working', true)
  if (mode === 'done') return writeGeneration(file, 'done', false)
  throw new Error(`unknown fixture mode: ${mode}`)
}

void main()
  .then(() => process.disconnect?.())
  .catch((error: unknown) => {
    send({ type: 'error', message: error instanceof Error ? error.stack ?? error.message : String(error) })
    process.exitCode = 1
    process.disconnect?.()
  })
