import { create } from 'zustand'
import type { ContextWindowUsage } from '@shared/types'

const KEY = 'nodeterm.contextWindow'
const MAX_SESSIONS = 200
const SAVE_DEBOUNCE_MS = 2000
export const CONTEXT_STALE_AFTER_MS = 2 * 60 * 1000
const STALE_CLOCK_MS = 15_000
const activeSessions = new Set<string>()

type StoredUsage = Omit<ContextWindowUsage, 'generation' | 'sourceEpoch'> & {
  generation?: number
  sourceEpoch?: string
}

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
    updatedAt
  }
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

export const useContextWindow = create<ContextWindowState>((set, get) => ({
  bySourceSession: load(),
  now: Date.now(),
  set: (usage) =>
    set((state) => {
      const key = sourceKeyFor(usage.sessionId, usage.sourceKey)
      const previous = state.bySourceSession[key]
      // Generation fencing is scoped to a source epoch. A new app process may restart at 1 and
      // must never be rejected by a persisted generation from an older process.
      if (
        previous &&
        previous.sourceEpoch === usage.sourceEpoch &&
        usage.generation <= previous.generation
      ) return state
      const bySourceSession = prune({ ...state.bySourceSession, [key]: usage })
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
