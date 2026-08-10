import { restartEligibility } from '../terminal/agent-restart'

export interface CodexAccountSwitchState {
  accountId?: string
  agentId?: string
  cwd?: string
  sessionId?: string
  ssh?: boolean
  state?: string
}

/**
 * The account fork can take seconds. Nothing may recycle the source pane unless it is still the
 * exact idle conversation that the user chose when the fork began.
 */
export function codexAccountSwitchStillEligible(
  expected: Required<Pick<CodexAccountSwitchState, 'agentId' | 'cwd' | 'sessionId'>> &
    Pick<CodexAccountSwitchState, 'accountId'>,
  current: CodexAccountSwitchState
): boolean {
  return (
    current.agentId === expected.agentId &&
    current.agentId === 'codex' &&
    !current.ssh &&
    current.cwd === expected.cwd &&
    current.accountId === expected.accountId &&
    current.sessionId === expected.sessionId &&
    restartEligibility('codex', current.state, current.sessionId).ok
  )
}
