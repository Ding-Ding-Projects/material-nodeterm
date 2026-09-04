import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnchoredPopover } from '../../ui/AnchoredPopover'
import { Button, FieldLabel, IconButton, SearchField, TextField } from '../../ui/md3'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { applySavedLayout, createSavedLayout, type SavedLayoutApplyResult } from '../../lib/savedLayouts'
import type { CanvasNodeState, SavedLayoutView } from '@shared/types'

interface SavedLayoutsPanelProps {
  anchorRef: RefObject<HTMLElement>
  open: boolean
  layouts: SavedLayoutView[]
  nodes: CanvasNodeState[]
  onClose: () => void
  onSave: (layout: SavedLayoutView) => void
  onApply: (layout: SavedLayoutView, result: SavedLayoutApplyResult) => void
  onDelete: (layout: SavedLayoutView) => void
}

/**
 * The saved-layout catalogue is an anchored, keyboard-first surface rather than a menu full of
 * dynamic rows.  It previews missing nodes and collisions before applying, and names the portable
 * boundary beside the controls so importing a project never looks like it will start a process.
 */
export function SavedLayoutsPanel({ anchorRef, open, layouts, nodes, onClose, onSave, onApply, onDelete }: SavedLayoutsPanelProps): React.JSX.Element | null {
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const filtered = useMemo(() => layouts.filter((layout) => search.test(`${layout.name} ${layout.nodes.length}`)), [layouts, search])
  const preview = useMemo(() => {
    const selected = layouts.find((layout) => layout.id === previewId)
    return selected ? { layout: selected, result: applySavedLayout(nodes, selected) } : null
  }, [layouts, nodes, previewId])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const save = (): void => {
    const layout = createSavedLayout(nodes, name)
    if (!layout) return
    onSave(layout)
    setName('')
    setPreviewId(layout.id)
  }

  return (
    <AnchoredPopover anchorRef={anchorRef} open={open} onClose={onClose} width={480} className="saved-layouts-popover" zIndex={70}>
      <section aria-label="Saved layouts">
        <header className="saved-layouts__header">
          <div>
            <h2>Saved layouts</h2>
            <p>Portable node arrangements for this project. Applying one changes geometry only.</p>
          </div>
          <IconButton icon="close" aria-label="Close saved layouts" title="Close saved layouts" onClick={onClose} />
        </header>
        <div className="saved-layouts__note" role="note">
          Stored in the shared project file: node identity, size, position, grouping, and collapsed state only.
          Credentials, sessions, host paths, process state, and caches stay local. Applying or importing never launches or deploys anything.
        </div>
        <div className="menu-filter saved-layouts__search">
          <div className="menu-filter__row">
            <SearchField
              ref={inputRef}
              inputClassName="menu-filter__input"
              value={search.value}
              onChange={(e) => search.setValue(e.target.value)}
              placeholder={search.mode === 'regex' ? 'Search layouts… (regex)' : 'Search layouts…'}
              aria-label="Search saved layouts"
              trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={inputRef} label="Regex — saved layouts" zIndex={73} />}
            />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
          <span className="sr-only" role="status" aria-live="polite">{filtered.length} saved layouts</span>
        </div>
        <div className="saved-layouts__list" role="listbox" aria-label="Saved layout catalogue">
          {filtered.length === 0 ? <div className="saved-layouts__empty">{layouts.length ? 'No saved layouts match this search.' : 'No saved layouts yet. Name the current canvas below.'}</div> : filtered.map((layout) => {
            const selected = previewId === layout.id
            return (
              <div className={`saved-layouts__row${selected ? ' is-selected' : ''}`} key={layout.id} role="option" aria-selected={selected}>
                <Button type="button" variant="text" className="saved-layouts__select" onClick={() => setPreviewId(layout.id)}>
                  <strong>{layout.name}</strong>
                  <span>{layout.nodes.length} nodes · {new Date(layout.createdAt).toLocaleString()}</span>
                </Button>
                <Button type="button" variant="tonal" className="saved-layouts__apply" onClick={() => onApply(layout, applySavedLayout(nodes, layout))} aria-label={`Apply saved layout ${layout.name}`}>Apply</Button>
                <Button type="button" variant="text" className="saved-layouts__delete" onClick={() => onDelete(layout)} aria-label={`Delete saved layout ${layout.name}`}>Delete</Button>
              </div>
            )
          })}
        </div>
        {preview && (
          <div className="saved-layouts__preview" role="status" aria-live="polite">
            <strong>Preview: {preview.layout.name}</strong>
            <span>{preview.result.appliedIds.length} nodes will move or resize.</span>
            {preview.result.missingIds.length > 0 && <span className="saved-layouts__warning">{preview.result.missingIds.length} saved nodes are not in this canvas and will be left untouched.</span>}
            {preview.result.collisionPairs.length > 0 && <span className="saved-layouts__warning">{preview.result.collisionPairs.length} collision{preview.result.collisionPairs.length === 1 ? '' : 's'} detected. The arrangement will be applied exactly, so review the affected nodes.</span>}
          </div>
        )}
        <div className="saved-layouts__create">
          <FieldLabel label="Name this canvas" htmlFor="saved-layout-name" />
          <div className="saved-layouts__create-row">
            <TextField ref={nameRef} id="saved-layout-name" label="Layout name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="For example: Agent review" aria-describedby="saved-layout-name-help" />
            <Button type="button" variant="filled" onClick={save} disabled={!name.trim() || nodes.length === 0}>Save layout</Button>
          </div>
          <small id="saved-layout-name-help">Names are required, limited to 160 characters, and saved with the portable project geometry.</small>
        </div>
        <footer className="saved-layouts__footer">
          <span>Keyboard: Tab through layouts, Enter applies, Escape closes.</span>
          <Button type="button" variant="text" onClick={onClose}>Close</Button>
        </footer>
      </section>
    </AnchoredPopover>
  )
}
