import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  CONVERTER_CATALOG,
  converterAdapterById,
  portableAdvancedPipelineIntent,
  type ConvertQueueItem,
  type ConverterAdapterDescriptor,
  type ConverterDetectionResult,
  type ConverterPreflightResult,
  type ConverterQueueState
} from '@shared/converter'
import { E_UNSUPPORTED } from '@shared/rpc'
import type { NodeTerminalApi } from '@shared/types'
import { UPLOAD_MAX_BYTES, UPLOAD_TOO_LARGE_MESSAGE } from '@shared/uploads'
import { isBrowserRuntime } from '../../bridge/runtime'
import { formatBytes } from '../../lib/bytesFormat'
import { bytesToBase64 } from '../../lib/browserBytes'
import { useActiveSessionApi } from '../../session/session'
import { mapLocalVocabularyText } from '../../lib/personalVocabulary/hostMessage'
import { MaterialSymbol, type MaterialSymbolName } from '../MaterialSymbol'
import { AdapterCatalog } from './AdapterCatalog'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../../lib/personalVocabulary/ownedCopy'
import { Checkbox, Progress } from '@renderer/ui/md3'

export function detectionSummarySegments(note: string, confidence: 'high' | 'medium' | 'low') {
  return [copy('Detection: '), fact(note), copy(' (confidence: '), fact(confidence), copy(')')]
}

export interface FileConverterPanelProps {
  onClose: () => void
}

const PANEL_SCOPE_KEYS = new WeakMap<NodeTerminalApi, number>()
let nextPanelScopeKey = 1

function panelScopeKey(api: NodeTerminalApi): number {
  const known = PANEL_SCOPE_KEYS.get(api)
  if (known !== undefined) return known
  const key = nextPanelScopeKey++
  PANEL_SCOPE_KEYS.set(api, key)
  return key
}

interface PickedFile {
  path: string
  detection?: ConverterDetectionResult
}

const toast = (message: string, kind: 'error' | 'info' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind, message } }))
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function converterErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === E_UNSUPPORTED
  ) {
    return `File conversion is not available for this session (${E_UNSUPPORTED}).`
  }
  return errorMessage(error, 'The file converter could not complete that action.')
}

/** Lands browser Files on the active machine — the Server Edition has no native multi-file dialog,
 *  so this is how "Add files…" works there. */
async function uploadBrowserFiles(filesApi: NodeTerminalApi['files'], files: FileList): Promise<string[]> {
  const paths: string[] = []
  for (const file of Array.from(files)) {
    // File.size is browser-owned metadata. Refuse before either carrier reads the file; the
    // receiver still enforces the same shared ceiling against untrusted bytes.
    if (file.size > UPLOAD_MAX_BYTES) throw new Error(mapLocalVocabularyText(UPLOAD_TOO_LARGE_MESSAGE))
    const path = filesApi.saveUploadBlob
      ? // Server Edition owns this same-origin capability. Passing the File by identity lets fetch
        // stream its backing store without ArrayBuffer + base64 + atob + Uint8Array copies.
        await filesApi.saveUploadBlob(file.name, file)
      : await file.arrayBuffer().then((buf) =>
          filesApi.saveUpload(file.name, bytesToBase64(new Uint8Array(buf)))
        )
    // `null` covers an unwritable staging area and core-side size rejection. Silently dropping it
    // makes the picker look like it accepted the file while adding nothing to the next step.
    if (!path) throw new Error(`Could not upload "${file.name}" — the server did not save the file.`)
    paths.push(path)
  }
  return paths
}

function statusIcon(status: ConvertQueueItem['status']): MaterialSymbolName {
  switch (status) {
    case 'done':
      return 'check_circle'
    case 'failed':
      return 'warning'
    case 'cancelled':
      return 'close'
    case 'running':
      return 'sync'
    case 'needs-confirm':
      return 'warning'
    case 'paused':
      return 'hourglass_top'
    case 'skipped':
      return 'close'
    default:
      return 'schedule'
  }
}

