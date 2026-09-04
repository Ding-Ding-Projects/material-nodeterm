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
import { Button, Checkbox, IconButton, Tabs } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { copy, fact, mapOwnedSentence, type DisplaySegment } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

interface PickedFile {
  path: string
  detection?: ConverterDetectionResult
}

const notify = (message: string, kind: 'info' | 'error' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { message, kind } }))
}

class ConverterDisplayError extends Error {
  constructor(readonly segments: readonly DisplaySegment[]) {
    super(segments.map((segment) => segment.text).join(''))
  }
}

async function uploadBrowserFiles(filesApi: NodeTerminalApi['files'], files: FileList): Promise<string[]> {
  const paths: string[] = []
  for (const file of Array.from(files)) {
    if (file.size > UPLOAD_MAX_BYTES) throw new ConverterDisplayError([copy(UPLOAD_TOO_LARGE_MESSAGE)])
    const path = filesApi.saveUploadBlob
      ? await filesApi.saveUploadBlob(file.name, file)
      : await file.arrayBuffer().then((buf) => filesApi.saveUpload(file.name, bytesToBase64(new Uint8Array(buf))))
    if (!path) throw new ConverterDisplayError([copy('Could not stage “'), fact(file.name), copy('”. The host did not save the file.')])
    paths.push(path)
  }
  return paths
}

function errorText(error: unknown): readonly DisplaySegment[] {
  if (error instanceof ConverterDisplayError) return error.segments
  if (error instanceof Error && error.message.trim()) return [fact(error.message)]
  return [copy('The converter could not complete that action.')]
}

