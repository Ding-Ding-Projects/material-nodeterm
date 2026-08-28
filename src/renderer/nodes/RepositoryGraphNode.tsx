import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { RepositoryGraphExportInput, RepositoryGraphMode, RepositoryGraphProgress, RepositoryGraphSnapshot } from '@shared/repository-graph'
import type { CanvasNode } from '../state/workspace'
import { useActiveSessionApi } from '../session/session'
import { useProjects } from '../state/projects'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

const MODES: readonly RepositoryGraphMode[] = ['code', 'dependencies', 'combined']
const EXPORTS: readonly RepositoryGraphExportInput['format'][] = ['json', 'jsonl', 'csv', 'tsv', 'markdown', 'html', 'graphml', 'dot']

function modeLabel(mode: RepositoryGraphMode): string {
  return mode === 'code' ? 'Code' : mode === 'dependencies' ? 'Dependency' : 'Combined'
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function RepositoryGraphNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const api = useActiveSessionApi()
  const projectId = useProjects((state) => state.activeProjectId)
  const { updateNodeData } = useReactFlow<CanvasNode>()
  const vocab = useVocabularyMapper()
  const [snapshot, setSnapshot] = useState<RepositoryGraphSnapshot | null>(null)
  const [progress, setProgress] = useState<RepositoryGraphProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intent = data.repositoryGraphIntent ?? { version: 1 as const, mode: 'combined' as const, query: '', expandedNodeIds: [], layout: 'hierarchical' as const }
  const [mode, setMode] = useState<RepositoryGraphMode>(intent.mode)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [exportFormat, setExportFormat] = useState<RepositoryGraphExportInput['format']>('json')

  const setIntent = useCallback((patch: Partial<typeof intent>): void => {
    updateNodeData(id, { repositoryGraphIntent: { ...intent, ...patch } })
  }, [id, intent, updateNodeData])

  const load = useCallback(async (): Promise<void> => {
    if (!projectId) return
    try {
      const next = await api.repositoryGraph.inspect(projectId, mode)
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The graph snapshot could not be read.')
    }
  }, [api, mode, projectId])

  useEffect(() => { void load() }, [load])
  useEffect(() => api.repositoryGraph.onProgress(setProgress), [api])

  const refresh = async (): Promise<void> => {
    if (!projectId) return
    setError(null)
    const next = await api.repositoryGraph.refresh({ projectId, mode })
    setSnapshot(next)
  }

  const visibleNodes = useMemo(() => {
    if (!snapshot) return []
    const query = search.query.trim()
    return snapshot.nodes.filter((node) => search.test(`${node.kind} ${node.label} ${node.detail ?? ''} ${node.source?.path ?? ''}`)).slice(0, 400)
      .filter((node) => !query || search.test(`${node.kind} ${node.label} ${node.detail ?? ''} ${node.source?.path ?? ''}`))
  }, [search, snapshot])

  const visualNodes = visibleNodes.slice(0, 80)
  const visualPositions = useMemo(() => new Map(visualNodes.map((node, index) => [node.id, { x: 110 + (index % 4) * 170, y: 36 + Math.floor(index / 4) * 76 }])), [visualNodes])
  const visualEdges = useMemo(() => snapshot?.edges.filter((edge) => visualPositions.has(edge.from) && visualPositions.has(edge.to)).slice(0, 180) ?? [], [snapshot, visualPositions])

  const openSource = async (node: NonNullable<RepositoryGraphSnapshot['nodes'][number]>): Promise<void> => {
    if (!projectId || !node.source) return
    const result = await api.repositoryGraph.openSource(projectId, node.source)
    if (!result.ok) setError(result.reason)
  }

  const doExport = async (): Promise<void> => {
    if (!projectId) return
    const result = await api.repositoryGraph.export({ projectId, mode, format: exportFormat })
    download(result.content, result.filename)
  }

  const headerFill = nodeHeaderFillStyle(data.color)
  const status = error ?? progress?.message ?? (snapshot?.status === 'idle' ? vocab('No verified snapshot. Refresh to index this project.') : snapshot ? `${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges, revision ${snapshot.fingerprint.revision}` : vocab('Reading project graph…'))

  return (
    <div className={`term-node repository-graph-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={560} minHeight={380} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <EditableNodeTitle value={data.title} onChange={(title) => updateNodeData(id, { title })} emptyLabel={vocab('Repository graph')} title={vocab('Click to rename')} ariaLabel={vocab('Repository graph node name')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button type="button" onClick={() => void refresh()} aria-label={vocab('Refresh repository graph')} title={vocab('Refresh repository graph')}>⟳</button>
      </div>
      <div className="repository-graph-node__body nodrag nowheel">
        <p className={`repository-graph-node__status${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{status}</p>
        <p className="repository-graph-node__hint">{vocab('The source root is resolved by this host from the active project. Derived graph data stays machine-local.')}</p>
        <div className="repository-graph-node__tabs" role="tablist" aria-label={vocab('Repository graph views')}>
          {MODES.map((candidate) => <button key={candidate} type="button" role="tab" aria-selected={mode === candidate} className={mode === candidate ? 'is-active' : ''} onClick={() => { setMode(candidate); setIntent({ mode: candidate }); search.setValue('') }}>{vocab(modeLabel(candidate))}</button>)}
        </div>
        <div className="repository-graph-node__toolbar">
          <div className="repository-graph-node__search"><input ref={searchRef} aria-label={vocab('Search graph nodes')} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={search.mode === 'regex' ? vocab('Regex pattern') : vocab('Search nodes, paths, symbols')} /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label={vocab('Regex builder for graph nodes')} /></div>
          <select aria-label={vocab('Export graph format')} value={exportFormat} onChange={(event) => setExportFormat(event.target.value as RepositoryGraphExportInput['format'])}>{EXPORTS.map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</select>
          <button type="button" onClick={() => void doExport()} disabled={!snapshot}>{vocab('Export')}</button>
        </div>
        {search.error && <p className="repository-graph-node__error" role="alert">{vocab(search.error)}</p>}
        {progress && progress.status === 'running' && <progress max={progress.total || 1} value={progress.completed} aria-label={`${progress.completed} of ${progress.total} graph items`} />}
        <div className="repository-graph-node__summary"><span>{snapshot?.fingerprint.files ?? 0} files</span><span>{snapshot?.nodes.length ?? 0} nodes</span><span>{snapshot?.edges.length ?? 0} edges</span><span>{snapshot?.status ?? 'idle'}</span></div>
        {visualNodes.length > 0 && <div className="repository-graph-node__visual" aria-label={vocab('Interactive graph preview')}>
          <svg viewBox={`0 0 760 ${Math.max(120, Math.ceil(visualNodes.length / 4) * 76 + 30)}`} role="img" aria-label={vocab('Graph relationships')}>
            <defs><marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="currentColor" /></marker></defs>
            {visualEdges.map((edge) => { const from = visualPositions.get(edge.from)!; const to = visualPositions.get(edge.to)!; return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" strokeOpacity=".45" markerEnd={`url(#${id}-arrow)`}><title>{`${edge.kind}: ${edge.from} → ${edge.to}`}</title></line> })}
            {visualNodes.map((node) => { const point = visualPositions.get(node.id)!; return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.label}, ${node.kind}`} transform={`translate(${point.x - 72},${point.y - 20})`} onClick={() => { const expanded = new Set(intent.expandedNodeIds ?? []); expanded.has(node.id) ? expanded.delete(node.id) : expanded.add(node.id); setIntent({ expandedNodeIds: [...expanded].slice(0, 2000) }) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true })) } }}><rect width="144" height="40" rx="10" fill="var(--md-sys-color-secondary-container)" stroke="var(--md-sys-color-outline)" /><text x="72" y="17" textAnchor="middle" fontSize="11" fill="var(--md-sys-color-on-secondary-container)">{node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}</text><text x="72" y="31" textAnchor="middle" fontSize="9" fill="var(--md-sys-color-on-secondary-container)">{node.kind}</text></g> })}
          </svg>
        </div>}
        <section className="repository-graph-node__list" role="list" aria-label={vocab('Graph nodes')}>
          {!snapshot || visibleNodes.length === 0 ? <p>{vocab(snapshot ? 'No graph nodes match this search.' : 'Refresh to build a verified graph snapshot.')}</p> : visibleNodes.map((node) => <article className="repository-graph-node__row" key={node.id} role="listitem"><button type="button" className="repository-graph-node__node" onClick={() => { const expanded = new Set(intent.expandedNodeIds ?? []); expanded.has(node.id) ? expanded.delete(node.id) : expanded.add(node.id); setIntent({ expandedNodeIds: [...expanded].slice(0, 2000) }) }} aria-expanded={intent.expandedNodeIds?.includes(node.id)}><strong>{node.label}</strong><span>{node.kind}{node.unresolved ? ' · unresolved' : ''}</span></button>{intent.expandedNodeIds?.includes(node.id) && <div className="repository-graph-node__detail"><code>{node.id}</code>{node.detail && <span>{node.detail}</span>}{node.source && <button type="button" onClick={() => void openSource(node)}>{node.source.path}{node.source.line ? `:${node.source.line}:${node.source.column ?? 1}` : ''}</button>}</div>}</article>)}
        </section>
        {snapshot?.omissions.length ? <details><summary>{vocab('Omissions and unsupported relationships')}</summary><ul>{snapshot.omissions.slice(0, 100).map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      </div>
    </div>
  )
}
