import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { TorrentSeedPolicy, TorrentTaskState } from '@shared/torrent'
import { buildTorrentExport, normalizeSeedPolicy } from '@shared/torrent'
import type { ExportFormat } from '@shared/export'
import type { CanvasNode } from '../state/workspace'
import { useActiveSessionApi } from '../session/session'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useI18n } from '../lib/i18n'
import { useSchoolMode } from '../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../lib/schoolModePolicy'
import { appearanceId } from '../lib/appearance/registry'
import { BulkActionBar, type BulkAction } from '../components/BulkActionBar'
import { emptySelection, invertSelection, pruneSelection, selectAll, selectRange, toggleOne, type BulkSelectionState } from '../lib/bulkSelection'

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

function freshConsent() {
  return { accepted: true as const, acceptedAt: Date.now(), activationId: crypto.randomUUID(), disclosed: 'trackers-dht-peers-ip-seeding-destination' as const }
}

export function torrentNodeOptionalFeatureVisible(state: { enabled: boolean; hydrated: boolean }): boolean {
  return schoolModeAllowsOptionalFeatures(state)
}

export default function TorrentNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const { t } = useI18n()
  const schoolModeEnabled = useSchoolMode((state) => state.enabled)
  const schoolModeHydrated = useSchoolMode((state) => state.hydrated)
  const schoolMode = { enabled: schoolModeEnabled, hydrated: schoolModeHydrated }
  const optionalFeaturesAllowed = torrentNodeOptionalFeatureVisible(schoolMode)
  const copy = (key: string, fallback: string, params?: Record<string, string>): string => t(key, fallback, params).primary
  const statusLabel = (status: TorrentTaskState['status']): string => copy(`torrent.status.${status}`, status)
  const [tasks, setTasks] = useState<TorrentTaskState[]>([])
  const [destination, setDestination] = useState('')
  const [runtime, setRuntime] = useState<{ available: boolean; origin: string; detail: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [networkConsent, setNetworkConsent] = useState(false)
  const [selection, setSelection] = useState<BulkSelectionState>(emptySelection)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextTasks, nextRuntime] = await Promise.all([api.torrent.list(id), api.torrent.runtime()])
      setTasks(nextTasks)
      setSelection((current) => pruneSelection(current, nextTasks.map((task) => task.id)))
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
    return tasks.filter((task) => search.test(`${taskLabel(task)} ${task.status} ${task.sourceKind}`))
  }, [search, tasks])

  const bulkActions = useMemo<BulkAction<TorrentTaskState>[]>(() => {
    const runEach = async (items: TorrentTaskState, action: (task: TorrentTaskState) => Promise<unknown>) => action(items)
    const action = (id: string, label: string, run: (task: TorrentTaskState) => Promise<unknown>, destructive = false): BulkAction<TorrentTaskState> => ({
      id, label, destructive, describe: taskLabel,
      run: async (items) => {
        const succeeded: TorrentTaskState[] = []
        const failed: { item: TorrentTaskState; reason: string }[] = []
        for (const item of items) {
          try { await runEach(item, run); succeeded.push(item) } catch (error) { failed.push({ item, reason: error instanceof Error ? error.message : String(error) }) }
        }
        return { succeeded, failed }
      }
    })
    return [
      action('pause', copy('torrent.bulk.pause', 'Pause selected'), (task) => api.torrent.pause(task.id)),
      action('resume', copy('torrent.bulk.resume', 'Resume selected'), (task) => api.torrent.resume(task.id, networkConsent ? freshConsent() : undefined)),
      action('cancel', copy('torrent.bulk.cancel', 'Cancel selected'), (task) => api.torrent.cancel(task.id)),
      action('retry', copy('torrent.bulk.retry', 'Retry selected'), (task) => api.torrent.retry(task.id, networkConsent ? freshConsent() : undefined)),
      action('remove', copy('torrent.bulk.remove', 'Remove selected'), (task) => api.torrent.remove(task.id), true),
      action('export', copy('torrent.bulk.export', 'Export selected'), async (task) => {
        const ok = await api.clipboard.writeText(buildTorrentExport([task], 'json').content, { reportFailure: false })
        if (!ok) throw new Error(copy('torrent.exportError', 'Could not export selected tasks.'))
      })
    ]
  }, [api, copy, networkConsent])

  const onBulkComplete = useCallback((actionId: string, result: { succeeded: TorrentTaskState[]; failed: { item: TorrentTaskState; reason: string }[] }) => {
    setSelection(emptySelection())
    window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: result.failed.length ? 'error' : 'success', message: copy('torrent.bulkResult', '{action}: {succeeded} succeeded, {failed} skipped or failed.', { action: actionId, succeeded: String(result.succeeded.length), failed: String(result.failed.length) }) } }))
    void load()
  }, [copy, load])

  const exportSelected = useCallback(async (format: ExportFormat): Promise<void> => {
    const selected = filteredTasks.filter((task) => selection.selected.has(task.id))
    if (selected.length === 0) return
    setExportError(null)
    const built = buildTorrentExport(selected, format)
    const result = await api.export.saveText(built.filename, built.content, built.mimeType)
    if (!result.ok && !result.canceled) setExportError(result.error ?? copy('torrent.exportError', 'Could not export selected tasks.'))
  }, [api, copy, filteredTasks, selection.selected])

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
      const task = await api.torrent.add({ nodeId: id, sourceKind: 'magnet', sourceRef: magnet, destination, networkConsent: networkConsent ? freshConsent() : undefined })
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
    })
  }, [api, data.torrentMagnet, destination, id, networkConsent, withBusy])

  const addTorrentFile = useCallback(async (): Promise<void> => {
    const source = await api.dialog.selectFile({ extensions: ['torrent'] })
    if (!source) return
    await withBusy(async () => {
      const task = await api.torrent.add({ nodeId: id, sourceKind: 'torrent-file', sourceRef: source, destination, networkConsent: networkConsent ? freshConsent() : undefined })
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
    })
  }, [api, destination, id, networkConsent, withBusy])

  const setTaskDestination = useCallback(async (task: TorrentTaskState): Promise<void> => {
    if (!destination) return
    await withBusy(() => api.torrent.setDestination(task.id, destination))
  }, [api, destination, withBusy])

  const updatePolicy = useCallback((task: TorrentTaskState, value: string): Promise<void> => {
    const policy: TorrentSeedPolicy = value === 'ratio'
      ? { kind: 'ratio', ratio: 1 }
      : value === 'minutes'
        ? { kind: 'minutes', minutes: 30 }
        : value === 'indefinite'
          ? { kind: 'indefinite' }
        : normalizeSeedPolicy({ kind: 'never' })
    return withBusy(() => api.torrent.setSeedPolicy(task.id, policy))
  }, [api, withBusy])

  if (!optionalFeaturesAllowed) return null
  const fill = nodeHeaderFillStyle(data.color)
  return (
    <div className={`term-node torrent-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }} data-appearance-id={appearanceId('node', id)} data-toylock-target={`node:${id}`}>
      <NodeResizer minWidth={440} minHeight={360} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style} data-appearance-id={appearanceId('node', `${id}:header`)} data-toylock-target={`node:${id}:header`}>
        <EditableNodeTitle value={data.title} onChange={(title) => updateNodeData(id, { title })} emptyLabel={copy('torrent.title', 'Torrent downloader')} title={copy('torrent.rename', 'Click to rename')} ariaLabel={copy('torrent.nodeName', 'Torrent downloader node name')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button className="term-node__close" title="Refresh torrent tasks" onClick={() => void load()}>⟳</button>
      </div>
      <div className="torrent-node__body nodrag nowheel">
        <div className="torrent-node__runtime" role="status" data-appearance-id={appearanceId('node', `${id}:runtime`)} data-toylock-target={`node:${id}:runtime`}>
          {runtime ? runtime.available ? `${copy('torrent.runtime', 'WebTorrent')} ${runtime.origin}` : `${copy('torrent.runtimeUnavailable', 'WebTorrent unavailable')}: ${runtime.detail ?? copy('torrent.runtimeMissing', 'runtime could not be loaded')}` : copy('torrent.runtimeChecking', 'Checking WebTorrent runtime…')}
        </div>
        <label className="torrent-node__field" htmlFor={`${id}-magnet`} data-appearance-id={appearanceId('node', `${id}:magnet`)} data-toylock-target={`node:${id}:magnet`}>
          <span>{copy('torrent.magnet', 'Magnet URI')}</span>
          <input id={`${id}-magnet`} value={data.torrentMagnet ?? ''} spellCheck={false} placeholder="magnet:?xt=urn:btih:…" onChange={(event) => updateNodeData(id, { torrentMagnet: event.target.value })} />
        </label>
        <label className="torrent-node__consent" data-appearance-id={appearanceId('node', `${id}:consent`)} data-toylock-target={`node:${id}:consent`}><input type="checkbox" checked={networkConsent} onChange={(event) => setNetworkConsent(event.target.checked)} /> {copy('torrent.networkConsent', 'I understand this uses trackers, DHT, peers, my IP address, seeding, and the chosen destination.')}</label>
        <div className="torrent-node__actions">
          <button type="button" disabled={!runtime?.available || !data.torrentMagnet?.trim() || !destination || !networkConsent || busy} onClick={() => void addMagnet()}>{copy('torrent.addMagnet', 'Add magnet')}</button>
          <button type="button" disabled={!runtime?.available || !destination || !networkConsent || busy} onClick={() => void addTorrentFile()}>{copy('torrent.chooseFile', 'Choose .torrent file')}</button>
        </div>
        <div className="torrent-node__destination" data-appearance-id={appearanceId('node', `${id}:destination`)} data-toylock-target={`node:${id}:destination`}>
          <label htmlFor={`${id}-destination`}>{copy('torrent.destination', 'Download folder')}</label>
          <input id={`${id}-destination`} value={destination} readOnly placeholder="Choose a destination folder" />
          <button type="button" onClick={() => void pickDestination()}>{copy('torrent.browse', 'Browse…')}</button>
        </div>
        <div className="torrent-node__search" data-appearance-id={appearanceId('node', `${id}:search`)} data-toylock-target={`node:${id}:search`}>
          <label htmlFor={`${id}-search`}>{copy('torrent.tasks', 'Tasks')}</label>
          <div className="menu-filter__row">
            <input ref={searchInputRef} id={`${id}-search`} value={search.value} placeholder={search.mode === 'regex' ? 'Search tasks… (regex)' : 'Search tasks…'} onChange={(event) => search.setValue(event.target.value)} />
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex for torrent tasks" zIndex={40} />
          </div>
        </div>
        {search.error && <div className="torrent-node__error" role="alert">{search.error}</div>}
        <BulkActionBar
          visible={filteredTasks}
          idOf={(task) => task.id}
          selectedIds={selection.selected}
          onSelectAll={() => setSelection(selectAll(filteredTasks.map((task) => task.id)))}
          onInvert={() => setSelection(invertSelection(selection, filteredTasks.map((task) => task.id)))}
          onClear={() => setSelection(emptySelection())}
          actions={bulkActions}
          onActionComplete={onBulkComplete}
        />
        {selection.selected.size > 0 && <details className="torrent-node__exports"><summary>{copy('torrent.exportSummary', 'Export selected tasks (private fields omitted)')}</summary><p>{copy('torrent.exportDisclosure', 'Source URI, trackers, destination paths, peer addresses, and engine handles are omitted from every export format.')}</p><div className="torrent-node__export-actions">{(['json', 'jsonl', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'markdown', 'html', 'sql'] as ExportFormat[]).map((format) => <button key={format} type="button" onClick={() => void exportSelected(format)}>{format.toUpperCase()}</button>)}</div>{exportError && <div role="alert">{exportError}</div>}</details>}
        {filteredTasks.length === 0 ? <p className="torrent-node__empty">{copy('torrent.noTasks', 'No torrent tasks yet. Add a magnet or choose a torrent file.')}</p> : filteredTasks.map((task) => (
          <article key={task.id} className="torrent-node__task" data-appearance-id={appearanceId('node', `${id}:task:${task.id}`)} data-toylock-target={`node:${id}:task:${task.id}`}>
            <div className="torrent-node__task-head"><label><input type="checkbox" checked={selection.selected.has(task.id)} onChange={(event) => setSelection((current) => event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey ? selectRange(current, task.id, filteredTasks.map((item) => item.id)) : toggleOne(current, task.id))} aria-label={`Select ${taskLabel(task)}`} /> <strong>{taskLabel(task)}</strong></label><span>{statusLabel(task.status)}</span></div>
            <progress max={1} value={task.progress} aria-label={`${Math.round(task.progress * 100)} percent downloaded`} />
            <div className="torrent-node__stats"><span>{Math.round(task.progress * 100)}%</span><span>{bytes(task.downloadedBytes)} / {bytes(task.totalBytes)}</span><span>{bytes(task.speedBytesPerSecond)}/s</span><span>{task.peers} peers</span><span>ETA {duration(task.etaSeconds)}</span></div>
            {task.error && <p className="torrent-node__error" role="alert">{task.error}</p>}
            {task.files.length > 0 && <details><summary>Files ({task.files.length})</summary><div className="torrent-node__files">{task.files.map((file) => <label key={file.path}><input type="checkbox" checked={file.selected} onChange={(event) => void withBusy(() => api.torrent.chooseFiles(task.id, task.files.filter((entry) => entry.path === file.path ? event.target.checked : entry.selected).map((entry) => entry.path)))} /> <span>{file.path}</span><small>{bytes(file.sizeBytes)}</small></label>)}</div></details>}
            <div className="torrent-node__task-actions">
              {task.status === 'downloading' ? <button type="button" onClick={() => void withBusy(() => api.torrent.pause(task.id))}>Pause</button> : <button type="button" disabled={task.status === 'completed' || task.status === 'cancelled'} onClick={() => void withBusy(() => api.torrent.resume(task.id, networkConsent ? freshConsent() : undefined))}>Resume</button>}
              <button type="button" disabled={task.status === 'completed' || task.status === 'cancelled'} onClick={() => void withBusy(() => api.torrent.cancel(task.id))}>Cancel</button>
              <button type="button" disabled={task.status !== 'failed' && task.status !== 'cancelled'} onClick={() => void withBusy(() => api.torrent.retry(task.id, networkConsent ? freshConsent() : undefined))}>Retry</button>
              <button type="button" disabled={!!task.destination || !destination} onClick={() => void setTaskDestination(task)}>Use folder</button>
              <select aria-label={`Seeding policy for ${taskLabel(task)}`} value={task.seedPolicy.kind} onChange={(event) => void updatePolicy(task, event.target.value)}><option value="never">Do not seed</option><option value="ratio">Seed to 1.0 ratio</option><option value="minutes">Seed for 30 minutes</option><option value="indefinite">Seed indefinitely</option></select>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
} 
