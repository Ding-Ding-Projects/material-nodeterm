import { create } from 'zustand'
import type { ContextWindowUsage } from '@shared/types'
import { CONTEXT_TELEMETRY_MATRIX, contextPercentFromCounts, isContextSource } from '@shared/context-source'

// Per-session context-window fill, fed by context.onUpdate.
//
// Persisted to localStorage (like agentStatus' sessionId). Why: after an app restart the
// node's sessionId is restored, but its tmux Claude session is now idle and emits no new
// hook event — so the main-process tailer is never re-fed the transcript path and can't
// re-push until the next prompt. Without persistence the meter would vanish on every restart
// even though the session (and its fill) is unchanged. We restore the last-known value so the
// meter survives the restart; the live tailer overwrites it on the next prompt.
const KEY = 'nodeterm.contextWindow'
// Hard cap on retained sessions. Every resume / `/clear` / restart mints a new sessionId, so
// without a bound the map would grow forever (and we'd re-stringify the whole thing on every
// hook tick). 200 is far more than any realistic number of live meters; oldest are evicted.
const MAX_SESSIONS = 200
const MAX_CACHE_RECORDS = MAX_SESSIONS * 4
// Don't write localStorage on every update (onUpdate fires repeatedly within a turn); coalesce.
const SAVE_DEBOUNCE_MS = 2000
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const EPOCH_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const MAX_CONTEXT_TOKENS = 100_000_000
const USAGE_KEYS = new Set(['sessionId', 'usedTokens', 'windowTokens', 'usedPercent', 'model', 'updatedAt', 'generation', 'epoch', 'incarnation', 'producerId', 'lifecycle', 'agentId', 'source', 'epochHistory', 'producerHistory'])

export function contextUsageKey(sessionId: string, agentId: string, source: string): string {
  return `${agentId}\u0000${source}\u0000${sessionId}`
}

/** Pre-issue records are recognized only as a migration shape and are never rendered or merged. */
type LegacyContextWindowUsage = Pick<ContextWindowUsage, 'sessionId' | 'usedTokens' | 'windowTokens' | 'usedPercent' | 'model' | 'updatedAt'>

function isLegacyUsage(value: unknown): value is LegacyContextWindowUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.sessionId === 'string' &&
    typeof record.usedTokens === 'number' &&
    typeof record.windowTokens === 'number' &&
    typeof record.usedPercent === 'number' &&
    (record.model === null || typeof record.model === 'string') &&
    typeof record.updatedAt === 'number' &&
    !('agentId' in record) && !('source' in record) && !('producerId' in record)
}

function validUsage(value: unknown): value is ContextWindowUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const usage = value as Partial<ContextWindowUsage>
  if (Object.keys(usage).some((key) => !USAGE_KEYS.has(key))) return false
  if (typeof usage.sessionId !== 'string' || !SESSION_ID_RE.test(usage.sessionId)) return false
  if (typeof usage.usedTokens !== 'number' || !Number.isSafeInteger(usage.usedTokens) || usage.usedTokens < 0 || usage.usedTokens > MAX_CONTEXT_TOKENS) return false
  if (typeof usage.windowTokens !== 'number' || !Number.isSafeInteger(usage.windowTokens) || usage.windowTokens <= 0 || usage.windowTokens > MAX_CONTEXT_TOKENS) return false
  if (typeof usage.usedPercent !== 'number' || !Number.isFinite(usage.usedPercent) || usage.usedPercent < 0 || usage.usedPercent > 100) return false
  if (usage.model !== null && (typeof usage.model !== 'string' || usage.model.length > 256)) return false
  if (typeof usage.updatedAt !== 'number' || !Number.isFinite(usage.updatedAt) || usage.updatedAt < 0) return false
  if (!Number.isInteger(usage.generation) || usage.generation < 1) return false
  if (typeof usage.epoch !== 'string' || !EPOCH_RE.test(usage.epoch)) return false
  if (!Number.isSafeInteger(usage.incarnation) || usage.incarnation < 0) return false
  if (typeof usage.producerId !== 'string' || !EPOCH_RE.test(usage.producerId)) return false
  if (!Number.isSafeInteger(usage.lifecycle) || usage.lifecycle < 1) return false
  if (typeof usage.agentId !== 'string' || usage.agentId.length > 128) return false
  if (typeof usage.source !== 'string' || usage.source.length > 256 || !isContextSource(usage.source)) return false
  if (!Array.isArray(usage.epochHistory) || usage.epochHistory.length > 4096 || usage.epochHistory.some((e) => typeof e !== 'string' || !EPOCH_RE.test(e))) return false
  if (!Array.isArray(usage.producerHistory) || usage.producerHistory.length > 4096 || usage.producerHistory.some((e) => typeof e !== 'string' || !EPOCH_RE.test(e))) return false
  if (!usage.agentId || !usage.source) return false
  const provider = usage.agentId as keyof typeof CONTEXT_TELEMETRY_MATRIX
  const kind = usage.source === 'local' ? 'local' : 'host'
  if (!(provider in CONTEXT_TELEMETRY_MATRIX) || !CONTEXT_TELEMETRY_MATRIX[provider][kind]) return false
  return true
}

