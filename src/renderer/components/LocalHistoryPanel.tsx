// Filterable local, git-backed version history for a user-managed record (settings today — see
// docs/local-history.md). Reusable across future domains: pass a different `domain` + `title`.
//
// Filtering composes rather than overrides: the date range, the action checkboxes and the text
// search all narrow the SAME list together. The action checkboxes are DERIVED from whatever
// actions actually appear in this domain's log — never a hard-coded list that could drift from
// what core/local-history.ts actually records (see describeSettingsChange in shared/settings-diff.ts
// for the only action producer today).
//
// A calendar-picker note: this uses the platform's native `<input type="date">` plus a small set
// of named presets rather than a bespoke anchored calendar widget — a real, honest simplification
// given this lane's scope; see docs/local-history.md.

import { useEffect, useMemo, useState } from 'react'
import type { ExportTable } from '@shared/export'
import { buildTableExport } from '@shared/export'
import type { HistoryAction, HistoryEntry } from '@shared/local-history'
import { restoreSettingsRevision } from '../state/settings'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportMenu } from './ExportMenu'
import { BulkActionBar, type BulkAction } from './BulkActionBar'
import {
  clearSelection,
  emptySelection,
  invertSelection,
  isSelected,
  pruneSelection,
  selectAll,
  selectRange,
  toggleOne,
  type BulkSelectionState
} from '../lib/bulkSelection'

export interface LocalHistoryPanelProps {
  domain: string
  title: string
}

type Preset = 'today' | '7d' | '30d' | 'all'

function toDateInputValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse a date-range boundary input. Accepts the browser's own `yyyy-mm-dd` AND a plain ISO
 *  timestamp typed by hand (the "typed dates in the locale's format and plain ISO alongside it"
 *  requirement) — reports invalid input via the returned `error` WITHOUT discarding what was
 *  typed, so the caller can echo it back rather than silently clearing the field. */
