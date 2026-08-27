import { useCallback, useEffect, useMemo, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { TorrentSeedPolicy, TorrentTaskState } from '@shared/torrent'
import { normalizeSeedPolicy } from '@shared/torrent'
import type { CanvasNode } from '../state/workspace'
import { useActiveSessionApi } from '../session/session'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { nodeHeaderFillStyle } from '../lib/nodeColor'

function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`
}

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Unknown'
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

function taskLabel(task: TorrentTaskState): string {
  return task.name || (task.sourceKind === 'magnet' ? 'Magnet download' : 'Torrent file')
}

export default function TorrentNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const [tasks, setTasks] = useState<TorrentTaskState[]>([])
  const [destination, setDestination] = useState('')
  const [runtime, setRuntime] = useState<{ available: boolean; origin: string; detail: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [regexOpen, setRegexOpen] = useState(false)
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('i')
  const [regexError, setRegexError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextTasks, nextRuntime] = await Promise.all([api.torrent.list(id), api.torrent.runtime()])
      setTasks(nextTasks)
      setRuntime(nextRuntime)
      if (!destination) setDestination(nextTasks.find((task) => task.destination)?.destination ?? '')
    } catch (error) {
      setRuntime({ available: false, origin: 'unavailable', detail: error instanceof Error ? error.message : String(error) })
    }
  }, [api, id, destination])

  useEffect(() => {
    void load()
    return api.torrent.onTask((task) => {
      if (task.nodeId !== id) return
      setTasks((current) => {
        const exists = current.some((item) => item.id === task.id)
        return exists ? current.map((item) => (item.id === task.id ? task : item)) : [...current, task]
      })
    })
  }, [api, id, load])

  const filteredTasks = useMemo(() => {
    const text = query.trim()
    if (!text) return tasks
    if (regexOpen && pattern) {
      try {
        const re = new RegExp(pattern, flags)
        setRegexError(null)
        return tasks.filter((task) => re.test(`${taskLabel(task)} ${task.status} ${task.sourceKind}`))
      } catch (error) {
        setRegexError(error instanceof Error ? error.message : 'Invalid regular expression')
        return []
      }
    }
    const lowered = text.toLocaleLowerCase()
    return tasks.filter((task) => `${taskLabel(task)} ${task.status}`.toLocaleLowerCase().includes(lowered))
  }, [flags, pattern, query, regexOpen, tasks])

  const withBusy = useCallback(async (operation: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message: error instanceof Error ? error.message : String(error) } }))
    } finally {
      setBusy(false)
      void load()
    }
  }, [busy, load])

  const pickDestination = useCallback(async (): Promise<void> => {
    const chosen = await api.dialog.selectFolder()
    if (chosen) setDestination(chosen)
  }, [api])

  const addMagnet = useCallback(async (): Promise<void> => {
    const magnet = String(data.torrentMagnet ?? '').trim()
    if (!magnet) return
    await withBusy(async () => {
      const task = await api.torrent.add({ nodeId: id, sourceKind: 'magnet', sourceRef: magnet, destination })
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
    })
  }, [api, data.torrentMagnet, destination, id, withBusy])

  const addTorrentFile = useCallback(async (): Promise<void> => {
    const source = await api.dialog.selectFile()
    if (!source) return
    await withBusy(async () => {
      const task = await api.torrent.add({ nodeId: id, sourceKind: 'torrent-file', sourceRef: source, destination })
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
    })
  }, [api, destination, id, withBusy])

  const setTaskDestination = useCallback(async (task: TorrentTaskState): Promise<void> => {
    if (!destination) return
    await withBusy(() => api.torrent.setDestination(task.id, destination))
  }, [api, destination, withBusy])

  const updatePolicy = useCallback((task: TorrentTaskState, value: string): Promise<void> => {
    const policy: TorrentSeedPolicy = value === 'ratio'
      ? { kind: 'ratio', ratio: 1 }
      : value === 'minutes'
        ? { kind: 'minutes', minutes: 30 }
        : normalizeSeedPolicy({ kind: 'never' })
    return withBusy(() => api.torrent.setSeedPolicy(task.id, policy))
  }, [api, withBusy])

  const fill = nodeHeaderFillStyle(data.color)
  return (
    <div className={`term-node torrent-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={440} minHeight={360} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <EditableNodeTitle value={data.title} onChange={(title) => updateNodeData(id, { title })} emptyLabel="Torrent downloader" title="Click to rename" ariaLabel="Torrent downloader node name" rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button className="term-node__close" title="Refresh torrent tasks" onClick={() => void load()}>⟳</button>
      </div>
      <div className="torrent-node__body nodrag nowheel">
        <div className="torrent-node__runtime" role="status">
          {runtime ? runtime.available ? `WebTorrent ${runtime.origin}` : `WebTorrent unavailable: ${runtime.detail ?? 'runtime could not be loaded'}` : 'Checking WebTorrent runtime…'}
        </div>
        <label className="torrent-node__field" htmlFor={`${id}-magnet`}>
          <span>Magnet URI</span>
          <input id={`${id}-magnet`} value={data.torrentMagnet ?? ''} spellCheck={false} placeholder="magnet:?xt=urn:btih:…" onChange={(event) => updateNodeData(id, { torrentMagnet: event.target.value })} />
        </label>
        <div className="torrent-node__actions">
          <button type="button" disabled={!runtime?.available || !data.torrentMagnet?.trim() || !destination || busy} onClick={() => void addMagnet()}>Add magnet</button>
          <button type="button" disabled={!runtime?.available || !destination || busy} onClick={() => void addTorrentFile()}>Choose .torrent file</button>
        </div>
        <div className="torrent-node__destination">
          <label htmlFor={`${id}-destination`}>Download folder</label>
          <input id={`${id}-destination`} value={destination} readOnly placeholder="Choose a destination folder" />
          <button type="button" onClick={() => void pickDestination()}>Browse…</button>
        </div>
        <div className="torrent-node__search">
          <label htmlFor={`${id}-search`}>Tasks</label>
          <input id={`${id}-search`} value={query} placeholder="Search tasks" onChange={(event) => setQuery(event.target.value)} />
          <button type="button" aria-expanded={regexOpen} onClick={() => setRegexOpen((open) => !open)}>Regex builder</button>
        </div>
        {regexOpen && (
          <div className="torrent-node__regex" role="region" aria-label="Torrent task regex builder">
            <label>Pattern <input value={pattern} onChange={(event) => setPattern(event.target.value)} /></label>
            <label>Flags <input value={flags} onChange={(event) => setFlags(event.target.value)} /></label>
            {regexError && <span role="alert">{regexError}</span>}
          </div>
        )}
        {filteredTasks.length === 0 ? <p className="torrent-node__empty">No torrent tasks yet. Add a magnet or choose a torrent file.</p> : filteredTasks.map((task) => (
          <article key={task.id} className="torrent-node__task">
            <div className="torrent-node__task-head"><strong>{taskLabel(task)}</strong><span>{task.status}</span></div>
            <progress max={1} value={task.progress} aria-label={`${Math.round(task.progress * 100)} percent downloaded`} />
            <div className="torrent-node__stats"><span>{Math.round(task.progress * 100)}%</span><span>{bytes(task.downloadedBytes)} / {bytes(task.totalBytes)}</span><span>{bytes(task.speedBytesPerSecond)}/s</span><span>{task.peers} peers</span><span>ETA {duration(task.etaSeconds)}</span></div>
            {task.error && <p className="torrent-node__error" role="alert">{task.error}</p>}
            {task.files.length > 0 && <details><summary>Files ({task.files.length})</summary><div className="torrent-node__files">{task.files.map((file) => <label key={file.path}><input type="checkbox" checked={file.selected} onChange={(event) => void withBusy(() => api.torrent.chooseFiles(task.id, task.files.filter((entry) => entry.path === file.path ? event.target.checked : entry.selected).map((entry) => entry.path)))} /> <span>{file.path}</span><small>{bytes(file.sizeBytes)}</small></label>)}</div></details>}
            <div className="torrent-node__task-actions">
              {task.status === 'downloading' ? <button type="button" onClick={() => void withBusy(() => api.torrent.pause(task.id))}>Pause</button> : <button type="button" disabled={task.status === 'completed' || task.status === 'cancelled'} onClick={() => void withBusy(() => api.torrent.resume(task.id))}>Resume</button>}
              <button type="button" disabled={task.status === 'completed' || task.status === 'cancelled'} onClick={() => void withBusy(() => api.torrent.cancel(task.id))}>Cancel</button>
              <button type="button" disabled={task.status !== 'failed' && task.status !== 'cancelled'} onClick={() => void withBusy(() => api.torrent.retry(task.id))}>Retry</button>
              <button type="button" disabled={!!task.destination || !destination} onClick={() => void setTaskDestination(task)}>Use folder</button>
              <select aria-label={`Seeding policy for ${taskLabel(task)}`} value={task.seedPolicy.kind} onChange={(event) => void updatePolicy(task, event.target.value)}><option value="never">Do not seed</option><option value="ratio">Seed to 1.0 ratio</option><option value="minutes">Seed for 30 minutes</option></select>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
