import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { WindowsDiagnosticSection, WindowsDiagnosticsSnapshot } from '@shared/windows-diagnostics'
import { WINDOWS_DIAGNOSTIC_SECTIONS } from '@shared/windows-diagnostics'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { IconButton, Tablist } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Chip } from '@renderer/ui/md3'

const SECTION_LABELS: Record<WindowsDiagnosticSection, string> = {
  drives: 'Drives and storage',
  services: 'Services',
  startup: 'Startup entries',
  scheduledTasks: 'Scheduled tasks',
  updates: 'Updates',
  network: 'Network state',
  events: 'Event summaries'
}
function sectionLabel(section: WindowsDiagnosticSection, vocab: (value: string) => string): string {
  return vocab(SECTION_LABELS[section])
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not reported'
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('en-US')
  return String(value)
}

export default function WindowsDiagnosticsNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { updateNodeData } = useReactFlow()
  const [snapshot, setSnapshot] = useState<WindowsDiagnosticsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<WindowsDiagnosticSection>('drives')
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await window.nodeTerminal.windowsDiagnostics.snapshot()
      setSnapshot(next)
      setError(null)
    } catch {
      setSnapshot(null)
      setError(vocab('The Windows diagnostics snapshot could not be read from this host.'))
    }
  }, [vocab])

  useEffect(() => { void load() }, [load])

  const active = snapshot?.sections[activeSection]
  const visibleRows = useMemo(() => {
    if (!active || active.state !== 'available') return []
    return active.rows.filter((row) => search.test(`${row.id} ${Object.entries(row.values).map(([key, value]) => `${key} ${valueText(value)}`).join(' ')}`))
  }, [active, search])

  const headerFill = nodeHeaderFillStyle(data.color)
  const statusKind = error ? 'error' : snapshot?.source === 'unavailable' ? 'unavailable' : snapshot ? 'checked' : 'reading'
  const statusText = statusKind === 'error'
    ? error
    : statusKind === 'unavailable'
      ? vocab('This host did not return a Windows diagnostics snapshot.')
      : statusKind === 'checked' && snapshot
        ? <><span>{vocab('Read-only snapshot checked')}</span> {new Date(snapshot.checkedAt).toLocaleString()}.</>
        : vocab('Reading this host…')

  return (
    <div className={`term-node windows-diagnostics-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={520} minHeight={360} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <EditableNodeTitle
          value={(data.title as string) ?? ''}
          onChange={(next) => updateNodeData(id, { title: next })}
          emptyLabel={vocab('Windows diagnostics')}
          title={vocab('Click to rename')}
          ariaLabel={vocab('Windows diagnostics node name')}
          rejectEmpty={false}
        />
        <span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__refresh" icon="refresh" title="Refresh diagnostics" aria-label="Refresh diagnostics" onClick={() => void load()} />
      </div>
      <div className="windows-diagnostics-node__body nodrag nowheel">
        <p className={`windows-diagnostics-node__status${error || snapshot?.source === 'unavailable' ? ' is-error' : ''}`} role={error || snapshot?.source === 'unavailable' ? 'alert' : 'status'}>{statusText}</p>
        <p className="windows-diagnostics-node__hint">{vocab('Read-only host facts. This node never starts, stops, enables, disables, edits, or deletes host resources.')}</p>
        <Tablist className="windows-diagnostics-node__tabs" ariaLabel={vocab('Windows diagnostics sections')}>
          {WINDOWS_DIAGNOSTIC_SECTIONS.map((section) => {
            const current = snapshot?.sections[section]
            const count = current?.state === 'available' ? current.rows.length : 0
            return <Chip vocabularyMode="factual" selected={activeSection === section} key={section} role="tab" aria-selected={activeSection === section} aria-controls={`${id}-${section}`} className={activeSection === section ? 'is-active' : ''} onClick={() => { setActiveSection(section); search.setValue('') }}>{sectionLabel(section, vocab)} <span aria-label={`${count} ${vocab('rows')}`}>({count})</span></Chip>
          })}
        </Tablist>
        <div className="windows-diagnostics-node__search">
          <Input ref={searchRef} type="search" vocabularyMode="factual" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={search.mode === 'regex' ? vocab('Filter this section with regex') : vocab('Filter this section')} aria-label={`${vocab('Search')} ${sectionLabel(activeSection, vocab)}`} />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={`${vocab('Regex for')} ${sectionLabel(activeSection, vocab)}`} />
        </div>
        {search.error && <p className="windows-diagnostics-node__error" role="alert">{vocab(search.error)}</p>}
        <section id={`${id}-${activeSection}`} role="tabpanel" aria-label={sectionLabel(activeSection, vocab)} className="windows-diagnostics-node__panel">
          {!active ? <p>{vocab('No snapshot is available yet.')}</p> : active.state !== 'available' ? <p role="alert">{active.reason}</p> : visibleRows.length === 0 ? <p>{vocab(search.query ? 'No rows match this filter.' : 'The host reported no rows in this section.')}</p> : <div className="windows-diagnostics-node__table" role="table" aria-rowcount={visibleRows.length}>
            {visibleRows.map((row) => <article key={row.id} className="windows-diagnostics-node__row" role="row"><strong>{row.id}</strong><div>{Object.entries(row.values).map(([key, value]) => <span key={key}><b>{key}</b><code>{valueText(value) === 'Not reported' ? vocab('Not reported') : valueText(value)}</code></span>)}</div></article>)}
          </div>}
        </section>
      </div>
    </div>
  )
}
