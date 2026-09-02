import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  CONVERTER_CATALOG,
  converterAdapterById,
  type ConvertQueueItem,
  type ConverterAdapterDescriptor,
  type ConverterDetectionResult,
  type ConverterPreflightResult,
  type ConverterQueueState
} from '@shared/converter'
import type { NodeTerminalApi } from '@shared/types'
import { UPLOAD_MAX_BYTES, UPLOAD_TOO_LARGE_MESSAGE } from '@shared/uploads'
import { isBrowserRuntime } from '../bridge/runtime'
import { bytesToBase64 } from '../lib/browserBytes'
import { formatBytes } from '../lib/bytesFormat'
import { useActiveSessionApi } from '../session/session'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { MaterialSymbol } from '../components/MaterialSymbol'
import { AdapterCatalog } from '../components/converter/AdapterCatalog'
import type { CanvasNode } from '../state/workspace'
import { Button, Checkbox, Chip, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

interface PickedFile {
  path: string
  detection?: ConverterDetectionResult
}

const notify = (message: string, kind: 'info' | 'error' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { message, kind } }))
}

async function uploadBrowserFiles(filesApi: NodeTerminalApi['files'], files: FileList): Promise<string[]> {
  const paths: string[] = []
  for (const file of Array.from(files)) {
    if (file.size > UPLOAD_MAX_BYTES) throw new Error(UPLOAD_TOO_LARGE_MESSAGE)
    const path = filesApi.saveUploadBlob
      ? await filesApi.saveUploadBlob(file.name, file)
      : await file.arrayBuffer().then((buf) => filesApi.saveUpload(file.name, bytesToBase64(new Uint8Array(buf))))
    if (!path) throw new Error(`Could not stage “${file.name}”. The host did not save the file.`)
    paths.push(path)
  }
  return paths
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'The converter could not complete that action.'
}

function statusIcon(status: ConvertQueueItem['status']): 'check_circle' | 'warning' | 'close' | 'sync' | 'hourglass_top' | 'schedule' {
  if (status === 'done') return 'check_circle'
  if (status === 'failed' || status === 'needs-confirm') return 'warning'
  if (status === 'cancelled' || status === 'skipped') return 'close'
  if (status === 'running') return 'sync'
  if (status === 'paused') return 'hourglass_top'
  return 'schedule'
}