function normalizeUsage(usage: ContextWindowUsage): ContextWindowUsage {
  return {
    ...usage,
    usedPercent: contextPercentFromCounts(usage.usedTokens, usage.windowTokens) ?? 0
  }
}

function load(): Record<string, ContextWindowUsage> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    if (raw.length > 2_000_000) return {}
    const data = JSON.parse(raw) as Record<string, unknown>
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const keys = Object.keys(data)
    if (keys.length > MAX_CACHE_RECORDS || keys.some((key) => key.length > 768)) return {}
    const valid: Record<string, ContextWindowUsage> = {}
    for (const [key, value] of Object.entries(data)) {
      if (key === (value as LegacyContextWindowUsage | undefined)?.sessionId && isLegacyUsage(value)) continue
      if (!validUsage(value)) continue
      const usage = value
      // Legacy records keyed only by session id have no provider/source identity and are
      // intentionally retired instead of being shown through an ambiguous fallback.
      if (key === usage.sessionId) continue
      if (key !== contextUsageKey(usage.sessionId, usage.agentId, usage.source)) continue
      valid[key] = normalizeUsage(usage)
    }
    return prune(valid)
  } catch {
    return {}
  }
}

/** Keep only the MAX_SESSIONS most-recently-updated entries (LRU by updatedAt). */
function prune(map: Record<string, ContextWindowUsage>): Record<string, ContextWindowUsage> {
  const keys = Object.keys(map)
  if (keys.length <= MAX_SESSIONS) return map
  const newest = keys
    .sort((a, b) => (map[b]?.updatedAt ?? 0) - (map[a]?.updatedAt ?? 0))
    .slice(0, MAX_SESSIONS)
  const out: Record<string, ContextWindowUsage> = {}
  for (const k of newest) out[k] = map[k]
  return out
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(bySessionId: Record<string, ContextWindowUsage>): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(KEY, JSON.stringify(bySessionId))
    } catch {
      // ignore quota / serialization errors
    }
  }, SAVE_DEBOUNCE_MS)
}

interface ContextWindowState {
  bySessionId: Record<string, ContextWindowUsage>
  set(usage: ContextWindowUsage): void
}

/** Admission fence shared by live updates and restored cache records. A lifecycle switch may
 * advance once, but a producer or epoch already retired can never replay, even when generations
 * restart at one or wall-clock timestamps move backwards. */
export function isFreshEnough(next: ContextWindowUsage, previous: ContextWindowUsage): boolean {
  if (next.epoch !== previous.epoch) {
    if (previous.epochHistory.includes(next.epoch)) return false
    if (next.producerId !== previous.producerId && previous.producerHistory.includes(next.producerId)) return false
    if (next.producerId === previous.producerId && next.lifecycle <= previous.lifecycle) return false
    return true
  }
  if (next.epoch && previous.epoch && next.epoch === previous.epoch && typeof next.generation === 'number' && typeof previous.generation === 'number') {
    return next.generation >= previous.generation
  }
  return next.updatedAt >= previous.updatedAt
}

export const useContextWindow = create<ContextWindowState>((set) => ({
  bySessionId: load(),
  set: (usage) =>
    set((s) => {
      if (!validUsage(usage)) return s
      const normalized = normalizeUsage(usage)
      const key = contextUsageKey(normalized.sessionId, normalized.agentId, normalized.source)
      const previous = s.bySessionId[key]
      if (previous && !isFreshEnough(normalized, previous)) return s
      const priorEpochs = previous?.epoch
        ? [...(previous.epochHistory ?? []), previous.epoch]
        : []
      const epochHistory = normalized.epoch
        ? [...new Set([...(normalized.epochHistory ?? []), ...priorEpochs])].slice(-4096)
        : normalized.epochHistory
      const producerHistory = [...normalized.producerHistory, ...(previous?.producerId && previous.producerId !== normalized.producerId ? [previous.producerId] : [])]
        .filter((id, i, all) => id !== normalized.producerId && all.indexOf(id) === i)
        .slice(-4096)
      const merged = { ...s.bySessionId, [key]: { ...normalized, epochHistory, producerHistory } }
      const bySessionId = prune(merged)
      scheduleSave(bySessionId)
      return { bySessionId }
    })
}))
