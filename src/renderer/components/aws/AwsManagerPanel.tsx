import { useEffect, useMemo, useRef, useState } from 'react'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { useActiveSessionApi } from '../../session/session'
import { DestructiveConfirmGate } from '../DestructiveConfirmGate'
import { Button, Checkbox, SearchField } from '../../ui/md3'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { AWS_SERVICE_KINDS, AWS_SERVICE_LABELS, type AwsExecutionPreview, type AwsFieldSpec, type AwsInventoryPage, type AwsOperationInput, type AwsOperationSpec, type AwsResourceRecord, type AwsServiceKind } from '@shared/aws'

export interface AwsManagerPanelProps { onClose?: () => void }

function Field({ spec, value, onChange }: { spec: AwsFieldSpec; value: unknown; onChange: (value: unknown) => void }): React.JSX.Element {
  if (spec.type === 'boolean') return <label className="aws-manager__check"><Checkbox checked={value === true} onChange={(event) => onChange(event.target.checked)} />{spec.label}<small>{spec.description}</small></label>
  if (spec.type === 'enum') return <label className="aws-manager__field"><span>{spec.label}</span><Select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}><option value="">Choose {spec.label.toLowerCase()}</option>{spec.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select><small>{spec.description}</small></label>
  const inputType = spec.type === 'number' ? 'number' : spec.type === 'date' ? 'date' : spec.type === 'time' ? 'time' : 'text'
  return <label className="aws-manager__field"><span>{spec.label}{spec.required ? ' *' : ''}</span><Input type={inputType} value={String(value ?? '')} min={spec.min} max={spec.max} onChange={(event) => onChange(spec.type === 'number' ? Number(event.target.value) : event.target.value)} /><small>{spec.description}</small></label>
}

function resourceText(resource: AwsResourceRecord): string { return `${resource.name} ${resource.kind} ${resource.status} ${resource.region}` }

/**
 * The ECR/ECS/EKS/RDS/database/VPC/Route 53/cost surface. All operations originate in the typed
 * operation catalog, and the panel asks the trusted core for previews before any mutation. A
 * browser relay receives the explicit unsupported response rather than using this computer's AWS
 * profile.
 */
