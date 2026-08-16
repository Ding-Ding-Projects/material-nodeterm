import type {
  LaunchIntentExecutionResult,
  PendingLaunch,
  TerminalLaunchIntent
} from '@shared/types'

/**
 * The two delivery capabilities a live renderer session may expose.
 *
 * `executeLaunchIntent` exists only on the local Windows desktop bridge. The legacy callback is
 * deliberately narrower: it accepts only already-authorized local shell source and is used by
 * Server Edition/SSH/relay sessions that never entered the Windows-profile planner.
 */
export interface PendingLaunchSessionPort {
  executeLaunchIntent?: (
    sessionId: string,
    launchId: string,
    launch: TerminalLaunchIntent
  ) => Promise<LaunchIntentExecutionResult>
  sendLegacyShellCommand(command: string): Promise<boolean>
}

export interface PendingLaunchSessionTarget {
  sessionId: string
  pending: PendingLaunch
  /** True only when this pane is owned by a trusted local Windows terminal profile. */
  localWindowsProfile: boolean
}

const SESSION_UNAVAILABLE: LaunchIntentExecutionResult = {
  ok: false,
  reason: 'session-unavailable',
  message: 'The terminal session is not ready for this queued launch.'
}

const UNSUPPORTED: LaunchIntentExecutionResult = {
  ok: false,
  reason: 'unsupported-shell',
  message: 'Queued launches are not available for this terminal session.'
}

/**
 * Execute one machine-local held launch against the exact live PTY session.
 *
 * A local Windows profile never degrades to shell text if the opaque planner is unavailable. On
 * the deliberately planner-free Server/SSH/relay paths, only the explicit shell-command variant
 * may retain the historical sendText behavior. Semantic agent intents can never cross that seam.
 */
export async function executePendingLaunchForSession(
  port: PendingLaunchSessionPort,
  target: PendingLaunchSessionTarget
): Promise<LaunchIntentExecutionResult> {
  if (port.executeLaunchIntent) {
    return port.executeLaunchIntent(
      target.sessionId,
      target.pending.launchId,
      target.pending.launch
    )
  }

  if (target.localWindowsProfile || target.pending.launch.kind !== 'shell-command') {
    return UNSUPPORTED
  }

  return (await port.sendLegacyShellCommand(target.pending.launch.command))
    ? { ok: true }
    : SESSION_UNAVAILABLE
}
