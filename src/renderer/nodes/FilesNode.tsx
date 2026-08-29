import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { DirEntry } from '@shared/types'
import { COLLAPSED_HEIGHT, NODE_COLORS, type CanvasNode } from '../state/workspace'
import { breadcrumbs, childPath, fileOpenTarget, filterEntries, folderTitle, parentDir } from '../lib/filesNode'
import { ancestorDirs, createTargetDir, newEntryPath } from '../lib/explorerCreate'
import { sshFs } from '../terminal/ssh-fs'
import { useSession } from '../session/session'
import { useProjects } from '../state/projects'
import { promptDialog } from '../components/promptDialog'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { isBrowserRuntime } from '../bridge/runtime'
import { useI18n } from '../lib/i18n'

const FILE_DRAG_MIME = 'application/x-nodeterm-file'

function toast(message: string): void {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message } }))
}

function EntryGlyph({ dir }: { dir: boolean }): React.JSX.Element {
  return dir ? (
    <svg className="files-node__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ) : (
    <svg className="files-node__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" />
    </svg>
  )
}

export function FilesNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData, deleteElements, setNodes } = useReactFlow()
  const { api, source } = useSession()
  const { ts } = useI18n()
  const activeProjectId = useProjects((state) => state.activeProjectId)
  const fs = data.sshFs && activeProjectId ? sshFs(activeProjectId) : api.fs
  const remote = !!data.sshFs || source === 'relay'
  const canReveal = !remote && !isBrowserRuntime()
  const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : '/'
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleBefore, setTitleBefore] = useState('')
  const [showColors, setShowColors] = useState(false)
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const lastSelected = useRef<string | null>(null)
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const collapsed = !!data.collapsed

  useEffect(() => {
    let live = true
    setEntries(null)
    setError('')
    void fs.list(cwd).then((result) => {
      if (live) setEntries(result)
    }).catch(() => {
      if (!live) return
      setEntries([])
      setError(ts('files.node.error', 'Could not read this folder.'))
    })
    return () => { live = false }
    // fs is a short-lived wrapper for SSH projects. Its meaning is covered by these stable keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, data.sshFs, activeProjectId, source, version, ts])

  const shown = useMemo(
    () => (search.mode === 'text' ? filterEntries(entries ?? [], search.query) : (entries ?? []).filter((e) => search.test(e.name))),
    [entries, search.mode, search.query, search.test]
  )
  const crumbs = useMemo(() => breadcrumbs(cwd), [cwd])

  const navigate = useCallback((path: string) => {
    const patch: Record<string, unknown> = { cwd: path }
    if (data.titleAuto !== false) patch.title = folderTitle(path)
    updateNodeData(id, patch)
    search.reset()
    setSelectedNames([])
    lastSelected.current = null
  }, [data.titleAuto, id, search, updateNodeData])

  const openEntry = useCallback((entry: DirEntry) => {
    const path = childPath(cwd, entry.name)
    if (entry.dir) return navigate(path)
    if (fileOpenTarget(path, { remote }) === 'os') return api.shell.openPath(path)
    window.dispatchEvent(new CustomEvent('nodeterm:open-file', { detail: { path, ssh: !!data.sshFs } }))
  }, [api.shell, cwd, data.sshFs, navigate, remote])

  const createEntry = useCallback(async (dir: string, kind: 'file' | 'folder') => {
    const name = await promptDialog({ message: kind === 'file' ? 'New file name:' : 'New folder name:', confirmLabel: 'Create' })
    if (name === null) return
    const target = newEntryPath(dir, name)
    if (!target) return toast('That name cannot be used.')
    if (await fs.exists(target)) return toast(`${name.trim()} already exists.`)
    const parents = ancestorDirs(dir, name)
    if (parents.length && !(await fs.mkdir(parents[parents.length - 1]))) return toast('Could not create that folder.')
    const ok = kind === 'folder' ? await fs.mkdir(target) : await fs.write(target, '')
    if (!ok) return toast(kind === 'folder' ? 'Could not create that folder.' : 'Could not create that file.')
    setVersion((value) => value + 1)
    if (kind === 'file') window.dispatchEvent(new CustomEvent('nodeterm:open-file', { detail: { path: target, ssh: !!data.sshFs } }))
  }, [data.sshFs, fs])

  const openMenu = useCallback((event: MouseEvent, entry: DirEntry | null) => {
    event.preventDefault(); event.stopPropagation()
    const path = entry ? childPath(cwd, entry.name) : cwd
    const dir = entry ? createTargetDir(path, entry.dir) : cwd
    const items: MenuItem[] = []
    if (entry) items.push({ label: entry.dir ? 'Open folder' : 'Open', onClick: () => openEntry(entry) })
    if (!entry || entry.dir) items.push({ label: 'New terminal here', onClick: () => window.dispatchEvent(new CustomEvent('nodeterm:open-terminal', { detail: { cwd: path } })) })
    items.push({ type: 'separator' })
    items.push({ label: 'New file…', onClick: () => void createEntry(dir, 'file') })
    items.push({ label: 'New folder…', onClick: () => void createEntry(dir, 'folder') })
    items.push({ type: 'separator' })
    items.push({ label: 'Copy path', onClick: () => void api.clipboard.writeText(path) })
    if (canReveal) items.push({ label: 'Reveal in file manager', onClick: () => api.shell.reveal(path) })
    setMenu({ x: event.clientX, y: event.clientY, items })
  }, [api.clipboard, api.shell, canReveal, createEntry, cwd, openEntry])

  const toggleCollapse = useCallback(() => setNodes((nodes) => nodes.map((node) => {
    if (node.id !== id) return node
    const next = !node.data.collapsed
    const expandedHeight = node.data.expandedHeight ?? node.measured?.height ?? node.height ?? 460
    const height = next ? COLLAPSED_HEIGHT : expandedHeight
    return { ...node, height, style: { ...node.style, height }, data: { ...node.data, collapsed: next, expandedHeight } }
  })), [id, setNodes])

  const selectEntry = useCallback((event: MouseEvent, name: string) => {
    const names = shown.map((entry) => entry.name)
    const index = names.indexOf(name)
    let next = [name]
    if (event.shiftKey && lastSelected.current) {
      const start = names.indexOf(lastSelected.current)
      if (start >= 0) next = names.slice(Math.min(start, index), Math.max(start, index) + 1)
    } else if (event.ctrlKey || event.metaKey) {
      next = selectedNames.includes(name) ? selectedNames.filter((value) => value !== name) : [...selectedNames, name]
    }
    setSelectedNames(next); lastSelected.current = name
  }, [selectedNames, shown])

  const copySelected = useCallback(() => {
    const paths = selectedNames.map((name) => childPath(cwd, name))
    if (paths.length) void api.clipboard.writeText(paths.join('\n'))
  }, [api.clipboard, cwd, selectedNames])

  const pickFolder = useCallback(async () => {
    if (remote || isBrowserRuntime()) return
    const picked = await api.dialog.selectFolder()
    if (picked) navigate(picked)
  }, [api.dialog, navigate, remote])

  const pickFile = useCallback(async () => {
    if (remote || isBrowserRuntime()) return
    const picked = await api.dialog.selectFile()
    if (picked) window.dispatchEvent(new CustomEvent('nodeterm:open-file', { detail: { path: picked } }))
  }, [api.dialog, remote])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>, target?: DirEntry) => {
    event.preventDefault()
    if (!target?.dir) return
    const raw = event.dataTransfer.getData(FILE_DRAG_MIME)
    if (!raw) return
    try {
      const value = JSON.parse(raw) as { path?: unknown; dir?: unknown }
      if (typeof value.path !== 'string' || !value.path.startsWith(cwd.replace(/[\\/]+$/, '') + '/')) return
      navigate(childPath(cwd, target.name))
    } catch { /* malformed external data is ignored */ }
  }, [cwd, navigate])

  return <div className={`files-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''}`}>
    <NodeResizer minWidth={240} minHeight={160} isVisible={selected && !collapsed} color={data.color} />
    <div className="files-node__header" style={{ background: `${data.color}22` }}>
      <button className="term-node__collapse" title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand files' : 'Collapse files'} onClick={toggleCollapse}>{collapsed ? '▸' : '▾'}</button>
      <button className="term-node__color" style={{ background: data.color }} title="Color" aria-label="Choose files node color" onClick={() => setShowColors((value) => !value)} />
      {showColors && <div className="color-popover">{NODE_COLORS.map((color) => <button key={color} style={{ background: color }} aria-label={`Use ${color}`} onClick={() => { updateNodeData(id, { color }); setShowColors(false) }} />)}</div>}
      {editingTitle ? <input className="term-node__title nodrag" value={data.title} autoFocus onChange={(event) => updateNodeData(id, { title: event.target.value, titleAuto: false })} onBlur={() => setEditingTitle(false)} onKeyDown={(event) => { if (event.key === 'Enter') setEditingTitle(false); else if (event.key === 'Escape') { updateNodeData(id, { title: titleBefore }); setEditingTitle(false) } }} /> : <button className="files-node__title nodrag" title="Rename files node" onClick={() => { setTitleBefore(data.title); setEditingTitle(true) }}>{data.title || folderTitle(cwd)}</button>}
      {data.sshFs && <span className="files-node__chip">SSH</span>}
      <span className="term-node__spacer" />
      <button className="files-node__btn nodrag" title="Up one folder" aria-label="Up one folder" disabled={cwd === '/'} onClick={() => navigate(parentDir(cwd))}>↑</button>
      <button className="files-node__btn nodrag" title="Refresh" aria-label="Refresh folder" onClick={() => setVersion((value) => value + 1)}>⟳</button>
      {!remote && !isBrowserRuntime() && <><button className="files-node__btn nodrag" title="Choose folder" aria-label="Choose folder" onClick={() => void pickFolder()}>⌂</button><button className="files-node__btn nodrag" title="Choose file" aria-label="Choose file" onClick={() => void pickFile()}>＋</button></>}
      <button className="term-node__close" title="Close" aria-label="Close files node" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
    </div>
    {!collapsed && <>
      <div className="files-node__crumbs nodrag">{crumbs.map((crumb, index) => <span key={`${crumb.path}-${index}`} className="files-node__crumb-wrap">{index > 0 && crumbs[index - 1].name !== '/' && <span className="files-node__sep">/</span>}<button className="files-node__crumb" title={crumb.path} onClick={() => navigate(crumb.path)}>{crumb.name}</button></span>)}</div>
      <div className="files-node__search-row nodrag"><input ref={searchInputRef} className="files-node__filter" value={search.value} placeholder={ts('files.node.filter', 'Filter files')} aria-label={ts('files.node.filter', 'Filter files')} onChange={(event) => search.setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') search.reset() }} /><AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex builder for files filter" zIndex={93} /></div>
      {search.error && <div className="files-node__search-error" role="alert">{search.error}</div>}
      {selectedNames.length > 0 && <div className="files-node__bulk nodrag" role="toolbar" aria-label="Selected files actions"><span>{selectedNames.length} selected</span><button onClick={copySelected}>Copy paths</button><button onClick={() => setSelectedNames([])}>Clear</button></div>}
      <div className="files-node__list nodrag nowheel" onContextMenu={(event) => openMenu(event, null)} onDragOver={(event) => { if (event.dataTransfer.types.includes(FILE_DRAG_MIME)) event.preventDefault() }}>
        {entries === null ? <div className="files-node__empty">{ts('files.node.loading', 'Loading folder…')}</div> : error ? <div className="files-node__empty files-node__empty--error" role="alert">{error}</div> : entries.length === 0 ? <div className="files-node__empty">{ts('files.node.empty', 'This folder is empty.')}</div> : shown.length === 0 ? <div className="files-node__empty">{ts('files.node.noMatch', 'Nothing matches this filter.')}</div> : shown.map((entry) => <div key={entry.name} className={`files-node__row${entry.ignored ? ' is-ignored' : ''}${selectedNames.includes(entry.name) ? ' is-selected' : ''}`} title={childPath(cwd, entry.name)} draggable onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey) selectEntry(event, entry.name); else openEntry(entry) }} onContextMenu={(event) => openMenu(event, entry)} onDragStart={(event) => event.dataTransfer.setData(FILE_DRAG_MIME, JSON.stringify({ path: childPath(cwd, entry.name), dir: entry.dir }))} onDragOver={(event) => { if (entry.dir) event.preventDefault() }} onDrop={(event) => onDrop(event, entry)}><EntryGlyph dir={entry.dir} /><span className="files-node__name">{entry.name}</span></div>)}
      </div>
    </>}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
  </div>
}