function QueueRow({
  item,
  onCancel,
  onRetry,
  onRemove,
  onResolve,
  onReveal,
  onOpenInEditor
}: {
  item: ConvertQueueItem
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onResolve: (id: string, opts: { overwrite?: boolean; lossyAcknowledged?: boolean }) => void
  onReveal: (path: string) => void
  onOpenInEditor: (path: string) => void
}) {
  const vocab = useVocabularyMapper()
  const pct = item.totalBytes > 0 ? Math.round((item.progressBytes / item.totalBytes) * 100) : 0
  return (
    <li className={`cv-item cv-item--${item.status}`}>
      <div className="cv-item__row">
        <span className="cv-item__icon" aria-hidden>
          <MaterialSymbol name={statusIcon(item.status)} size={16} />
        </span>
        <span className="cv-item__name" title={item.sourcePath}>
          {item.sourceName}
        </span>
        <span className="cv-item__arrow" aria-hidden>
          →
        </span>
        <span className="cv-item__dest" title={item.destPath}>
          {item.destPath.split(/[\\/]/).pop()}
        </span>
        <span className="cv-item__size">{formatBytes(item.sourceBytes)}</span>
        <span className="cv-item__status">{vocab(item.status.replace('-', ' '))}</span>
      </div>
      {item.status === 'running' && (
        <Progress
          value={pct}
          label={`Conversion progress for ${item.sourceName}`}
          className="cv-progress"
          barClassName="cv-progress__bar"
        />
      )}
      {item.status === 'needs-confirm' && (
        <div className="cv-confirm">
          {item.confirmReasons?.includes('overwrite') && (
            <div className="cv-confirm__row">
              <span>{vocab('Destination file already exists.')}</span>
              <button className="sc-btn" onClick={() => onResolve(item.id, { overwrite: true })}>
                {vocab('Overwrite')}
              </button>
            </div>
          )}
          {item.confirmReasons?.includes('lossy') && (
            <div className="cv-confirm__row">
              <span>{vocab('This conversion can lose information — see the catalog row for details.')}</span>
              <button className="sc-btn" onClick={() => onResolve(item.id, { lossyAcknowledged: true })}>
                {vocab('Convert anyway')}
              </button>
            </div>
          )}
          <button className="cv-item__link" onClick={() => onCancel(item.id)}>
            {vocab('Skip this file')}
          </button>
        </div>
      )}
      {item.error && <p className="cv-item__error">{item.error}</p>}
      {item.destinationCollisionIndex !== undefined && item.destinationCollisionIndex > 1 && (
        <p className="cv-item__warning">
          {vocab('Name adjusted to avoid replacing an existing or queued file.')}
        </p>
      )}
      {item.warnings && item.warnings.length > 0 && (
        <p className="cv-item__warning">{item.warnings.join(' ')}</p>
      )}
      <div className="cv-item__actions">
        {(item.status === 'queued' || item.status === 'running' || item.status === 'paused') && (
          <button className="cv-item__link" onClick={() => onCancel(item.id)}>
            {vocab('Cancel')}
          </button>
        )}
        {(item.status === 'failed' || item.status === 'cancelled') && (
          <button className="cv-item__link" onClick={() => onRetry(item.id)}>
            {vocab('Retry')}
          </button>
        )}
        {item.status === 'done' && !isBrowserRuntime() && (
          <button className="cv-item__link" onClick={() => onReveal(item.destPath)}>
            {vocab('Reveal')}
          </button>
        )}
        {item.status === 'done' && (
          <button className="cv-item__link" onClick={() => onOpenInEditor(item.destPath)}>
            {vocab('Open in Visual Studio Code')}
          </button>
        )}
        {(item.status === 'done' || item.status === 'failed' || item.status === 'cancelled') && (
          <button className="cv-item__link" onClick={() => onRemove(item.id)}>
            {vocab('Remove')}
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * Universal file converter — docs/file-converter.md. Categorized, bundled-only adapter catalog
 * (every unavailable format still listed, disabled, with its exact missing dependency), a bounded
 * detect-before-convert step, the lossy/overwrite confirmation gate, and a persistent bounded-
 * concurrency queue with pause/resume/cancel/retry.
 *
 * Known gaps versus the full house contract, left for a follow-up (see docs/file-converter.md):
 * the overwrite/lossy gate is the app's existing ConfirmDialog-style inline confirm rather than the
 * full two-key destructive-action slider; and the queue list here shows the first page only (no
 * pager control yet) — the engine itself is already paginated (converter.state(offset, limit)).
 */
export function FileConverterPanel(props: FileConverterPanelProps) {
  // This drawer sits outside Canvas's project-keyed SessionProvider. Resolve from the active
  // project binding directly so a relay tab reaches its refusing converter stub instead of
  // silently operating on the guest's window-global core.
  const api = useActiveSessionApi()
  // The key changes during the project-switch render itself. That synchronously discards rows,
  // paths, and callbacks owned by the old machine before a user can click them with the new API;
  // a passive-effect reset leaves one committed stale-owner frame.
  return <FileConverterPanelForApi key={panelScopeKey(api)} {...props} api={api} />
}

function FileConverterPanelForApi({
  onClose,
  api
}: FileConverterPanelProps & { api: NodeTerminalApi }) {
  const vocab = useVocabularyMapper()
  const [catalog, setCatalog] = useState<ConverterAdapterDescriptor[]>(CONVERTER_CATALOG)
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null)
  const [pending, setPending] = useState<PickedFile[]>([])
  const [destDir, setDestDir] = useState<string>('')
  const [preflight, setPreflight] = useState<ConverterPreflightResult | null>(null)
  const [lossyAck, setLossyAck] = useState(false)
  const [queue, setQueue] = useState<ConvertQueueItem[]>([])
  const [summary, setSummary] = useState<
    Pick<ConverterQueueState, 'running' | 'scanning' | 'concurrency' | 'total'>
  >({ running: false, scanning: false, concurrency: 2, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const apiRef = useRef(api)
  const mountedRef = useRef(true)
  apiRef.current = api

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    []
  )

  const apiStillActive = useCallback(
    (candidate: NodeTerminalApi): boolean => mountedRef.current && apiRef.current === candidate,
    []
  )

  const showConverterError = useCallback((cause: unknown) => {
    setError(converterErrorMessage(cause))
  }, [])

  const runConverterAction = useCallback(
    (actionApi: NodeTerminalApi, action: () => Promise<unknown>): void => {
      if (!apiStillActive(actionApi)) return
      setError(null)
      void action().catch((cause) => {
        if (apiStillActive(actionApi)) showConverterError(cause)
      })
    },
    [apiStillActive, showConverterError]
  )

  useEffect(() => {
    let current = true
    // Queue paths belong to one machine. Never leave the previous core's rows or pending paths on
    // screen while an active-project switch resolves the next core.
    setCatalog(CONVERTER_CATALOG)
    setSelectedAdapterId(null)
    setPending([])
    setDestDir('')
    setPreflight(null)
    setLossyAck(false)
    setQueue([])
    setSummary({ running: false, scanning: false, concurrency: 2, total: 0 })
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''

    void api.converter.catalog().then(
      (next) => {
        if (current) setCatalog(next)
      },
      (cause) => {
        if (current) showConverterError(cause)
      }
    )
    void api.converter.state(0, 500).then(
      (s) => {
        if (!current) return
        setQueue(s.items)
        setSummary({ running: s.running, scanning: s.scanning, concurrency: s.concurrency, total: s.total })
      },
      (cause) => {
        if (current) showConverterError(cause)
      }
    )
    const offItem = api.converter.onItem((item) => {
      if (!current) return
      setQueue((prev) => {
        const idx = prev.findIndex((i) => i.id === item.id)
        if (idx === -1) return [...prev, item]
        const copy = [...prev]
        copy[idx] = item
        return copy
      })
    })
    const offSummary = api.converter.onSummary((s) => {
      if (current) setSummary((prev) => ({ ...prev, ...s }))
    })
    return () => {
      current = false
      offItem()
      offSummary()
    }
  }, [api, showConverterError])

  useEffect(() => {
    if (!destDir) {
      setPreflight(null)
      return
    }
    let current = true
    void api.converter.preflight(destDir).then(
      (result) => {
        if (current) setPreflight(result)
      },
      (cause) => {
        if (!current) return
        setPreflight(null)
        showConverterError(cause)
      }
    )
    return () => {
      current = false
    }
  }, [api, destDir, showConverterError])

  const selectedAdapter = useMemo(
    () => (selectedAdapterId ? converterAdapterById(selectedAdapterId) ?? catalog.find((a) => a.id === selectedAdapterId) : null),
    [selectedAdapterId, catalog]
  )

  const selectedPipelineIntent = useMemo(() => {
    if (!selectedAdapter?.pipeline) return null
    try {
      return portableAdvancedPipelineIntent(selectedAdapter.id)
    } catch {
      return null
    }
  }, [selectedAdapter])

  const suggestedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of pending) for (const id of f.detection?.compatibleAdapterIds ?? []) ids.add(id)
    return [...ids]
  }, [pending])

  const addPaths = useCallback(async (paths: string[]) => {
    const operationApi = api
    const detections = await Promise.all(
      paths.map((path) =>
        operationApi.converter.detect(path).catch(
          (): ConverterDetectionResult => ({
            path,
            name: path.split(/[\\/]/).pop() ?? path,
            sizeBytes: 0,
            detectedKind: null,
            confidence: 'low',
            note: 'Could not inspect this file',
            compatibleAdapterIds: []
          })
        )
      )
    )
    if (!apiStillActive(operationApi)) return
    setPending((prev) => [...prev, ...paths.map((path, i) => ({ path, detection: detections[i] }))])
  }, [api, apiStillActive])

  const handlePickFiles = useCallback(async () => {
    const operationApi = api
    if (!apiStillActive(operationApi)) return
    if (isBrowserRuntime()) {
      fileInputRef.current?.click()
      return
    }
    try {
      const paths = await operationApi.dialog.selectFiles()
      if (!apiStillActive(operationApi)) return
      if (paths && paths.length > 0) await addPaths(paths)
    } catch (cause) {
      if (apiStillActive(operationApi)) showConverterError(cause)
    }
  }, [addPaths, api, apiStillActive, showConverterError])

  const handleBrowserFileInput = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const operationApi = api
      if (!apiStillActive(operationApi)) return
      const files = e.target.files
      if (!files || files.length === 0) return
      try {
        const paths = await uploadBrowserFiles(operationApi.files, files)
        if (!apiStillActive(operationApi)) return
        if (paths.length > 0) await addPaths(paths)
      } catch (cause) {
        // HTTP 413 carries the exact 64 MiB refusal here. Preserve it instead of replacing it with
        // a generic upload failure that gives the user no actionable size boundary.
        if (apiStillActive(operationApi)) {
          toast(errorMessage(cause, 'Could not upload the selected files.'), 'error')
        }
      } finally {
        // The active-api reset clears the picker on a project switch. A late upload from the old
        // project must not clear a newer selection made for the new one.
        if (apiStillActive(operationApi)) e.target.value = ''
      }
    },
    [addPaths, api, apiStillActive]
  )

  const handlePickFolder = useCallback(async () => {
    const operationApi = api
    if (!apiStillActive(operationApi)) return
    if (isBrowserRuntime()) {
      toast('Adding a whole folder is not available in the browser edition yet — add files instead.', 'error')
      return
    }
    if (!selectedAdapter) {
      toast('Choose a target format from the catalog first (step 2).', 'error')
      return
    }
    if (!destDir) {
      toast('Choose a destination folder first (step 3), then add a folder.', 'error')
      return
    }
    if (selectedAdapter.lossy && !lossyAck) {
      toast('Acknowledge the lossy-conversion notice before adding a folder.', 'error')
      return
    }
    try {
      const folder = await operationApi.dialog.selectFolder()
      if (!apiStillActive(operationApi)) return
      if (!folder) return
      await operationApi.converter.addFolder(folder, destDir, selectedAdapter.id, {
        lossyAcknowledged: lossyAck
      })
      if (!apiStillActive(operationApi)) return
      toast(`Scanning "${folder}" in the background — matching files will appear in the queue.`)
    } catch (cause) {
      if (apiStillActive(operationApi)) showConverterError(cause)
    }
  }, [api, apiStillActive, selectedAdapter, destDir, lossyAck, showConverterError])

  const handleChooseDest = useCallback(async () => {
    const operationApi = api
    if (!apiStillActive(operationApi)) return
    try {
      const folder = await operationApi.dialog.selectFolder()
      if (!apiStillActive(operationApi)) return
      if (folder) setDestDir(folder)
    } catch (cause) {
      if (apiStillActive(operationApi)) showConverterError(cause)
    }
  }, [api, apiStillActive, showConverterError])

  const handleAddToQueue = useCallback(async () => {
    const operationApi = api
    if (!apiStillActive(operationApi)) return
    if (!selectedAdapter) {
      toast('Choose a target format from the catalog first.', 'error')
      return
    }
    if (!destDir) {
      toast('Choose a destination folder first.', 'error')
      return
    }
    if (selectedAdapter.lossy && !lossyAck) {
      toast('Acknowledge the lossy-conversion notice before converting.', 'error')
      return
    }
    const paths = pending.map((f) => f.path)
    if (paths.length === 0) {
      toast('Pick at least one file first.', 'error')
      return
    }
    try {
      const result = await operationApi.converter.addFiles(paths, destDir, selectedAdapter.id, lossyAck)
      if (!apiStillActive(operationApi)) return
      setPending([])
      if (result.rejected.length > 0) {
        toast(`${result.added.length} added, ${result.rejected.length} rejected: ${result.rejected[0].error}`, 'error')
      } else {
        toast(`${result.added.length} file(s) added to the queue.`)
      }
    } catch (cause) {
      if (apiStillActive(operationApi)) showConverterError(cause)
    }
  }, [api, apiStillActive, selectedAdapter, destDir, lossyAck, pending, showConverterError])

  const toggleRunning = useCallback(() => {
    runConverterAction(api, () => (summary.running ? api.converter.pause() : api.converter.start()))
  }, [api, runConverterAction, summary.running])

  const handleOpenInEditor = useCallback(async (path: string) => {
    const operationApi = api
    if (!apiStillActive(operationApi)) return
    try {
      const result = await operationApi.vscode.open(path)
      if (!apiStillActive(operationApi)) return
      if (!result.ok) toast(result.error || 'Visual Studio Code could not open this output.', 'error')
    } catch (cause) {
      if (apiStillActive(operationApi)) {
        toast(errorMessage(cause, 'Visual Studio Code could not open this output.'), 'error')
      }
    }
  }, [api, apiStillActive])

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, needsConfirm: 0 }
    for (const i of queue) {
      if (i.status === 'queued' || i.status === 'paused') c.queued++
      else if (i.status === 'running') c.running++
      else if (i.status === 'done') c.done++
      else if (i.status === 'failed') c.failed++
      else if (i.status === 'cancelled' || i.status === 'skipped') c.cancelled++
      else if (i.status === 'needs-confirm') c.needsConfirm++
    }
    return c
  }, [queue])

  return createPortal(
    <div className="drawer-overlay md3-converter" onClick={onClose}>
      <aside className="drawer converter" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={vocab('File converter')}>
        <div className="drawer__head">
          <h2>{vocab('File converter')}</h2>
          <button className="drawer__close" onClick={onClose} aria-label={vocab('Close')}>
            <MaterialSymbol name="close" size={18} />
          </button>
        </div>
        <div className="drawer__body cv-body">
          {error && (
            <p className="cv-item__error" role="alert">
              {error}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleBrowserFileInput}
          />

          <section>
            <h3>{vocab('1. Choose files')}</h3>
            <div className="cv-actions">
              <button className="sc-btn" onClick={() => void handlePickFiles()}>
                {vocab('Add files…')}
              </button>
              <button className="sc-btn" onClick={() => void handlePickFolder()}>
                {vocab('Add folder…')}
              </button>
            </div>
            {pending.length === 0 && (
              <p className="cv-empty-note">
                {vocab('No files selected yet. Pick one or more files, or a whole folder, to get started.')}
              </p>
            )}
            {pending.length > 0 && (
              <ul className="cv-pending">
                {pending.map((f) => (
                  <li key={f.path}>
                    <span className="cv-pending__name">{f.path.split(/[\\/]/).pop()}</span>
                    <span className="cv-pending__meta">
                      {f.detection
                        ? mapOwnedSentence(vocab, detectionSummarySegments(f.detection.note, f.detection.confidence))
                        : vocab('inspecting…')}
                      {f.detection ? ` · ${formatBytes(f.detection.sizeBytes)}` : ''}
                    </span>
                    <button
                      className="cv-item__link"
                      aria-label={vocab('Remove selected file')}
                      onClick={() => setPending((prev) => prev.filter((p) => p.path !== f.path))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>{vocab('2. Choose a target format')}</h3>
            <AdapterCatalog
              catalog={catalog}
              selectedId={selectedAdapterId}
              onSelect={(id) => {
                setSelectedAdapterId(id)
                setLossyAck(false)
              }}
              suggestedIds={suggestedIds}
            />
            {selectedPipelineIntent && (
              <div className="cv-pipeline-intent" aria-label={vocab('Portable pipeline intent')}>
                <p>
                  <MaterialSymbol name="database" size={16} />
                  <strong>{vocab('Portable pipeline intent')}</strong>
                </p>
                <p>
                  {mapOwnedSentence(vocab, [
                    copy('Operation: '), fact(selectedPipelineIntent.operation),
                    copy(' · Resource profile: '), fact(selectedPipelineIntent.resourceProfile)
                  ])}
                </p>
                <p>
                  {vocab('A transferred project keeps only this safe operation intent. Import does not read a file, start processing, create output, or contact a service.')}
                </p>
                <p>
                  {vocab('On another computer choose Configure, Rebind, Adopt, Deploy, Locate Asset, or Leave Unbound. Source and destination paths, credentials, sessions, process state, host identifiers, caches, and generated output are omitted.')}
                </p>
              </div>
            )}
            {selectedAdapter && selectedAdapter.lossy && (
              <div className="cv-lossy">
                <p>
                  <MaterialSymbol name="warning" size={16} />
                  <strong>{vocab('This conversion can lose information:')}</strong>
                </p>
                <ul>
                  {(selectedAdapter.lossyNotes ?? []).map((n) => (
                    <li key={n}>{vocab(n)}</li>
                  ))}
                </ul>
                <label className="cv-lossy__ack">
                  <Checkbox checked={lossyAck} onChange={(e) => setLossyAck(e.target.checked)} />
                  {vocab('I understand — convert anyway')}
                </label>
              </div>
            )}
          </section>

          <section>
            <h3>{vocab('3. Destination')}</h3>
            <div className="cv-actions">
              <button className="sc-btn" onClick={() => void handleChooseDest()}>
                {vocab(destDir ? 'Change folder…' : 'Choose folder…')}
              </button>
              {destDir && <span className="cv-destdir" title={destDir}>{destDir}</span>}
            </div>
            {preflight && (
              <p className="cv-preflight">
                {preflight.destDirExists ? '' : vocab('Will be created. ')}
                {preflight.writable ? '' : vocab('Not writable — check permissions. ')}
                {vocab('Free space:')}{' '}
                {preflight.freeBytes === null ? vocab('unknown') : formatBytes(preflight.freeBytes)}{vocab('. Estimated need:')}{' '}
                {formatBytes(preflight.estimatedNeededBytes)}.
                {preflight.sufficient === false && vocab(' This may not be enough free space.')}
              </p>
            )}
            <button
              className="sc-btn primary"
              disabled={pending.length === 0 || !selectedAdapter || !destDir}
              onClick={() => void handleAddToQueue()}
            >
              {mapOwnedSentence(vocab, [copy('Add '), fact(pending.length ? String(pending.length) : ''), copy(` file${pending.length === 1 ? '' : 's'} to queue`)])}
            </button>
          </section>

          <section>
            <h3>{vocab('4. Queue')}</h3>
            <div className="cv-queue-controls">
              <button className="sc-btn" onClick={toggleRunning} disabled={queue.length === 0}>
                {vocab(summary.running ? 'Pause' : 'Start')}
              </button>
              <label className="cv-concurrency">
                {vocab('Parallel:')}
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={summary.concurrency}
                  onChange={(e) =>
                    runConverterAction(api, () => api.converter.setConcurrency(Number(e.target.value)))
                  }
                />
              </label>
              <button
                className="cv-item__link"
                onClick={() => runConverterAction(api, () => api.converter.cancelAll())}
              >
                {vocab('Cancel all')}
              </button>
              <button
                className="cv-item__link"
                onClick={() => runConverterAction(api, () => api.converter.clearFinished())}
              >
                {vocab('Clear finished')}
              </button>
              {summary.scanning && <span className="cv-scanning">{vocab('Scanning folder…')}</span>}
            </div>
            <p className="cv-summary-counts">
              {mapOwnedSentence(vocab, [
                fact(String(counts.queued)), copy(' queued · '), fact(String(counts.running)), copy(' running · '),
                fact(String(counts.needsConfirm)), copy(' need attention · '), fact(String(counts.done)), copy(' done · '),
                fact(String(counts.failed)), copy(' failed · '), fact(String(counts.cancelled)), copy(' cancelled')
              ])}
            </p>
            {queue.length === 0 ? (
              <p className="cv-empty-note">{vocab('Nothing in the queue yet.')}</p>
            ) : (
              <ul className="cv-items">
                {queue.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onCancel={(id) => runConverterAction(api, () => api.converter.cancelItem(id))}
                    onRetry={(id) => runConverterAction(api, () => api.converter.retryItem(id))}
                    onRemove={(id) => runConverterAction(api, () => api.converter.removeItem(id))}
                    onResolve={(id, opts) =>
                      runConverterAction(api, () => api.converter.resolvePending([id], opts))
                    }
                    onReveal={(path) => api.shell.reveal(path)}
                    onOpenInEditor={(path) => void handleOpenInEditor(path)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body
  )
}
