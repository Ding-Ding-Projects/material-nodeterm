import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  CONVERTER_CATALOG,
  converterAdapterById,
  type ConvertQueueItem,
  type ConverterAdapterDescriptor,
  type ConverterDetectionResult,
  type ConverterPreflightResult,
  type ConverterQueueState
} from '@shared/converter'
import { isBrowserRuntime } from '../../bridge/runtime'
import { formatBytes } from '../../lib/bytesFormat'
import { bytesToBase64 } from '../../lib/browserBytes'
import { AdapterCatalog } from './AdapterCatalog'

export interface FileConverterPanelProps {
  onClose: () => void
}

interface PickedFile {
  path: string
  detection?: ConverterDetectionResult
}

const toast = (message: string, kind: 'error' | 'info' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind, message } }))
}

/** Reads a browser File's bytes and lands them on the server via files.saveUpload — the Server
 *  Edition has no native multi-file dialog, so this is how "Add files…" works in the browser. */
async function uploadBrowserFiles(files: FileList): Promise<string[]> {
  const paths: string[] = []
  for (const file of Array.from(files)) {
    const buf = await file.arrayBuffer()
    const base64 = bytesToBase64(new Uint8Array(buf))
    const path = await window.nodeTerminal.files.saveUpload(file.name, base64)
    if (path) paths.push(path)
  }
  return paths
}

function statusIcon(status: ConvertQueueItem['status']): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'failed':
      return '✕'
    case 'cancelled':
      return '⦸'
    case 'running':
      return '↻'
    case 'needs-confirm':
      return '⚠'
    case 'paused':
      return '⏸'
    case 'skipped':
      return '⊘'
    default:
      return '⋯'
  }
}

