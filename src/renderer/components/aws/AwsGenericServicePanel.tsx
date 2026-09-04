import { useMemo, useRef, useState } from 'react'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import {
  buildAwsArgv,
  type AwsExecutionPreview,
  type AwsField,
  type AwsInvocationRequest,
  type AwsInvocationResult,
  type AwsInvocationSettings,
  type AwsModelCatalog,
  type AwsOperationModel,
  type AwsServiceModel,
  type AwsShape,
  type AwsWaiterModel,
  validateAwsInvocation
} from '@shared/aws-generic'
import './AwsGenericServicePanel.css'

export interface AwsGenericServicePanelProps {
  catalog: AwsModelCatalog | null
  onRefresh?: () => Promise<AwsModelCatalog>
  onInvoke?: (request: AwsInvocationRequest) => Promise<AwsInvocationResult>
  onPickFile?: (field: AwsField) => Promise<string | undefined>
  onProgress?: (message: string) => void
}

type Tab = 'command' | 'input' | 'preview' | 'output'
type JsonRecord = Record<string, unknown>

const emptySettings = (): AwsInvocationSettings => ({
  serviceId: '',
  operationId: '',
  globalOptions: {},
  input: {},
  outputMode: 'json',
  skeleton: 'none',
  retryAttempts: 2
})

function shapeLabel(shape: AwsShape, fallback: string): string {
  return shape.label || fallback
}

function optionInput(option: AwsModelCatalog['globalOptions'][number], value: unknown, onChange: (value: unknown) => void, onPickFile?: () => Promise<string | undefined>): React.JSX.Element {
  if (option.kind === 'boolean') return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-label={option.label} />
  if (option.kind === 'number') return <input type="number" min={option.min} max={option.max} step={option.step ?? 1} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} aria-label={option.label} />
  if (option.kind === 'enum') return <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={option.label}><option value="">Configured default</option>{(option.values ?? []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
  if (option.kind === 'file') return <button type="button" className="aws-choice-button" disabled={!onPickFile} onClick={() => void onPickFile?.()}>{typeof value === 'string' && value ? value : onPickFile ? 'Choose a file…' : 'File picker unavailable'}</button>
  return <input type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={option.label} />
}

function updatePath(root: unknown, path: string[], value: unknown): JsonRecord {
  const next: JsonRecord = { ...((root as JsonRecord | undefined) ?? {}) }
  if (path.length === 0) return (value as JsonRecord) ?? {}
  let cursor: JsonRecord = next
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    cursor[key] = { ...((cursor[key] as JsonRecord | undefined) ?? {}) }
    cursor = cursor[key] as JsonRecord
  }
  cursor[path[path.length - 1]] = value
  return next
}

function readPath(root: unknown, path: string[]): unknown {
  let cursor: unknown = root
  for (const key of path) cursor = (cursor as JsonRecord | undefined)?.[key]
  return cursor
}

function ScalarEditor({
  shape,
  value,
  onChange,
  onPickFile,
  field
}: {
  shape: AwsShape
  value: unknown
  onChange: (value: unknown) => void
  onPickFile?: (field: AwsField) => Promise<string | undefined>
  field: AwsField
}): React.JSX.Element {
  if (shape.kind === 'boolean') {
    return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-label={field.label} />
  }
  if (shape.kind === 'enum') {
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} aria-label={field.label}>
        <option value="">Choose…</option>
        {shape.values.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    )
  }
  if (shape.kind === 'number') {
    return <input type="number" value={typeof value === 'number' ? value : ''} min={shape.min} max={shape.max} step={shape.step ?? 1} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} aria-label={field.label} />
  }
  if (shape.kind === 'file') {
    return (
      <button type="button" className="aws-choice-button" onClick={() => void onPickFile?.(field)} disabled={!onPickFile} title={!onPickFile ? 'The host file picker is not available.' : undefined}>
        {typeof value === 'string' && value ? value : onPickFile ? 'Choose a file…' : 'File picker unavailable'}
      </button>
    )
  }
  return <input type={shape.kind === 'date' || shape.kind === 'timestamp' ? 'text' : 'text'} value={typeof value === 'string' ? value : ''} placeholder={shape.placeholder} onChange={(e) => onChange(e.target.value || undefined)} aria-label={field.label} />
}

