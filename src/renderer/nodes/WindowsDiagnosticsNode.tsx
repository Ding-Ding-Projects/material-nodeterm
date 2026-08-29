import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import {
  WINDOWS_DIAGNOSTIC_KINDS,
  type WindowsDiagnosticKind,
  type WindowsDiagnosticRecords,
  type WindowsDiagnosticSnapshot
} from '@shared/windows-diagnostics'

const LABELS: Record<WindowsDiagnosticKind, string> = {
  drives: 'Drives',
  storage: 'Storage',
  services: 'Services',
  startup: 'Startup',
  'scheduled-tasks': 'Scheduled tasks',
  updates: 'Updates',
  network: 'Network',
  events: 'Event summary'
}

const COLUMNS: Record<WindowsDiagnosticKind, readonly string[]> = {
  drives: ['device', 'label', 'filesystem', 'capacityBytes', 'freeBytes'],
  storage: ['model', 'mediaType', 'sizeBytes', 'status'],
  services: ['name', 'displayName', 'state', 'startMode', 'serviceType'],
  startup: ['name', 'command', 'location', 'user'],
  'scheduled-tasks': ['taskName', 'taskPath', 'state', 'lastRunTime', 'nextRunTime'],
  updates: ['hotFixId', 'description', 'installedOn', 'installedBy'],
  network: ['name', 'status', 'linkSpeed', 'macAddress', 'ipv4', 'ipv6'],
  events: ['timeCreated', 'provider', 'id', 'level', 'message']
}

const CATEGORY_IDS: Record<WindowsDiagnosticKind, string> = {
  drives: 'windowsDiagnostics.category.drives',
  storage: 'windowsDiagnostics.category.storage',
  services: 'windowsDiagnostics.category.services',
  startup: 'windowsDiagnostics.category.startup',
  'scheduled-tasks': 'windowsDiagnostics.category.scheduledTasks',
  updates: 'windowsDiagnostics.category.updates',
  network: 'windowsDiagnostics.category.network',
  events: 'windowsDiagnostics.category.events'
}

function displayHeader(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase())
}

function displayCell(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || 'None reported'
  if (value === null || value === undefined || value === '') return 'Not reported'
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString()
  return String(value)
}

