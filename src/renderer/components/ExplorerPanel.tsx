import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconButton, SearchField } from '../ui/md3'
import { createPortal } from 'react-dom'
import type { DirEntry, FsApi } from '@shared/types'
import { gitignoreAdd, gitignoreHasExact, gitignoreRemove } from '@shared/gitignore'
import { useProjects } from '../state/projects'
import { useExplorer } from '../state/explorer'
import { sshFs } from '../terminal/ssh-fs'
import { useSession } from '../session/session'
import { promptDialog } from './promptDialog'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import {
  ancestorDirs,
  createTargetDir,
  newEntryPath,
  parentDir,
  revealTargets
} from '../lib/explorerCreate'
import { canRevealLocally, downloadRoute, triggerBrowserDownload } from '../lib/download'
import { explorerOverlayClickCloses } from '../lib/explorerPin'
import { isBrowserRuntime } from '../bridge/runtime'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { MaterialSymbol, type MaterialSymbolName } from './MaterialSymbol'
import {
  AGENT_NODE_DRAG_MIME,
  hasDragType,
  readAgentNodeDrag,
  writeExplorerFolderDrag
} from '../lib/explorerNodeDrag'

export interface ExplorerAgentFolderDrop {
  nodeId: string
  projectId: string
  path: string
}

export interface ExplorerFolderAction {
  projectId: string
  path: string
}
import { IconPin } from './icons'

export interface ExplorerPanelProps {
  onClose: () => void
  /** Open a file as an editor node. `sshFs` is true for SSH projects (the path is remote, read/
   *  written over the project's ControlMaster fs); false/omitted for local + relay projects. */
  onOpenFile: (path: string, sshFs?: boolean) => void
  /** Spawn a same-type sibling for the dragged/keyboard-selected agent in this folder. */
  onAgentNodeDrop?: (drop: ExplorerAgentFolderDrop) => void
  /** Keyboard/context-menu equivalent for dropping this folder onto empty canvas. */
  onOpenTerminalAtFolder?: (folder: ExplorerFolderAction) => void
  /** Agent prepared by the node header's keyboard-operable Explorer action. */
  keyboardAgentNodeId?: string | null
  /** File to reveal (expand ancestors + select + scroll). `path` is relative to the active project
   *  cwd; `nonce` increments per request so revealing the same file twice still re-fires. */
  reveal?: { path: string; nonce: number } | null
  /**
   * Docked: no scrim close, pointer-events pass through to the canvas. Default false so an
   * omitted prop stays the historical overlay. Toggle lives here; persistence lives in Canvas.
   */
  pinned?: boolean
  onTogglePin?: () => void
}

type ContextFn = (x: number, y: number, path: string, isDir: boolean, ignored?: boolean) => void
type OpenFn = (path: string) => void
type SelectFn = (path: string) => void
type DownloadFn = (path: string, isDir: boolean) => void
type AgentFolderDropFn = (drop: ExplorerAgentFolderDrop) => void

/** What a tree row's download button is showing right now. */
type RowDownloadState = 'running' | 'done' | 'error'

/** How long a finished row keeps its ✓ / ! before falling back to a plain ⤓. Long enough to be
 *  read after a click, short enough that a tree of them doesn't stay decorated. */
const ROW_FLASH_MS = 2200

/** Row-button tooltip per state. The failure text points at the strip, which carries the reason. */
const DL_TITLE: Record<RowDownloadState, string> = {
  running: 'Downloading…',
  done: 'Downloaded',
  error: 'Download failed — see the list below'
}

/** One entry in the drawer's download strip. `localPath` is set once a desktop (scp) download has
 *  landed, which is what makes it revealable. */
interface DownloadItem {
  id: number
  name: string
  dir: boolean
  status: 'running' | 'done' | 'error'
  detail?: string
  localPath?: string
}

// Surface a transient error message (matches the Canvas listener at Canvas.tsx:380).
const toast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message } }))
}

