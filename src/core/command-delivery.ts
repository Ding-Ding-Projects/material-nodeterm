/**
 * Deliver one core-rendered command into an interactive shell without racing its startup.
 *
 * The command is deliberately opaque here. A trusted planner already rendered it for the live
 * shell dialect; this module only owns terminal choreography. In particular, no result or error
 * returned from this module contains the command, terminal output, or a caught transport error.
 */

export const CORE_COMMAND_PROMPT_QUIET_MS = 200
export const CORE_COMMAND_PROMPT_SILENCE_CAP_MS = 1500
export const CORE_COMMAND_VERIFY_TIMEOUT_MS = 2000
export const CORE_COMMAND_DELIVERY_ATTEMPTS = 3
export const CORE_COMMAND_ECHO_TAIL_CHARS = 24

/** Ctrl-U: discard a partially typed line before another attempt. */
export const CORE_COMMAND_KILL_LINE = '\x15'

// CSI (ESC [ ...), OSC (ESC ] ... BEL/ST), and single-character ESC sequences.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g

/** Remove terminal presentation noise while preserving the literal echoed command text. */
export function cleanCoreCommandEcho(chunk: string): string {
  // Interactive shells may explicitly wrap a long input line with CR/LF.
  // eslint-disable-next-line no-control-regex
  return chunk.replace(ESCAPE_SEQUENCE, '').replace(/[\r\n]/g, '')
}

/**
 * Match only the rendered command tail. The head of an echo is commonly polluted by the prompt,
 * while a sufficiently long tail still distinguishes a complete echo from a tty-flushed prefix.
 */
export function coreCommandEchoedIntact(
  cleanedEcho: string,
  renderedCommand: string,
  tailChars = CORE_COMMAND_ECHO_TAIL_CHARS,
): boolean {
  if (!renderedCommand) return false
  const width = Math.max(1, Math.floor(tailChars))
  return cleanedEcho.includes(renderedCommand.slice(-width))
}

export interface CoreCommandDeliveryIo {
  write(data: string): void
  /** Subscribe to raw PTY output. The returned function removes exactly this subscription. */
  onData(callback: (chunk: string) => void): () => void
}

export interface CoreCommandDeliveryOptions {
  /** Output must remain quiet for this long before the first write or a retry. */
  promptQuietMs?: number
  /** If the shell produces no observable prompt output, begin after this bounded fallback. */
  promptSilenceCapMs?: number
  /** Time allowed for the rendered command's echo to confirm one attempt. */
  verifyTimeoutMs?: number
  /** Total writes of the rendered command, including the first attempt. */
  attempts?: number
  /** Number of trailing rendered-command characters required in the cleaned echo. */
  echoTailChars?: number
}

export type CoreCommandDeliveryCancelReason = 'cancelled' | 'exited'

/** Sanitized terminal choreography outcome. It intentionally carries no message or input text. */
export type CoreCommandDeliveryResult =
  | Readonly<{
      status: 'submitted'
      verified: boolean
      attempts: number
    }>
  | Readonly<{
      status: 'cancelled' | 'exited' | 'io-error'
      attempts: number
    }>

export interface CoreCommandDeliveryHandle {
  /** Resolves exactly once; never rejects with a transport error containing private material. */
  result: Promise<CoreCommandDeliveryResult>
  /** Stop every timer/listener. Repeated or post-settlement cancellation is a no-op. */
  cancel(reason?: CoreCommandDeliveryCancelReason): void
}

type DeliveryPhase = 'waiting-for-prompt' | 'verifying' | 'settled'

function finiteDelay(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback
}

/**
 * Wait for a quiet prompt, type the rendered command without Enter, echo-verify it, and submit it
 * once. Missing/mangled echo is retried behind Ctrl-U; the final bounded attempt submits unverified
 * so a shell whose echo cannot be recognized does not permanently suppress the requested launch.
 *
 * `stdinAfterStart` is intentionally not part of this API. An agent's literal follow-up input needs
 * an agent-readiness signal, not merely evidence that the shell accepted its launch line.
 */
