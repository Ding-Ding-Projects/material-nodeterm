import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CloudflareApi,
  CloudflareCatalog,
  CloudflareExecutionProgress,
  CloudflareExecutionRequest,
  CloudflareFieldModel,
  CloudflareLocalBinding,
  CloudflareManagerKind,
  CloudflarePortableIntent,
  CloudflareResourceSummary
} from '@shared/cloudflare-zero-trust'
import { CLOUDFLARE_CATALOG, emptyCloudflarePortableIntent, managerById, operationById, validateCloudflareValue } from '@shared/cloudflare-zero-trust'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../state/destructiveGate'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import './cloudflare-zero-trust.css'

export interface CloudflareZeroTrustPanelProps {
  nodeId: string
  intent: CloudflarePortableIntent
  onIntentChange: (intent: CloudflarePortableIntent) => void
  client?: CloudflareApi
  unavailableReason?: string
}

function fieldValue(value: unknown): string | number | boolean | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined
}

function SearchField({ id, label, search, inputRef }: { id: string; label: string; search: ReturnType<typeof useRegexSearchField>; inputRef: React.RefObject<HTMLInputElement> }): React.JSX.Element {
  return <div className="cloudflare-zero-trust__search"><Input ref={inputRef} id={id} type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={label} aria-label={label} /><AnchoredRegexBuilder search={search} fieldRef={inputRef} label={`Regex builder for ${label}`} /></div>
}

