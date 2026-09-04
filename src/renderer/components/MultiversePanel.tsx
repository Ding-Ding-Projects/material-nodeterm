import { useMemo, useRef, useState } from 'react'
import { useProjects } from '../state/projects'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { MULTIVERSE_CATALOG, MULTIVERSE_MAX_DEPTH, MULTIVERSE_ROOT_CANVAS_ID } from '../../core/multiverse'
import { uuid } from '../lib/uuid'
import type { CanvasNodeState } from '@shared/types'
import { markWorkspaceDirty } from '../state/workspaceDirty'
import { Button, FieldLabel, IconButton, ListRow, SearchField } from '../ui/md3'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'

/**
 * Lang gui child-canvas navigator. It deliberately lives inside the current project canvas rather
 * than in ProjectSwitcher: a Multiverse child is content scope, never a project tab. The panel owns
 * only hierarchy navigation and a small catalog seam; door, code, and game nodes arrive in later
 * lanes.
 */
export function MultiversePanel({ projectId, onClose }: { projectId: string; onClose: () => void }): React.JSX.Element {
  const project = useProjects((state) => state.projects.find((candidate) => candidate.id === projectId))
  const createChild = useProjects((state) => state.createMultiverseChild)
  const setActive = useProjects((state) => state.setActiveMultiverseCanvas)
  const appendNode = useProjects((state) => state.appendMultiverseNode)
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('New Multiverse canvas')
  const [parentId, setParentId] = useState(MULTIVERSE_ROOT_CANVAS_ID)
  const [notice, setNotice] = useState<string | null>(null)
  const state = project?.multiverse
  const children = state?.children ?? []
  const visible = useMemo(() => {
    const query = search.query.trim().toLocaleLowerCase()
    return query ? children.filter((child) => child.title.toLocaleLowerCase().includes(query)) : children
  }, [children, search.query])

  if (!project) return <div className="md3-card multiverse-panel">Multiverse project is unavailable.</div>

  const addChild = () => {
    const id = `multiverse-${uuid()}`
    if (!createChild(projectId, parentId, title.trim(), id)) {
      setNotice(`Cannot create a child at this scope. Nesting is limited to depth ${MULTIVERSE_MAX_DEPTH}.`)
      return
    }
    markWorkspaceDirty()
    setNotice('Child canvas created and persisted in this project.')
  }

  const addNote = (canvasId: string) => {
    const node: CanvasNodeState = {
      id: `sticky-${uuid()}`,
      kind: 'sticky',
      position: { x: 80, y: 80 },
      size: { width: 240, height: 200 },
      title: 'Note',
      color: '#ffd60a',
      group: null,
      text: ''
    }
    const changed = appendNode(projectId, canvasId, node)
    if (changed) markWorkspaceDirty()
    setNotice(changed ? 'Note added to the child canvas.' : 'This child canvas rejected the catalog item.')
  }

  return (
    <section className="md3-card multiverse-panel" aria-label="Multiverse child canvases">
      <header className="multiverse-panel__header">
        <div>
          <h2>Multiverse</h2>
          <p>Scoped child canvases stay inside this project. They are not project tabs.</p>
        </div>
        <IconButton size="dense" icon="close" aria-label="Close Multiverse" onClick={onClose} />
      </header>
      <div className="multiverse-panel__search">
        <SearchField ref={searchRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Search child canvases" aria-label="Search child canvases" />
        <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex — Multiverse child canvas search" />
      </div>
      <div className="multiverse-panel__create" role="group" aria-label="Create child canvas">
        <FieldLabel label="Child canvas name">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </FieldLabel>
        <FieldLabel label="Parent canvas">
          <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value={MULTIVERSE_ROOT_CANVAS_ID}>Project root</option>
            {children.map((child) => <option key={child.id} value={child.id} disabled={child.depth >= MULTIVERSE_MAX_DEPTH}>{child.title} · depth {child.depth}</option>)}
          </Select>
        </FieldLabel>
        <Button variant="filled" onClick={addChild} disabled={!title.trim()}>Create child canvas</Button>
      </div>
      {notice && <p className="multiverse-panel__notice" role="status">{notice}</p>}
      <ul className="multiverse-panel__list" aria-label="Child canvas list">
        {visible.length === 0 && <li className="multiverse-panel__empty">No child canvases match this search.</li>}
        {visible.map((child) => (
          <li key={child.id} className={state?.activeCanvasId === child.id ? 'is-active' : ''}>
            <ListRow
              className="multiverse-panel__canvas"
              onClick={() => { if (setActive(projectId, child.id)) markWorkspaceDirty(); setNotice(`Opened ${child.title}.`) }}
              label={child.title}
              sub={`Depth ${child.depth} · ${child.nodes.length} item${child.nodes.length === 1 ? '' : 's'} · ${child.nodes.map((node) => node.title).join(', ') || 'empty child content'}`}
            />
            <Button variant="tonal" size="small" onClick={() => addNote(child.id)} aria-label={`Add a note to ${child.title}`}>Add note</Button>
          </li>
        ))}
      </ul>
      <footer className="multiverse-panel__catalog">
        <strong>Catalog scope</strong>
        <span>{MULTIVERSE_CATALOG.list({ rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID, canvasId: state?.activeCanvasId ?? MULTIVERSE_ROOT_CANVAS_ID, depth: 1 }).map((entry) => entry.label).join(' · ')}</span>
        <small>Future door, code, and game entries are intentionally not registered in this lane.</small>
      </footer>
    </section>
  )
}
