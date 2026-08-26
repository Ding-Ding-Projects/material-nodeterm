// The changelog viewer: every released version (generated from CHANGELOG.md — see
// docs/changelog-viewer.md), filterable by date range and by a plain-text/regex search over the
// version, its bullets and their categories.
//
// Filtering is deliberately RELEASE-level, not bullet-level: a release either matches the current
// date range + query or it doesn't, and a matching release shows every one of its bullets. The
// design this screen implements shows whole release cards this way, and it also keeps the
// question the user is actually asking ("what shipped in this window / mentioning this word")
// answerable without a release card silently losing bullets a reader might expect to still be
// there once they've scrolled to it.
//
// Nothing here is destructive — reading history never needs a confirmation gate — so there is no
// destructive bulk action; the one bulk action offered is export, exactly like the two sibling
// History tabs.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangelogRelease } from '@shared/changelog'
import { CHANGELOG_RELEASES } from '@shared/changelog-data'
import type { ExportTable } from '@shared/export'
import { buildTableExport } from '@shared/export'
import { ExportMenu } from '../ExportMenu'
import { BulkActionBar, type BulkAction } from '../BulkActionBar'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import {
  applyDateRangePreset,
  DATE_RANGE_PRESET_LABELS,
  parseBoundary,
  type DateRangePreset
} from '../../lib/dateRange'
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
} from '../../lib/bulkSelection'
import { ReleaseCard } from './ReleaseCard'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

const PRESETS: DateRangePreset[] = ['30d', '90d', 'all']

function releaseId(r: ChangelogRelease): string {
  return r.version
}

function releaseHaystack(r: ChangelogRelease): string {
  return [
    r.version,
    ...r.items.map((i) => `${i.category} ${i.text}`),
    ...r.commits.map((c) => c.sha)
  ].join(' ')
}

function toExportTable(releases: readonly ChangelogRelease[], map: (text: string) => string = (text) => text): ExportTable {
  const rows: Record<string, unknown>[] = []
  for (const r of releases) {
    if (r.items.length === 0) {
      rows.push({
        version: r.version,
        date: r.date ?? '',
        category: '',
        text: '',
        commits: r.commits.map((c) => c.sha).join(' ')
      })
      continue
    }
    for (const item of r.items) {
      rows.push({
        version: r.version,
        date: r.date ?? '',
        category: item.category,
        text: item.text,
        commits: r.commits.map((c) => c.sha).join(' ')
      })
    }
  }
  return {
    name: 'changelog',
    columns: [
      { key: 'version', label: map('Version') },
      { key: 'date', label: map('Date') },
      { key: 'category', label: map('Category') },
      { key: 'text', label: map('Change') },
      { key: 'commits', label: map('Commits') }
    ],
    rows
  }
}

export function ChangelogPanel(): JSX.Element {
  const vocab = useVocabularyMapper()
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [activePreset, setActivePreset] = useState<DateRangePreset | null>('all')
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<BulkSelectionState>(emptySelection())
  const [exportResult, setExportResult] = useState<string | null>(null)

  const applyPreset = (preset: DateRangePreset): void => {
    const { from, to } = applyDateRangePreset(preset)
    setFromInput(from)
    setToInput(to)
    setActivePreset(preset)
  }

  const from = parseBoundary(fromInput, false)
  const to = parseBoundary(toInput, true)

  const filtered = useMemo(() => {
    return CHANGELOG_RELEASES.filter((r) => {
      // "Unreleased" carries no date. Excluding it from an explicit date-bounded window (rather
      // than guessing it's "now") is the honest choice — it hasn't shipped, so it has no date to
      // compare, and silently treating it as "today" would misrepresent an in-progress window as
      // a dated release. It still shows under the default "All time" / any open-ended range.
      if (from.ms !== undefined || to.ms !== undefined) {
        if (r.dateMs === null) return false
        if (from.ms !== undefined && r.dateMs < from.ms) return false
        if (to.ms !== undefined && r.dateMs > to.ms) return false
      }
      return search.test(releaseHaystack(r))
    })
  }, [from.ms, to.ms, search])

  const visibleIds = useMemo(() => filtered.map(releaseId), [filtered])
  useEffect(() => setSelection((s) => pruneSelection(s, visibleIds)), [visibleIds])

  const bulkActions: BulkAction<ChangelogRelease>[] = useMemo(
    () => [
      {
        id: 'export-selected',
        label: 'Export selected (CSV)',
        describe: (r) => `${r.version}${r.date ? ` — ${r.date}` : ''} (${r.items.length} change${r.items.length === 1 ? '' : 's'})`,
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
    <div className="md3-changelog" role="region" aria-label={vocab('Changelog')}>
      <div className="md3-changelog__toolbar">
        <div className="md3-changelog__dates">
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
        </div>
        <div className="md3-history-presets" role="group" aria-label={vocab('Date range presets')}>
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
        <div className="md3-history-search">
          <input
            ref={searchInputRef}
            type="text"
            className="md3-history-search__input"
            placeholder={vocab(search.mode === 'regex' ? 'Search the changelog (regex)…' : 'Search the changelog…')}
            value={search.value}
            spellCheck={false}
            onChange={(e) => search.setValue(e.target.value)}
            aria-label={vocab('Search changelog')}
          />
          <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — Changelog search" />
        </div>
        {search.error && (
          <div className="md3-changelog__error" role="alert">
            {search.error}
          </div>
        )}
        {from.error && (
          <div className="md3-changelog__error" role="alert">
            {from.error}
          </div>
        )}
        {to.error && (
          <div className="md3-changelog__error" role="alert">
            {to.error}
          </div>
        )}
        <ExportMenu kind="tabular" label={vocab('changelog')} build={(format) => buildTableExport(toExportTable(filtered, vocab), format)} />
      </div>

      {filtered.length === 0 ? (
        <div className="md3-changelog-empty md3-changelog-empty--panel">
          {CHANGELOG_RELEASES.length === 0
            ? vocab('No changelog data is available in this build.')
            : vocab('Nothing matches this filter.')}
        </div>
      ) : (
        <>
          <BulkActionBar<ChangelogRelease>
            visible={filtered}
            idOf={releaseId}
            selectedIds={selection.selected}
            onSelectAll={() => setSelection(selectAll(visibleIds))}
            onInvert={() => setSelection(invertSelection(selection, visibleIds))}
            onClear={() => setSelection(clearSelection())}
            actions={bulkActions}
            onActionComplete={(_id, result) => {
              const parts: string[] = []
              if (result.succeeded.length > 0) parts.push(vocab(`${result.succeeded.length} exported`))
              if (result.failed.length > 0) parts.push(vocab(`${result.failed.length} failed`))
              setExportResult(parts.length > 0 ? parts.join(', ') : null)
              if (parts.length > 0) setTimeout(() => setExportResult(null), 6000)
            }}
          />
          {exportResult && (
            <div className="md3-changelog__toast" role="status" aria-live="polite">
              {exportResult}
            </div>
          )}
          <ul className="md3-changelog-releases">
            {filtered.map((r) => (
              <ReleaseCard
                key={releaseId(r)}
                release={r}
                selected={isSelected(selection, releaseId(r))}
                onToggleSelect={(shiftKey) => {
                  if (shiftKey) setSelection((s) => selectRange(s, releaseId(r), visibleIds))
                  else setSelection((s) => toggleOne(s, releaseId(r)))
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
