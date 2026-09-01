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
// of named presets (src/renderer/lib/dateRange.ts, shared with the changelog viewer) rather than a
// bespoke anchored calendar widget — a real, honest simplification given this lane's scope; see
// docs/local-history.md.

import { useEffect, useMemo, useRef, useState } from 'react'
import { SearchField } from '../ui/md3/SearchField'
import type { ExportTable } from '@shared/export'
import { buildTableExport } from '@shared/export'
import type { HistoryAction, HistoryEntry } from '@shared/local-history'
import { restoreSettingsRevision } from '../state/settings'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportMenu } from './ExportMenu'
import { BulkActionBar, type BulkAction } from './BulkActionBar'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import {
  applyDateRangePreset,
  DATE_RANGE_PRESET_LABELS,
  parseBoundary,
  type DateRangePreset
} from '../lib/dateRange'
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
import { Checkbox } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact } from '../lib/personalVocabulary/ownedCopy'

export function historyRestoreMessageSegments(label: string, sha: string) {
  return [
    copy('Restore to "'), fact(label), copy('" ('), fact(sha.slice(0, 7)),
    copy(')? This applies that old revision as a NEW save — it does not delete anything from the history, and you can restore forward again afterward.')
  ]
}

export interface LocalHistoryPanelProps {
  domain: string
  title: string
}

const PRESETS: DateRangePreset[] = ['today', '7d', '30d', '90d', 'all']

