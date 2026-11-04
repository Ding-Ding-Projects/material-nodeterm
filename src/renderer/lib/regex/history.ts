import { useSyncExternalStore } from 'react'

/** One pattern the user worked on in this app session. */
export interface RegexHistoryEntry {
  pattern: string
  flags: string
  at: number
}

export const REGEX_HISTORY_MAX = 20

/** Newest first, de-duplicated on pattern+flags (a repeat moves to the top), capped. */
export function pushRegexHistory(
  list: readonly RegexHistoryEntry[],
  entry: RegexHistoryEntry,
  max = REGEX_HISTORY_MAX
): RegexHistoryEntry[] {
  if (!entry.pattern.trim()) return [...list]
  const rest = list.filter((e) => !(e.pattern === entry.pattern && e.flags === entry.flags))
  return [entry, ...rest].slice(0, max)
}

// Session-only by design: patterns can hold pasted text from private logs, so they are kept in
// memory for this run of the app and never written to disk.
let entries: RegexHistoryEntry[] = []
const listeners = new Set<() => void>()

export const regexHistory = {
  get: (): readonly RegexHistoryEntry[] => entries,
  record(entry: RegexHistoryEntry): void {
    const next = pushRegexHistory(entries, entry)
    if (next.length === entries.length && next.every((e, i) => e === entries[i])) return
    entries = next
    for (const l of listeners) l()
  },
  clear(): void {
    entries = []
    for (const l of listeners) l()
  },
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  }
}

export function useRegexHistory(): readonly RegexHistoryEntry[] {
  return useSyncExternalStore(regexHistory.subscribe, regexHistory.get, regexHistory.get)
}