export function AwsManagerPanel({ onClose }: AwsManagerPanelProps): React.JSX.Element {
  const api = useActiveSessionApi().aws
  const [service, setService] = useState<AwsServiceKind>('ecr')
  const [operations, setOperations] = useState<AwsOperationSpec[]>([])
  const [operationId, setOperationId] = useState('')
  const [values, setValues] = useState<Record<string, unknown>>({ region: 'us-east-1' })
  const [profile, setProfile] = useState('')
  const [inventory, setInventory] = useState<AwsInventoryPage | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [preview, setPreview] = useState<AwsExecutionPreview | null>(null)
  const [bulkPreview, setBulkPreview] = useState<{ affectedCount: number; summary: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const [runningOperationId, setRunningOperationId] = useState<string | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    if (!api) return () => { active = false }
    void api.forms(service).then((forms) => { if (active) { setOperations(forms); setOperationId(forms[0]?.id ?? '') } }).catch((error) => { if (active) setMessage(String(error)) })
    return () => { active = false }
  }, [api, service])

  useEffect(() => api?.onEvent((event) => setEvents((current) => [`${event.kind}: ${event.operationId}`, ...current].slice(0, 8))) ?? (() => {}), [api])

  const operation = operations.find((candidate) => candidate.id === operationId) ?? null
  const visibleItems = useMemo(() => (inventory?.items ?? []).filter((item) => search.test(resourceText(item))), [inventory, search])
  const setField = (key: string, value: unknown): void => setValues((current) => ({ ...current, [key]: value }))
  const context = { region: String(values.region ?? ''), ...(profile.trim() ? { profile: profile.trim() } : {}) }
  const input: AwsOperationInput | null = operation ? { operationId: operation.id, context, values } : null

  const loadInventory = async (): Promise<void> => {
    if (!api) return setMessage('AWS managers are unavailable for this session.')
    setMessage('Loading inventory…')
    const result = await api.inventory({ service, region: context.region, profile: context.profile })
    setInventory(result); setSelected([]); setMessage(result.permission.detail)
  }
  const loadNextPage = async (): Promise<void> => {
    if (!api || !inventory?.nextToken) return
    const result = await api.inventory({ service, region: context.region, profile: context.profile, continuationToken: inventory.nextToken, page: inventory.page + 1 })
    setInventory({ ...result, items: [...inventory.items, ...result.items] }); setMessage(result.permission.detail)
  }
  const makePreview = async (): Promise<void> => {
    if (!api || !input) return
    try { setPreview(await api.preview(input)); setMessage('Review the generated operation before running it.') } catch (error) { setMessage(String(error)) }
  }
  const run = async (): Promise<void> => {
    if (!api || !input) return
    setMessage('Running…'); setRunningOperationId(input.operationId)
    try {
      const result = await api.execute(input)
      setMessage(result.ok ? 'Operation completed.' : result.permission.detail)
      setPreview(null); setConfirming(false)
    } finally { setRunningOperationId(null) }
  }
  const makeBulkPreview = async (): Promise<void> => {
    if (!api || !input || selected.length === 0) return setMessage('Select one or more inventory rows first.')
    try { const result = await api.bulkPreview(input, selected); setBulkPreview(result); setMessage(result.summary) } catch (error) { setMessage(String(error)) }
  }

  if (!api) return <section className="aws-manager"><header><h2>AWS managers</h2>{onClose && <Button variant="text" onClick={onClose}>Close</Button>}</header><p className="aws-manager__notice">AWS managers are unavailable for this project session. Choose a local AWS session to configure them.</p></section>
  return <section className="aws-manager" aria-label="AWS service managers">
    <header className="aws-manager__header"><div><h2>AWS service managers</h2><p>Typed ECR, ECS, EKS, RDS, database, VPC, Route 53, and cost operations.</p></div>{onClose && <Button variant="text" onClick={onClose}>Close</Button>}</header>
    <div className="aws-manager__toolbar">
      <label><span>Service</span><Select value={service} onChange={(event) => { setService(event.target.value as AwsServiceKind); setInventory(null); setSelected([]) }}>{AWS_SERVICE_KINDS.map((kind) => <option key={kind} value={kind}>{AWS_SERVICE_LABELS[kind]}</option>)}</Select></label>
      <label><span>Profile</span><Input value={profile} placeholder="Use environment credentials" onChange={(event) => setProfile(event.target.value)} /></label>
      <label><span>Region</span><Input value={String(values.region ?? '')} onChange={(event) => setField('region', event.target.value)} /></label>
      <Button variant="tonal" onClick={() => void loadInventory()}>Refresh inventory</Button>{inventory?.nextToken && <Button variant="outlined" onClick={() => void loadNextPage()}>Load next page</Button>}
    </div>
    <div className="aws-manager__search"><SearchField ref={searchInputRef} value={search.value} placeholder="Search inventory (plain text)" onChange={(event) => search.setValue(event.target.value)} aria-label="Search AWS inventory" aria-describedby="aws-search-note" trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — AWS inventory" />} /><small id="aws-search-note">Plain text is the default. Regex is an explicit opt-in and stays attached to this list.</small></div>
    <div className="aws-manager__body">
      <div className="aws-manager__operations"><h3>Operation</h3><Select value={operationId} aria-label="AWS operation" onChange={(event) => { setOperationId(event.target.value); setPreview(null) }}>{operations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.risk}</option>)}</Select>{operation && <><p>{operation.description}</p>{operation.fields.map((spec) => <Field key={spec.key} spec={spec} value={values[spec.key]} onChange={(value) => setField(spec.key, value)} />)}<div className="aws-manager__actions"><Button variant="tonal" onClick={() => void makePreview()} disabled={!input}>Preview operation</Button><Button variant="outlined" onClick={() => void makeBulkPreview()} disabled={selected.length === 0 || !input}>Preview bulk ({selected.length})</Button></div></>}</div>
      <div className="aws-manager__inventory"><h3>Inventory {inventory && <small>({visibleItems.length})</small>}</h3>{inventory?.permission.state !== 'granted' && inventory && <p className="aws-manager__warning">{inventory.permission.state}: {inventory.permission.detail}</p>}{visibleItems.length === 0 ? <p className="aws-manager__empty">No resources are loaded for this service, or the search has no matches.</p> : <ul>{visibleItems.map((resource) => <li key={resource.id} className={resource.partial ? 'partial' : ''}><label><Checkbox checked={selected.includes(resource.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id))} /><span><strong>{resource.name}</strong><small>{resource.status} · {resource.region}{resource.partial ? ' · partial permissions' : ''}</small></span></label></li>)}</ul>}</div>
    </div>
    {message && <p className="aws-manager__status" role="status">{message}{runningOperationId && <Button variant="text" size="small" onClick={() => void api.cancel(runningOperationId)}>Cancel operation</Button>}</p>}
    {events.length > 0 && <details className="aws-manager__events"><summary>Live operation status</summary><ul>{events.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)}</ul></details>}
    {preview && <div className="aws-manager__preview"><h3>Review operation</h3><p>{preview.operation.label} · {preview.risk}</p><p>Region: {preview.context.region}{preview.context.profile ? ` · Profile: ${preview.context.profile}` : ''}</p><code>{preview.argv.join(' ')}</code><p>Credentials stay in the local AWS credential chain and are never sent to the renderer.</p><Button variant="filled" danger={preview.risk === 'destructive'} onClick={() => preview.risk === 'destructive' ? setConfirming(true) : void run()}>{preview.risk === 'destructive' ? 'Continue to confirmation' : 'Run operation'}</Button></div>}
    {bulkPreview && <div className="aws-manager__preview"><h3>Review bulk operation</h3><p>{bulkPreview.summary}</p><p>{bulkPreview.affectedCount} selected resource(s) will be processed. Partial results remain visible.</p><Button variant="outlined" onClick={() => { setBulkPreview(null); setMessage('Bulk execution is available after the destructive confirmation step.') }}>Keep preview</Button><Button variant="filled" onClick={() => { setBulkPreview(null); setMessage('Bulk operation is ready to run from the preview.') }}>Continue</Button></div>}
    {confirming && preview && <DestructiveConfirmGate title={`Run ${preview.operation.label}`} description="This AWS operation changes provider state. Review the exact operation and selected resource before confirming." affected={selected} confirmLabel="Run destructive operation" onConfirm={() => void run()} onCancel={() => setConfirming(false)} />}
  </section>
}
