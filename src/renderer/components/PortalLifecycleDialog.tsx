import { useMemo, useRef, useState } from 'react'
import type { PortableCanvasProjectionV3 } from '../../core/portable-canvas-projection'
import {
  createPortablePortal,
  deletePortablePortal,
  navigatePortablePortal,
  setPortablePortalStatus,
  type PortablePortalV3
} from '../../core/portal-lifecycle'
import { Dialog } from '../ui/md3/Dialog'
import { TextField } from '../ui/md3/TextField'
import { Button } from '../ui/md3/Button'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'

export interface PortalLifecycleDialogProps {
  open: boolean
  projection: PortableCanvasProjectionV3
  currentCanvasId: string
  onClose: () => void
  onChange: (projection: PortableCanvasProjectionV3) => void
  onOpenCanvas: (canvasId: string, returnDoorId: string) => void
  /** Deletion remains behind the app's existing two-key confirmation surface. */
  onRequestDelete: (portal: PortablePortalV3, apply: () => void) => void
}

/** Guided portal lifecycle surface. It only changes the portable projection; binding, process,
 * provider, and deployment work stays behind explicit destination actions after import. */
export function PortalLifecycleDialog({
  open,
  projection,
  currentCanvasId,
  onClose,
  onChange,
  onOpenCanvas,
  onRequestDelete
}: PortalLifecycleDialogProps) {
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [selectedParent, setSelectedParent] = useState(currentCanvasId)
  const [childId, setChildId] = useState('')
  const portals = projection.portals ?? []
  const visible = useMemo(() => {
    const query = search.query.trim()
    if (!query) return portals
    if (search.mode === 'regex') return portals.filter((portal) => search.test(`${portal.title} ${portal.id}`))
    return portals.filter((portal) => `${portal.title} ${portal.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  }, [portals, search.mode, search.query, search.test])
  const selectedParentRecord = projection.canvases.find((canvas) => canvas.id === selectedParent)
  const parentDepth = selectedParentRecord?.depth ?? 0
  const canCreate = !!selectedParentRecord && (selectedParentRecord.scope === 'root' || selectedParentRecord.scope === 'multiverse') && parentDepth < 8 && title.trim().length > 0 && childId.trim().length > 0
  const createReason = !selectedParentRecord
    ? 'Choose a containing canvas.'
    : selectedParentRecord.scope !== 'root' && selectedParentRecord.scope !== 'multiverse'
      ? 'Only the root and Multiverse canvases can contain a portal.'
      : parentDepth >= 8
        ? 'Multiverse portals stop at depth 8.'
        : !title.trim() || !childId.trim()
          ? 'Enter a portal title and a new child canvas id.'
          : undefined

  const create = () => {
    if (!canCreate) return
    const result = createPortablePortal(projection, {
      portalId: `portal-${childId.trim()}`,
      childCanvasId: childId.trim(),
      parentCanvasId: selectedParent,
      title: title.trim()
    })
    if (result.projection && result.portal) {
      onChange(result.projection)
      setTitle('')
      setChildId('')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Portal lifecycle" className="portal-lifecycle-dialog">
      <p>Choose a containing canvas, give the child canvas a name, and create a closed portal. Import and repair never contact a provider or start a process.</p>
      <section aria-label="Create portal" className="portal-lifecycle-dialog__create">
        <label>
          Containing canvas
          <select value={selectedParent} onChange={(event) => setSelectedParent(event.target.value)} aria-label="Containing canvas">
            {projection.canvases.map((canvas) => <option key={canvas.id} value={canvas.id}>{canvas.title} ({canvas.id})</option>)}
          </select>
        </label>
        <TextField label="Portal title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <TextField label="New child canvas id" value={childId} onChange={(event) => setChildId(event.target.value)} supportText="Use a new visible identifier; credentials, paths, and runtime state never enter the projection." />
        <Button disabled={!canCreate} title={createReason} onClick={create}>Create portal</Button>
        {!canCreate && <p role="status">{createReason}</p>}
      </section>
      <section aria-label="Search portals" className="portal-lifecycle-dialog__list">
        <TextField
          ref={searchRef}
          label="Search portals"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex: portal search" />}
          supportText={search.error ?? `${visible.length} portal${visible.length === 1 ? '' : 's'} shown`}
          invalid={!!search.error}
        />
        {!visible.length ? <p role="status">No portals match this search.</p> : visible.map((portal) => {
          const isCurrent = portal.parentCanvasId === currentCanvasId
          const isOpen = portal.status === 'open'
          return (
            <article key={portal.id} className="portal-lifecycle-dialog__row" aria-label={portal.title}>
              <div><strong>{portal.title}</strong><span>{portal.id} · depth {portal.depth} · {portal.status}</span></div>
              <Button disabled={!isCurrent || !isOpen} title={!isCurrent ? 'Open the containing canvas first.' : !isOpen ? 'Open this portal before entering it.' : undefined} onClick={() => onOpenCanvas(portal.childCanvasId, portal.returnDoorId)}>Open</Button>
              <Button onClick={() => onChange(setPortablePortalStatus(projection, portal.id, isOpen ? 'closed' : 'open'))}>{isOpen ? 'Close' : 'Open portal'}</Button>
              <Button title="Deletion requires the app two-key confirmation." onClick={() => onRequestDelete(portal, () => { const result = deletePortablePortal(projection, portal.id); if (result.projection) onChange(result.projection) })}>Delete portal…</Button>
            </article>
          )
        })}
      </section>
    </Dialog>
  )
}

/** Shared helper for callers that need the exact door-only entry decision before navigation. */
export { navigatePortablePortal }
