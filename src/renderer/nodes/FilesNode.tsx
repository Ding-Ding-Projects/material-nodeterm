/**
 * A file-manager node: one directory listing, on the canvas, beside the terminals that work in it.
 *
 * This is NOT a second Explorer. The Explorer drawer is a single tree rooted at the active
 * project's cwd, and it is modal in practice — it covers the canvas and you close it to get back
 * to work. A file manager node is a persisted canvas object pinned to ONE directory, so you can
 * keep `src/renderer/nodes` open next to the agent working in it and a second one on `docs/`,
 * where a tree gives you one cursor and a lot of scrolling.
 *
 * **Which filesystem** is the same decision `EditorNode` makes, read the same way: an SSH project's
 * node (`data.sshFs`) lists the project's HOST over the ControlMaster; everything else lists
 * through the node's own session api — which is the local core for a local project and the PEER's
 * core for a relay tab, so a relay tab browses the machine its terminals are actually on. Getting
 * this from `useSession()` rather than `window.nodeTerminal` is the whole reason a relay tab works
 * here for free.
 *
 * **Opening is delegated, not reimplemented.** A file dispatches `nodeterm:open-file` — the event
 * `TerminalNode`'s Cmd+click links already use — so editor / image / video routing stays in
 * Canvas's one `openFile`, and this node never grows a second opinion about what a `.png` is.
 * Directories navigate in place (persisted, so a reload comes back where you were).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { DirEntry } from '@shared/types'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import { COLLAPSED_HEIGHT, type CanvasNode } from '../state/workspace'
import { ColorMenu } from '../components/color/ColorMenu'
import { Button, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { breadcrumbs, childPath, fileOpenTarget, folderTitle, parentDir } from '../lib/filesNode'
import { ancestorDirs, createTargetDir, newEntryPath } from '../lib/explorerCreate'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { sshFs } from '../terminal/ssh-fs'
import { useSession } from '../session/session'
import { useProjects } from '../state/projects'
import { promptDialog } from '../components/promptDialog'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { isBrowserRuntime } from '../bridge/runtime'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'

/** Surface a transient error the way every other node does (Canvas listens for this). */
const toast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message } }))
}

function EntryGlyph({ dir }: { dir: boolean }) {
  return dir ? (
    <svg aria-hidden="true" className="files-node__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="files-node__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </svg>
  )
}

