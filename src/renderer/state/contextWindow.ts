import { create } from 'zustand'
import type { ContextWindowUsage } from '@shared/types'
import { CONTEXT_TELEMETRY_MATRIX, contextPercentFromCounts, isContextSource } from '@shared/context-source'

const KEY = 'nodeterm.contextWindow'
const MAX_SESSIONS = 200
const SAVE_DEBOUNCE_MS = 2000
export const CONTEXT_STALE_AFTER_MS = 2 * 60 * 1000
const STALE_CLOCK_MS = 15_000
const activeSessions = new Set<string>()

type StoredUsage = Partial<ContextWindowUsage>

function sourceKeyFor(sessionId: string, sourceKey: string): string {
  return `${sourceKey}::${sessionId}`
}

export function retainContextSession(sessionId: string | null, sourceKey?: string): () => void {
  if (!sessionId) return () => {}
  const key = sourceKeyFor(sessionId, sourceKey ?? 'unknown:local')
  activeSessions.add(key)
  return () => activeSessions.delete(key)
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalize(value: unknown, fallbackSessionId?: string): ContextWindowUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<StoredUsage>
  const sessionId = typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : fallbackSessionId
  if (!sessionId) return null
  const sourceKey = typeof raw.sourceKey === 'string' && raw.sourceKey ? raw.sourceKey : 'claude:local'
  const provider = typeof raw.provider === 'string' && raw.provider ? raw.provider : sourceKey.split(':', 1)[0]
  const usedTokens = raw.usedTokens === null || isFiniteNonNegative(raw.usedTokens) ? raw.usedTokens ?? null : null
  const windowTokens = raw.windowTokens === null || (isFiniteNonNegative(raw.windowTokens) && raw.windowTokens > 0)
    ? raw.windowTokens ?? null
    : null
  const usedPercent = raw.usedPercent === null || (isFiniteNonNegative(raw.usedPercent) && raw.usedPercent <= 100)
    ? raw.usedPercent ?? null
    : null
  const updatedAt = raw.updatedAt === null || isFiniteNonNegative(raw.updatedAt) ? raw.updatedAt ?? null : null
  const status = usedPercent !== null && windowTokens !== null
    ? 'known'
    : raw.status === 'unavailable' || raw.status === 'not-reported'
      ? raw.status
      : 'stale'
  return {
    sessionId,
    provider,
    sourceKey,
    usedTokens,
    windowTokens,
    usedPercent,
    status,
    model: typeof raw.model === 'string' ? raw.model : null,
    generation: 0,
    sourceEpoch: '',
    updatedAt,
    epoch: typeof raw.epoch === 'string' ? raw.epoch : 'legacy:0',
    incarnation: typeof raw.incarnation === 'number' ? raw.incarnation : 0,
    producerId: typeof raw.producerId === 'string' && raw.producerId ? raw.producerId : 'legacy',
    lifecycle: typeof raw.lifecycle === 'number' && raw.lifecycle > 0 ? raw.lifecycle : 1,
    agentId: typeof raw.agentId === 'string' && raw.agentId ? raw.agentId : provider,
    source: typeof raw.source === 'string' && raw.source ? raw.source : 'local',
    epochHistory: Array.isArray(raw.epochHistory) ? raw.epochHistory.filter((entry): entry is string => typeof entry === 'string') : [],
    producerHistory: Array.isArray(raw.producerHistory) ? raw.producerHistory.filter((entry): entry is string => typeof entry === 'string') : []
  }
}
const MAX_CACHE_RECORDS = MAX_SESSIONS * 4
const MAX_CONTEXT_TOKENS = 100_000_000
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const EPOCH_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const USAGE_KEYS = new Set(['sessionId', 'provider', 'sourceKey', 'usedTokens', 'windowTokens', 'usedPercent', 'status', 'model', 'updatedAt', 'generation', 'sourceEpoch', 'epoch', 'incarnation', 'producerId', 'lifecycle', 'agentId', 'source', 'epochHistory', 'producerHistory'])