function ShapeEditor({
  shape,
  field,
  value,
  onChange,
  onPickFile,
  depth = 0
}: {
  shape: AwsShape
  field: AwsField
  value: unknown
  onChange: (value: unknown) => void
  onPickFile?: (field: AwsField) => Promise<string | undefined>
  depth?: number
}): React.JSX.Element {
  if (shape.kind !== 'structure' && shape.kind !== 'list' && shape.kind !== 'map') {
    return <ScalarEditor shape={shape} value={value} onChange={onChange} onPickFile={onPickFile} field={field} />
  }
  if (shape.kind === 'structure') {
    const record = (value as JsonRecord | undefined) ?? {}
    return (
      <div className="aws-shape-structure" style={{ marginInlineStart: Math.min(depth, 4) * 12 }}>
        {shape.fields.map((child) => (
          <label className="aws-field" key={child.name}>
            <span>{child.label}{child.required ? ' *' : ''}</span>
            {child.documentation && <small>{child.documentation}</small>}
            <ShapeEditor shape={child.shape} field={child} value={record[child.name]} onChange={(next) => onChange(updatePath(record, [child.name], next))} onPickFile={onPickFile} depth={depth + 1} />
          </label>
        ))}
        {shape.fields.length === 0 && <p className="aws-muted">This operation has no input fields.</p>}
      </div>
    )
  }
  if (shape.kind === 'list') {
    const items = Array.isArray(value) ? value : []
    return (
      <div className="aws-repeated-editor">
        {items.map((item, index) => {
          const child: AwsField = { name: String(index), label: `${shapeLabel(shape.item, 'Item')} ${index + 1}`, shape: shape.item }
          return <div className="aws-repeated-row" key={`${index}-${String(item)}`}><ShapeEditor shape={shape.item} field={child} value={item} onChange={(next) => { const copy = [...items]; copy[index] = next; onChange(copy) }} onPickFile={onPickFile} depth={depth + 1} /><button type="button" className="aws-link-button" onClick={() => onChange(items.filter((_, i) => i !== index))}>Remove</button></div>
        })}
        <button type="button" className="aws-choice-button" disabled={shape.maxItems !== undefined && items.length >= shape.maxItems} onClick={() => onChange([...items, undefined])}>Add item</button>
      </div>
    )
  }
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as JsonRecord) : []
  return (
    <div className="aws-repeated-editor">
      {entries.map(([key, item]) => {
        const child: AwsField = { name: key, label: key, shape: shape.value }
        return <div className="aws-repeated-row" key={key}><input value={key} aria-label="Map key" onChange={(e) => { const copy: JsonRecord = {}; for (const [oldKey, oldValue] of entries) copy[oldKey === key ? e.target.value : oldKey] = oldValue; onChange(copy) }} /><ShapeEditor shape={shape.value} field={child} value={item} onChange={(next) => onChange(updatePath(value, [key], next))} onPickFile={onPickFile} depth={depth + 1} /><button type="button" className="aws-link-button" onClick={() => { const copy = { ...(value as JsonRecord) }; delete copy[key]; onChange(copy) }}>Remove</button></div>
      })}
      <button type="button" className="aws-choice-button" disabled={shape.maxEntries !== undefined && entries.length >= shape.maxEntries} onClick={() => { const copy = { ...(value as JsonRecord) }; let key = 'key'; let n = 2; while (key in copy) key = `key${n++}`; copy[key] = undefined; onChange(copy) }}>Add entry</button>
    </div>
  )
}

