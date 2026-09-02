import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { TorrentApi, TorrentSeedPolicy, TorrentTaskState } from '@shared/torrent'
import { normalizeSeedPolicy } from '@shared/torrent'
import type { CanvasNode } from '../state/workspace'
import { useActiveSessionApi } from '../session/session'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { formatHostMessage, hostFact, hostText } from '../lib/personalVocabulary/hostMessage'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { openDestructiveGate } from '../state/destructiveGate'
import { Radio } from '../ui/md3'
import { Button, Checkbox, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

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

function duration(seconds: number | null, map?: VocabularyMapper): string {
  if (seconds === null || !Number.isFinite(seconds)) return map?.('Unknown') ?? 'Unknown'
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

type VocabularyMapper = (text: string) => string

function taskLabel(task: TorrentTaskState, map: VocabularyMapper): string {
  return task.name || map(task.sourceKind === 'magnet' ? 'Magnet download' : 'Torrent file')
}

function textWithFact(map: VocabularyMapper, before: string, fact: string, after = ''): string {
  return formatHostMessage([hostText(before), hostFact(fact), hostText(after)], map)
}

function runtimeLabel(
  runtime: { available: boolean; origin: string; detail: string | null } | null,
  map: VocabularyMapper
): string {
  if (!runtime) return map('Checking WebTorrent runtime…')
  if (runtime.available) return formatHostMessage([hostFact('WebTorrent '), hostFact(runtime.origin)], map)
  return formatHostMessage([
    hostFact('WebTorrent'),
    hostText(' unavailable: '),
    runtime.detail ? hostFact(runtime.detail) : hostText('runtime could not be loaded')
  ], map)
}

const SEED_CHOICES: ReadonlyArray<{ id: TorrentSeedPolicy['kind']; label: string; description: string; policy: TorrentSeedPolicy }> = [
  { id: 'never', label: 'Do not seed', description: 'Stop the WebTorrent handle when the selected files finish.', policy: { kind: 'never' } },
  { id: 'ratio', label: 'Seed to 1.0 ratio', description: 'Stop after uploading the same amount that was downloaded.', policy: { kind: 'ratio', ratio: 1 } },
  { id: 'minutes', label: 'Seed for 30 minutes', description: 'Start the 30 minute timer only after the download completes.', policy: { kind: 'minutes', minutes: 30 } }
]

interface TorrentTaskCardProps {
  task: TorrentTaskState
  busy: boolean
  destination: string
  torrent: TorrentApi
  run: (operation: () => Promise<unknown>) => Promise<void>
}

function TorrentTaskCard({ task, busy, destination, torrent, run }: TorrentTaskCardProps): React.JSX.Element {
  const map = useVocabularyMapper()
  const fileSearch = useRegexSearchField()
  const seedSearch = useRegexSearchField()
  const fileSearchRef = useRef<HTMLInputElement>(null)
  const seedSearchRef = useRef<HTMLInputElement>(null)
  const visibleFiles = useMemo(
    () => task.files.filter((file) => fileSearch.test(`${file.path} ${file.name}`)),
    [task.files, fileSearch.mode, fileSearch.query, fileSearch.pattern, fileSearch.flags, fileSearch.error]
  )
  const visibleSeedChoices = useMemo(
    () => SEED_CHOICES.filter((choice) => seedSearch.test(`${map(choice.label)} ${map(choice.description)}`)),
    [map, seedSearch.mode, seedSearch.query, seedSearch.pattern, seedSearch.flags, seedSearch.error]
  )
  const label = taskLabel(task, map)
  const selectedCount = task.files.filter((file) => file.selected).length
  const canStart = !!task.destination && task.files.length > 0 && selectedCount > 0 && !busy
  const startReason = !task.destination
    ? map('Choose a download folder and apply it to this task before starting.')
    : task.files.length === 0
      ? map('Wait for torrent metadata before starting.')
      : selectedCount === 0
        ? map('Select at least one file before starting.')
        : null

  const updatePolicy = (policy: TorrentSeedPolicy): void => {
    void run(() => torrent.setSeedPolicy(task.id, normalizeSeedPolicy(policy)))
  }

  const requestRemove = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const trigger = event.currentTarget
    const rect = trigger.getBoundingClientRect()
    const opened = openDestructiveGate({
      title: textWithFact(map, 'Remove torrent task "', label, '"'),
      description: map('This removes the machine-local task record and stops its WebTorrent handle. Downloaded files remain on disk. The task record cannot be restored.'),
      affected: [label],
      confirmLabel: map('Remove task'),
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: trigger,
      onConfirm: () => { void run(() => torrent.remove(task.id)) }
    })
    if (!opened) {
      window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind: 'error', message: map('Another destructive confirmation is already open.') } }))
    }
  }

  return (
    <article className="torrent-node__task" aria-label={textWithFact(map, 'Torrent task: ', label)}>
      <div className="torrent-node__task-head"><strong>{label}</strong><span>{task.status}</span></div>
      <progress max={1} value={task.progress} aria-label={textWithFact(map, 'Downloaded ', String(Math.round(task.progress * 100)), '%')} />
      <div className="torrent-node__stats"><span>{Math.round(task.progress * 100)}%</span><span>{bytes(task.downloadedBytes)} / {bytes(task.totalBytes)}</span><span>{bytes(task.speedBytesPerSecond)}/s</span><span>{textWithFact(map, '', String(task.peers), ' peers')}</span><span>{textWithFact(map, 'ETA ', duration(task.etaSeconds, map))}</span></div>
      {task.error && <p className="torrent-node__error" role="alert">{task.error}</p>}

      {task.files.length > 0 && (
        <details className="torrent-node__picker">
          <summary>{formatHostMessage([
            hostText('Files ('),
            hostFact(String(selectedCount)),
            hostText(' of '),
            hostFact(String(task.files.length)),
            hostText(' selected)')
          ], map)}</summary>
          <div className="torrent-node__picker-search">
            <label htmlFor={`${task.id}-file-search`}>{map('Filter files')}</label>
            <Input vocabularyMode="factual"
              ref={fileSearchRef}
              id={`${task.id}-file-search`}
              value={fileSearch.value}
              placeholder={map(fileSearch.mode === 'regex' ? 'Regex pattern' : 'Search file names and paths')}
              onChange={(event) => fileSearch.setValue(event.target.value)}
            />
            <AnchoredRegexBuilder search={fileSearch} fieldRef={fileSearchRef} label={textWithFact(map, 'Regex builder for files in ', label)} />
          </div>
          {fileSearch.error && <p className="torrent-node__error" role="alert">{fileSearch.error}</p>}
          <div className="torrent-node__selection-actions">
            <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy || visibleFiles.length === 0} onClick={() => void run(() => torrent.chooseFiles(task.id, [...new Set([...task.files.filter((file) => file.selected).map((file) => file.path), ...visibleFiles.map((file) => file.path)])]))}>{map('Select filtered')}</Button>
            <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy || visibleFiles.length === 0} onClick={() => void run(() => torrent.chooseFiles(task.id, task.files.filter((file) => file.selected && !visibleFiles.some((visible) => visible.path === file.path)).map((file) => file.path)))}>{map('Clear filtered')}</Button>
          </div>
          <div className="torrent-node__files">
            {visibleFiles.length === 0 ? <p className="torrent-node__empty">{map('No files match this filter.')}</p> : visibleFiles.map((file) => (
              <label key={file.path}>
                <Checkbox vocabularyMode="factual"
                  checked={file.selected}
                  disabled={busy}
                  onChange={(event) => void run(() => torrent.chooseFiles(task.id, task.files.filter((entry) => entry.path === file.path ? event.target.checked : entry.selected).map((entry) => entry.path)))}
                />
                <span>{file.path}</span>
                <small>{bytes(file.sizeBytes)}</small>
              </label>
            ))}
          </div>
        </details>
      )}

      <details className="torrent-node__picker">
        <summary>{formatHostMessage([
          hostText('Seeding: '),
          hostText(SEED_CHOICES.find((choice) => choice.id === task.seedPolicy.kind)?.label ?? 'Do not seed')
        ], map)}</summary>
        <div className="torrent-node__picker-search">
          <label htmlFor={`${task.id}-seed-search`}>{map('Find a seeding policy')}</label>
          <Input vocabularyMode="factual"
            ref={seedSearchRef}
            id={`${task.id}-seed-search`}
            value={seedSearch.value}
            placeholder={map(seedSearch.mode === 'regex' ? 'Regex pattern' : 'Search seeding policies')}
            onChange={(event) => seedSearch.setValue(event.target.value)}
          />
          <AnchoredRegexBuilder search={seedSearch} fieldRef={seedSearchRef} label={textWithFact(map, 'Regex builder for seeding policies in ', label)} />
        </div>
        {seedSearch.error && <p className="torrent-node__error" role="alert">{seedSearch.error}</p>}
        <div className="torrent-node__seed-options" role="radiogroup" aria-label={textWithFact(map, 'Seeding policy for ', label)}>
          {visibleSeedChoices.length === 0 ? <p className="torrent-node__empty">{map('No seeding policies match this filter.')}</p> : visibleSeedChoices.map((choice) => (
            <label key={choice.id}>
              <Radio name={`${task.id}-seed-policy`} checked={task.seedPolicy.kind === choice.id} disabled={busy} onChange={() => updatePolicy(choice.policy)} />
              <span><strong>{map(choice.label)}</strong><small>{map(choice.description)}</small></span>
            </label>
          ))}
        </div>
      </details>

      {startReason && task.status !== 'completed' && task.status !== 'cancelled' && <p className="torrent-node__hint">{startReason}</p>}
      <div className="torrent-node__task-actions">
        {(task.status === 'queued' || task.status === 'metadata') && <Button variant="outlined" size="small" vocabularyMode="factual" disabled={!canStart} onClick={() => void run(() => torrent.start(task.id))}>{map('Start')}</Button>}
        {task.status === 'downloading' && <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void run(() => torrent.pause(task.id))}>{map('Pause')}</Button>}
        {task.status === 'paused' && <Button variant="outlined" size="small" vocabularyMode="factual" disabled={!canStart} onClick={() => void run(() => torrent.resume(task.id))}>{map('Resume')}</Button>}
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy || task.status === 'completed' || task.status === 'cancelled'} onClick={() => void run(() => torrent.cancel(task.id))}>{map('Cancel')}</Button>
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy || (task.status !== 'failed' && task.status !== 'cancelled')} onClick={() => void run(() => torrent.retry(task.id))}>{map('Retry')}</Button>
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy || !!task.destination || !destination} onClick={() => void run(() => torrent.setDestination(task.id, destination))}>{map('Use folder')}</Button>
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={requestRemove}>{map('Remove task')}</Button>
      </div>
    </article>
  )
}

