import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/ui/md3'
import { Select } from '@renderer/ui/Select'
import type { NodeTerminalApi } from '@shared/types'
import type { AdvancedPipelineDescriptor, AdvancedPipelineQueueItem } from '@shared/converter'
import { isBrowserRuntime } from '../../bridge/runtime'
import { formatBytes } from '../../lib/bytesFormat'

/**
 * The multi-output pipeline surface is intentionally a small sibling of the ordinary queue. It
 * uses native file/folder pickers, keeps disabled capabilities visible, and reports every output
 * path from the durable advanced queue instead of pretending one row represents a whole archive.
 */
export function AdvancedPipelinePanel({ api }: { api: NodeTerminalApi }) {
  const advanced = api.converter.advanced
  const [catalog, setCatalog] = useState<AdvancedPipelineDescriptor[]>([])
  const [items, setItems] = useState<AdvancedPipelineQueueItem[]>([])
  const [selected, setSelected] = useState<string>('')
  const [input, setInput] = useState('')
  const [destination, setDestination] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!advanced) return
    let live = true
    void Promise.all([advanced.catalog(), advanced.state()]).then(([rows, state]) => {
      if (!live) return
      setCatalog(rows)
      setItems(state.items)
      setSelected((current) => current || rows.find((row) => row.available)?.id || '')
    }).catch((error) => live && setNotice(error instanceof Error ? error.message : 'Advanced pipeline catalog is unavailable'))
    const offItem = advanced.onItem((item) => setItems((previous) => {
      const next = previous.filter((candidate) => candidate.id !== item.id)
      return [...next, item]
    }))
    return () => { live = false; offItem() }
  }, [advanced])

  if (!advanced) return null

  const selectedDescriptor = useMemo(() => catalog.find((row) => row.id === selected), [catalog, selected])

  const pickInput = async () => {
    if (isBrowserRuntime()) { setNotice('Choose a file through the browser upload route in the ordinary converter first.'); return }
    const paths = await api.dialog.selectFiles()
    if (paths?.[0]) setInput(paths[0])
  }

  const pickDestination = async () => {
    const path = await api.dialog.selectFolder()
    if (path) setDestination(path)
  }

  const enqueue = async () => {
    if (!selectedDescriptor?.available || !input || !destination) {
      setNotice('Choose an available pipeline, an input file, and a destination folder.')
      return
    }
    try {
      await advanced.add({ pipelineId: selectedDescriptor.id, inputPath: input, outputDirectory: destination })
      await advanced.start()
      setNotice('Advanced pipeline queued. Progress is reported below.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not queue the advanced pipeline') }
  }

  return <section className="cv-advanced" aria-labelledby="cv-advanced-title">
    <h3 id="cv-advanced-title">Advanced pipelines</h3>
    <p className="cv-empty-note">Offline image, ZIP, PDF, OCR, and structured-data pipelines use bounded resources and show every disabled dependency honestly.</p>
    {notice && <p className="cv-item__error" role="status">{notice}</p>}
    <label>
      Pipeline
      <Select value={selected} onChange={(event) => setSelected(event.target.value)} aria-label="Advanced pipeline">
        <option value="" disabled>Choose a pipeline</option>
        {catalog.map((row) => <option key={row.id} value={row.id} disabled={!row.available}>{row.label}{row.available ? '' : ` — ${row.unavailableReason ?? 'Unavailable'}`}</option>)}
      </Select>
    </label>
    {selectedDescriptor?.lossy && <p className="cv-lossy">{selectedDescriptor.disclosure.join(' ')}</p>}
    <div className="cv-actions">
      <Button size="small" vocabularyMode="factual" variant="outlined" className="sc-btn" onClick={() => void pickInput()}>Choose input…</Button>
      <span className="cv-destdir" title={input}>{input || 'No input selected'}</span>
    </div>
    <div className="cv-actions">
      <Button size="small" vocabularyMode="factual" variant="outlined" className="sc-btn" onClick={() => void pickDestination()}>Choose output folder…</Button>
      <span className="cv-destdir" title={destination}>{destination || 'No output folder selected'}</span>
    </div>
    <Button size="small" vocabularyMode="factual" className="sc-btn primary" onClick={() => void enqueue()} disabled={!selectedDescriptor?.available || !input || !destination}>Queue advanced pipeline</Button>
    {items.length === 0 ? <p className="cv-empty-note">No advanced pipeline jobs yet.</p> : <ul className="cv-items" aria-label="Advanced pipeline queue">
      {items.map((item) => <li className={`cv-item cv-item--${item.status}`} key={item.id}>
        <div className="cv-item__row"><span className="cv-item__name">{item.pipelineId}</span><span className="cv-item__status">{item.status}</span></div>
        {item.progress && <div className="cv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={item.progress.totalBytes || 1} aria-valuenow={item.progress.completedBytes} aria-label={item.progress.message}><div className="cv-progress__bar" style={{ width: `${item.progress.totalBytes ? Math.min(100, item.progress.completedBytes / item.progress.totalBytes * 100) : 0}%` }} /></div>}
        {item.result?.outputs.map((output) => <p className="cv-item__dest" key={output.path}>{output.path} · {formatBytes(output.bytes)} · {output.sha256.slice(0, 12)}</p>)}
        {item.error && <p className="cv-item__error">{item.error}</p>}
        {(item.status === 'running' || item.status === 'queued') && <Button variant="text" size="small" vocabularyMode="factual" className="cv-item__link" onClick={() => void advanced.cancel(item.id)}>Cancel</Button>}
        {(item.status === 'failed' || item.status === 'cancelled') && <Button variant="text" size="small" vocabularyMode="factual" className="cv-item__link" onClick={() => void advanced.retry(item.id)}>Retry</Button>}
      </li>)}
    </ul>}
  </section>
}