export function deliverCoreCommand(
  io: CoreCommandDeliveryIo,
  renderedCommand: string,
  options: CoreCommandDeliveryOptions = {},
): CoreCommandDeliveryHandle {
  const promptQuietMs = finiteDelay(
    options.promptQuietMs,
    CORE_COMMAND_PROMPT_QUIET_MS,
  )
  const promptSilenceCapMs = finiteDelay(
    options.promptSilenceCapMs,
    CORE_COMMAND_PROMPT_SILENCE_CAP_MS,
  )
  const verifyTimeoutMs = finiteDelay(
    options.verifyTimeoutMs,
    CORE_COMMAND_VERIFY_TIMEOUT_MS,
  )
  const maxAttempts = positiveInteger(
    options.attempts,
    CORE_COMMAND_DELIVERY_ATTEMPTS,
  )
  const echoTailChars = positiveInteger(
    options.echoTailChars,
    CORE_COMMAND_ECHO_TAIL_CHARS,
  )

  let phase: DeliveryPhase = 'waiting-for-prompt'
  let attempts = 0
  let attemptEpoch = 0
  let activeAttemptEpoch = 0
  let cleanedEcho = ''
  let promptQuietTimer: ReturnType<typeof setTimeout> | undefined
  let promptCapTimer: ReturnType<typeof setTimeout> | undefined
  let verifyTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  let resolveResult!: (result: CoreCommandDeliveryResult) => void
  const result = new Promise<CoreCommandDeliveryResult>((resolve) => {
    resolveResult = resolve
  })

  const clearTimer = (
    timer: ReturnType<typeof setTimeout> | undefined,
  ): void => {
    if (timer !== undefined) clearTimeout(timer)
  }

  const closeResources = (): void => {
    clearTimer(promptQuietTimer)
    clearTimer(promptCapTimer)
    clearTimer(verifyTimer)
    promptQuietTimer = undefined
    promptCapTimer = undefined
    verifyTimer = undefined
    const remove = unsubscribe
    unsubscribe = undefined
    if (remove) {
      try {
        remove()
      } catch {
        // An unsubscribe failure is private transport detail. Timers are already cold, and the
        // settled phase makes a stray callback inert, so there is nothing safe or useful to expose.
      }
    }
  }

  const complete = (outcome: CoreCommandDeliveryResult): void => {
    if (phase === 'settled') return
    phase = 'settled'
    // Invalidate every captured verify timeout before touching an io that may synchronously echo.
    activeAttemptEpoch = ++attemptEpoch
    closeResources()
    resolveResult(outcome)
  }

  const failIo = (): void => {
    complete({ status: 'io-error', attempts })
  }

  const safeWrite = (data: string): boolean => {
    try {
      io.write(data)
      return true
    } catch {
      // Never forward Error.message: transports are allowed to include their payload in it.
      failIo()
      return false
    }
  }

  const submit = (verified: boolean, epoch: number): void => {
    if (phase !== 'verifying' || activeAttemptEpoch !== epoch) return

    // Close first. An io may echo synchronously from write('\r'); keeping the listener active here
    // would re-enter submission while the same tail still matches and send duplicate Enters.
    phase = 'settled'
    activeAttemptEpoch = ++attemptEpoch
    closeResources()
    try {
      io.write('\r')
    } catch {
      resolveResult({ status: 'io-error', attempts })
      return
    }
    resolveResult({ status: 'submitted', verified, attempts })
  }

  let beginAttempt!: () => void

  const armPromptQuiet = (): void => {
    if (phase !== 'waiting-for-prompt') return
    clearTimer(promptQuietTimer)
    promptQuietTimer = setTimeout(() => beginAttempt(), promptQuietMs)
  }

  const waitForPrompt = (armQuietImmediately: boolean): void => {
    if (phase === 'settled') return
    phase = 'waiting-for-prompt'
    activeAttemptEpoch = ++attemptEpoch
    cleanedEcho = ''
    clearTimer(promptQuietTimer)
    clearTimer(promptCapTimer)
    clearTimer(verifyTimer)
    promptQuietTimer = undefined
    verifyTimer = undefined
    promptCapTimer = setTimeout(() => beginAttempt(), promptSilenceCapMs)
    if (armQuietImmediately) armPromptQuiet()
  }

  const retry = (epoch: number): void => {
    if (phase !== 'verifying' || activeAttemptEpoch !== epoch) return

    // Enter the waiting phase before Ctrl-U. A synchronous redraw caused by the kill must be prompt
    // activity for the next attempt, never mistaken for the previous/current command's echo.
    waitForPrompt(true)
    if (!safeWrite(CORE_COMMAND_KILL_LINE)) return
  }

  beginAttempt = (): void => {
    if (phase !== 'waiting-for-prompt') return
    clearTimer(promptQuietTimer)
    clearTimer(promptCapTimer)
    promptQuietTimer = undefined
    promptCapTimer = undefined
    phase = 'verifying'
    attempts += 1
    cleanedEcho = ''
    const epoch = ++attemptEpoch
    activeAttemptEpoch = epoch

    // Arm before write: direct/in-memory transports may echo synchronously from inside write().
    verifyTimer = setTimeout(() => {
      if (phase !== 'verifying' || activeAttemptEpoch !== epoch) return
      if (attempts >= maxAttempts) {
        submit(false, epoch)
      } else {
        retry(epoch)
      }
    }, verifyTimeoutMs)
    safeWrite(renderedCommand)
  }

  const onData = (chunk: string): void => {
    if (phase === 'settled') return
    if (phase === 'waiting-for-prompt') {
      // Startup/redraw output postpones delivery until the prompt has remained quiet. It is not
      // eligible to verify a later attempt, even if it happens to contain the same command text.
      armPromptQuiet()
      return
    }

    const epoch = activeAttemptEpoch
    const combined = cleanedEcho + cleanCoreCommandEcho(chunk)
    if (coreCommandEchoedIntact(combined, renderedCommand, echoTailChars)) {
      submit(true, epoch)
      return
    }
    // Keep only a small suffix. PTY output is untrusted and an echo timeout must not become an
    // unbounded transcript buffer inside the trusted core.
    cleanedEcho = combined.slice(-Math.max(echoTailChars * 2, 128))
  }

  try {
    unsubscribe = io.onData(onData)
  } catch {
    failIo()
  }

  // `waitForPrompt` is itself settlement-aware. Calling it unconditionally also keeps runtime
  // subscription failures on the same path without relying on TypeScript to infer closure effects.
  waitForPrompt(false)

  return {
    result,
    cancel: (reason = 'cancelled') => {
      if (phase === 'settled') return
      complete({
        status: reason === 'exited' ? 'exited' : 'cancelled',
        attempts,
      })
    },
  }
}
