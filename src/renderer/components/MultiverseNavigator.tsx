import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { MAX_MULTIVERSE_DEPTH, ROOT_CANVAS_ID, multiverseCanvasPath } from '@shared/multiverse-canvases'
import { useProjects } from '../state/projects'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { Button, Chip } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

export interface PendingDoorConstruction {
  parentCanvasId: string
  childCanvasId: string
  entryDoorId: string
  returnDoorId: string
  title: string
}

interface MultiverseNavigatorProps {
  onNavigate: (canvasId: string) => void
  onCreate: (parentCanvasId: string, title: string) => { canvasId?: string; reason?: string }
  onBeginDoorConstruction: (pending: PendingDoorConstruction) => void
  /** Optional controlled visibility for compact top-bar composition. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Anchor the compact picker to the shared More button instead of mounting a second trigger. */
  anchorRefOverride?: RefObject<HTMLButtonElement>
  hideTrigger?: boolean
}

/** Guided hierarchy picker for root plus scoped Multiverse canvases. */
export function MultiverseNavigator({ onNavigate, onCreate, onBeginDoorConstruction, open: controlledOpen, onOpenChange, anchorRefOverride, hideTrigger = false }: MultiverseNavigatorProps): React.JSX.Element | null {
  const ts = useLocalizedVocabularyText()
  const project = useProjects((state) => state.projects.find((item) => item.id === state.activeProjectId))
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [parentCanvasId, setParentCanvasId] = useState(ROOT_CANVAS_ID)
  const [title, setTitle] = useState('New Multiverse canvas')
  const [message, setMessage] = useState<string | null>(null)
  const internalAnchorRef = useRef<HTMLButtonElement>(null)
  const anchorRef = anchorRefOverride ?? internalAnchorRef
  const searchRef = useRef<HTMLInputElement>(null)
  const parentSearchRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()
  const parentSearch = useRegexSearchField()
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean): void => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const rows = useMemo(() => {
    if (!project) return []
    return [
      { id: ROOT_CANVAS_ID, title: project.name, depth: 0, parentCanvasId: undefined },
      ...(project.multiverseCanvases ?? [])
    ]
  }, [project])
  const visible = useMemo(
    () => rows.filter((row) => search.test(`${row.title} depth ${row.depth} ${row.id}`)),
    [rows, search]
  )
  const visibleParents = useMemo(
    () => rows.filter((row) => parentSearch.test(`${row.title} depth ${row.depth} ${row.id}`)),
    [rows, parentSearch]
  )
  if (!project) return null

  const activeId = project.activeCanvasId ?? ROOT_CANVAS_ID
  const active = rows.find((row) => row.id === activeId) ?? rows[0]
  const activePath = multiverseCanvasPath(project, activeId)
  const parent = rows.find((row) => row.id === parentCanvasId) ?? rows[0]
  const nextDepth = parent.depth + 1
  const createDisabledReason = nextDepth > MAX_MULTIVERSE_DEPTH
    ? ts('multiverse.depthLimit', 'Depth 8 is the deepest Multiverse canvas. Choose a shallower parent.')
    : !title.trim()
      ? ts('multiverse.nameRequired', 'Enter a name before creating the child canvas.')
      : null

  const submit = (): void => {
    if (createDisabledReason) return
    const result = onCreate(parentCanvasId, title)
    if (!result.canvasId) {
      setMessage(result.reason ?? ts('multiverse.createFailed', 'The child canvas could not be created.'))
      return
    }
    setMessage(ts('multiverse.created', 'Child canvas created.'))
    setCreateOpen(false)
    const entryDoorId = `door-${result.canvasId}-entry`
    const returnDoorId = `door-${result.canvasId}-return`
    onBeginDoorConstruction({ parentCanvasId, childCanvasId: result.canvasId, entryDoorId, returnDoorId, title: title.trim() })
    setOpen(false)
  }

  return (
    <>
      {!hideTrigger && (
        <Button variant="text" size="small" vocabularyMode="factual"
          ref={anchorRef}
         
          className="multiverse-nav__trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={ts('multiverse.open', 'Open canvas hierarchy')}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">◎</span>
          <span className="multiverse-nav__path">
            {activePath.map((item) => item.title).join(' / ') || active.title}
          </span>
          <span className="multiverse-nav__depth">{ts('multiverse.depth', 'Depth {depth}', { depth: String(active.depth) })}</span>
        </Button>
      )}
      <AnchoredPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={460} className="multiverse-nav__popover" zIndex={92}>
        <div className="multiverse-nav__header">
          <div>
            <h2>{ts('multiverse.title', 'Canvas hierarchy')}</h2>
            <p>{ts('multiverse.description', 'Open a scoped child canvas or create one beneath a parent. Hierarchy stops at depth 8.')}</p>
          </div>
          <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => setCreateOpen((value) => !value)} aria-expanded={createOpen}>
            {createOpen ? ts('multiverse.cancelCreate', 'Cancel') : ts('multiverse.newChild', 'New child canvas')}
          </Button>
        </div>
        <div className="multiverse-nav__search">
          <label htmlFor="multiverse-canvas-search">{ts('multiverse.search.label', 'Search canvases')}</label>
          <div className="multiverse-nav__search-control">
            <Input vocabularyMode="factual"
              ref={searchRef}
              id="multiverse-canvas-search"
              type="search"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              placeholder={ts('multiverse.search.placeholder', 'Name, depth, or identifier')}
            />
            <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={ts('multiverse.search.regex', 'Open regex builder for canvas search')} zIndex={96} />
          </div>
          <span role="status">{search.error ?? ts('multiverse.search.count', '{count} canvases shown', { count: String(visible.length) })}</span>
        </div>
        {createOpen && (
          <section className="multiverse-nav__create" aria-label={ts('multiverse.create.aria', 'Create child canvas')}>
            <label htmlFor="multiverse-parent-search">{ts('multiverse.parent', 'Parent canvas')}</label>
            <div className="multiverse-nav__search-control">
              <Input vocabularyMode="factual"
                ref={parentSearchRef}
                id="multiverse-parent-search"
                type="search"
                value={parentSearch.value}
                onChange={(event) => parentSearch.setValue(event.target.value)}
                placeholder={ts('multiverse.parentSearch.placeholder', 'Filter possible parents')}
              />
              <AnchoredRegexBuilder search={parentSearch} fieldRef={parentSearchRef} label={ts('multiverse.parentSearch.regex', 'Open regex builder for parent search')} zIndex={97} />
            </div>
            <span role="status">{parentSearch.error ?? ts('multiverse.parentSearch.count', '{count} parents shown', { count: String(visibleParents.length) })}</span>
            <div className="multiverse-nav__parent-list" role="listbox" aria-label={ts('multiverse.parentList.aria', 'Possible parent canvases')}>
              {visibleParents.length === 0 ? <p>{ts('multiverse.parentSearch.empty', 'No parent canvases match this search.')}</p> : visibleParents.map((row) => {
                const disabledReason = row.depth >= MAX_MULTIVERSE_DEPTH
                  ? ts('multiverse.parentDepthDisabled', '{parent} is already at depth 8 and cannot contain another child.', { parent: row.title })
                  : undefined
                return (
                  <Chip vocabularyMode="factual" selected={row.id === parentCanvasId}
                    key={row.id}
                   
                    role="option"
                    aria-selected={row.id === parentCanvasId}
                    aria-disabled={disabledReason ? 'true' : undefined}
                    className={row.id === parentCanvasId ? 'is-selected' : ''}
                    title={disabledReason}
                    onClick={() => { if (!disabledReason) setParentCanvasId(row.id) }}
                  >
                    <span>{'  '.repeat(row.depth)}{row.title}</span>
                    <span>{disabledReason ?? ts('multiverse.depth', 'Depth {depth}', { depth: String(row.depth) })}</span>
                  </Chip>
                )
              })}
            </div>
            <label htmlFor="multiverse-title">{ts('multiverse.name', 'Canvas name')}</label>
            <Input vocabularyMode="factual" id="multiverse-title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
            <p>{ts('multiverse.createPreview', 'This creates depth {depth} beneath {parent}, with one permanent scoped Shop.', { depth: String(nextDepth), parent: parent.title })}</p>
            {createDisabledReason && <p className="multiverse-nav__error" role="status">{createDisabledReason}</p>}
            <Button variant="outlined" size="small" vocabularyMode="factual" disabled={!!createDisabledReason} title={createDisabledReason ?? undefined} onClick={submit}>{ts('multiverse.create', 'Create and open')}</Button>
          </section>
        )}
        <div className="multiverse-nav__list" role="listbox" aria-label={ts('multiverse.list.aria', 'Project canvases')}>
          {visible.length === 0 ? <p>{ts('multiverse.empty', 'No canvases match this search.')}</p> : visible.map((row) => (
            <Chip vocabularyMode="factual" selected={row.id === activeId}
              key={row.id}
             
              role="option"
              aria-selected={row.id === activeId}
              className={row.id === activeId ? 'is-active' : ''}
              style={{ paddingInlineStart: 16 + row.depth * 18 }}
              onClick={() => { onNavigate(row.id); setOpen(false) }}
            >
              <span>{row.title}</span>
              <span>{ts('multiverse.depth', 'Depth {depth}', { depth: String(row.depth) })}</span>
            </Chip>
          ))}
        </div>
        {message && <p className="multiverse-nav__message" role="status">{message}</p>}
      </AnchoredPopover>
    </>
  )
}
