import { describe, expect, it, vi } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { stopOwnedCodexRelayProcess, type OwnedRelayProcess } from './codex-relay-lifecycle'

function waitFor(child: ChildProcess, event: 'spawn' | 'exit'): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once(event, () => resolve())
    child.once('error', reject)
  })
}

function relayProcess(state: { exited?: boolean } = {}): OwnedRelayProcess & {
  emitExit(): void
  kill: ReturnType<typeof vi.fn>
} {
  let exitCode: number | null = state.exited ? 0 : null
  let signalCode: NodeJS.Signals | null = null
  const listeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()
  const kill = vi.fn(() => true)
  return {
    get exitCode() {
      return exitCode
    },
    get signalCode() {
      return signalCode
    },
    kill,
    once(_event, listener) {
      listeners.add(listener)
      return this
    },
    removeListener(_event, listener) {
      listeners.delete(listener)
      return this
    },
    emitExit() {
      exitCode = 0
      signalCode = 'SIGTERM'
      for (const listener of [...listeners]) listener(exitCode, signalCode)
    }
  }
}

describe('owned Codex relay shutdown', () => {
  it('signals and awaits only the exact relay process owned by this application instance', async () => {
    const owned = relayProcess()
    const unrelated = relayProcess()

    const stopped = stopOwnedCodexRelayProcess(owned, 100)
    expect(owned.kill).toHaveBeenCalledTimes(1)
    expect(unrelated.kill).not.toHaveBeenCalled()

    owned.emitExit()
    await expect(stopped).resolves.toBe('stopped')
    expect(unrelated.exitCode).toBeNull()
  })

  it('does not signal a relay that already exited', async () => {
    const exited = relayProcess({ exited: true })
    await expect(stopOwnedCodexRelayProcess(exited, 100)).resolves.toBe('already-stopped')
    expect(exited.kill).not.toHaveBeenCalled()
  })

  it('returns at the deadline when an owned relay does not acknowledge termination', async () => {
    const stuck = relayProcess()
    await expect(stopOwnedCodexRelayProcess(stuck, 5)).resolves.toBe('timed-out')
    expect(stuck.kill).toHaveBeenCalledTimes(1)
  })

  it('terminates a real owned child and leaves a sibling process running', async () => {
    const script = 'setInterval(() => undefined, 1000)'
    const owned = spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
    const sibling = spawn(process.execPath, ['-e', script], { stdio: 'ignore' })
    try {
      await Promise.all([waitFor(owned, 'spawn'), waitFor(sibling, 'spawn')])
      await expect(stopOwnedCodexRelayProcess(owned, 2_000)).resolves.toBe('stopped')
      expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true)
      expect(sibling.exitCode).toBeNull()
      expect(sibling.signalCode).toBeNull()
    } finally {
      if (owned.exitCode === null && owned.signalCode === null) {
        const exited = waitFor(owned, 'exit')
        owned.kill('SIGKILL')
        await exited
      }
      if (sibling.exitCode === null && sibling.signalCode === null) {
        const exited = waitFor(sibling, 'exit')
        sibling.kill('SIGKILL')
        await exited
      }
    }
  })
})