function preflightText(
  vocab: (text: string) => string,
  value: ConverterPreflightResult
): string {
  return mapOwnedSentence(vocab, [
    ...(value.destDirExists ? [] : [copy('Folder will be created. ')]),
    ...(value.writable ? [] : [copy('Not writable. ')]),
    value.freeBytes === null ? copy('Free space unknown.') : copy('Free space: '),
    ...(value.freeBytes === null ? [] : [fact(formatBytes(value.freeBytes)), copy('.')]),
    copy(' Estimated need: '),
    fact(formatBytes(value.estimatedNeededBytes)),
    copy('.'),
    ...(value.sufficient === false ? [copy(' Not enough free space for the current queue.')] : [])
  ])
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
  const [error, setError] = useState<readonly DisplaySegment[] | null>(null)
  const [vscodeAvailable, setVscodeAvailable] = useState<boolean | null>(null)
  const [view, setView] = useState<'convert' | 'queue'>('convert')
  const vocab = useVocabularyMapper()
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
      notify(vocab('Choose a target format and output folder before adding a folder.'), 'error')
      return
    }
    if (selectedAdapter.lossy && !lossyAcknowledged) {
      notify(vocab('Review and acknowledge the loss disclosure before adding a folder.'), 'error')
      return
    }
    try {
      const folder = await api.dialog.selectFolder()
      if (folder) {
        await api.converter.addFolder(folder, destination, selectedAdapter.id, { lossyAcknowledged })
        setView('queue')
        notify(vocab('Folder scan started. Matching files will appear in the queue.'))
      }
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [api, destination, lossyAcknowledged, selectedAdapter, vocab])

  const addToQueue = useCallback(async (): Promise<void> => {
    if (!selectedAdapter || !destination || pending.length === 0) {
      notify(vocab('Choose files, a compatible target format, and an output folder first.'), 'error')
      return
    }
    if (selectedAdapter.lossy && !lossyAcknowledged) {
      notify(vocab('Review and acknowledge the loss disclosure before adding this conversion.'), 'error')
      return
    }
    try {
      const result = await api.converter.addFiles(pending.map((file) => file.path), destination, selectedAdapter.id, lossyAcknowledged)
      setPending([])
      setView('queue')
      if (result.rejected.length) notify(mapOwnedSentence(vocab, [fact(String(result.added.length)), copy(' added, '), fact(String(result.rejected.length)), copy(' rejected: '), fact(result.rejected[0].error)]), 'error')
      else notify(mapOwnedSentence(vocab, [fact(String(result.added.length)), copy(` file${result.added.length === 1 ? '' : 's'} added to the queue.`)]))
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [api, destination, lossyAcknowledged, pending, selectedAdapter, vocab])

  const openInEditor = useCallback((path: string): void => {
    run(() => api.vscode.open(path).then((result) => {
      if (!result.ok) throw new Error(result.error)
      notify(vocab('Opened the converted file in VS Code.'))
    }))
  }, [api, run, vocab])

  const headerFill = nodeHeaderFillStyle(data.color)
  return (
    <div className={`term-node converter-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={560} minHeight={380} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <MaterialSymbol name="description" size={18} label={vocab('File converter')} />
        <EditableNodeTitle value={data.title ?? vocab('File converter')} onChange={(title) => updateNodeData(id, { title })} emptyLabel={vocab('File converter')} title={vocab('Click to rename')} ariaLabel={vocab('File converter node name')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__close" icon="close" title={vocab('Close')} aria-label={vocab('Close')} onClick={() => void deleteElements({ nodes: [{ id }] })} />
      </div>
      <div className="converter-node__body nodrag nowheel">
        <Input vocabularyMode="factual" ref={inputRef} type="file" multiple hidden onChange={(event) => void onFileInput(event)} />
        {/* Was a hand-rolled `role="tablist"` of chips: it announced itself as ARIA tabs and then
            ignored the arrow keys that role promises, so a keyboard or screen-reader user was told
            these were tabs and found they could not traverse them. Tabs owns the roving tabIndex,
            aria-orientation and Arrow/Home/End contract. The authored words are mapped here before
            they are handed over, and `factual` then stops Tabs mapping them a second time; the
            queue count beside the word stays a caller-owned fact. */}
        <Tabs
          items={[
            { id: 'convert', label: vocab('Convert') },
            { id: 'queue', label: `${vocab('Queue')} (${summary.total})` }
          ]}
          value={view}
          onChange={(id) => setView(id === 'queue' ? 'queue' : 'convert')}
          ariaLabel={vocab('Converter views')}
          className="converter-node__tabs"
          tabClassName="mdx-chip"
          activeTabClassName="mdx-chip--selected"
          idPrefix="converter-view"
          vocabularyMode="factual"
        />
        {error && <p className="cv-item__error" role="alert">{mapOwnedSentence(vocab, error)}</p>}
        {view === 'convert' ? (
          <>
            <div className="converter-node__drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void onDrop(event)}>
              <MaterialSymbol name="upload_file" size={28} />
              <strong>{vocab('Drop files here')}</strong>
              <span>{vocab('or use a real file picker')}</span>
              <div className="cv-actions">
                <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseFiles()}>{vocab('Add files…')}</Button>
                {!isBrowserRuntime() && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseFolder()}>{vocab('Add folder…')}</Button>}
              </div>
            </div>
            {pending.length > 0 && (
              <section>
                <h4>{vocab('Preview')} ({pending.length})</h4>
                <ul className="converter-node__preview">
                  {pending.map((file) => <li key={file.path}><span>{fact(file.detection?.name ?? file.path.split(/[\\/]/).pop() ?? file.path).text}</span><small>{file.detection ? mapOwnedSentence(vocab, [fact(file.detection.note), copy(' · '), fact(formatBytes(file.detection.sizeBytes))]) : vocab('Inspecting…')}</small></li>)}
                </ul>
              </section>
            )}
            <section>
              <h4>{vocab('Target format')}</h4>
              <AdapterCatalog catalog={catalog} selectedId={selectedAdapterId} suggestedIds={suggestedIds} onSelect={(value) => { setSelectedAdapterId(value); setLossyAcknowledged(false) }} />
              {selectedAdapter?.lossy && <div className="cv-lossy"><strong>{vocab('Loss disclosure')}</strong><ul>{(selectedAdapter.lossyNotes ?? []).map((note) => <li key={note}>{fact(note).text}</li>)}</ul><label><Checkbox vocabularyMode="factual" checked={lossyAcknowledged} onChange={(event) => setLossyAcknowledged(event.target.checked)} /> {vocab('I understand and want to convert anyway')}</label></div>}
            </section>
            <section className="converter-node__destination">
              <h4>{vocab('Output folder')}</h4>
              <div className="cv-actions"><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseDestination()}>{vocab(destination ? 'Change folder…' : 'Choose folder…')}</Button><span title={destination}>{destination ? fact(destination).text : vocab('No output folder selected')}</span></div>
              {preflight && <p className="cv-preflight">{preflightText(vocab, preflight)}</p>}
              <Button variant="filled" size="small" vocabularyMode="factual" type="button" disabled={!selectedAdapter || !destination || pending.length === 0} onClick={() => void addToQueue()}>{vocab('Add to queue')}</Button>
            </section>
          </>
        ) : (
          <section>
            <div className="cv-queue-controls"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={!queue.length} onClick={() => run(summary.running ? api.converter.pause() : api.converter.start())}>{vocab(summary.running ? 'Pause' : 'Start')}</Button><label className="cv-concurrency">{vocab('Parallel')} <Input vocabularyMode="factual" type="number" min={1} max={6} value={summary.concurrency} aria-label={vocab('Parallel conversions')} onChange={(event) => run(api.converter.setConcurrency(Number(event.target.value)))} /></label><Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.cancelAll())}>{vocab('Cancel all')}</Button><Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.clearFinished())}>{vocab('Clear finished')}</Button>{summary.scanning && <span className="cv-scanning">{vocab('Scanning folder…')}</span>}</div>
            <p className="cv-summary-counts">{mapOwnedSentence(vocab, [fact(String(counts.queued)), copy(' queued · '), fact(String(counts.running)), copy(' running · '), fact(String(counts.attention)), copy(' need attention · '), fact(String(counts.done)), copy(' done · '), fact(String(counts.failed)), copy(' failed · '), fact(String(counts.cancelled)), copy(' cancelled')])}</p>
            {vscodeAvailable === false && <p className="cv-empty-note">{vocab('VS Code was not found on this machine. Install it or choose Reveal to use the platform file manager.')}</p>}
            {queue.length === 0 ? <p className="cv-empty-note">{vocab('Nothing in the queue yet.')}</p> : <ul className="cv-items">{queue.map((item) => { const pct = item.totalBytes ? Math.round((item.progressBytes / item.totalBytes) * 100) : 0; return <li className={`cv-item cv-item--${item.status}`} key={item.id} aria-label={mapOwnedSentence(vocab, [copy('Conversion '), fact(item.sourceName), copy(' to '), fact(item.destPath), copy(', status '), fact(item.status)])}><div className="cv-item__row"><MaterialSymbol name={statusIcon(item.status)} size={16} /><span className="cv-item__name" title={item.sourcePath}>{fact(item.sourceName).text}</span><span className="cv-item__arrow">→</span><span className="cv-item__dest" title={item.destPath}>{fact(item.destPath.split(/[\\/]/).pop() ?? item.destPath).text}</span><span className="cv-item__size">{fact(formatBytes(item.sourceBytes)).text}</span><span className="cv-item__status">{fact(item.status).text}</span></div>{item.status === 'running' && <div className="cv-progress" role="progressbar" aria-label={vocab('Conversion progress')} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={mapOwnedSentence(vocab, [fact(String(pct)), copy('% complete')])}><div className="cv-progress__bar" style={{ width: `${pct}%` }} /></div>}{item.error && <p className="cv-item__error">{fact(item.error).text}</p>}{item.status === 'needs-confirm' && <div className="cv-confirm"><span>{vocab('Review the required confirmation before running.')}</span><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => run(api.converter.resolvePending([item.id], { overwrite: true, lossyAcknowledged: true }))}>{vocab('Confirm and continue')}</Button></div>}<div className="cv-item__actions">{['queued', 'running', 'paused'].includes(item.status) && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.cancelItem(item.id))}>{vocab('Cancel')}</Button>}{['failed', 'cancelled'].includes(item.status) && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.retryItem(item.id))}>{vocab('Retry')}</Button>}{item.status === 'done' && <><Button variant="text" size="small" vocabularyMode="factual" disabled={vscodeAvailable !== true} title={vscodeAvailable === false ? vocab('VS Code was not found on this machine.') : vocab('Open in VS Code')} onClick={() => openInEditor(item.destPath)}>{vocab('Open in VS Code')}</Button><Button variant="text" size="small" vocabularyMode="factual" onClick={() => api.shell.reveal(item.destPath)}>{vocab('Reveal')}</Button></>}{['done', 'failed', 'cancelled'].includes(item.status) && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => run(api.converter.removeItem(item.id))}>{vocab('Remove')}</Button>}</div></li> })}</ul>}
          </section>
        )}
      </div>
    </div>
  )
}
