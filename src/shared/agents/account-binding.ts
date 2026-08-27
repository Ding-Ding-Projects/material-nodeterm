/**
 * Resolve the managed account actually bound to a node. This is the shared predicate behind both
 * the persisted account id and its default node color, so those two facts cannot drift apart.
 *
 * The canvas always supplies a known builtin agent. The phone registration path may omit agentId,
 * so an unstated agent keeps the supplied binding; a known non-Claude/Codex agent is refused.
 */
export function boundAccountId(
  accountId: string | undefined,
  agentId: string | undefined
): string | undefined {
  if (!accountId) return undefined
  if (agentId !== undefined && agentId !== 'claude' && agentId !== 'codex') return undefined
  return accountId
}