/** Best-effort file glyph from the extension — every name not called out here (the overwhelming
 *  majority) gets the plain document glyph, matching the tree's previous one-icon-for-every-file
 *  behavior. Only extensions the bundled 92-glyph subset actually has a distinct icon for are
 *  special-cased (see scripts/material-symbols-glyphs.json). */
function fileIconName(name: string): MaterialSymbolName {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return ext === 'css' ? 'css' : 'description'
}

function EntryIcon({ dir, open, name }: { dir: boolean; open: boolean; name: string }) {
  return (
    <MaterialSymbol
      className={`ex-icon${dir ? ' ex-icon--dir' : ''}`}
      name={dir ? (open ? 'folder_open' : 'folder') : fileIconName(name)}
      size={17}
      fill={dir}
    />
  )
}

function TreeEntry({
  entry,
  path,
  depth,
  fs,
  projectId,
  version,
  selected,
  onContext,
  onOpenFile,
  onSelect,
  onDownload,
  rowDl,
  filterTest,
  onAgentNodeDrop
}: {
  entry: DirEntry
  path: string
  depth: number
  fs: FsApi
  projectId: string
  version: number
  selected: string | null
  onContext: ContextFn
  onOpenFile: OpenFn
  onSelect: SelectFn
  /** Omitted where this tree can't be downloaded from (see lib/download.ts) — the row then has
   *  no download button at all, rather than one that fails on click. */
  onDownload?: DownloadFn
  /** Download state per path — the whole map, so a row deep in the tree sees its own entry
   *  without every level having to thread a single value down. */
  rowDl: Record<string, RowDownloadState>
  onAgentNodeDrop?: AgentFolderDropFn
  /**
   * The Explorer's own filter/regex field, or undefined when the filter is empty (no filtering
   * at all — the common case). Applied to FILE rows only: the tree is lazy-loaded, so a
   * directory whose children haven't been fetched yet can't be judged as "no matches inside" —
   * hiding it would make a real match unreachable. Directories therefore always stay visible
   * while a filter is active; only non-matching files are hidden.
   */
  filterTest?: (name: string) => boolean
}) {
  const vocab = useVocabularyMapper()
  const open = useExplorer((s) => (s.expandedByProject[projectId] ?? []).includes(path))
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const dl = rowDl[path]
  const [agentDragOver, setAgentDragOver] = useState(false)

  const toggleDir = useCallback(() => {
    useExplorer.getState().setExpanded(projectId, path, !open)
  }, [projectId, path, open])

  // A version bump (create/refresh) invalidates every cached subtree; open dirs re-list
  // through the children===null effect below. Initial mount is a no-op (ref seeded with the
  // current version), so a collapsed dir never fetches eagerly.
  const lastVersionRef = useRef(version)
  useEffect(() => {
    if (lastVersionRef.current === version) return
    lastVersionRef.current = version
    setChildren(null)
  }, [version])

  // Lazy-load children whenever this dir is (or becomes) open with nothing loaded yet —
  // covers click-to-expand, restored-from-storage, and reveal-forced expansion alike.
  useEffect(() => {
    if (!entry.dir || !open || children !== null) return
    let cancelled = false
    void fs.list(path).then((c) => {
      if (!cancelled) setChildren(c)
    })
    return () => {
      cancelled = true
    }
  }, [entry.dir, open, children, path, fs])

  // Reveal: scroll the selected (target) row into view once it has mounted.
  useEffect(() => {
    if (selected === path) rowRef.current?.scrollIntoView({ block: 'center' })
  }, [selected, path])

  // Files: first click selects, a second click opens the node. No separate dblclick
  // handler — the second click of a double-click already lands in the `selected === path`
  // branch here, so a dblclick handler would open the SAME file twice (two editor nodes).
  // Directories: a click toggles expansion (and selects for highlight).
  const onClick = useCallback(() => {
    if (entry.dir) {
      onSelect(path)
      toggleDir()
    } else if (selected === path) {
      onOpenFile(path)
    } else {
      onSelect(path)
    }
  }, [entry.dir, selected, path, onOpenFile, onSelect, toggleDir])

  // Files hide when they don't match an active filter; directories never do (see the doc comment
  // on `filterTest` above — the tree is lazy and a collapsed match would otherwise be unreachable).
  if (!entry.dir && filterTest && !filterTest(entry.name)) return null

  return (
    <>
      <div
        ref={rowRef}
        className={`ex-row md3-explorer__row${entry.ignored ? ' ignored' : ''}${selected === path ? ' selected' : ''}${agentDragOver ? ' ex-row--agent-drop' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-expanded={entry.dir ? open : undefined}
        tabIndex={0}
        draggable={entry.dir}
        onDragStart={(event) => {
          if (!entry.dir) return
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'copy'
          writeExplorerFolderDrag(event.dataTransfer, { projectId, path })
        }}
        onDragOver={(event) => {
          if (
            !entry.dir ||
            !onAgentNodeDrop ||
            !hasDragType(event.dataTransfer, AGENT_NODE_DRAG_MIME)
          ) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
          setAgentDragOver(true)
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget as Node | null
          if (!related || !event.currentTarget.contains(related)) setAgentDragOver(false)
        }}
        onDrop={(event) => {
          if (!entry.dir || !onAgentNodeDrop) return
          const payload = readAgentNodeDrag(event.dataTransfer)
          if (!payload) return
          event.preventDefault()
          event.stopPropagation()
          setAgentDragOver(false)
          onAgentNodeDrop({ nodeId: payload.nodeId, projectId, path })
        }}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
            return
          }
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            onSelect(path)
            onContext(rect.left + 16, rect.top + 16, path, entry.dir, entry.ignored)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onSelect(path)
          onContext(e.clientX, e.clientY, path, entry.dir, entry.ignored)
        }}
        title={entry.name}
      >
        <MaterialSymbol
          className={`ex-chevron${entry.dir ? '' : ' hidden'}${open ? ' open' : ''}`}
          name="chevron_right"
          size={16}
        />
        <EntryIcon dir={entry.dir} open={open} name={entry.name} />
        <span className="ex-name">{entry.name}</span>
        {onDownload && (
          <button
            className={`ex-dl${dl ? ` ${dl}` : ''}`}
            title={dl ? vocab(DL_TITLE[dl]) : entry.dir ? `${vocab('Download')} ${entry.name} ${vocab('folder')}` : `${vocab('Download')} ${entry.name}`}
            aria-label={vocab('Download')}
            aria-busy={dl === 'running'}
            // A second click while the first transfer is still running would start a duplicate
            // download and land it beside the first as `name (2)`.
            disabled={dl === 'running'}
            // The row's own onClick opens/expands — a download must not also do that.
            onClick={(e) => {
              e.stopPropagation()
              onDownload(path, entry.dir)
            }}
          >
            {dl === 'running' ? (
              <span className="ex-dl__spin" />
            ) : (
              <MaterialSymbol
                name={dl === 'done' ? 'check_circle' : dl === 'error' ? 'error' : 'download'}
                size={15}
                fill={dl === 'done' || dl === 'error'}
              />
            )}
          </button>
        )}
      </div>
      {entry.dir &&
        open &&
        children?.map((c) => (
          <TreeEntry
            key={c.name}
            entry={c}
            path={`${path}/${c.name}`}
            depth={depth + 1}
            fs={fs}
            projectId={projectId}
            version={version}
            selected={selected}
            onContext={onContext}
            onOpenFile={onOpenFile}
            onSelect={onSelect}
            onDownload={onDownload}
            rowDl={rowDl}
            filterTest={filterTest}
            onAgentNodeDrop={onAgentNodeDrop}
          />
        ))}
    </>
  )
}

/** Project file explorer — a lazy-loaded tree of the active project's folder.
 *
 * SSH projects browse the REMOTE filesystem (rooted at `project.ssh.remoteCwd`, listed via
 * `sshFs(projectId)` over the ControlMaster); local projects use the local fs rooted at `cwd`.
 *
 * NOTE (relay): a relay session's Explorer is still rooted at the local project's `cwd` — the host's
 * root cwd isn't known client-side. A relay tab reaches the host fs through its bridged session api
 * (the same seam TerminalNode/EditorNode use), not a separate per-connection fs client. */
export function ExplorerPanel({
  onClose,
  onOpenFile,
  onAgentNodeDrop,
  onOpenTerminalAtFolder,
  keyboardAgentNodeId,
  reveal,
  pinned = false,
  onTogglePin
}: ExplorerPanelProps) {
  const vocab = useVocabularyMapper()
  // Filters visible FILE rows by name (plain text, or regex via the `.*` trigger). See the
  // `filterTest` doc comment on TreeEntry for why directories are never hidden by it.
  const filter = useRegexSearchField()
  const filterInputRef = useRef<HTMLInputElement>(null)
  const filterTest = filter.active ? filter.test : undefined
  const project = useProjects((s) => s.projects.find((p) => p.id === s.activeProjectId))
  // SSH projects browse the REMOTE filesystem: root at the project's `remoteCwd` and list over the
  // ControlMaster via `sshFs`. Local (and relay) projects keep the local fs rooted at `cwd`.
  const ssh = project?.ssh
  const cwd = ssh ? ssh.remoteCwd : project?.cwd
  // This panel's core api (a stable context read — the local session's api IS window.nodeTerminal).
  // `api` IS a dep here: the memo is a pure pick (no resource), and the list effect below should
  // re-fetch off a new core's fs when 4c makes a session's api replaceable.
  const { api } = useSession()
  const fs = useMemo<FsApi>(
    () => (ssh && project ? sshFs(project.id) : api.fs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, ssh, api]
  )
  // Files opened from an SSH project's Explorer are genuinely remote — stamp `sshFs` so the editor
  // node routes its read/write over the project's ControlMaster fs (local/relay projects pass false).
  const handleOpenFile = useCallback<OpenFn>((path) => onOpenFile(path, !!ssh), [onOpenFile, ssh])
  const [roots, setRoots] = useState<DirEntry[] | null>(null)
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    path: string
    dir: boolean
    ignored?: boolean
  } | null>(null)
  /** Whether the ignored menu entry matches an EXACT .gitignore line (null = still resolving). */
  const [menuExactIgnore, setMenuExactIgnore] = useState<boolean | null>(null)

  // Downloading is only meaningful when the tree is NOT this machine's own filesystem, and the
  // transport differs per shell — the whole decision is the pure `downloadRoute` (lib/download.ts).
  const session = useSession()
  const dlCtx = useMemo(
    () => ({ browser: isBrowserRuntime(), ssh: !!ssh, source: session.source }),
    [ssh, session.source]
  )
  const route = downloadRoute(dlCtx)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const dlSeq = useRef(0)
  // Per-ROW download state, keyed by path. The strip at the bottom of the drawer reports the same
  // transfers, but the user's eye is on the button they just pressed — and on the HTTP route the
  // whole thing can be over before a glance travels down there. So the row answers for itself.
  const [rowDl, setRowDl] = useState<Record<string, RowDownloadState>>({})
  const setRowState = useCallback((path: string, state: RowDownloadState): void => {
    setRowDl((m) => ({ ...m, [path]: state }))
  }, [])

  const patchDownload = useCallback((id: number, patch: Partial<DownloadItem>): void => {
    setDownloads((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  /**
   * Download one entry. `destDir` (desktop only) overrides the OS Downloads folder — it comes from
   * the native folder picker, and main still builds the final path itself.
   *
   * Both routes report through the same strip, but they finish differently on purpose: an scp pull
   * is ours from start to finish, so it ends as a revealable local file; an HTTP download is handed
   * to the BROWSER at the first byte, and its own download shelf owns the progress from there — so
   * the strip's job is just to cover the mint round-trip and then get out of the way.
   */
  const download = useCallback(
    async (path: string, isDir: boolean, destDir?: string): Promise<void> => {
      if (route === 'none') return
      const id = ++dlSeq.current
      const name = path.split('/').filter(Boolean).pop() || path
      setDownloads((list) => [...list, { id, name, dir: isDir, status: 'running' }])
      setRowState(path, 'running')
      const finish = (state: RowDownloadState): void => {
        setRowState(path, state)
        // Clear the row back to a plain ⤓ after the flash. Keyed by PATH, so a second download of
        // the same entry started meanwhile owns the row and its timer must not wipe that state.
        setTimeout(
          () =>
            setRowDl((m) => {
              if (m[path] !== state) return m
              const next = { ...m }
              delete next[path]
              return next
            }),
          ROW_FLASH_MS
        )
      }
      try {
        if (route === 'scp') {
          const res = await window.nodeTerminal.sshProject.downloadFile(project!.id, path, destDir)
          if (res.ok) patchDownload(id, { status: 'done', localPath: res.localPath })
          else patchDownload(id, { status: 'error', detail: res.error })
          finish(res.ok ? 'done' : 'error')
          return
        }
        const ticket = await session.api.files.downloadTicket(path)
        if (!ticket) {
          patchDownload(id, { status: 'error', detail: 'Downloading is not available here.' })
          finish('error')
          return
        }
        triggerBrowserDownload(ticket.url, ticket.name)
        patchDownload(id, { status: 'done', detail: 'Sent to your browser downloads.' })
        finish('done')
        // The browser has it now; the strip row would just be noise from here on.
        setTimeout(() => setDownloads((list) => list.filter((d) => d.id !== id)), 4000)
      } catch {
        patchDownload(id, { status: 'error', detail: 'The download could not be started.' })
        finish('error')
      }
    },
    [route, project, session.api, patchDownload, setRowState]
  )

  const onDownload = useMemo<DownloadFn | undefined>(
    () => (route === 'none' ? undefined : (p, isDir) => void download(p, isDir)),
    [route, download]
  )

  /** "Download to…" — desktop only (the browser has no native folder picker, and its own download
   *  location is a browser setting, not ours to ask about). */
  const downloadTo = useCallback(
    async (path: string, isDir: boolean): Promise<void> => {
      const dir = await window.nodeTerminal.dialog.selectFolder()
      if (dir) await download(path, isDir, dir)
    },
    [download]
  )

  useEffect(() => {
    if (cwd) fs.list(cwd).then(setRoots)
    else setRoots(null)
  }, [cwd, version, fs])

  // Reveal a file: force-open every ancestor directory under cwd, select the file, and
  // let the matching row scroll itself into view. Only paths inside cwd are revealed.
  // Keyed on the nonce so revealing the same file twice still re-triggers.
  useEffect(() => {
    const revealPath = reveal?.path
    if (!revealPath || !cwd) return
    // The path arithmetic lives in `revealTargets` so it can be unit-tested — this version of it
    // compared `revealPath.startsWith(base + '/')`, which is false for every backslash path, so
    // reveal silently did nothing at all on Windows. See explorerCreate.ts for the full account.
    const targets = revealTargets(cwd, revealPath)
    if (!targets) return // outside cwd, or a traversal
    useExplorer.getState().expandMany(project!.id, targets.dirs)
    setSelected(targets.selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce, cwd])

  const onContext: ContextFn = (x, y, path, isDir, ignored) => {
    setMenu({ x, y, path, dir: isDir, ignored })
    // The "Remove from .gitignore" offer needs to know whether the entry is ignored by an EXACT
    // line (removable) or by a broader pattern like `*.log` (nothing safe to remove — rewriting a
    // user's pattern is not a menu click's call, so no item is shown). Resolved async while the
    // menu opens; until then neither gitignore item renders for an ignored entry.
    setMenuExactIgnore(null)
    if (ignored && cwd && path !== cwd) {
      const rel = path.slice(cwd.length + 1)
      void fs
        .read(`${cwd}/.gitignore`)
        .then((content) => setMenuExactIgnore(gitignoreHasExact(content, rel)))
        .catch(() => setMenuExactIgnore(false))
    }
  }

  /** Add (or exact-line-remove) the entry to the project root's .gitignore, then re-list so the
   *  row's dimming reflects the new truth. Read-modify-write via the pure gitignore helpers. */
  const toggleGitignore = useCallback(
    async (path: string, remove: boolean): Promise<void> => {
      if (!cwd) return
      const rel = path.slice(cwd.length + 1)
      const gi = `${cwd}/.gitignore`
      const cur = (await fs.exists(gi)) ? await fs.read(gi) : ''
      await fs.write(gi, remove ? gitignoreRemove(cur, rel) : gitignoreAdd(cur, rel))
      setVersion((v) => v + 1)
    },
    [cwd, fs]
  )

  // Create a file or folder under the clicked entry (a dir targets itself, a file its
  // parent). Multi-segment names create intermediate dirs. Never overwrites: an existing
  // path is surfaced as a toast and the prompt is abandoned.
  const createEntry = useCallback(
    async (targetPath: string, targetIsDir: boolean, kind: 'file' | 'folder') => {
      const baseDir = createTargetDir(targetPath, targetIsDir)
      const name = await promptDialog({
        message: kind === 'file' ? 'New file name:' : 'New folder name:',
        placeholder: kind === 'file' ? 'notes.md (subdirs ok: docs/notes.md)' : 'folder name',
        confirmLabel: 'Create'
      })
      if (name === null) return
      const dest = newEntryPath(baseDir, name)
      if (!dest) {
        toast(`Invalid name: “${name.trim()}”`)
        return
      }
      if (await fs.exists(dest)) {
        toast(`Already exists: ${dest}`)
        return
      }
      const ok =
        kind === 'folder'
          ? await fs.mkdir(dest)
          : (name.includes('/') ? await fs.mkdir(parentDir(dest)) : true) && (await fs.write(dest, ''))
      if (!ok) {
        toast(`Could not create ${dest}`)
        return
      }
      // Keep the target (and any new intermediate dirs) expanded, then re-list the tree.
      if (project) {
        const dirs = [baseDir, ...ancestorDirs(baseDir, name)].filter((d) => d !== cwd)
        useExplorer.getState().expandMany(project.id, dirs)
      }
      setVersion((v) => v + 1)
      if (kind === 'file') handleOpenFile(dest)
    },
    [fs, cwd, project, handleOpenFile]
  )

  return createPortal(
    <div
      className={pinned ? 'drawer-overlay explorer-overlay drawer-overlay--pinned' : 'drawer-overlay explorer-overlay'}
      // Pinned: no handler, so a CSS miss still cannot dismiss the docked tree. `explorer-overlay`
      // is already non-blocking (pointer-events pass through so an agent node/folder can be
      // dragged between the canvas and the tree) — the click-outside-closes case below only
      // reaches this handler through the aside's own stopPropagation bubble, never a raw canvas
      // click.
      onClick={explorerOverlayClickCloses(pinned) ? onClose : undefined}
    >
      <aside
        className={pinned ? 'drawer md3-explorer drawer--pinned' : 'drawer md3-explorer'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__head">
          <h2>{project?.name || vocab('Explorer')}</h2>
          <div className="ex-head-actions">
            <IconButton size="dense" title="Refresh" aria-label="Refresh" onClick={() => setVersion((v) => v + 1)}>
              ↻
            </IconButton>
            {onTogglePin && (
              <IconButton
                size="dense"
                active={pinned}
                className={pinned ? 'is-on' : ''}
                title={pinned ? 'Unpin' : 'Pin'}
                aria-label={pinned ? 'Unpin' : 'Pin'}
                aria-pressed={pinned}
                onClick={onTogglePin}
              >
                <IconPin />
              </IconButton>
            )}
            <IconButton size="dense" className="drawer__close" title="Close" aria-label="Close" onClick={onClose}>
              ×
            </IconButton>
          </div>
        </div>

        {!cwd && (
          <div className="drawer__body">
            <p className="set-note">{vocab('Set a folder for this project first (tab ⌄ → “Set folder…”).')}</p>
          </div>
        )}

        {cwd && (
          <>
            <div className="ex-filter-row md3-explorer__filter">
              <SearchField
                ref={filterInputRef}
                dense
                className="ex-filter-input"
                value={filter.value}
                placeholder={filter.mode === 'regex' ? 'Filter files (regex)…' : 'Filter files…'}
                aria-label="Filter files"
                onChange={(e) => filter.setValue(e.target.value)}
                trailingSlot={
                  <AnchoredRegexBuilder search={filter} fieldRef={filterInputRef} label="Regex — Explorer filter" />
                }
              />
            </div>
            {filter.error && <p className="ex-filter-error">{filter.error}</p>}
            {filter.active && (
              <p className="ex-filter-note">
                {vocab('Showing files matching your filter. Expand folders to search inside them.')}
              </p>
            )}
            <div
              className="drawer__body ex-body"
              role="tree"
              aria-label={`${project?.name || vocab('Project')} ${vocab('folders and files')}`}
              onContextMenu={(e) => {
                if (e.target !== e.currentTarget || !cwd) return
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path: cwd, dir: true })
              }}
            >
              {roots?.length === 0 && <p className="set-note">{vocab('Empty folder.')}</p>}
              {roots?.map((e) => (
                <TreeEntry
                  key={e.name}
                  entry={e}
                  path={`${cwd}/${e.name}`}
                  depth={0}
                  fs={fs}
                  projectId={project!.id}
                  version={version}
                  selected={selected}
                  onContext={onContext}
                  onOpenFile={handleOpenFile}
                  onSelect={setSelected}
                  onDownload={onDownload}
                  rowDl={rowDl}
                  filterTest={filterTest}
                  onAgentNodeDrop={onAgentNodeDrop}
                />
              ))}
            </div>
          </>
        )}

        {downloads.length > 0 && (
          <div className="ex-dls md3-explorer__downloads">
            {downloads.map((d) => (
              <div key={d.id} className={`ex-dls__row ${d.status}`}>
                {d.status === 'running' ? (
                  <span className="ex-dls__spin" />
                ) : (
                  <MaterialSymbol
                    className="ex-dls__icon"
                    name={d.status === 'error' ? 'error' : 'downloading'}
                    size={17}
                  />
                )}
                <span className="ex-dls__name" title={d.detail || d.localPath || d.name}>
                  {d.name}
                  {d.dir && d.status === 'running' ? ` (${vocab('folder')})` : ''}
                </span>
                {d.status === 'done' && d.localPath && (
                  <Button
                    variant="text"
                    size="small"
                    className="ex-dls__act"
                    onClick={() => window.nodeTerminal.shell.reveal(d.localPath!)}
                  >
                    Reveal
                  </Button>
                )}
                <IconButton
                  size="dense"
                  className="ex-dls__act ex-dls__dismiss"
                  aria-label="Dismiss"
                  onClick={() => setDownloads((list) => list.filter((x) => x.id !== d.id))}
                >
                  <MaterialSymbol name="close" size={15} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </aside>

      {menu &&
        createPortal(
          <>
            {/* stopPropagation everywhere (same as ContextMenu): this portal's React parent is the
                drawer OVERLAY (not the aside), so a bubbled click on the unpinned modal lands on
                the overlay's onClick={onClose} and closes the whole Explorer along with the menu.
                A pinned overlay has no close handler, but the stop is still what keeps the
                click off the canvas. */}
            <div
              className="tab-backdrop"
              style={{ zIndex: 78 }}
              onClick={(e) => {
                e.stopPropagation()
                setMenu(null)
              }}
            />
            <div
              className="ctx-menu"
              style={{ top: menu.y, left: menu.x, zIndex: 80 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="ctx-item"
                onClick={() => {
                  const m = menu
                  setMenu(null)
                  void createEntry(m.path, m.dir, 'file')
                }}
              >
                {vocab('New File…')}
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  const m = menu
                  setMenu(null)
                  void createEntry(m.path, m.dir, 'folder')
                }}
              >
                {vocab('New Folder…')}
              </button>
              {menu.dir && onOpenTerminalAtFolder && (
                <>
                  <div className="ctx-sep" />
                  <button
                    className="ctx-item"
                    onClick={() => {
                      const folder = { projectId: project!.id, path: menu.path }
                      setMenu(null)
                      onOpenTerminalAtFolder(folder)
                    }}
                  >
                    {vocab('Open terminal here')}
                  </button>
                  {keyboardAgentNodeId && onAgentNodeDrop && (
                    <button
                      className="ctx-item"
                      onClick={() => {
                        const path = menu.path
                        setMenu(null)
                        onAgentNodeDrop({
                          nodeId: keyboardAgentNodeId,
                          projectId: project!.id,
                          path
                        })
                      }}
                    >
                      {vocab('Open selected agent here')}
                    </button>
                  )}
                </>
              )}
              {route !== 'none' && (
                <>
                  <div className="ctx-sep" />
                  <button
                    className="ctx-item"
                    onClick={() => {
                      const m = menu
                      setMenu(null)
                      void download(m.path, m.dir)
                    }}
                  >
                    {/* scp -r brings a folder down AS a folder; the HTTP route has to archive it
                        on the fly, and the user should know what will land in Downloads. */}
                    {vocab(menu.dir ? (route === 'http' ? 'Download Folder (.tar.gz)' : 'Download Folder') : 'Download')}
                  </button>
                  {route === 'scp' && (
                    <button
                      className="ctx-item"
                      onClick={() => {
                        const m = menu
                        setMenu(null)
                        void downloadTo(m.path, m.dir)
                      }}
                    >
                      {vocab('Download to…')}
                    </button>
                  )}
                </>
              )}
              <div className="ctx-sep" />
              <button
                className="ctx-item"
                onClick={() => {
                  window.nodeTerminal.clipboard.writeText(menu.path)
                  setMenu(null)
                }}
              >
                {vocab('Copy Path')}
              </button>
              <button
                className="ctx-item"
                onClick={() => {
                  window.nodeTerminal.clipboard.writeText(cwd ? menu.path.slice(cwd.length + 1) : menu.path)
                  setMenu(null)
                }}
              >
                {vocab('Copy Relative Path')}
              </button>
              {/* Root itself (the empty-area menu) is not an ignorable entry. An entry ignored by
                  a broader PATTERN gets neither item: it cannot be "added" (already ignored) and
                  there is no exact line to remove — see onContext. */}
              {menu.path !== cwd && (!menu.ignored || menuExactIgnore) && (
                <>
                  <div className="ctx-sep" />
                  <button
                    className="ctx-item"
                    onClick={() => {
                      const m = menu
                      setMenu(null)
                      void toggleGitignore(m.path, !!m.ignored)
                    }}
                  >
                    {vocab(menu.ignored ? 'Remove from .gitignore' : 'Add to .gitignore')}
                  </button>
                </>
              )}
              {/* Only where it can work: revealing an SSH project's REMOTE path in the local file
                  manager did nothing, and in a browser tab the whole member is an inert stub. */}
              {canRevealLocally(dlCtx) && (
                <>
                  <div className="ctx-sep" />
                  <button
                    className="ctx-item"
                    onClick={() => {
                      window.nodeTerminal.shell.reveal(menu.path)
                      setMenu(null)
                    }}
                  >
                    {vocab('Reveal in Finder')}
                  </button>
                </>
              )}
            </div>
          </>,
          document.body
        )}
    </div>,
    document.body
  )
}