export default function WindowsDiagnosticsNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const [snapshot, setSnapshot] = useState<WindowsDiagnosticSnapshot | null>(null)
  const [activeKind, setActiveKind] = useState<WindowsDiagnosticKind>('drives')
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tx = useLocalizedVocabularyText()
  const labels = useMemo(
    () => Object.fromEntries(WINDOWS_DIAGNOSTIC_KINDS.map((kind) => [kind, tx(CATEGORY_IDS[kind], LABELS[kind])])) as Record<WindowsDiagnosticKind, string>,
    [tx]
  )

  const load = useCallback(async (): Promise<void> => {
    const api = window.nodeTerminal.windowsDiagnostics
    if (!api) {
      setError(tx('windowsDiagnostics.unavailable', 'Read-only Windows diagnostics are unavailable in this surface.'))
      return
    }
    setLoading(true)
    try {
      const next = await api.snapshot()
      setSnapshot(next)
      setError(null)
    } catch {
      setError(tx('windowsDiagnostics.readFailed', 'Could not read Windows diagnostics. The machine was not changed.'))
    } finally {
      setLoading(false)
    }
  }, [tx])

  useEffect(() => {
    void load()
  }, [load])

  const section = snapshot?.sections[activeKind]
  const records = (section?.records ?? []) as WindowsDiagnosticRecords[WindowsDiagnosticKind]
  const filtered = useMemo(
    () => records.filter((record) => search.test(Object.values(record).map(displayCell).join(' '))),
    [records, search]
  )
  const columns = COLUMNS[activeKind]
  const fill = nodeHeaderFillStyle(data.color)

  return (
    <div className={`term-node windows-diagnostics-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={540} minHeight={320} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <EditableNodeTitle
          value={(data.title as string) ?? ''}
          onChange={(next) => updateNodeData(id, { title: next })}
          emptyLabel={tx('windowsDiagnostics.title', 'Windows diagnostics')}
          title="Click to rename"
          ariaLabel={tx('windowsDiagnostics.title', 'Windows diagnostics') + ' node name'}
          rejectEmpty={false}
        />
        <span className="term-node__spacer" />
        <button className="term-node__close" title={tx('windowsDiagnostics.refresh', 'Refresh read-only diagnostics')} aria-label={tx('windowsDiagnostics.refresh', 'Refresh read-only diagnostics')} onClick={() => void load()} disabled={loading}>
          {loading ? '…' : '⟳'}
        </button>
        <button className="term-node__close" title={tx('windowsDiagnostics.close', 'Close')} aria-label={tx('windowsDiagnostics.close', 'Close')} onClick={() => void deleteElements({ nodes: [{ id }] })}>×</button>
      </div>
      <div className="windows-diagnostics-node__body nodrag nowheel">
        <div className="windows-diagnostics-node__intro">
          <span>{tx('windowsDiagnostics.snapshot', 'Read-only machine snapshot')}</span>
          <span>{snapshot ? tx('windowsDiagnostics.captured', 'Captured {time}', { time: new Date(snapshot.capturedAt).toLocaleTimeString() }) : tx('windowsDiagnostics.notCaptured', 'Not captured yet')}</span>
        </div>
        <div className="windows-diagnostics-node__tabs" role="tablist" aria-label="Diagnostic categories">
          {WINDOWS_DIAGNOSTIC_KINDS.map((kind) => (
            <button
              key={kind}
              role="tab"
              aria-selected={activeKind === kind}
              className={activeKind === kind ? 'active' : ''}
              onClick={() => setActiveKind(kind)}
              onKeyDown={(event) => {
                const index = WINDOWS_DIAGNOSTIC_KINDS.indexOf(kind)
                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  const next = WINDOWS_DIAGNOSTIC_KINDS[(index + 1) % WINDOWS_DIAGNOSTIC_KINDS.length]
                  setActiveKind(next)
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[
                    (index + 1) % WINDOWS_DIAGNOSTIC_KINDS.length
                  ]?.focus()
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const nextIndex = (index - 1 + WINDOWS_DIAGNOSTIC_KINDS.length) % WINDOWS_DIAGNOSTIC_KINDS.length
                  setActiveKind(WINDOWS_DIAGNOSTIC_KINDS[nextIndex])
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
                }
              }}
            >
              {labels[kind]}
            </button>
          ))}
        </div>
        <div className="windows-diagnostics-node__toolbar">
          <label htmlFor={`${id}-diagnostic-search`}>{tx('windowsDiagnostics.filter', 'Filter {category}', { category: labels[activeKind].toLocaleLowerCase() })}</label>
          <input
            id={`${id}-diagnostic-search`}
            type="search"
            placeholder={tx('windowsDiagnostics.filterPlaceholder', 'Type to filter this category')}
            ref={searchInputRef}
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
          />
          <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — Windows diagnostics filter" zIndex={93} />
          {search.error ? <span className="windows-diagnostics-node__search-error" role="alert">{search.error}</span> : null}
          <span aria-live="polite">{tx('windowsDiagnostics.rowCount', '{shown} of {total} rows', { shown: String(filtered.length), total: String(records.length) })}</span>
        </div>
        {error ? <p className="windows-diagnostics-node__error" role="alert">{error}</p> : section?.error ? <p className="windows-diagnostics-node__error" role="alert">{section.error}</p> : null}
        {!error && !section?.error && filtered.length === 0 ? <p className="windows-diagnostics-node__empty">{tx('windowsDiagnostics.noMatch', 'No {category} matched this filter.', { category: labels[activeKind].toLocaleLowerCase() })}</p> : null}
        {!error && !section?.error && filtered.length > 0 ? (
          <div className="windows-diagnostics-node__table-wrap">
            <table>
              <thead><tr>{columns.map((column) => <th key={column} scope="col">{displayHeader(column)}</th>)}</tr></thead>
              <tbody>{filtered.map((record, index) => <tr key={`${activeKind}-${index}`}>{columns.map((column) => <td key={column}>{displayCell((record as Record<string, unknown>)[column])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
        <p className="windows-diagnostics-node__note">{tx('windowsDiagnostics.note', 'This node reads local Windows state only. It does not change services, startup entries, tasks, updates, network settings, or event logs.')}</p>
      </div>
    </div>
  )
}
