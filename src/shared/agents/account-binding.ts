/**
 * Resolve the managed account binding for a node. Claude and Codex keep separate account lists
 * and separate persisted fields, while custom agents must never inherit a managed account merely
 * because they use a similar launch command.
 */
export function boundAccountId(
  accountId: string | undefined,
  agentId: string | undefined
): string | undefined {
  if (!accountId) return undefined
  if (agentId !== undefined && agentId !== 'claude' && agentId !== 'codex') return undefined
  return accountId
}