function FieldEditor({ field, value, resources, onChange, localFile, onFile }: { field: CloudflareFieldModel; value: string | number | boolean | undefined; resources: readonly CloudflareResourceSummary[]; onChange: (value: string | number | boolean | undefined) => void; localFile?: string; onFile: (path: string) => void }): React.JSX.Element {
  if (field.kind === 'boolean') return <label className="cloudflare-zero-trust__boolean"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span><strong>{field.label}</strong><small>{field.description}</small></span></label>
  if (field.kind === 'enum') return <label className="cloudflare-zero-trust__field"><span>{field.label}</span><select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">Choose {field.label.toLowerCase()}…</option>{field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select><small>{field.description}</small></label>
  if (field.kind === 'file') return <label className="cloudflare-zero-trust__field"><span>{field.label}</span><input type="file" accept=".js,.mjs,.ts,.txt" onChange={(event) => { const file = event.target.files?.[0] as (File & { path?: string }) | undefined; if (file?.path) onFile(file.path) }} /><small>{localFile ? `Selected: ${localFile.split(/[\\/]/u).pop() ?? localFile}` : field.description}</small></label>
  const isResourceField = field.id.endsWith('Id') || ['scriptName', 'projectName', 'queueName'].includes(field.id)
  const resource = resources.find((item) => isResourceField && item.id === value)
  if (resource || (isResourceField && resources.length > 0)) return <label className="cloudflare-zero-trust__field"><span>{field.label}</span><select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">Choose {field.label.toLowerCase()}…</option>{resources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>{field.description}</small></label>
  return <label className="cloudflare-zero-trust__field"><span>{field.label}</span><Input type={field.kind === 'integer' ? 'number' : 'text'} value={value === undefined ? '' : String(value)} placeholder={field.placeholder} onChange={(event) => onChange(field.kind === 'integer' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} /><small>{field.description}</small></label>
}

export function CloudflareZeroTrustPanel({ nodeId, intent, onIntentChange, client = window.nodeTerminal.cloudflareZeroTrust, unavailableReason }: CloudflareZeroTrustPanelProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [catalog, setCatalog] = useState<CloudflareCatalog>(CLOUDFLARE_CATALOG)
  const [accounts, setAccounts] = useState<Awaited<ReturnType<CloudflareApi['accounts']>>>([])
  const [binding, setBinding] = useState<CloudflareLocalBinding>({})
  const [resources, setResources] = useState<readonly CloudflareResourceSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloudflareExecutionProgress | null>(null)
  const [result, setResult] = useState<{ summary: string; resultCount: number; outputPreview?: string } | null>(null)
  const [accountLabel, setAccountLabel] = useState('')
  const [accountId, setAccountId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [localFiles, setLocalFiles] = useState<Record<string, string>>({})
  const managerSearch = useRegexSearchField()
  const managerSearchRef = useRef<HTMLInputElement>(null)
  const operationSearch = useRegexSearchField()
  const operationSearchRef = useRef<HTMLInputElement>(null)
  const resourceSearch = useRegexSearchField()
  const resourceSearchRef = useRef<HTMLInputElement>(null)
  const running = !!progress && !['complete', 'failed', 'cancelled'].includes(progress.phase)
  const manager = managerById(intent.manager)
  const operation = operationById(intent.manager, intent.operation)
  const visibleManagers = useMemo(() => catalog.managers.filter((item) => managerSearch.test(`${item.label} ${item.id} ${item.description}`)), [catalog.managers, managerSearch])
  const visibleOperations = useMemo(() => (manager?.operations ?? []).filter((item) => operationSearch.test(`${item.label} ${item.id} ${item.description}`)), [manager?.operations, operationSearch])
  const visibleResources = useMemo(() => resources.filter((item) => resourceSearch.test(`${item.label} ${item.id} ${item.kind}`)), [resources, resourceSearch])

  const reload = async (): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      const [nextCatalog, nextAccounts, nextBinding] = await Promise.all([client.catalog(), client.accounts(), client.binding(nodeId)])
      setCatalog(nextCatalog)
      setAccounts(nextAccounts)
      setBinding(nextBinding)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  useEffect(() => { void reload() }, [client, nodeId])
  useEffect(() => {
    if (!client || !intent.manager) { setResources([]); return }
    void client.resources(nodeId, intent.manager).then(setResources).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [client, nodeId, intent.manager, intent.operation])

  const saveAccount = async (): Promise<void> => {
    if (!client) return
    setError(null)
    try {
      const saved = await client.configure({ label: accountLabel, accountId, apiToken })
      const next = { accountId: saved.accountId, credentialRef: `cloudflare-account:${saved.id}` }
      setBinding(next)
      await client.saveBinding(nodeId, next)
      setApiToken('')
      setAccountLabel('')
      setAccountId('')
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const selectManager = (next: CloudflareManagerKind): void => onIntentChange({ ...emptyCloudflarePortableIntent(), manager: next })
  const selectOperation = (next: string): void => onIntentChange({ ...intent, operation: next, values: {} })
  const updateValue = (fieldId: string, value: string | number | boolean | undefined): void => onIntentChange({ ...intent, values: { ...intent.values, ...(value === undefined || value === '' ? (() => { const copy = { ...intent.values }; delete copy[fieldId]; return copy })() : { [fieldId]: value }) } })

  const buildRequest = (confirmed: boolean): CloudflareExecutionRequest | null => {
    if (!manager || !operation || !binding.accountId) return null
    const errors = operation.fields.map((field) => validateCloudflareValue(field, field.kind === 'file' ? localFiles[field.id] : intent.values[field.id])).filter(Boolean)
    if (errors.length) { setError(errors[0] ?? 'Complete the typed operation fields.'); return null }
    return { intent, localFiles, preview: { manager: manager.id, operation: operation.id, accountId: binding.accountId, method: operation.method, route: operation.route, risk: operation.risk, fields: intent.values, omissions: ['credential and provider session', 'machine-local file paths', 'runtime progress and response cache'], confirmed } }
  }

  const execute = async (request: CloudflareExecutionRequest): Promise<void> => {
    if (!client) return
    setBusy(true)
    setError(null)
    setResult(null)
    setProgress({ phase: 'preparing', message: 'Preparing the typed Cloudflare operation.' })
    try { const completed = await client.execute(nodeId, request, setProgress); setResult(completed); setProgress({ phase: 'complete', message: completed.summary, completed: completed.resultCount, total: completed.resultCount }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setProgress({ phase: 'failed', message: cause instanceof Error ? cause.message : String(cause) }) }
    finally { setBusy(false) }
  }

  const start = (): void => {
    const request = buildRequest(false)
    if (!request || !operation) return
    if (operation.risk === 'destructive') openDestructiveGate({ title: `Review ${operation.label}`, description: 'This Cloudflare action can permanently change or remove provider resources. Both keys and the full slider are required.', affected: [operation.label, binding.accountId ?? 'Account not selected'], confirmLabel: operation.label, onConfirm: () => { const confirmed = buildRequest(true); if (confirmed) void execute(confirmed) } })
    else void execute(request)
  }

  if (!client) return <div className="cloudflare-zero-trust cloudflare-zero-trust--unavailable" role="status"><h3>{vocab('Cloudflare manager')}</h3><p>{unavailableReason ?? vocab('The local Cloudflare manager is unavailable on this surface.')}</p></div>
  return <div className="cloudflare-zero-trust nodrag" aria-label={vocab('Cloudflare Access and Zero Trust managers')}>
    <header className="cloudflare-zero-trust__header"><div><h3>{vocab('Cloudflare managers')}</h3><p>{catalog.apiVersion} · {catalog.managers.length} typed manager families · credentials stay in local secure storage</p></div><Button variant="outlined" disabled={busy || running} onClick={() => void reload()}>{busy ? vocab('Refreshing…') : vocab('Refresh')}</Button></header>
    <section className="cloudflare-zero-trust__account" aria-label="Cloudflare account binding"><h4>{vocab('Account binding')}</h4><div className="cloudflare-zero-trust__account-row"><select aria-label="Cloudflare account" value={binding.accountId ?? ''} disabled={busy || running} onChange={(event) => { const account = accounts.find((item) => item.accountId === event.target.value); const next = account ? { accountId: account.accountId, credentialRef: `cloudflare-account:${account.id}` } : {}; setBinding(next); void client.saveBinding(nodeId, next).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))) }}><option value="">Choose a connected account…</option>{accounts.map((account) => <option key={account.id} value={account.accountId}>{account.label} · {account.accountId}</option>)}</select><Input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} placeholder="Account label" aria-label="New account label" /><Input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="32-character account id" aria-label="New account id" /><Input type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder="API token, stored locally" aria-label="Cloudflare API token" /><Button disabled={!accountLabel || !accountId || !apiToken || busy} onClick={() => void saveAccount()}>{vocab('Save account')}</Button></div><p className="cloudflare-zero-trust__hint">{vocab('The token is used only by the trusted local core and is never written to project files, logs, exports, or request previews.')}</p></section>
    <section className="cloudflare-zero-trust__chooser"><div><label htmlFor={`${nodeId}-cloudflare-managers`}>{vocab('Manager families')}</label><SearchField id={`${nodeId}-cloudflare-managers`} label="Search Cloudflare managers" search={managerSearch} inputRef={managerSearchRef} /><div className="cloudflare-zero-trust__choices" role="listbox" aria-label="Cloudflare manager families">{visibleManagers.map((item) => <button key={item.id} type="button" role="option" aria-selected={item.id === intent.manager} className={item.id === intent.manager ? 'selected' : ''} disabled={running} onClick={() => selectManager(item.id)}><strong>{item.label}</strong><small>{item.description}</small></button>)}</div></div><div><label htmlFor={`${nodeId}-cloudflare-operations`}>{vocab('Typed operations')}</label><SearchField id={`${nodeId}-cloudflare-operations`} label="Search typed Cloudflare operations" search={operationSearch} inputRef={operationSearchRef} /><div className="cloudflare-zero-trust__choices" role="listbox" aria-label="Typed Cloudflare operations">{visibleOperations.map((item) => <button key={item.id} type="button" role="option" aria-selected={item.id === intent.operation} className={item.id === intent.operation ? 'selected' : ''} disabled={running} onClick={() => selectOperation(item.id)}><strong>{item.label}</strong><small>{item.description} · {item.risk}</small></button>)}</div></div></section>
    {operation?.fields.some((field) => field.id.endsWith('Id') || ['scriptName', 'projectName', 'queueName'].includes(field.id)) ? <section className="cloudflare-zero-trust__resources"><div><h4>{vocab('Verified resources')}</h4><SearchField id={`${nodeId}-cloudflare-resources`} label="Search verified Cloudflare resources" search={resourceSearch} inputRef={resourceSearchRef} /></div><div className="cloudflare-zero-trust__resource-list" role="listbox" aria-label="Verified Cloudflare resources">{visibleResources.length ? visibleResources.map((item) => <button type="button" key={item.id} role="option" onClick={() => { const key = operation.fields.find((field) => field.id.endsWith('Id') || ['scriptName', 'projectName', 'queueName'].includes(field.id))?.id; if (key) updateValue(key, item.id) }}>{item.label}<small>{item.id}</small></button>) : <p>{vocab('No verified resources are available. Refresh the account or complete a read operation first.')}</p>}</div></section> : null}
    {operation ? <section className="cloudflare-zero-trust__fields" aria-label={operation.label}><h4>{operation.label}</h4><p>{operation.description}</p>{operation.fields.map((field) => <FieldEditor key={field.id} field={field} value={fieldValue(intent.values[field.id])} resources={visibleResources} localFile={localFiles[field.id]} onChange={(value) => updateValue(field.id, value)} onFile={(file) => setLocalFiles((current) => ({ ...current, [field.id]: file }))} />)}</section> : null}
    {error ? <p className="cloudflare-zero-trust__error" role="alert">{error}</p> : null}{progress ? <section className="cloudflare-zero-trust__progress" role="status" aria-live="polite"><strong>{progress.message}</strong><span>{progress.phase}{progress.completed !== undefined && progress.total !== undefined ? ` · ${progress.completed}/${progress.total}` : ''}</span><progress max={progress.total} value={progress.completed} /></section> : null}{result ? <section className="cloudflare-zero-trust__result" role="status"><strong>{result.summary}</strong><span>{result.resultCount} result(s)</span>{result.outputPreview ? <pre>{result.outputPreview}</pre> : null}</section> : null}
    <footer className="cloudflare-zero-trust__actions"><p>{vocab('Import and export carry manager and field intent only. Account credentials, provider sessions, resource ids, local files, caches, and runtime state remain on this computer.')}</p>{running ? <Button variant="outlined" danger onClick={() => void client.cancel(nodeId)}>{vocab('Cancel operation')}</Button> : null}<Button disabled={!operation || !binding.accountId || busy || running} danger={operation?.risk === 'destructive'} onClick={start}>{operation?.risk === 'destructive' ? vocab('Review destructive action') : vocab('Run typed operation')}</Button></footer>
  </div>
}
