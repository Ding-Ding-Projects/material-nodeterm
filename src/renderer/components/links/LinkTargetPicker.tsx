import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BranchSelect } from '../BranchSelect'
import { Button, FieldLabel, SearchField, Tablist } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { useProjects } from '../../state/projects'
import { activeSessionApi } from '../../session/session'
import type { Endpoint, Link, LinkKind } from '@shared/types'
import {
  describeEndpoint,
  kindAllowed,
  linkKindEndpointOf,
  newLinkId,
  resolveEndpoint,
  type PickerSelection,
  type ProjectLookup
} from '../../lib/link-authoring'

export interface LinkTargetPickerProps {
  sourceNodeId: string
  sourceProjectId: string
  onConfirm: (link: Link) => void
  onCancel: () => void
}

const KINDS: LinkKind[] = ['context', 'lineage', 'dependency']
const KIND_LABEL: Record<LinkKind, string> = {
  context: 'Context',
  lineage: 'Lineage',
  dependency: 'Dependency'
}

/** Off-canvas authoring for cross-project, branch, and dependency relationships. */
export function LinkTargetPicker({
  sourceNodeId,
  sourceProjectId,
  onConfirm,
  onCancel
}: LinkTargetPickerProps) {
  const [targetMode, setTargetMode] = useState<'node' | 'branch'>('node')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<PickerSelection | null>(null)
  const [kind, setKind] = useState<LinkKind>('dependency')
  const [purpose, setPurpose] = useState('')
  const [branch, setBranch] = useState('')
  const [branchSource, setBranchSource] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [sourceIsRemote, setSourceIsRemote] = useState(false)
  const projects = useProjects(
    (state) =>
      state.projects
        .filter((project) => !project.closed && !project.unavailable)
        .map((project) => ({
          id: project.id,
          name: project.name,
          cwd: project.cwd,
          nodes: project.nodes,
          closed: project.closed,
          unavailable: project.unavailable
        })) as ProjectLookup[]
  )

  const sourceProject = projects.find((project) => project.id === sourceProjectId)
  const sourceNode = sourceProject?.nodes.find((node) => node.id === sourceNodeId)
  const sourceEndpoint: Endpoint | null =
    targetMode === 'branch'
      ? branchSource.trim() && sourceProject?.cwd
        ? { ref: 'branch', repoPath: sourceProject.cwd, branch: branchSource.trim() }
        : null
      : sourceNode
        ? { ref: 'node', nodeId: sourceNodeId }
        : null
  const sourceDescriptor =
    sourceEndpoint?.ref === 'branch'
      ? { kind: 'branch', contextCapable: false }
      : sourceNode
        ? linkKindEndpointOf(sourceNode)
        : null

  useEffect(() => {
    const project = useProjects.getState().getProject(sourceProjectId)
    setSourceIsRemote(!!project?.ssh || !!project?.remote)
    if (targetMode !== 'branch' || !project?.cwd || project.ssh || project.remote) return
    let alive = true
    void activeSessionApi()
      .git.status(project.cwd)
      .then((status) => {
        if (alive) setBranches(status.branches ?? [])
      })
      .catch(() => {
        if (alive) setBranches([])
      })
    return () => {
      alive = false
    }
  }, [sourceProjectId, targetMode])

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return projects
    return projects
      .map((project) => ({
        ...project,
        nodes: project.nodes.filter((node) =>
          `${project.name} ${node.title} ${node.id}`.toLocaleLowerCase().includes(needle)
        )
      }))
      .filter((project) => project.nodes.length > 0)
  }, [projects, query])

  const target: Endpoint | null =
    targetMode === 'branch'
      ? branch.trim()
        ? { ref: 'branch', repoPath: sourceProject?.cwd ?? '', branch: branch.trim() }
        : null
      : selection?.kind === 'node'
        ? resolveEndpoint(selection, sourceProjectId)
        : null
  const targetNode =
    target?.ref === 'xnode'
      ? projects.find((project) => project.id === target.projectId)?.nodes.find((node) => node.id === target.nodeId)
      : target?.ref === 'node'
        ? projects.find((project) => project.nodes.some((node) => node.id === target.nodeId))?.nodes.find((node) => node.id === target.nodeId)
        : undefined
  const targetDescriptor = target?.ref === 'branch' ? { kind: 'branch', contextCapable: false } : targetNode ? linkKindEndpointOf(targetNode) : null
  const allowed = !!sourceDescriptor && !!targetDescriptor && !!target && kindAllowed(kind, sourceDescriptor, targetDescriptor)
  const canSubmit = allowed && (targetMode === 'branch'
    ? !sourceIsRemote && !!branchSource.trim() && !!branch.trim()
    : !!selection)

  const submit = (): void => {
    if (!canSubmit || !target) return
    onConfirm({
      id: newLinkId(),
      kind,
      source: sourceEndpoint!,
      target,
      ...(purpose.trim() ? { meta: { purpose: purpose.trim() } } : {})
    })
  }

  return createPortal(
    <div className="confirm-overlay link-picker-overlay" onClick={onCancel}>
      <div className="confirm link-picker" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2>New link</h2>
        <Tablist className="link-picker__tabs" ariaLabel="Target type">
          <Button variant="text" size="small" role="tab" aria-selected={targetMode === 'node'} onClick={() => setTargetMode('node')}>
            Node
          </Button>
          <Button variant="text" size="small" role="tab" aria-selected={targetMode === 'branch'} onClick={() => setTargetMode('branch')}>
            Branch
          </Button>
        </Tablist>
        {targetMode === 'node' ? (
          <>
            <FieldLabel className="link-picker__field" label="Find a project or node" htmlFor="link-picker-query">
              <SearchField id="link-picker-query" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Search" />
            </FieldLabel>
            <div className="link-picker__list">
              {visibleProjects.map((project) => (
                <div className="link-picker__project" key={project.id}>
                  <div className="link-picker__project-name">{project.name}</div>
                  {project.nodes.map((node) => {
                    const selected = selection?.kind === 'node' && selection.projectId === project.id && selection.nodeId === node.id
                    const source = project.id === sourceProjectId && node.id === sourceNodeId
                    return (
                      <Button
                        variant="text"
                        size="small"
                        vocabularyMode="factual"
                        className={`link-picker__node${selected ? ' selected' : ''}`}
                        key={node.id}
                        disabled={source}
                        aria-pressed={selected}
                        onClick={() => setSelection({ kind: 'node', projectId: project.id, nodeId: node.id })}
                      >
                        <span>{node.title || node.id}</span>
                        <small>{node.kind}{project.id === sourceProjectId ? '' : ' · foreign project'}</small>
                      </Button>
                    )
                  })}
                </div>
              ))}
              {visibleProjects.length === 0 && <p className="link-picker__empty">No matching nodes.</p>}
            </div>
          </>
        ) : sourceIsRemote ? (
          <p className="link-picker__empty">Branch links are unavailable for a remote project.</p>
        ) : (
          <>
            <FieldLabel className="link-picker__field" label="Child branch">
              <BranchSelect value={branchSource} options={branches} placeholder="Select the child branch" allowCustom customPlaceholder="Type a child branch or ref" onChange={setBranchSource} />
            </FieldLabel>
            <FieldLabel className="link-picker__field" label="Parent branch">
              <BranchSelect value={branch} options={branches} placeholder="Select the parent branch" allowCustom customPlaceholder="Type a parent branch or ref" onChange={setBranch} />
            </FieldLabel>
          </>
        )}
        <FieldLabel className="link-picker__field" label="Kind" htmlFor="link-picker-kind">
          <Select id="link-picker-kind" value={kind} onChange={(event) => setKind(event.target.value as LinkKind)}>
            {KINDS.map((candidate) => {
              const isAllowed = !!sourceDescriptor && !!targetDescriptor && kindAllowed(candidate, sourceDescriptor, targetDescriptor)
              return <option value={candidate} key={candidate} disabled={!isAllowed}>{KIND_LABEL[candidate]}{isAllowed ? '' : ' unavailable for this pair'}</option>
            })}
          </Select>
        </FieldLabel>
        <FieldLabel className="link-picker__field" label="Purpose (optional)" htmlFor="link-picker-purpose">
          <Input id="link-picker-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Why this relationship exists" />
        </FieldLabel>
        {target && <p className="link-picker__target">Target: {describeEndpoint(target, projects).label}</p>}
        <div className="confirm__actions">
          <Button variant="outlined" className="confirm__btn" onClick={onCancel}>Cancel</Button>
          <Button variant="filled" className="confirm__btn confirm__btn--primary" disabled={!canSubmit} onClick={submit}>Link</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