function parseBoundary(raw: string, endOfDay: boolean): { ms: number | undefined; error: string | null } {
  if (raw.trim() === '') return { ms: undefined, error: null }
  // A bare `yyyy-mm-dd` (from the native date input, or hand-typed) has no time component — give
  // it one so a `to` boundary includes the whole day rather than stopping at midnight. Anything
  // longer (a full ISO timestamp typed by hand) is parsed as-is.
  const parsed = Date.parse(raw.length === 10 ? `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : raw)
  if (Number.isNaN(parsed)) return { ms: undefined, error: `"${raw}" is not a date I can read.` }
  return { ms: parsed, error: null }
}

function toExportTable(entries: HistoryEntry[]): ExportTable {
  return {
    name: 'history',
    columns: [
      { key: 'timestamp', label: 'When' },
      { key: 'action', label: 'Action' },
      { key: 'label', label: 'What changed' },
      { key: 'sha', label: 'Revision' },
      { key: 'filename', label: 'File' }
    ],
    rows: entries.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      action: e.action,
      label: e.label,
      sha: e.sha,
      filename: e.filename
    }))
  }
}

export function LocalHistoryPanel({ domain, title }: LocalHistoryPanelProps): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [activeActions, setActiveActions] = useState<Set<HistoryAction>>(new Set())
  const [query, setQuery] = useState('')

  const [restoring, setRestoring] = useState<HistoryEntry | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const [selection, setSelection] = useState<BulkSelectionState>(emptySelection())

  const load = (): void => {
    setLoading(true)
    setError(null)
    void window.nodeTerminal.history
      .list(domain)
      .then((result) => {
        if (!result.ok) {
          setError(result.error)
          setEntries(null)
          return
        }
        setEntries(result.entries)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [domain])

  const applyPreset = (preset: Preset): void => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    if (preset === 'all') {
      setFromInput('')
      setToInput('')
    } else if (preset === 'today') {
      setFromInput(toDateInputValue(now))
      setToInput(toDateInputValue(now))
    } else if (preset === '7d') {
      setFromInput(toDateInputValue(now - 7 * day))
      setToInput(toDateInputValue(now))
    } else {
      setFromInput(toDateInputValue(now - 30 * day))
      setToInput(toDateInputValue(now))
    }
  }

  const from = parseBoundary(fromInput, false)
  const to = parseBoundary(toInput, true)

  // Every action actually present in this domain's log, with counts — never a hard-coded list.
  const actionCounts = useMemo(() => {
    const counts = new Map<HistoryAction, number>()
    for (const e of entries ?? []) counts.set(e.action, (counts.get(e.action) ?? 0) + 1)
    return counts
  }, [entries])

  const filtered = useMemo(() => {
    if (!entries) return []
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (from.ms !== undefined && e.timestamp < from.ms) return false
      if (to.ms !== undefined && e.timestamp > to.ms) return false
      if (activeActions.size > 0 && !activeActions.has(e.action)) return false
      if (q && !e.label.toLowerCase().includes(q) && !e.sha.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, from.ms, to.ms, activeActions, query])

  const visibleIds = useMemo(() => filtered.map((e) => e.sha), [filtered])
  useEffect(() => setSelection((s) => pruneSelection(s, visibleIds)), [visibleIds])

  const toggleAction = (action: HistoryAction): void => {
    setActiveActions((s) => {
      const next = new Set(s)
      if (next.has(action)) next.delete(action)
      else next.add(action)
      return next
    })
  }

  const restore = async (): Promise<void> => {
    if (!restoring) return
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      const requestRestore = (): ReturnType<typeof window.nodeTerminal.history.restore> =>
        window.nodeTerminal.history.restore(domain, restoring.sha)
      // Settings are live renderer state as well as a core-owned file. Join/cancel the renderer's
      // coalesced save lane and rehydrate immediately, or an old 300 ms callback can overwrite the
      // revision after this dialog reports success. Future domains can supply their own equivalent
      // apply hook instead of being silently treated as settings.
      const result =
        domain === 'settings' ? await restoreSettingsRevision(requestRestore) : await requestRestore()
      if (!result.ok) {
        setRestoreError(result.error)
        return
      }
      setRestoring(null)
      load()
    } finally {
      setRestoreBusy(false)
    }
  }

  const bulkActions: BulkAction<HistoryEntry>[] = useMemo(
    () => [
      {
        id: 'export-selected',
        label: 'Export selected',
        describe: (e) => `${new Date(e.timestamp).toLocaleString()} — ${e.label}`,
        run: async (items) => {
          const built = buildTableExport(toExportTable(items), 'csv')
          const result = await window.nodeTerminal.export.saveText(built.filename, built.content, built.mimeType)
          if (!result.ok) {
            if (result.canceled) return { succeeded: [], failed: [] }
            return { succeeded: [], failed: items.map((item) => ({ item, reason: result.error ?? 'Save failed.' })) }
          }
          return { succeeded: items, failed: [] }
        }
      }
    ],
    []
  )

  return (
    <div className="local-history" role="region" aria-label={`${title} history`}>
      <div className="local-history__toolbar">
        <div className="local-history__dates">
          <label>
            From
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              aria-invalid={!!from.error}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              aria-invalid={!!to.error}
            />
          </label>
          <div className="local-history__presets">
            <button type="button" onClick={() => applyPreset('today')}>
              Today
            </button>
            <button type="button" onClick={() => applyPreset('7d')}>
              Last 7 days
            </button>
            <button type="button" onClick={() => applyPreset('30d')}>
              Last 30 days
            </button>
            <button type="button" onClick={() => applyPreset('all')}>
              All time
            </button>
          </div>
        </div>
        {from.error && (
          <div className="local-history__date-error" role="alert">
            {from.error}
          </div>
        )}
        {to.error && (
          <div className="local-history__date-error" role="alert">
            {to.error}
          </div>
        )}

        <input
          type="search"
          className="local-history__search"
          placeholder="Search what changed…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search history"
        />

        {actionCounts.size > 0 && (
          <div className="local-history__actions" role="group" aria-label="Filter by action">
            {[...actionCounts.entries()].map(([action, n]) => (
              <label key={action} className="local-history__action-chip">
                <input
                  type="checkbox"
                  checked={activeActions.has(action)}
                  onChange={() => toggleAction(action)}
                />
                {action} ({n})
              </label>
            ))}
          </div>
        )}

        <ExportMenu
          kind="tabular"
          label={`${title} history`}
          build={(format) => buildTableExport(toExportTable(filtered), format)}
        />
      </div>

      {loading && <div className="local-history__note">Loading…</div>}
      {!loading && error && <div className="local-history__note local-history__note--error">{error}</div>}
      {!loading && !error && entries && entries.length === 0 && (
        <div className="local-history__note">No history yet — it starts with the next change.</div>
      )}
      {!loading && !error && entries && entries.length > 0 && filtered.length === 0 && (
        <div className="local-history__note">Nothing matches this filter.</div>
      )}

      {filtered.length > 0 && (
        <>
          <BulkActionBar<HistoryEntry>
            visible={filtered}
            idOf={(e) => e.sha}
            selectedIds={selection.selected}
            onSelectAll={() => setSelection(selectAll(visibleIds))}
            onInvert={() => setSelection(invertSelection(selection, visibleIds))}
            onClear={() => setSelection(clearSelection())}
            actions={bulkActions}
          />
          <ul className="local-history__rows">
            {filtered.map((e) => (
              <li key={e.sha} className="local-history__row">
                <input
                  type="checkbox"
                  aria-label={`Select revision ${e.sha.slice(0, 7)}`}
                  checked={isSelected(selection, e.sha)}
                  onClick={(ev) => {
                    if (ev.shiftKey) setSelection((s) => selectRange(s, e.sha, visibleIds))
                    else setSelection((s) => toggleOne(s, e.sha))
                  }}
                  onChange={() => {}}
                />
                <span className="local-history__when">{new Date(e.timestamp).toLocaleString()}</span>
                <span className={`local-history__action local-history__action--${e.action}`}>{e.action}</span>
                <span className="local-history__label">{e.label}</span>
                <span className="local-history__sha" title={e.sha}>
                  {e.sha.slice(0, 7)}
                </span>
                <button type="button" className="local-history__restore" onClick={() => setRestoring(e)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {restoring && (
        <ConfirmDialog
          message={`Restore to "${restoring.label}" (${restoring.sha.slice(0, 7)})? This applies that old revision as a NEW save — it does not delete anything from the history, and you can restore forward again afterward.`}
          confirmLabel={restoreBusy ? 'Restoring…' : 'Restore'}
          onConfirm={() => void restore()}
          onCancel={() => setRestoring(null)}
        />
      )}
      {restoreError && (
        <div className="local-history__note local-history__note--error" role="alert">
          {restoreError}
        </div>
      )}
    </div>
  )
}