function toExportTable(entries: HistoryEntry[], map: (text: string) => string = (text) => text): ExportTable {
  return {
    name: 'history',
    columns: [
      { key: 'timestamp', label: map('When') },
      { key: 'action', label: map('Action') },
      { key: 'label', label: map('What changed') },
      { key: 'sha', label: map('Revision') },
      { key: 'filename', label: map('File') }
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

/** A small, colored assist-chip label for one action word — never a hard-coded switch over the
 *  closed set `HistoryAction` claims to be: an unrecognized future action still renders (neutral
 *  tone), it just doesn't get a themed color yet. */
function ActionChip({ action, map }: { action: HistoryAction; map: (text: string) => string }): JSX.Element {
  return <span className={`md3-history-chip md3-history-chip--${action}`}>{map(action)}</span>
}

export function LocalHistoryPanel({ domain, title }: LocalHistoryPanelProps): JSX.Element {
  const vocab = useVocabularyMapper()
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>('all')
  const [activeActions, setActiveActions] = useState<Set<HistoryAction>>(new Set())
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  const applyPreset = (preset: DateRangePreset): void => {
    const { from, to } = applyDateRangePreset(preset)
    setFromInput(from)
    setToInput(to)
    setActivePreset(preset)
  }

  const from = parseBoundary(fromInput, false)
  const to = parseBoundary(toInput, true)

  // core/local-history.ts's `list()` promises "every revision, newest first" — the first entry of
  // the RAW (unfiltered) list is therefore the current revision, always, regardless of what the
  // date/action/text filters below currently hide. Deriving "current" from the filtered array
  // instead would let a filter silently hand the CURRENT chip to the wrong row.
  const currentSha = entries && entries.length > 0 ? entries[0].sha : null

  // Every action actually present in this domain's log, with counts — never a hard-coded list.
  const actionCounts = useMemo(() => {
    const counts = new Map<HistoryAction, number>()
    for (const e of entries ?? []) counts.set(e.action, (counts.get(e.action) ?? 0) + 1)
    return counts
  }, [entries])

  const filtered = useMemo(() => {
    if (!entries) return []
    return entries.filter((e) => {
      if (from.ms !== undefined && e.timestamp < from.ms) return false
      if (to.ms !== undefined && e.timestamp > to.ms) return false
      if (activeActions.size > 0 && !activeActions.has(e.action)) return false
      if (!search.test(`${e.label} ${e.sha}`)) return false
      return true
    })
  }, [entries, from.ms, to.ms, activeActions, search])

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
          const built = buildTableExport(toExportTable(items, vocab), 'csv')
          const result = await window.nodeTerminal.export.saveText(built.filename, built.content, built.mimeType)
          if (!result.ok) {
            if (result.canceled) return { succeeded: [], failed: [] }
            return { succeeded: [], failed: items.map((item) => ({ item, reason: result.error ?? 'Save failed.' })) }
          }
          return { succeeded: items, failed: [] }
        }
      }
    ],
    [vocab]
  )

  return (
    <div className="local-history md3-history-panel" role="region" aria-label={vocab(`${title} history`)}>
      <div className="local-history__toolbar md3-history-toolbar">
        <div className="local-history__dates md3-history-dates">
          <label className="md3-history-date-field">
            {vocab('From')}
            <input
              type="date"
              value={fromInput}
              onChange={(e) => {
                setFromInput(e.target.value)
                setActivePreset(null)
              }}
              aria-invalid={!!from.error}
            />
          </label>
          <label className="md3-history-date-field">
            {vocab('To')}
            <input
              type="date"
              value={toInput}
              onChange={(e) => {
                setToInput(e.target.value)
                setActivePreset(null)
              }}
              aria-invalid={!!to.error}
            />
          </label>
          <div className="local-history__presets md3-history-presets" role="group" aria-label={vocab('Date range presets')}>
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`md3-history-preset${activePreset === p ? ' md3-history-preset--active' : ''}`}
                aria-pressed={activePreset === p}
                onClick={() => applyPreset(p)}
              >
                {vocab(DATE_RANGE_PRESET_LABELS[p])}
              </button>
            ))}
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

        <SearchField
          ref={searchInputRef}
          className="local-history__search"
          dense
          placeholder={search.mode === 'regex' ? 'Search what changed (regex)…' : 'Search what changed…'}
          value={search.value}
          onChange={(e) => search.setValue(e.target.value)}
          aria-label="Search history"
          trailingSlot={
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — Settings history search" />
          }
        />
        {search.error && (
          <div className="local-history__date-error" role="alert">
            {search.error}
          </div>
        )}

        {actionCounts.size > 0 && (
          <div className="local-history__actions md3-history-action-filters" role="group" aria-label={vocab('Filter by action')}>
            {[...actionCounts.entries()].map(([action, n]) => (
              <label
                key={action}
                className={`local-history__action-chip md3-history-action-toggle${activeActions.has(action) ? ' md3-history-action-toggle--on' : ''}`}
              >
                <Checkbox
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
          label={vocab(`${title} history`)}
          build={(format) => buildTableExport(toExportTable(filtered, vocab), format)}
        />
      </div>

      {loading && <div className="local-history__note md3-history-note">{vocab('Loading…')}</div>}
      {!loading && error && (
        <div className="local-history__note local-history__note--error md3-history-note md3-history-note--error">
          {error}
        </div>
      )}
      {!loading && !error && entries && entries.length === 0 && (
        <div className="local-history__note md3-history-note">{vocab('No history yet — it starts with the next change.')}</div>
      )}
      {!loading && !error && entries && entries.length > 0 && filtered.length === 0 && (
        <div className="local-history__note md3-history-note">{vocab('Nothing matches this filter.')}</div>
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
          <ul className="local-history__rows md3-history-rows">
            {filtered.map((e) => {
              const isCurrent = e.sha === currentSha
              return (
                <li key={e.sha} className="local-history__row md3-history-row">
                  <Checkbox
                    aria-label={`${vocab('Select revision')} ${e.sha.slice(0, 7)}`}
                    checked={isSelected(selection, e.sha)}
                    onClick={(ev) => {
                      if (ev.shiftKey) setSelection((s) => selectRange(s, e.sha, visibleIds))
                      else setSelection((s) => toggleOne(s, e.sha))
                    }}
                    onChange={() => {}}
                  />
                  <ActionChip action={e.action} map={vocab} />
                  <div className="md3-history-row__body">
                    <span className="local-history__label md3-history-row__label">{e.label}</span>
                    <span className="md3-history-row__meta">
                      <span className="local-history__when">{new Date(e.timestamp).toLocaleString()}</span>
                      {' · '}
                      <span className="local-history__sha" title={e.sha}>
                        {e.sha.slice(0, 7)}
                      </span>
                    </span>
                  </div>
                  {isCurrent ? (
                    <span className="md3-history-current-chip">{vocab('CURRENT')}</span>
                  ) : (
                    <button type="button" className="local-history__restore md3-history-restore" onClick={() => setRestoring(e)}>
                      {vocab('Restore as new')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {restoring && (
        <ConfirmDialog
          message=""
          messageSegments={historyRestoreMessageSegments(restoring.label, restoring.sha)}
          confirmLabel={restoreBusy ? 'Restoring…' : 'Restore'}
          onConfirm={() => void restore()}
          onCancel={() => setRestoring(null)}
        />
      )}
      {restoreError && (
        <div className="local-history__note local-history__note--error md3-history-note md3-history-note--error" role="alert">
          {restoreError}
        </div>
      )}
    </div>
  )
}
