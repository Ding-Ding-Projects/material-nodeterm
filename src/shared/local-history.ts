// Shared types for local, git-backed version history (src/core/local-history.ts). Kept in
// src/shared so both the core implementation and the renderer's NodeTerminalApi surface (see
// shared/types.ts's `LocalHistoryApi`) and settings-diff.ts can import the SAME definitions
// without core importing renderer-facing code or shared importing core.

/** Not a closed enum on purpose — the history filter UI derives its checkboxes from whatever
 *  actions actually appear in a domain's log (see docs/local-history.md), never from a hard-coded
 *  list that could drift from what the app actually records. These are the values this codebase's
 *  callers currently use. */
export type HistoryAction = 'created' | 'updated' | 'deleted' | 'restored'

export interface HistoryEntry {
  domain: string
  sha: string
  /** Epoch milliseconds (from git's own author date), so the renderer's date-range filter can
   *  compare plain numbers. */
  timestamp: number
  /** What changed, in words — "Added Claude account acme@x", never "Updated". */
  label: string
  action: HistoryAction
  /** The file this revision touched, relative to the domain's repo root. */
  filename: string
}

export interface HistoryFilters {
  /** Inclusive epoch-ms bounds. Omit either side for an open range. */
  from?: number
  to?: number
  /** Keep only entries whose action is in this set. Omit/empty = every action. */
  actions?: HistoryAction[]
}

/** `entries: null` (not `[]`) means the domain's repo could not be read at all — distinguished
 *  from "this domain genuinely has no history yet", the same "we could not look" vs "there is
 *  nothing" discipline SessionMemoryPanel's `ok`/`rows` pair already follows in this codebase. */
export type HistoryListResult = { ok: true; entries: HistoryEntry[] } | { ok: false; error: string }

export type HistoryRestoreResult = { ok: true } | { ok: false; error: string }