export function contextUsageKey(sessionId: string, agentId: string, source: string): string {
  return `${agentId}\u0000${source}\u0000${sessionId}`
}

function validUsage(value: unknown): value is ContextWindowUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const usage = value as Partial<ContextWindowUsage>
  if (Object.keys(usage).some((key) => !USAGE_KEYS.has(key))) return false
  if (typeof usage.sessionId !== 'string' || !SESSION_ID_RE.test(usage.sessionId)) return false
  if (usage.usedTokens !== null && (typeof usage.usedTokens !== 'number' || !Number.isSafeInteger(usage.usedTokens) || usage.usedTokens < 0 || usage.usedTokens > MAX_CONTEXT_TOKENS)) return false
  if (usage.windowTokens !== null && (typeof usage.windowTokens !== 'number' || !Number.isSafeInteger(usage.windowTokens) || usage.windowTokens <= 0 || usage.windowTokens > MAX_CONTEXT_TOKENS)) return false
  if (usage.usedPercent !== null && (typeof usage.usedPercent !== 'number' || !Number.isFinite(usage.usedPercent) || usage.usedPercent < 0 || usage.usedPercent > 100)) return false
  if (usage.model !== null && (typeof usage.model !== 'string' || usage.model.length > 256)) return false
  if (usage.updatedAt !== null && (typeof usage.updatedAt !== 'number' || !Number.isFinite(usage.updatedAt) || usage.updatedAt < 0)) return false
  if (typeof usage.generation !== 'number' || !Number.isInteger(usage.generation) || usage.generation < 1) return false
  if (typeof usage.sourceEpoch !== 'string' || usage.sourceEpoch.length > 256) return false
  if (typeof usage.epoch !== 'string' || !EPOCH_RE.test(usage.epoch)) return false
  if (typeof usage.incarnation !== 'number' || !Number.isSafeInteger(usage.incarnation) || usage.incarnation < 0) return false
  if (typeof usage.producerId !== 'string' || !EPOCH_RE.test(usage.producerId)) return false
  if (typeof usage.lifecycle !== 'number' || !Number.isSafeInteger(usage.lifecycle) || usage.lifecycle < 1) return false
  if (typeof usage.agentId !== 'string' || usage.agentId.length > 128 || !usage.agentId) return false
  if (typeof usage.source !== 'string' || usage.source.length > 256 || !isContextSource(usage.source)) return false
  if (!Array.isArray(usage.epochHistory) || usage.epochHistory.length > 4096 || usage.epochHistory.some((e) => typeof e !== 'string' || !EPOCH_RE.test(e))) return false
  if (!Array.isArray(usage.producerHistory) || usage.producerHistory.length > 4096 || usage.producerHistory.some((e) => typeof e !== 'string' || !EPOCH_RE.test(e))) return false
  return true
}

function normalizeUsage(usage: ContextWindowUsage): ContextWindowUsage {
  return { ...usage, usedPercent: contextPercentFromCounts(usage.usedTokens, usage.windowTokens) }
}

function load(): Record<string, ContextWindowUsage> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, ContextWindowUsage> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const legacySessionId = key.includes('::') ? undefined : key
      const usage = normalize(value, legacySessionId)
      if (usage) out[sourceKeyFor(usage.sessionId, usage.sourceKey)] = usage
    }
    return prune(out)
  } catch {
    return {}
  }
}

