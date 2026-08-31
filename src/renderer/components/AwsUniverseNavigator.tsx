import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AWS_UNIVERSE_ROOT_ID, awsUniverseCanvasPath } from '@shared/aws-universes'
import { useProjects } from '../state/projects'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

interface AwsUniverseNavigatorProps {
  onNavigate: (canvasId: string) => void
  onCreate: (title: string) => { canvasId?: string; reason?: string }
  /** Optional controlled visibility for compact top-bar composition. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Anchor the compact picker to the shared More button instead of mounting a second trigger. */
  anchorRefOverride?: RefObject<HTMLButtonElement>
  hideTrigger?: boolean
}

/** Root-only navigator for an unlimited collection of AWS-only Universe instances. */
export function AwsUniverseNavigator({ onNavigate, onCreate, open: controlledOpen, onOpenChange, anchorRefOverride, hideTrigger = false }: AwsUniverseNavigatorProps): React.JSX.Element | null {
  const ts = useLocalizedVocabularyText()
  const project = useProjects((state) => state.projects.find((item) => item.id === state.activeProjectId))
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('New AWS Universe')
  const [message, setMessage] = useState<string | null>(null)
  const internalAnchorRef = useRef<HTMLButtonElement>(null)
  const anchorRef = anchorRefOverride ?? internalAnchorRef
  const searchRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()
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

  const rows = useMemo(() => project ? (project.childCanvases ?? []).filter((canvas) => canvas.scope === 'aws-universe') : [], [project])
  const visible = useMemo(
    () => rows.filter((row) => search.test(`${row.title} ${row.id} AWS Universe`)),
    [rows, search]
  )
  if (!project) return null

  const activeId = project.activeCanvasId ?? AWS_UNIVERSE_ROOT_ID
  const active = rows.find((row) => row.id === activeId)
  const activePath = active ? awsUniverseCanvasPath(project, activeId) : [{
    id: AWS_UNIVERSE_ROOT_ID,
    title: project.name,
    depth: 0,
    parentCanvasId: AWS_UNIVERSE_ROOT_ID,
    viewport: project.viewport,
    nodes: project.nodes
  }]
  const createDisabledReason = !title.trim()
    ? ts('awsUniverse.nameRequired', 'Enter a name before creating the AWS Universe.')
    : null

  const submit = (): void => {
    if (createDisabledReason) return
    const result = onCreate(title)
    if (!result.canvasId) {
      setMessage(result.reason ?? ts('awsUniverse.createFailed', 'The AWS Universe could not be created.'))
      return
    }
    setMessage(ts('awsUniverse.created', 'AWS Universe created.'))
    setCreateOpen(false)
    onNavigate(result.canvasId)
  }

  return (
    <>
      {!hideTrigger && (
        <button
          ref={anchorRef}
          type="button"
          className="aws-universe-nav__trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={ts('awsUniverse.open', 'Open AWS Universe')}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">◎</span>
          <span className="aws-universe-nav__path">{activePath.map((item) => item.title).join(' / ')}</span>
          <span className="aws-universe-nav__scope">{ts('awsUniverse.scope', 'AWS-only scope')}</span>
        </button>
      )}
      <AnchoredPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={460} className="aws-universe-nav__popover" zIndex={92}>
        <div className="aws-universe-nav__header">
          <div>
            <h2>{ts('awsUniverse.title', 'AWS Universe')}</h2>
            <p>{ts('awsUniverse.description', 'An AWS-only canvas. Provider credentials and runtime bindings stay on this computer.')}</p>
          </div>
          <button type="button" onClick={() => setCreateOpen((value) => !value)} aria-expanded={createOpen}>
            {createOpen ? ts('dialog.confirm.cancel', 'Cancel') : ts('awsUniverse.new', 'New AWS Universe')}
          </button>
        </div>
        <div className="aws-universe-nav__search">
          <label htmlFor="aws-universe-search">{ts('awsUniverse.search.label', 'Search AWS Universes')}</label>
          <div className="aws-universe-nav__search-control">
            <input
              ref={searchRef}
              id="aws-universe-search"
              type="search"
              value={search.value}
              onChange={(event) => search.setValue(event.target.value)}
              placeholder={ts('awsUniverse.search.placeholder', 'Name or instance id')}
            />
            <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={ts('awsUniverse.search.regex', 'Open regex builder for AWS Universe search')} zIndex={96} />
          </div>
          <span role="status">{search.error ?? ts('awsUniverse.search.count', '{count} AWS Universe instances shown', { count: String(visible.length) })}</span>
        </div>
        {createOpen && (
          <section className="aws-universe-nav__create" aria-label={ts('awsUniverse.new', 'New AWS Universe')}>
            <label htmlFor="aws-universe-title">{ts('awsUniverse.name', 'Universe name')}</label>
            <input id="aws-universe-title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
            <p>{ts('awsUniverse.preview', 'Creates one AWS-only child canvas with one permanent scoped Shop.')}</p>
            {createDisabledReason && <p className="aws-universe-nav__error" role="status">{createDisabledReason}</p>}
            <button type="button" disabled={!!createDisabledReason} title={createDisabledReason ?? undefined} onClick={submit}>{ts('awsUniverse.create', 'Create and open')}</button>
          </section>
        )}
        <div className="aws-universe-nav__list" role="listbox" aria-label={ts('awsUniverse.search.label', 'AWS Universes')}>
          {visible.length === 0 ? <p>{ts('awsUniverse.empty', 'No AWS Universe instances match this search.')}</p> : visible.map((row) => (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={row.id === activeId}
              className={row.id === activeId ? 'is-active' : ''}
              onClick={() => { onNavigate(row.id); setOpen(false) }}
            >
              <span>{row.title}</span>
              <span>{row.id}</span>
            </button>
          ))}
        </div>
        {message && <p className="aws-universe-nav__message" role="status">{message}</p>}
      </AnchoredPopover>
    </>
  )
}
