import { useMemo, useRef, useState } from 'react'
import type { PortableCanvasProjectionV3 } from '../../core/portable-canvas-projection'
import {
  createPortablePortal,
  navigatePortablePortal,
  setPortablePortalStatus,
  type PortablePortalV3
} from '../../core/portal-lifecycle'
import {
  decideUniverseDoorNavigation,
  verifyUniverseDoorEntry,
  type UniverseDoorEntrySubmission
} from '../../core/universe-door-navigation'
import { Dialog } from '../ui/md3/Dialog'
import { TextField } from '../ui/md3/TextField'
import { Button } from '../ui/md3/Button'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { UniverseDoorEntryPanel } from './canvas/UniverseDoorEntryPanel'

export interface PortalLifecycleDialogProps {
  open: boolean
  projection: PortableCanvasProjectionV3
  currentCanvasId: string
  onClose: () => void
  onChange: (projection: PortableCanvasProjectionV3) => void
  onOpenCanvas: (portalId: string) => void
  /** Optional override for non-desktop hosts. Default uses the host-owned bridge API. */
  onVerifyEntry?: (doorId: string, submission: UniverseDoorEntrySubmission) => Promise<boolean>
  /** Deletion remains behind the app's existing two-key confirmation surface. */
  onRequestDelete: (portal: PortablePortalV3) => void
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
  onVerifyEntry,
  onRequestDelete
}: PortalLifecycleDialogProps) {
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [selectedParent, setSelectedParent] = useState(currentCanvasId)
  const [childId, setChildId] = useState('')
  const entryAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [entryPortal, setEntryPortal] = useState<PortablePortalV3 | null>(null)
  const [entryError, setEntryError] = useState<string | null>(null)
  const [entryBusy, setEntryBusy] = useState(false)
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

  const openEntry = (portal: PortablePortalV3, anchor: HTMLButtonElement): void => {
    entryAnchorRef.current = anchor
    const door = (projection.doors ?? []).find((candidate) => candidate.id === portal.entryDoorId)
    const decision = navigatePortablePortal(projection, portal.id, currentCanvasId)
    if (!decision.allowed) {
      setEntryError(decision.reason)
      setEntryPortal(null)
      return
    }
    if (!door) {
      setEntryError('The matching entry door is unavailable, so this portal remains closed.')
      setEntryPortal(null)
      return
    }
    const pairedDecision = decideUniverseDoorNavigation(projection.doors ?? [], {
      source: 'door',
      fromCanvasId: currentCanvasId,
      targetCanvasId: portal.childCanvasId,
      doorId: portal.entryDoorId
    })
    if (!pairedDecision.allowed) {
      setEntryError(pairedDecision.reason)
      setEntryPortal(null)
      return
    }
    if (!door.entryPolicy) {
      setEntryError('This door has no entry policy configured on this computer.')
      setEntryPortal(null)
      return
    }
    setEntryError(null)
    setEntryPortal(portal)
  }

  const submitEntry = async (submission: UniverseDoorEntrySubmission): Promise<void> => {
    if (!entryPortal || entryBusy) return
    const door = (projection.doors ?? []).find((candidate) => candidate.id === entryPortal.entryDoorId)
    if (!door) {
      setEntryError('The matching entry door is unavailable, so this portal remains closed.')
      return
    }
    setEntryBusy(true)
    try {
      const decision = navigatePortablePortal(projection, entryPortal.id, currentCanvasId)
      if (!decision.allowed) {
        setEntryError(decision.reason)
        return
      }
      const pairedDecision = decideUniverseDoorNavigation(projection.doors ?? [], {
        source: 'door',
        fromCanvasId: currentCanvasId,
        targetCanvasId: entryPortal.childCanvasId,
        doorId: entryPortal.entryDoorId
      })
      if (!pairedDecision.allowed) {
        setEntryError(pairedDecision.reason)
        return
      }
      const verifyWithHost = onVerifyEntry ?? (async (doorId: string, value: UniverseDoorEntrySubmission): Promise<boolean> => {
        const result = await window.nodeTerminal.universeDoorEntry.verify({ doorId, method: value.method, value: value.value })
        return result.verified
      })
      const result = await verifyUniverseDoorEntry(door, submission, verifyWithHost)
      if (!result.verified) {
        setEntryError(result.reason)
        return
      }
      setEntryPortal(null)
      setEntryError(null)
      onOpenCanvas(entryPortal.id)
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : 'The door entry could not be verified.')
    } finally {
      setEntryBusy(false)
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
              <Button
                disabled={!isCurrent || !isOpen}
                title={!isCurrent ? 'Open the containing canvas first.' : !isOpen ? 'Open this portal before entering it.' : undefined}
                onClick={(event) => openEntry(portal, event.currentTarget)}
              >
                Enter
              </Button>
              <Button onClick={() => onChange(setPortablePortalStatus(projection, portal.id, isOpen ? 'closed' : 'open'))}>{isOpen ? 'Close' : 'Open portal'}</Button>
              <Button title="Deletion requires the app two-key confirmation." onClick={() => onRequestDelete(portal)}>Delete portal…</Button>
            </article>
          )
        })}
      </section>
      {entryPortal && (() => {
        const door = (projection.doors ?? []).find((candidate) => candidate.id === entryPortal.entryDoorId)
        if (!door?.entryPolicy) return null
        return (
          <AnchoredPopover
            anchorRef={entryAnchorRef}
            open
            onClose={() => {
              setEntryPortal(null)
              setEntryError(null)
            }}
            width={560}
            className="universe-door-entry-popover"
            zIndex={116}
          >
            <UniverseDoorEntryPanel
              policy={door.entryPolicy}
              destinationLabel={entryPortal.title}
              busy={entryBusy}
              error={entryError}
              onSubmit={(submission) => { void submitEntry(submission) }}
              onCancel={() => {
                setEntryPortal(null)
                setEntryError(null)
              }}
            />
          </AnchoredPopover>
        )
      })()}
    </Dialog>
  )
}

/** Shared helper for callers that need the exact door-only entry decision before navigation. */
export { navigatePortablePortal }