function SearchField({ label, search, inputRef }: { label: string; search: ReturnType<typeof useRegexSearchField>; inputRef: React.RefObject<HTMLInputElement | null> }): React.JSX.Element {
  return <div className="aws-search-field"><input ref={inputRef} value={search.value} onChange={(e) => search.setValue(e.target.value)} placeholder={label} aria-label={label} /><AnchoredRegexBuilder search={search} fieldRef={inputRef} label={`Regex for ${label}`} /></div>
}

function PreviewCard({ preview, reviewed, onReviewed }: { preview: AwsExecutionPreview | null; reviewed: boolean; onReviewed: (next: boolean) => void }): React.JSX.Element {
  if (!preview) return <p className="aws-muted">Choose a service and operation to see the exact typed argv and risk before running.</p>
  return (
    <section className={`aws-risk-card aws-risk-card--${preview.risk}`} aria-label="Execution risk preview">
      <div className="aws-risk-heading"><span className="aws-risk-icon">{preview.risk === 'destructive' ? '⚠️' : preview.risk === 'write' ? '✎' : '✓'}</span><strong>{preview.risk === 'destructive' ? 'Destructive operation' : preview.risk === 'write' ? 'State-changing operation' : 'Read-only operation'}</strong></div>
      <p>{preview.serviceLabel} / {preview.operationLabel}</p>
      <dl className="aws-preview-facts"><div><dt>Profile</dt><dd>{preview.profile ?? 'Configured default'}</dd></div><div><dt>Region</dt><dd>{preview.region ?? 'Configured default'}</dd></div><div><dt>Pagination</dt><dd>{preview.paginatorLabel ?? 'Disabled'}</dd></div><div><dt>Waiter</dt><dd>{preview.waiterLabel ?? 'None'}</dd></div><div><dt>Output</dt><dd>{preview.outputMode}</dd></div><div><dt>Retry</dt><dd>{preview.retryAttempts}</dd></div></dl>
      <pre className="aws-argv-preview" aria-label="Generated argument vector">{preview.argv.map((token, index) => <code key={`${index}-${token}`}>{index ? ` ${token}` : token}</code>)}</pre>
      {preview.endpointUrl && <p className="aws-warning">Custom endpoints are enabled for this invocation: {preview.endpointUrl}</p>}
      <label className="aws-review-check"><input type="checkbox" checked={reviewed} onChange={(e) => onReviewed(e.target.checked)} /> I reviewed the service, operation, target, generated argv, output, and risk.</label>
    </section>
  )
}