export function FilesNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { updateNodeData, deleteElements, setNodes } = useReactFlow()
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleBefore, setTitleBefore] = useState('')
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState('')
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  /** Bumped to force a re-list after a create; `cwd` alone cannot express "same dir, new content". */
  const [version, setVersion] = useState(0)

  const collapsed = !!data.collapsed
  const cwd = (data.cwd as string) || '/'
  const isSshFs = !!data.sshFs
  const { api, source } = useSession()
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const fs = isSshFs && activeProjectId ? sshFs(activeProjectId) : api.fs
  /** A listing this machine's OS cannot act on: an SSH host's files, or a relay peer's. */
  const remote = isSshFs || source === 'relay'
  /** `shell.*` is Electron-only — in the browser the reveal row would be a button that does
   *  nothing, which teaches less than not offering it. */
  const canReveal = !remote && !isBrowserRuntime()

  useEffect(() => {
    let live = true
    setError('')
    void fs
      .list(cwd)
      .then((list) => {
        if (live) setEntries(list)
      })
      .catch(() => {
        if (!live) return
        setEntries([])
        setError('Could not read this folder.')
      })
    return () => {
      live = false
    }
    // `fs` is rebuilt each render (sshFs returns a fresh object), so it is deliberately not a
    // dependency — the identity that matters is the project + the sshFs flag, both of which
    // change `cwd`'s meaning and are covered by the deps that are here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, isSshFs, activeProjectId, version])

  const navigate = useCallback(
    (to: string) => {
      // The title tracks the folder ONLY while the user has not renamed the node by hand — the
      // same `titleAuto` contract agent nodes use for their session name. Renaming a file manager
      // "assets" and then having it silently become "images" on the next click would be the node
      // overwriting the user.
      const patch: Record<string, unknown> = { cwd: to }
      if (data.titleAuto !== false) patch.title = folderTitle(to)
      updateNodeData(id, patch)
      search.reset()
    },
    [id, updateNodeData, data.titleAuto, search.reset]
  )

  const open = useCallback(
    (entry: DirEntry) => {
      const path = childPath(cwd, entry.name)
      if (entry.dir) {
        navigate(path)
        return
      }
      if (fileOpenTarget(path, { remote }) === 'os') {
        api.shell.openPath(path)
        return
      }
      // Canvas owns editor-vs-video routing; `ssh` tells its `openFile` to read over the
      // project's remote fs rather than this machine's.
      window.dispatchEvent(
        new CustomEvent('nodeterm:open-file', { detail: { path, ssh: isSshFs } })
      )
    },
    [cwd, navigate, remote, api, isSshFs]
  )

  /** Create a file or a folder under `dir`, then re-list. Shared by both menu rows because the
   *  only difference is the last call — and the validation, the intermediate dirs and the
   *  already-exists check are exactly the things that must not be written twice. */
  const create = useCallback(
    async (dir: string, kind: 'file' | 'folder') => {
      const name = await promptDialog({
        // InputDialog owns this prompt's vocabulary boundary. Keep its copy raw here so the
        // singleton host maps it exactly once while the submitted name remains user data.
        message: kind === 'file' ? 'New file name:' : 'New folder name:',
        confirmLabel: 'Create'
      })
      if (name === null) return
      const target = newEntryPath(dir, name)
      if (!target) {
        toast(vocab('That name cannot be used.'))
        return
      }
      if (await fs.exists(target)) {
        toast(mapOwnedSentence(vocab, [fact(name.trim()), copy(' already exists.')]))
        return
      }
      // A nested name ("a/b/c.ts") needs its intermediate directories first — mkdir is recursive,
      // so one call on the deepest one is enough.
      const parents = ancestorDirs(dir, name)
      if (parents.length && !(await fs.mkdir(parents[parents.length - 1]))) {
        toast(vocab('Could not create that folder.'))
        return
      }
      const ok = kind === 'folder' ? await fs.mkdir(target) : await fs.write(target, '')
      if (!ok) {
        toast(vocab(kind === 'folder' ? 'Could not create that folder.' : 'Could not create that file.'))
        return
      }
      setVersion((v) => v + 1)
      if (kind === 'file') {
        window.dispatchEvent(
          new CustomEvent('nodeterm:open-file', { detail: { path: target, ssh: isSshFs } })
        )
      }
    },
    [fs, isSshFs, vocab]
  )

  const openMenu = useCallback(
    (e: React.MouseEvent, entry: DirEntry | null) => {
      e.preventDefault()
      e.stopPropagation()
      const path = entry ? childPath(cwd, entry.name) : cwd
      const dir = entry ? createTargetDir(path, entry.dir) : cwd
      const items: MenuItem[] = []
      if (entry) {
        items.push({ label: vocab(entry.dir ? 'Open folder' : 'Open'), onClick: () => open(entry) })
      }
      if (!entry || entry.dir) {
        items.push({
          label: vocab('New terminal here'),
          onClick: () =>
            window.dispatchEvent(
              new CustomEvent('nodeterm:open-terminal', { detail: { cwd: entry ? path : cwd } })
            )
        })
      }
      items.push({ type: 'separator' })
      items.push({ label: vocab('New file…'), onClick: () => void create(dir, 'file') })
      items.push({ label: vocab('New folder…'), onClick: () => void create(dir, 'folder') })
      items.push({ type: 'separator' })
      items.push({
        label: vocab('Copy path'),
        onClick: () => api.clipboard.writeText(path)
      })
      if (canReveal) {
        items.push({ label: vocab('Reveal in file manager'), onClick: () => api.shell.reveal(path) })
      }
      setMenu({ x: e.clientX, y: e.clientY, items })
    },
    [cwd, open, create, api, canReveal, vocab]
  )

  const toggleCollapse = () =>
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n
        const next = !n.data.collapsed
        const expandedHeight =
          (n.data.expandedHeight as number) ?? n.measured?.height ?? (n.height as number) ?? 460
        const height = next ? COLLAPSED_HEIGHT : expandedHeight
        return {
          ...n,
          height,
          style: { ...n.style, height },
          data: { ...n.data, collapsed: next, expandedHeight }
        }
      })
    )

  const shown = useMemo(
    () => (entries ?? []).filter((entry) => search.test(entry.name)),
    [entries, search.test]
  )
  const crumbs = useMemo(() => breadcrumbs(cwd), [cwd])

  return (
    <div className={`files-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''}`}>
      <NodeResizer
        minWidth={NODE_MIN_SIZES.files.width}
        minHeight={NODE_MIN_SIZES.files.height}
        isVisible={selected && !collapsed}
        color={data.color as string}
      />

      <div className="files-node__header" style={{ background: `${data.color}22` }}>
        <IconButton
          size="compact"
          className="term-node__collapse"
          icon={collapsed ? 'chevron_right' : 'arrow_drop_down'}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand files node' : 'Collapse files node'}
          onClick={toggleCollapse}
        />
        <IconButton
          size="compact"
          className="term-node__color-btn"
          title="Color"
          aria-label="Choose node color"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setColorAnchor((cur) => (cur ? null : { x: r.left, y: r.bottom + 4 }))
          }}
        >
          <span className="mdx-icon-btn__swatch" style={{ background: data.color as string }} />
        </IconButton>
        {colorAnchor && (
          <ColorMenu
            x={colorAnchor.x}
            y={colorAnchor.y}
            value={data.color as string}
            onPick={(c) => updateNodeData(id, { color: c })}
            onClose={() => setColorAnchor(null)}
          />
        )}
        {editingTitle ? (
          <Input
            className="mdx-input--bare term-node__title nodrag"
            value={(data.title as string) ?? ''}
            aria-label="File node title"
            spellCheck={false}
            autoFocus
            // A hand rename stops the title tracking the folder — same contract as an agent
            // node's session name (`titleAuto`), so navigating never overwrites a chosen name.
            onChange={(e) => updateNodeData(id, { title: e.target.value, titleAuto: false })}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setEditingTitle(false)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                updateNodeData(id, { title: titleBefore })
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <span
            className="term-node__title-text nodrag"
            title={vocab('Click to rename')}
            role="button"
            tabIndex={0}
            onClick={() => {
              setTitleBefore((data.title as string) ?? '')
              setEditingTitle(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setTitleBefore((data.title as string) ?? '')
                setEditingTitle(true)
              }
            }}
          >
            {(data.title as string) || folderTitle(cwd)}
          </span>
        )}
        {isSshFs && <span className="files-node__chip">SSH</span>}
        {!editingTitle && <span className="term-node__spacer" />}
        <IconButton
          size="compact"
          className="files-node__btn nodrag"
          icon="north_west"
          title="Up one folder"
          aria-label="Up one folder"
          disabled={cwd === '/'}
          onClick={() => navigate(parentDir(cwd))}
        />
        <IconButton
          size="compact"
          className="files-node__btn nodrag"
          icon="refresh"
          title="Refresh"
          aria-label="Refresh"
          onClick={() => setVersion((v) => v + 1)}
        />
        <IconButton
          size="compact"
          className="term-node__close"
          icon="close"
          title="Close"
          aria-label="Close files node"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        />
      </div>

      {!collapsed && (
        <>
          <div className="files-node__crumbs nodrag">
            {crumbs.map((c, i) => (
              <span key={`${c.path}-${i}`} className="files-node__crumb-wrap">
                {/* No separator after the ROOT crumb — its own label is already "/", and a
                    separator there renders the doubled "/ / …" this replaced. */}
                {i > 0 && crumbs[i - 1].name !== '/' && <span className="files-node__sep">/</span>}
                <Button variant="text" size="small" className="files-node__crumb" vocabularyMode="factual" title={c.path} aria-label={mapOwnedSentence(vocab, [copy('Open folder '), fact(c.path)])} onClick={() => navigate(c.path)}>
                  {c.name}
                </Button>
              </span>
            ))}
          </div>

          <div className="files-node__search nodrag">
            <Input
              ref={searchRef}
              className="files-node__filter"
              type="search"
              value={search.value}
              placeholder={vocab(search.mode === 'regex' ? 'Filter files… (regex)' : 'Filter files…')}
              aria-label={vocab('Filter files')}
              spellCheck={false}
              onChange={(e) => search.setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  search.reset()
                }
              }}
            />
            <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={vocab('Regex builder for Files node filter')} />
          </div>
          {search.error && <p className="files-node__search-error" role="alert">{search.error}</p>}

          <div
            className="files-node__list nodrag nowheel"
            onContextMenu={(e) => openMenu(e, null)}
          >
            {/* Four distinct states, kept distinct. "Still loading", "could not read", "the
                folder is empty" and "your filter matches nothing" are different facts, and
                collapsing any of them into a blank pane is exactly the failure this repo's
                house rules call out. */}
            {entries === null ? (
              <div className="files-node__empty">{vocab('Loading…')}</div>
            ) : error ? (
              <div className="files-node__empty files-node__empty--error">{vocab(error)}</div>
            ) : entries.length === 0 ? (
              <div className="files-node__empty">{vocab('This folder is empty.')}</div>
            ) : shown.length === 0 ? (
              <div className="files-node__empty">{mapOwnedSentence(vocab, [copy('Nothing matches “'), fact(search.value.trim()), copy('”.')])}</div>
            ) : (
              shown.map((entry) => (
                <div
                  key={entry.name}
                  className={`files-node__row${entry.ignored ? ' is-ignored' : ''}`}
                  title={childPath(cwd, entry.name)}
                  role="button"
                  tabIndex={0}
                  aria-label={mapOwnedSentence(vocab, [copy(entry.dir ? 'Open folder ' : 'Open file '), fact(entry.name)])}
                  onClick={() => open(entry)}
                  onContextMenu={(e) => openMenu(e, entry)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      open(entry)
                    }
                  }}
                >
                  <EntryGlyph dir={entry.dir} />
                  <span className="files-node__name">{entry.name}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