function QueueRow({
  item,
  onCancel,
  onRetry,
  onRemove,
  onResolve
}: {
  item: ConvertQueueItem
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onResolve: (id: string, opts: { overwrite?: boolean; lossyAcknowledged?: boolean }) => void
}) {
  const pct = item.totalBytes > 0 ? Math.round((item.progressBytes / item.totalBytes) * 100) : 0
  return (
    <li className={`cv-item cv-item--${item.status}`}>
      <div className="cv-item__row">
        <span className="cv-item__icon" aria-hidden>
          {statusIcon(item.status)}
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
        <span className="cv-item__status">{item.status.replace('-', ' ')}</span>
      </div>
      {item.status === 'running' && (
        <div className="cv-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="cv-progress__bar" style={{ width: `${pct}%` }} />
        </div>
      )}
      {item.status === 'needs-confirm' && (
        <div className="cv-confirm">
          {item.confirmReasons?.includes('overwrite') && (
            <div className="cv-confirm__row">
              <span>Destination file already exists.</span>
              <button className="sc-btn" onClick={() => onResolve(item.id, { overwrite: true })}>
                Overwrite
              </button>
            </div>
          )}
          {item.confirmReasons?.includes('lossy') && (
            <div className="cv-confirm__row">
              <span>This conversion can lose information — see the catalog row for details.</span>
              <button className="sc-btn" onClick={() => onResolve(item.id, { lossyAcknowledged: true })}>
                Convert anyway
              </button>
            </div>
          )}
          <button className="cv-item__link" onClick={() => onCancel(item.id)}>
            Skip this file
          </button>
        </div>
      )}
      {item.error && <p className="cv-item__error">{item.error}</p>}
      {item.warnings && item.warnings.length > 0 && (
        <p className="cv-item__warning">{item.warnings.join(' ')}</p>
      )}
      <div className="cv-item__actions">
        {(item.status === 'queued' || item.status === 'running' || item.status === 'paused') && (
          <button className="cv-item__link" onClick={() => onCancel(item.id)}>
            Cancel
          </button>
        )}
        {(item.status === 'failed' || item.status === 'cancelled') && (
          <button className="cv-item__link" onClick={() => onRetry(item.id)}>
            Retry
          </button>
        )}
        {item.status === 'done' && !isBrowserRuntime() && (
          <button className="cv-item__link" onClick={() => void window.nodeTerminal.shell.reveal(item.destPath)}>
            Reveal
          </button>
        )}
        {(item.status === 'done' || item.status === 'failed' || item.status === 'cancelled') && (
          <button className="cv-item__link" onClick={() => onRemove(item.id)}>
            Remove
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
 * the per-category search boxes are plain substring search, not the full anchored regex builder;
 * the overwrite/lossy gate is the app's existing ConfirmDialog-style inline confirm rather than the
 * full two-key destructive-action slider; and the queue list here shows the first page only (no
 * pager control yet) — the engine itself is already paginated (converter.state(offset, limit)).
 */
export function FileConverterPanel({ onClose }: FileConverterPanelProps) {
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.nodeTerminal.converter.catalog().then(setCatalog).catch(() => {})
    window.nodeTerminal.converter.state(0, 500).then((s) => {
      setQueue(s.items)
      setSummary({ running: s.running, scanning: s.scanning, concurrency: s.concurrency, total: s.total })
    })
    const offItem = window.nodeTerminal.converter.onItem((item) => {
      setQueue((prev) => {
        const idx = prev.findIndex((i) => i.id === item.id)
        if (idx === -1) return [...prev, item]
        const copy = [...prev]
        copy[idx] = item
        return copy
      })
    })
    const offSummary = window.nodeTerminal.converter.onSummary((s) => setSummary((prev) => ({ ...prev, ...s })))
    return () => {
      offItem()
      offSummary()
    }
  }, [])

  useEffect(() => {
    if (!destDir) {
      setPreflight(null)
      return
    }
    window.nodeTerminal.converter.preflight(destDir).then(setPreflight).catch(() => setPreflight(null))
  }, [destDir])

  const selectedAdapter = useMemo(
    () => (selectedAdapterId ? converterAdapterById(selectedAdapterId) ?? catalog.find((a) => a.id === selectedAdapterId) : null),
    [selectedAdapterId, catalog]
  )

  const suggestedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const f of pending) for (const id of f.detection?.compatibleAdapterIds ?? []) ids.add(id)
    return [...ids]
  }, [pending])

  const addPaths = useCallback(async (paths: string[]) => {
    const detections = await Promise.all(
      paths.map((path) =>
        window.nodeTerminal.converter.detect(path).catch(
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
    setPending((prev) => [...prev, ...paths.map((path, i) => ({ path, detection: detections[i] }))])
  }, [])

  const handlePickFiles = useCallback(async () => {
    if (isBrowserRuntime()) {
      fileInputRef.current?.click()
      return
    }
    const paths = await window.nodeTerminal.dialog.selectFiles()
    if (paths && paths.length > 0) await addPaths(paths)
  }, [addPaths])

  const handleBrowserFileInput = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      try {
        const paths = await uploadBrowserFiles(files)
        if (paths.length > 0) await addPaths(paths)
      } catch {
        toast('Could not upload the selected files.', 'error')
      } finally {
        e.target.value = ''
      }
    },
    [addPaths]
  )

  const handlePickFolder = useCallback(async () => {
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
    const folder = await window.nodeTerminal.dialog.selectFolder()
    if (!folder) return
    await window.nodeTerminal.converter.addFolder(folder, destDir, selectedAdapter.id, {
      lossyAcknowledged: lossyAck
    })
    toast(`Scanning "${folder}" in the background — matching files will appear in the queue.`)
  }, [selectedAdapter, destDir, lossyAck])

  const handleChooseDest = useCallback(async () => {
    const folder = await window.nodeTerminal.dialog.selectFolder()
    if (folder) setDestDir(folder)
  }, [])

  const handleAddToQueue = useCallback(async () => {
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
    const result = await window.nodeTerminal.converter.addFiles(paths, destDir, selectedAdapter.id, lossyAck)
    setPending([])
    if (result.rejected.length > 0) {
      toast(`${result.added.length} added, ${result.rejected.length} rejected: ${result.rejected[0].error}`, 'error')
    } else {
      toast(`${result.added.length} file(s) added to the queue.`)
    }
  }, [selectedAdapter, destDir, lossyAck, pending])

  const toggleRunning = useCallback(() => {
    if (summary.running) void window.nodeTerminal.converter.pause()
    else void window.nodeTerminal.converter.start()
  }, [summary.running])

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
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer converter" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="File converter">
        <div className="drawer__head">
          <h2>File converter</h2>
          <button className="drawer__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer__body cv-body">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleBrowserFileInput}
          />

          <section>
            <h3>1. Choose files</h3>
            <div className="cv-actions">
              <button className="sc-btn" onClick={() => void handlePickFiles()}>
                Add files…
              </button>
              <button className="sc-btn" onClick={() => void handlePickFolder()}>
                Add folder…
              </button>
            </div>
            {pending.length === 0 && (
              <p className="cv-empty-note">
                No files selected yet. Pick one or more files, or a whole folder, to get started.
              </p>
            )}
            {pending.length > 0 && (
              <ul className="cv-pending">
                {pending.map((f) => (
                  <li key={f.path}>
                    <span className="cv-pending__name">{f.path.split(/[\\/]/).pop()}</span>
                    <span className="cv-pending__meta">
                      {f.detection ? `${f.detection.note} (${f.detection.confidence})` : 'inspecting…'}
                      {f.detection ? ` · ${formatBytes(f.detection.sizeBytes)}` : ''}
                    </span>
                    <button
                      className="cv-item__link"
                      aria-label={`Remove ${f.path}`}
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
            <h3>2. Choose a target format</h3>
            <AdapterCatalog
              catalog={catalog}
              selectedId={selectedAdapterId}
              onSelect={(id) => {
                setSelectedAdapterId(id)
                setLossyAck(false)
              }}
              suggestedIds={suggestedIds}
            />
            {selectedAdapter && selectedAdapter.lossy && (
              <div className="cv-lossy">
                <p>
                  <strong>This conversion can lose information:</strong>
                </p>
                <ul>
                  {(selectedAdapter.lossyNotes ?? []).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <label className="cv-lossy__ack">
                  <input type="checkbox" checked={lossyAck} onChange={(e) => setLossyAck(e.target.checked)} />
                  I understand — convert anyway
                </label>
              </div>
            )}
          </section>

          <section>
            <h3>3. Destination</h3>
            <div className="cv-actions">
              <button className="sc-btn" onClick={() => void handleChooseDest()}>
                {destDir ? 'Change folder…' : 'Choose folder…'}
              </button>
              {destDir && <span className="cv-destdir" title={destDir}>{destDir}</span>}
            </div>
            {preflight && (
              <p className="cv-preflight">
                {preflight.destDirExists ? '' : 'Will be created. '}
                {preflight.writable ? '' : 'Not writable — check permissions. '}
                Free space:{' '}
                {preflight.freeBytes === null ? 'unknown' : formatBytes(preflight.freeBytes)}. Estimated need:{' '}
                {formatBytes(preflight.estimatedNeededBytes)}.
                {preflight.sufficient === false && ' This may not be enough free space.'}
              </p>
            )}
            <button
              className="sc-btn primary"
              disabled={pending.length === 0 || !selectedAdapter || !destDir}
              onClick={() => void handleAddToQueue()}
            >
              Add {pending.length || ''} file{pending.length === 1 ? '' : 's'} to queue
            </button>
          </section>

          <section>
            <h3>4. Queue</h3>
            <div className="cv-queue-controls">
              <button className="sc-btn" onClick={toggleRunning} disabled={queue.length === 0}>
                {summary.running ? 'Pause' : 'Start'}
              </button>
              <label className="cv-concurrency">
                Parallel:
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={summary.concurrency}
                  onChange={(e) => void window.nodeTerminal.converter.setConcurrency(Number(e.target.value))}
                />
              </label>
              <button className="cv-item__link" onClick={() => void window.nodeTerminal.converter.cancelAll()}>
                Cancel all
              </button>
              <button className="cv-item__link" onClick={() => void window.nodeTerminal.converter.clearFinished()}>
                Clear finished
              </button>
              {summary.scanning && <span className="cv-scanning">Scanning folder…</span>}
            </div>
            <p className="cv-summary-counts">
              {counts.queued} queued · {counts.running} running · {counts.needsConfirm} need attention ·{' '}
              {counts.done} done · {counts.failed} failed · {counts.cancelled} cancelled
            </p>
            {queue.length === 0 ? (
              <p className="cv-empty-note">Nothing in the queue yet.</p>
            ) : (
              <ul className="cv-items">
                {queue.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onCancel={(id) => void window.nodeTerminal.converter.cancelItem(id)}
                    onRetry={(id) => void window.nodeTerminal.converter.retryItem(id)}
                    onRemove={(id) => void window.nodeTerminal.converter.removeItem(id)}
                    onResolve={(id, opts) => void window.nodeTerminal.converter.resolvePending([id], opts)}
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