function prune(map: Record<string, ContextWindowUsage>): Record<string, ContextWindowUsage> {
  const keys = Object.keys(map)
  if (keys.length <= MAX_SESSIONS) return map
  const active = keys.filter((key) => activeSessions.has(key))
  // Never evict an open node's generation fence. The cap applies to inactive history first; an
  // unusually large active canvas may temporarily exceed it rather than lose live state.
  if (active.length >= MAX_SESSIONS) return Object.fromEntries(active.map((key) => [key, map[key]]))
  const rest = keys.filter((key) => !active.includes(key))
  const keep = [...active, ...rest]
    .sort((a, b) => (map[b]?.updatedAt ?? 0) - (map[a]?.updatedAt ?? 0))
    .slice(0, MAX_SESSIONS)
  return Object.fromEntries(keep.map((key) => [key, map[key]]))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(bySourceSession: Record<string, ContextWindowUsage>): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const persisted: Record<string, StoredUsage> = {}
      for (const [key, value] of Object.entries(bySourceSession)) {
        const { generation: _generation, sourceEpoch: _sourceEpoch, ...safe } = value
        persisted[key] = safe
      }
      localStorage.setItem(KEY, JSON.stringify(persisted))
    } catch {
      // Storage is a best-effort local cache. Live telemetry remains in memory.
    }
  }, SAVE_DEBOUNCE_MS)
}

export function contextSourceKey(agentId?: string | null, remote = false): string {
  return `${agentId || 'unknown'}:${remote ? 'remote' : 'local'}`
}

export function contextStatus(usage: ContextWindowUsage | undefined, now = Date.now()): ContextWindowUsage['status'] {
  if (!usage) return 'not-reported'
  if (usage.status !== 'known') return usage.status
  if (usage.updatedAt === null || now - usage.updatedAt > CONTEXT_STALE_AFTER_MS) return 'stale'
  return 'known'
}

interface ContextWindowState {
  bySourceSession: Record<string, ContextWindowUsage>
  now: number
  set(usage: ContextWindowUsage): void
  get(sessionId: string | null, sourceKey?: string): ContextWindowUsage | undefined
}

/** Admission fence rejects delayed reads from retired producer epochs. */
export function isFreshEnough(next: ContextWindowUsage, previous: ContextWindowUsage): boolean {
  if (next.epoch !== previous.epoch) {
    if (previous.epochHistory.includes(next.epoch)) return false
    if (next.producerId !== previous.producerId && previous.producerHistory.includes(next.producerId)) return false
    if (next.producerId === previous.producerId && next.lifecycle <= previous.lifecycle) return false
    return true
  }
  return next.generation >= previous.generation
}

export const useContextWindow = create<ContextWindowState>((set, get) => ({
  bySourceSession: load(),
  now: Date.now(),
  set: (usage) =>
    set((state) => {
      if (!validUsage(usage)) return state
      const key = sourceKeyFor(usage.sessionId, usage.sourceKey)
      const previous = state.bySourceSession[key]
      if (previous && !isFreshEnough(usage, previous)) return state
      const priorEpochs = previous?.epoch ? [...previous.epochHistory, previous.epoch] : []
      const epochHistory = [...new Set([...usage.epochHistory, ...priorEpochs])].slice(-4096)
      const producerHistory = [...usage.producerHistory, ...(previous && previous.producerId !== usage.producerId ? [previous.producerId] : [])]
        .filter((id, index, all) => id !== usage.producerId && all.indexOf(id) === index)
        .slice(-4096)
      const next = { ...usage, epochHistory, producerHistory }
      const bySourceSession = prune({ ...state.bySourceSession, [key]: next })
      scheduleSave(bySourceSession)
      return { ...state, bySourceSession }
    }),
  get: (sessionId, sourceKey) => {
    if (!sessionId) return undefined
    const map = get().bySourceSession
    if (sourceKey) return map[sourceKeyFor(sessionId, sourceKey)]
    const candidates = Object.values(map).filter((usage) => usage.sessionId === sessionId)
    return candidates.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  }
}))

// One shared staleness clock serves every meter, including hidden, collapsed, and restored views.
const staleTimer = typeof window === 'undefined' ? null : window.setInterval(() => {
  useContextWindow.setState({ now: Date.now() })
}, STALE_CLOCK_MS)
void staleTimer