export function AwsGenericServicePanel({ catalog, onRefresh, onInvoke, onPickFile, onProgress }: AwsGenericServicePanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AwsInvocationSettings>(emptySettings)
  const [tab, setTab] = useState<Tab>('command')
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('Ready')
  const [result, setResult] = useState<AwsInvocationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const serviceSearch = useRegexSearchField()
  const operationSearch = useRegexSearchField()
  const serviceInputRef = useRef<HTMLInputElement>(null)
  const operationInputRef = useRef<HTMLInputElement>(null)

  const services = useMemo(() => (catalog?.services ?? []).filter((service) => serviceSearch.test(`${service.label} ${service.id}`)), [catalog, serviceSearch])
  const selectedService = catalog?.services.find((service) => service.id === settings.serviceId) ?? null
  const operations = useMemo(() => (selectedService?.commands ?? []).filter((operation) => operationSearch.test(`${operation.label} ${operation.id}`)), [operationSearch, selectedService])
  const selectedOperation = selectedService?.commands.find((operation) => operation.id === settings.operationId) ?? null

  const preview = useMemo<AwsExecutionPreview | null>(() => {
    if (!selectedService || !selectedOperation) return null
    try {
      return { argv: buildAwsArgv(settings), risk: selectedOperation.risk, serviceLabel: selectedService.label, operationLabel: selectedOperation.label, profile: settings.profile ?? null, region: settings.region ?? null, endpointUrl: settings.endpointUrl ?? null, paginatorLabel: selectedOperation.paginators.find((p) => p.id === settings.paginatorId)?.label ?? null, waiterLabel: selectedOperation.waiters.find((w) => w.id === settings.waiterId)?.label ?? null, outputMode: settings.outputMode, streaming: !!selectedOperation.streaming, retryAttempts: settings.retryAttempts }
    } catch { return null }
  }, [selectedOperation, selectedService, settings])
  const validation = useMemo(() => validateAwsInvocation(settings), [settings])

  const updateSettings = (next: Partial<AwsInvocationSettings>): void => { setSettings((current) => ({ ...current, ...next })); setReviewed(false); setResult(null); setError(null) }
  const selectService = (service: AwsServiceModel): void => { updateSettings({ serviceId: service.id, operationId: '', input: {}, paginatorId: undefined, waiterId: undefined }); setOperationQuery(''); setTab('command') }
  const selectOperation = (operation: AwsOperationModel): void => { updateSettings({ operationId: operation.id, input: {}, paginatorId: undefined, waiterId: undefined, skeleton: 'none' }); setTab('input') }

  const run = async (): Promise<void> => {
    if (!onInvoke || !selectedService || !selectedOperation || validation.length > 0 || !reviewed) return
    const nextController = new AbortController(); controller.current = nextController; setBusy(true); setError(null); setResult(null); setPhase(selectedOperation.streaming ? 'Streaming response…' : 'Running…'); onProgress?.('AWS operation started')
    try {
      let lastError: unknown = null
      for (let attempt = 0; attempt <= settings.retryAttempts; attempt += 1) {
        if (nextController.signal.aborted) return
        try { const value = await onInvoke({ argv: buildAwsArgv(settings), settings, signal: nextController.signal }); setResult(value); setPhase(value.stopped ? 'Cancelled' : `Complete, ${value.pages} page${value.pages === 1 ? '' : 's'}`); onProgress?.(value.stopped ? 'AWS operation cancelled' : 'AWS operation complete'); return } catch (cause) { lastError = cause; if (attempt < settings.retryAttempts) { setPhase(`Retrying, attempt ${attempt + 2} of ${settings.retryAttempts + 1}…`); onProgress?.(`AWS retry ${attempt + 2}`) } }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    } catch (cause) { if (!nextController.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); setPhase('Failed') } } finally { if (controller.current === nextController) { controller.current = null; setBusy(false) } }
  }

  const cancel = (): void => { controller.current?.abort(); setPhase('Cancellation requested…'); onProgress?.('AWS cancellation requested') }
  const refresh = async (): Promise<void> => { if (!onRefresh) return; setRefreshing(true); try { await onRefresh(); setPhase('Model catalog refreshed') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPhase('Catalog refresh failed') } finally { setRefreshing(false) } }

  return (
    <section className="aws-generic-panel" aria-label="Generic AWS service manager">
      <header className="aws-panel-header"><div><p className="aws-eyebrow">AWS Universe · installed CLI models</p><h2>All-service AWS manager</h2><p className="aws-muted">Guided controls are generated from the installed service models, so newly installed services appear without hand-maintained forms.</p></div><button type="button" className="aws-choice-button" onClick={() => void refresh()} disabled={!onRefresh || refreshing}>{refreshing ? 'Refreshing…' : 'Refresh models'}</button></header>
      {!catalog ? <div className="aws-empty-state"><h3>No AWS model catalog loaded</h3><p>Load the installed AWS CLI model index to enumerate services, operations, paginators, waiters, skeletons, inputs, and outputs. Nothing is guessed from a service name.</p><button type="button" className="aws-choice-button" onClick={() => void refresh()} disabled={!onRefresh || refreshing}>{onRefresh ? 'Load installed models' : 'Model loader unavailable'}</button></div> : <>
        <div className="aws-catalog-meta"><span>CLI {catalog.cliVersion}</span><span>Revision {catalog.revision}</span><span>Loaded {new Date(catalog.loadedAt).toLocaleString()}</span><span>{catalog.services.length} services</span></div>
        <div className="aws-tabs" role="tablist" aria-label="AWS manager sections">{(['command', 'input', 'preview', 'output'] as Tab[]).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item === 'command' ? 'Service & command' : item === 'input' ? 'Typed input' : item === 'preview' ? 'Risk preview' : 'Output'}</button>)}</div>
        {tab === 'command' && <div className="aws-command-layout"><aside className="aws-catalog-column"><h3>Services</h3><SearchField label="Search services" search={serviceSearch} inputRef={serviceInputRef} />{services.length === 0 && <p className="aws-muted">No services match. Refresh the installed model catalog if the service was added recently.</p>}{services.map((service) => <button type="button" className={`aws-list-item${selectedService?.id === service.id ? ' is-selected' : ''}`} key={service.id} onClick={() => selectService(service)}><strong>{service.label}</strong><small>{service.id} · {service.commands.length} operations</small></button>)}</aside><section className="aws-command-column"><h3>{selectedService ? selectedService.label : 'Choose a service'}</h3>{selectedService && <><SearchField label="Search operations" search={operationSearch} inputRef={operationInputRef} />{operations.length === 0 && <p className="aws-muted">No operations match this search.</p>}{operations.map((operation) => <button type="button" className={`aws-list-item aws-operation-item${selectedOperation?.id === operation.id ? ' is-selected' : ''}`} key={operation.id} onClick={() => selectOperation(operation)}><span><strong>{operation.label}</strong><small>{operation.id}</small></span><span className={`aws-risk-chip aws-risk-chip--${operation.risk}`}>{operation.risk}</span></button>)}</>}</section></div>}
        {tab === 'input' && <section className="aws-form-surface"><div className="aws-form-grid"><label className="aws-field"><span>Profile</span><input value={settings.profile ?? ''} onChange={(e) => updateSettings({ profile: e.target.value || undefined })} placeholder="Configured default" /></label><label className="aws-field"><span>Region</span><input value={settings.region ?? ''} onChange={(e) => updateSettings({ region: e.target.value || undefined })} placeholder="Configured default" /></label><label className="aws-field"><span>Endpoint URL</span><input value={settings.endpointUrl ?? ''} onChange={(e) => updateSettings({ endpointUrl: e.target.value || undefined })} placeholder="Optional HTTPS endpoint" /></label><label className="aws-field"><span>Retries</span><input type="number" min={0} max={5} value={settings.retryAttempts} onChange={(e) => updateSettings({ retryAttempts: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} /></label><label className="aws-field"><span>Output mode</span><select value={settings.outputMode} onChange={(e) => updateSettings({ outputMode: e.target.value as AwsInvocationSettings['outputMode'] })}>{['json', 'yaml', 'yaml-stream', 'text', 'table'].map((mode) => <option key={mode}>{mode}</option>)}</select></label></div>{catalog.globalOptions.length > 0 && <section className="aws-global-options"><h3>Global CLI options</h3>{catalog.globalOptions.map((option) => <label className="aws-field" key={option.name}><span>{option.label}</span>{option.documentation && <small>{option.documentation}</small>}{optionInput(option, settings.globalOptions[option.name], (value) => updateSettings({ globalOptions: { ...settings.globalOptions, [option.name]: value } }), option.kind === 'file' ? async () => { const picked = await onPickFile?.({ name: option.name, label: option.label, shape: { kind: 'file' } }); if (picked) updateSettings({ globalOptions: { ...settings.globalOptions, [option.name]: picked } }); return picked } : undefined)}</label>)}</section>}{selectedOperation ? <><h3>{selectedOperation.label} input</h3>{selectedOperation.documentation && <p className="aws-muted">{selectedOperation.documentation}</p>}{selectedOperation.input ? <ShapeEditor shape={selectedOperation.input} field={{ name: 'input', label: 'Input', shape: selectedOperation.input }} value={settings.input} onChange={(value) => updateSettings({ input: (value as JsonRecord) ?? {} })} onPickFile={async (field) => { const picked = await onPickFile?.(field); if (picked) updateSettings({ input: updatePath(settings.input, [field.name], picked) }) }} /> : <p className="aws-muted">This operation has no request body.</p>}{selectedOperation.paginators.length > 0 && <label className="aws-field"><span>Pagination</span><select value={settings.paginatorId ?? ''} onChange={(e) => updateSettings({ paginatorId: e.target.value || undefined })}><option value="">Do not paginate</option>{selectedOperation.paginators.map((p) => <option key={p.id} value={p.id}>{p.label}{p.pageSizeParam ? ` · ${p.pageSizeParam}` : ''}</option>)}</select></label>}{selectedOperation.waiters.length > 0 && <label className="aws-field"><span>Waiter</span><select value={settings.waiterId ?? ''} onChange={(e) => updateSettings({ waiterId: e.target.value || undefined })}><option value="">No waiter</option>{selectedOperation.waiters.map((w: AwsWaiterModel) => <option key={w.id} value={w.id}>{w.label} · {w.maxAttempts} attempts · {w.delaySeconds}s</option>)}</select></label>}{selectedOperation.supportsSkeleton && <><label className="aws-field"><span>CLI skeleton</span><select value={settings.skeleton} onChange={(e) => updateSettings({ skeleton: e.target.value as AwsInvocationSettings['skeleton'] })}><option value="none">Run operation</option><option value="input">Generate input skeleton</option><option value="output">Generate output skeleton</option></select></label>{settings.skeleton !== 'none' && <pre className="aws-argv-preview" aria-label="Generated CLI skeleton">{JSON.stringify(settings.skeleton === 'input' ? selectedOperation.skeletonInput : selectedOperation.skeletonOutput, null, 2)}</pre>}</>}</> : <p className="aws-muted">Choose an operation first. Its typed fields will be generated from the installed model.</p>}</section>}
        {tab === 'preview' && <section className="aws-form-surface"><PreviewCard preview={preview} reviewed={reviewed} onReviewed={setReviewed} />{selectedOperation?.jmesPathFields && selectedOperation.jmesPathFields.length > 0 && <label className="aws-field"><span>Result filter, guided JMESPath</span><select value={settings.jmesPath ?? ''} onChange={(e) => updateSettings({ jmesPath: e.target.value || undefined })}><option value="">Show complete output</option>{selectedOperation.jmesPathFields.map((path) => <option key={path} value={path}>{path}</option>)}</select><small>The filter is selected from output fields declared by the installed model.</small></label>}{validation.length > 0 && <div className="aws-validation" role="alert">{validation.map((message) => <p key={message}>{message}</p>)}</div>}<div className="aws-action-row"><button type="button" className="aws-primary-button" disabled={!onInvoke || busy || !preview || validation.length > 0 || !reviewed} onClick={() => void run()}>{busy ? phase : 'Run typed operation'}</button>{busy && <button type="button" className="aws-choice-button" onClick={cancel}>Cancel</button>}</div>{error && <p className="aws-error" role="alert">{error}</p>}<p className="aws-status-line" aria-live="polite">{phase}</p></section>}
        {tab === 'output' && <section className="aws-output-surface"><div className="aws-output-header"><h3>Output</h3>{result && <span>{result.pages} pages · {result.attempts} attempts · {result.durationMs} ms</span>}</div>{result ? <><pre className="aws-output" tabIndex={0}>{result.rawOutput ?? JSON.stringify(result.output, null, 2)}</pre><p className="aws-muted">Output is shown locally. Secrets, credentials, and local paths are excluded from status records and exports.</p></> : <p className="aws-muted">Run an operation to see its output here. Streaming output and cancellation status will remain visible while the host callback is active.</p>}</section>}
      </>}
    </section>
  )
}
