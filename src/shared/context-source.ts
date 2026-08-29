import type { AgentId, BuiltinAgentId } from './agents/config'

const NUMERIC_PROVIDERS: readonly BuiltinAgentId[] = ['claude', 'codex', 'gemini']
const HOST_SOURCE_RE = /^[^@\s]+@(?:\[[^\]\s]+\]|[^:\s]+):\d+$/
export const CONTEXT_STALE_AFTER_MS = 45_000
export const MAX_CONTEXT_TOKENS = 100_000_000

export function isContextSource(source: unknown): source is string {
  return source === 'local' || (typeof source === 'string' && HOST_SOURCE_RE.test(source))
}

export function contextPercentFromCounts(used: unknown, total: unknown): number | null {
  if (!Number.isSafeInteger(used) || !Number.isSafeInteger(total) || (used as number) < 0 || (total as number) <= 0 || (used as number) > MAX_CONTEXT_TOKENS || (total as number) > MAX_CONTEXT_TOKENS) return null
  return Math.min(100, Math.max(0, ((used as number) / (total as number)) * 100))
}

export interface ContextSourceNodeLike {
  agentId?: unknown
  sshRemoteTmux?: unknown
  ssh?: { user?: unknown; host?: unknown; port?: unknown }
  /** Trusted source override for main-process mirror records. */
  source?: string
}

export interface ContextSource {
  agentId?: AgentId
  source: string
  telemetryAvailable: boolean
}

/** Authoritative availability matrix used by every surface and by source-level contract checks. */
export const CONTEXT_TELEMETRY_MATRIX = Object.freeze({
  claude: Object.freeze({ local: true, host: true }),
  codex: Object.freeze({ local: true, host: false }),
  gemini: Object.freeze({ local: true, host: false }),
  grok: Object.freeze({ local: false, host: false }),
  opencode: Object.freeze({ local: false, host: false }),
  custom: Object.freeze({ local: false, host: false })
} as const)

/** One source decision for renderer cards, sidebar rows, and provider mirror attribution. Remote
 * source labels carry user, host, and port. ControlMaster and transcript paths are deliberately
 * not exposed in shared node data; a remote retrack compares both privately before changing epoch. */
export function contextSourceForNode(node: ContextSourceNodeLike): ContextSource {
  const agentId = typeof node.agentId === 'string' && node.agentId ? (node.agentId as AgentId) : undefined
  const remote = node.sshRemoteTmux === true
  const host = node.ssh && typeof node.ssh.user === 'string' && typeof node.ssh.host === 'string'
    ? `${node.ssh.user}@${node.ssh.host}:${typeof node.ssh.port === 'number' ? node.ssh.port : 22}`
    : undefined
  // A host reading is only attributable when the complete user@host:port identity is known.
  // The generic word "remote" is deliberately not an admissible telemetry source: it could
  // let a cached reading from one SSH host appear on another host's node.
  const source = node.source || (remote ? host || 'remote:unresolved' : 'local')
  const explicitHostSource = source !== 'local' && HOST_SOURCE_RE.test(source)
  const hostSource = remote || explicitHostSource
  return {
    agentId,
    source,
    telemetryAvailable: !!agentId && NUMERIC_PROVIDERS.includes(agentId as BuiltinAgentId) &&
      (CONTEXT_TELEMETRY_MATRIX[agentId as BuiltinAgentId]?.[hostSource ? 'host' : 'local'] ?? false) &&
      (!hostSource || !!host || explicitHostSource)
  }
}