export default function TorrentNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const map = useVocabularyMapper()
  const [tasks, setTasks] = useState<TorrentTaskState[]>([])
  const [destination, setDestination] = useState('')
  const [runtime, setRuntime] = useState<{ available: boolean; origin: string; detail: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const taskSearch = useRegexSearchField()
  const taskSearchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextTasks, nextRuntime] = await Promise.all([api.torrent.list(id), api.torrent.runtime()])
      setTasks(nextTasks)
      setRuntime(nextRuntime)
      setDestination((current) => current || nextTasks.find((task) => task.destination)?.destination || '')
    } catch (error) {
      setRuntime({ available: false, origin: 'unavailable', detail: error instanceof Error ? error.message : String(error) })
    }
  }, [api, id])

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

  const filteredTasks = useMemo(
    () => tasks.filter((task) => taskSearch.test(`${taskLabel(task, map)} ${task.status} ${task.sourceKind}`)),
    [map, tasks, taskSearch.mode, taskSearch.query, taskSearch.pattern, taskSearch.flags, taskSearch.error]
  )

  const withBusy = useCallback(async (operation: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      window.dispatchEvent(new CustomEvent('nodeterm:toast', {
        detail: { kind: 'error', message: formatHostMessage([hostText('Torrent operation failed: '), hostFact(detail)], map) }
      }))
    } finally {
      setBusy(false)
      void load()
    }
  }, [busy, load, map])

  const pickDestination = useCallback(async (): Promise<void> => {
    const chosen = await api.dialog.selectFolder()
    if (chosen) setDestination(chosen)
  }, [api])

  const inspectMagnet = useCallback(async (): Promise<void> => {
    const magnet = String(data.torrentMagnet ?? '').trim()
    if (!magnet) return
    await withBusy(async () => {
      const task = await api.torrent.inspect({ nodeId: id, sourceKind: 'magnet', sourceRef: magnet })
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
    })
  }, [api, data.torrentMagnet, id, withBusy])

  const inspectTorrentFile = useCallback(async (): Promise<void> => {
    const source = await api.dialog.selectFile()
    if (!source) return
    await withBusy(async () => {
      const task = await api.torrent.inspect({ nodeId: id, sourceKind: 'torrent-file', sourceRef: source })
      setTasks((current) => [...current.filter((item) => item.id !== task.id), task])
    })
  }, [api, id, withBusy])

  const fill = nodeHeaderFillStyle(data.color)
  return (
    <div className={`term-node torrent-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={440} minHeight={360} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <EditableNodeTitle value={data.title} onChange={(title) => updateNodeData(id, { title })} emptyLabel="Torrent downloader" title="Click to rename" ariaLabel="Torrent downloader node name" rejectEmpty={false} />
        <span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__close" icon="refresh" vocabularyMode="factual" title={map('Refresh torrent tasks')} aria-label={map('Refresh torrent tasks')} onClick={() => void load()} />
      </div>
      <div className="torrent-node__body nodrag nowheel">
        <div className="torrent-node__runtime" role="status">
          {runtimeLabel(runtime, map)}
        </div>
        <label className="torrent-node__field" htmlFor={`${id}-magnet`}>
          <span>{map('Magnet URI')}</span>
          <Input vocabularyMode="factual" id={`${id}-magnet`} aria-label={map('Magnet URI')} value={data.torrentMagnet ?? ''} spellCheck={false} placeholder="magnet:?xt=urn:btih:…" onChange={(event) => updateNodeData(id, { torrentMagnet: event.target.value })} />
        </label>
        <div className="torrent-node__actions">
          <Button variant="outlined" size="small" vocabularyMode="factual" disabled={!runtime?.available || !data.torrentMagnet?.trim() || busy} onClick={() => void inspectMagnet()}>{map('Inspect magnet')}</Button>
          <Button variant="outlined" size="small" vocabularyMode="factual" disabled={!runtime?.available || busy} onClick={() => void inspectTorrentFile()}>{map('Inspect .torrent file')}</Button>
        </div>
        <p className="torrent-node__hint">{map('Inspection reads metadata first. Choose files and a download folder, then start the task explicitly.')}</p>
        <div className="torrent-node__destination">
          <label htmlFor={`${id}-destination`}>{map('Download folder')}</label>
          <Input vocabularyMode="factual" id={`${id}-destination`} aria-label={map('Download folder')} value={destination} readOnly placeholder={map('Choose a destination folder')} />
          <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void pickDestination()}>{map('Browse…')}</Button>
        </div>
        <div className="torrent-node__search">
          <label htmlFor={`${id}-search`}>{map('Tasks')}</label>
          <Input vocabularyMode="factual" ref={taskSearchRef} id={`${id}-search`} value={taskSearch.value} placeholder={map(taskSearch.mode === 'regex' ? 'Regex pattern' : 'Search tasks')} onChange={(event) => taskSearch.setValue(event.target.value)} />
          <AnchoredRegexBuilder search={taskSearch} fieldRef={taskSearchRef} label={map('Regex builder for torrent tasks')} />
        </div>
        {taskSearch.error && <p className="torrent-node__error" role="alert">{taskSearch.error}</p>}
        {filteredTasks.length === 0 ? <p className="torrent-node__empty">{map('No torrent tasks match this search. Inspect a magnet or torrent file to begin.')}</p> : filteredTasks.map((task) => (
          <TorrentTaskCard key={task.id} task={task} busy={busy} destination={destination} torrent={api.torrent} run={withBusy} />
        ))}
      </div>
    </div>
  )
}