export default function ConverterNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const [catalog, setCatalog] = useState<ConverterAdapterDescriptor[]>(CONVERTER_CATALOG)
  const [pending, setPending] = useState<PickedFile[]>([])
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null)
  const [destination, setDestination] = useState('')
  const [preflight, setPreflight] = useState<ConverterPreflightResult | null>(null)
  const [lossyAcknowledged, setLossyAcknowledged] = useState(false)
  const [queue, setQueue] = useState<ConvertQueueItem[]>([])
  const [summary, setSummary] = useState<Pick<ConverterQueueState, 'running' | 'scanning' | 'concurrency' | 'total'>>({
    running: false,
    scanning: false,
    concurrency: 2,
    total: 0
  })
  const [error, setError] = useState<string | null>(null)
  const [vscodeAvailable, setVscodeAvailable] = useState<boolean | null>(null)
  const [view, setView] = useState<'convert' | 'queue'>('convert')
  const inputRef = useRef<HTMLInputElement>(null)
  const apiRef = useRef(api)
  apiRef.current = api

  const run = useCallback((action: (() => Promise<unknown>) | Promise<unknown>): void => {
    setError(null)
    const pending = typeof action === 'function' ? action() : action
    void pending.catch((cause) => setError(errorText(cause)))
  }, [])

  const addPaths = useCallback(async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    const detections = await Promise.all(
      paths.map((path) =>
        apiRef.current.converter.detect(path).catch((): ConverterDetectionResult => ({
          path,
          name: path.split(/[\\/]/).pop() ?? path,
          sizeBytes: 0,
          detectedKind: null,
          confidence: 'low',
          note: 'Could not inspect this file',
          compatibleAdapterIds: []
        }))
      )
    )
    setPending((previous) => {
      const seen = new Set(previous.map((file) => file.path))
      return [...previous, ...paths.filter((path) => !seen.has(path)).map((path, index) => ({ path, detection: detections[index] }))]
    })
  }, [])

  useEffect(() => {
    let current = true
    void api.converter.catalog().then((value) => current && setCatalog(value)).catch((cause) => current && setError(errorText(cause)))
    void api.converter.state(0, 500).then((state) => {
      if (!current) return
      setQueue(state.items)
      setSummary({ running: state.running, scanning: state.scanning, concurrency: state.concurrency, total: state.total })
    }).catch((cause) => current && setError(errorText(cause)))
    void api.vscode.detect().then((installs) => current && setVscodeAvailable(installs.length > 0)).catch(() => current && setVscodeAvailable(false))
    const offItem = api.converter.onItem((item) => {
      if (!current) return
      setQueue((previous) => {
        const index = previous.findIndex((row) => row.id === item.id)
        if (index < 0) return [...previous, item]
        const next = previous.slice()
        next[index] = item
        return next
      })
    })
    const offSummary = api.converter.onSummary((value) => current && setSummary((previous) => ({ ...previous, ...value })))
    return () => {
      current = false
      offItem()
      offSummary()
    }
  }, [api])

  useEffect(() => {
    if (!destination) {
      setPreflight(null)
      return
    }
    let current = true
    void api.converter.preflight(destination).then((value) => current && setPreflight(value)).catch((cause) => current && setError(errorText(cause)))
    return () => {
      current = false
    }
  }, [api, destination])

  const selectedAdapter = useMemo(
    () => selectedAdapterId ? converterAdapterById(selectedAdapterId) ?? catalog.find((row) => row.id === selectedAdapterId) : null,
    [catalog, selectedAdapterId]
  )
  const suggestedIds = useMemo(() => [...new Set(pending.flatMap((file) => file.detection?.compatibleAdapterIds ?? []))], [pending])
  const counts = useMemo(() => {
    const value = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, attention: 0 }
    for (const item of queue) {
      if (item.status === 'queued' || item.status === 'paused') value.queued++
      else if (item.status === 'running') value.running++
      else if (item.status === 'done') value.done++
      else if (item.status === 'failed') value.failed++
      else if (item.status === 'needs-confirm') value.attention++
      else value.cancelled++
    }
    return value
  }, [queue])

  const chooseFiles = useCallback(async (): Promise<void> => {
    if (isBrowserRuntime()) {
      inputRef.current?.click()
      return
    }
    try {
      const paths = await api.dialog.selectFiles()
      if (paths) await addPaths(paths)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [addPaths, api])

  const onFileInput = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files
    if (!files?.length) return
    try {
      await addPaths(await uploadBrowserFiles(api.files, files))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      event.target.value = ''
    }
  }, [addPaths, api.files])

  const onDrop = useCallback(async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    const files = event.dataTransfer.files
    if (!files.length) return
    try {
      if (isBrowserRuntime()) await addPaths(await uploadBrowserFiles(api.files, files))
      else await addPaths(Array.from(files).map((file) => (file as File & { path?: string }).path).filter((path): path is string => !!path))
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [addPaths, api.files])

  const chooseDestination = useCallback(async (): Promise<void> => {
    try {
      const path = await api.dialog.selectFolder()
      if (path) setDestination(path)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [api])

  const chooseFolder = useCallback(async (): Promise<void> => {
    if (!selectedAdapter || !destination) {
      notify('Choose a target format and output folder before adding a folder.', 'error')
      return
    }
    if (selectedAdapter.lossy && !lossyAcknowledged) {
      notify('Review and acknowledge the loss disclosure before adding a folder.', 'error')
      return
    }
    try {
      const folder = await api.dialog.selectFolder()
      if (folder) {
        await api.converter.addFolder(folder, destination, selectedAdapter.id, { lossyAcknowledged })
        setView('queue')
        notify('Folder scan started. Matching files will appear in the queue.')
      }
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [api, destination, lossyAcknowledged, selectedAdapter])

  const addToQueue = useCallback(async (): Promise<void> => {
    if (!selectedAdapter || !destination || pending.length === 0) {
      notify('Choose files, a compatible target format, and an output folder first.', 'error')
      return
    }
    if (selectedAdapter.lossy && !lossyAcknowledged) {
      notify('Review and acknowledge the loss disclosure before adding this conversion.', 'error')
      return
    }
    try {
      const result = await api.converter.addFiles(pending.map((file) => file.path), destination, selectedAdapter.id, lossyAcknowledged)
      setPending([])
      setView('queue')
      if (result.rejected.length) notify(`${result.added.length} added, ${result.rejected.length} rejected: ${result.rejected[0].error}`, 'error')
      else notify(`${result.added.length} file${result.added.length === 1 ? '' : 's'} added to the queue.`)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [api, destination, lossyAcknowledged, pending, selectedAdapter])

  const openInEditor = useCallback((path: string): void => {
    run(api.vscode.open(path).then((result) => {
      if (!result.ok) throw new Error(result.error)
      notify('Opened the converted file in VS Code.')
    }))
  }, [api, run])

  const headerFill = nodeHeaderFillStyle(data.color)
  return (
    <div className={`term-node converter-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={560} minHeight={380} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <MaterialSymbol name="description" size={18} label="File converter" />
        <EditableNodeTitle value={data.title ?? 'File converter'} onChange={(title) => updateNodeData(id, { title })} emptyLabel="File converter" title="Click to rename" ariaLabel="File converter node name" rejectEmpty={false} />
        <span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__close" icon="close" title="Close" aria-label="Close" onClick={() => void deleteElements({ nodes: [{ id }] })} />
      </div>
      <div className="converter-node__body nodrag nowheel">
        <Input vocabularyMode="factual" ref={inputRef} type="file" multiple hidden onChange={(event) => void onFileInput(event)} />
        <div className="converter-node__tabs" role="tablist" aria-label="Converter views">
          <Chip vocabularyMode="factual" selected={view === 'convert'} role="tab" aria-selected={view === 'convert'} onClick={() => setView('convert')}>Convert</Chip>
          <Chip vocabularyMode="factual" selected={view === 'queue'} role="tab" aria-selected={view === 'queue'} onClick={() => setView('queue')}>Queue ({summary.total})</Chip>
        </div>
        {error && <p className="cv-item__error" role="alert">{error}</p>}
        {view === 'convert' ? (
          <>
            <div className="converter-node__drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void onDrop(event)}>
              <MaterialSymbol name="upload_file" size={28} />
              <strong>Drop files here</strong>
              <span>or use a real file picker</span>
              <div className="cv-actions">
                <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseFiles()}>Add files…</Button>
                {!isBrowserRuntime() && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseFolder()}>Add folder…</Button>}
              </div>
            </div>
            {pending.length > 0 && (
              <section>
                <h4>Preview ({pending.length})</h4>
                <ul className="converter-node__preview">
                  {pending.map((file) => <li key={file.path}><span>{file.detection?.name ?? file.path.split(/[\\/]/).pop()}</span><small>{file.detection ? `${file.detection.note} · ${formatBytes(file.detection.sizeBytes)}` : 'Inspecting…'}</small></li>)}
                </ul>
              </section>
            )}
            <section>
              <h4>Target format</h4>
              <AdapterCatalog catalog={catalog} selectedId={selectedAdapterId} suggestedIds={suggestedIds} onSelect={(value) => { setSelectedAdapterId(value); setLossyAcknowledged(false) }} />
              {selectedAdapter?.lossy && <div className="cv-lossy"><strong>Loss disclosure</strong><ul>{(selectedAdapter.lossyNotes ?? []).map((note) => <li key={note}>{note}</li>)}</ul><label><Checkbox vocabularyMode="factual" checked={lossyAcknowledged} onChange={(event) => setLossyAcknowledged(event.target.checked)} /> I understand and want to convert anyway</label></div>}
            </section>
            <section className="converter-node__destination">
              <h4>Output folder</h4>
              <div className="cv-actions"><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseDestination()}>{destination ? 'Change folder…' : 'Choose folder…'}</Button><span title={destination}>{destination || 'No output folder selected'}</span></div>
              {preflight && <p className="cv-preflight">{preflight.destDirExists ? '' : 'Folder will be created. '}{preflight.writable ? '' : 'Not writable. '}{preflight.freeBytes === null ? 'Free space unknown.' : `Free space: ${formatBytes(preflight.freeBytes)}.`} Estimated need: {formatBytes(preflight.estimatedNeededBytes)}.{preflight.sufficient === false ? ' Not enough free space for the current queue.' : ''}</p>}
              <Button variant="filled" size="small" vocabularyMode="factual" type="button" disabled={!selectedAdapter || !destination || pending.length === 0} onClick={() => void addToQueue()}>Add to queue</Button>
            </section>
          </>
        ) : (
          <section>
            <div className="cv-queue-controls"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={!queue.length} onClick={() => run(summary.running ? api.converter.pause() : api.converter.start())}>{summary.running ? 'Pause' : 'Start'}</Button><label className="cv-concurrency">Parallel <Input vocabularyMode="factual" type="number" min={1} max={6} value={summary.concurrency} onChange={(event) => run(api.converter.setConcurrency(Number(event.target.value)))} /></label><Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.cancelAll())}>Cancel all</Button><Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.clearFinished())}>Clear finished</Button>{summary.scanning && <span className="cv-scanning">Scanning folder…</span>}</div>
            <p className="cv-summary-counts">{counts.queued} queued · {counts.running} running · {counts.attention} need attention · {counts.done} done · {counts.failed} failed · {counts.cancelled} cancelled</p>
            {vscodeAvailable === false && <p className="cv-empty-note">VS Code was not found on this machine. Install it or choose Reveal to use the platform file manager.</p>}
            {queue.length === 0 ? <p className="cv-empty-note">Nothing in the queue yet.</p> : <ul className="cv-items">{queue.map((item) => { const pct = item.totalBytes ? Math.round((item.progressBytes / item.totalBytes) * 100) : 0; return <li className={`cv-item cv-item--${item.status}`} key={item.id}><div className="cv-item__row"><MaterialSymbol name={statusIcon(item.status)} size={16} /><span className="cv-item__name" title={item.sourcePath}>{item.sourceName}</span><span className="cv-item__arrow">→</span><span className="cv-item__dest" title={item.destPath}>{item.destPath.split(/[\\/]/).pop()}</span><span className="cv-item__size">{formatBytes(item.sourceBytes)}</span><span className="cv-item__status">{item.status.replace('-', ' ')}</span></div>{item.status === 'running' && <div className="cv-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="cv-progress__bar" style={{ width: `${pct}%` }} /></div>}{item.error && <p className="cv-item__error">{item.error}</p>}{item.status === 'needs-confirm' && <div className="cv-confirm"><span>Review the required confirmation before running.</span><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => run(api.converter.resolvePending([item.id], { overwrite: true, lossyAcknowledged: true }))}>Confirm and continue</Button></div>}<div className="cv-item__actions">{['queued', 'running', 'paused'].includes(item.status) && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.cancelItem(item.id))}>Cancel</Button>}{['failed', 'cancelled'].includes(item.status) && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.retryItem(item.id))}>Retry</Button>}{item.status === 'done' && <><Button variant="text" size="small" vocabularyMode="factual" disabled={vscodeAvailable !== true} title={vscodeAvailable === false ? 'VS Code was not found on this machine.' : 'Open in VS Code'} onClick={() => openInEditor(item.destPath)}>Open in VS Code</Button><Button variant="text" size="small" vocabularyMode="factual" onClick={() => api.shell.reveal(item.destPath)}>Reveal</Button></>}{['done', 'failed', 'cancelled'].includes(item.status) && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.removeItem(item.id))}>Remove</Button>}</div></li> })}</ul>}
          </section>
        )}
      </div>
    </div>
  )
}
