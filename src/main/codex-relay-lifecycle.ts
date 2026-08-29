export const CODEX_RELAY_SHUTDOWN_DEADLINE_MS = 1_000

export interface OwnedRelayProcess {
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown
  removeListener(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown
}

export type OwnedRelayStopResult = 'already-stopped' | 'stopped' | 'signal-refused' | 'timed-out'

/**
 * Stop only the relay child whose ChildProcess object this application instance retained. Process
 * names and persisted pid files are deliberately excluded because either could identify an older
 * relay owned by another still-running instance. The deadline joins the existing bounded quit
 * flush, so an unresponsive child is reported without holding Electron open forever.
 */
export function stopOwnedCodexRelayProcess(
  child: OwnedRelayProcess,
  timeoutMs = CODEX_RELAY_SHUTDOWN_DEADLINE_MS
): Promise<OwnedRelayStopResult> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve('already-stopped')

  const deadline = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : CODEX_RELAY_SHUTDOWN_DEADLINE_MS
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const onExit = (): void => finish('stopped')
    const finish = (result: OwnedRelayStopResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(result)
    }

    child.once('exit', onExit)
    timer = setTimeout(() => finish('timed-out'), deadline)
    try {
      if (!child.kill()) {
        finish(child.exitCode !== null || child.signalCode !== null ? 'stopped' : 'signal-refused')
        return
      }
    } catch {
      finish(child.exitCode !== null || child.signalCode !== null ? 'stopped' : 'signal-refused')
      return
    }
  })
}
