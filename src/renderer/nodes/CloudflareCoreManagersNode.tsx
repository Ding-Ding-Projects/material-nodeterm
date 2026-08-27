import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { openDestructiveGate } from '../state/destructiveGate'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import {
  CLOUDFLARE_MANAGER_KINDS,
  CLOUDFLARE_OPERATION_LABELS,
  CLOUDFLARE_OPERATIONS_BY_MANAGER,
  normalizeCloudflareIntent,
  type CloudflareBinding,
  type CloudflareCredentialSummary,
  type CloudflareManagerKind,
  type CloudflareOperation,
  type CloudflareOperationRequest,
  type CloudflareOperationResult,
  type CloudflarePortableIntent
} from '@shared/cloudflare-core-managers'
import type { CanvasNode } from '../state/workspace'
import { TunnelStatePanel } from '../components/tunnel/TunnelStatePanel'
import {
  DEFAULT_TUNNEL_PORTABLE_INTENT,
  type TunnelFacet,
  type TunnelLiveState,
  type TunnelPortableIntent
} from '@shared/tunnel-state'

const FIELD_NAMES: Partial<Record<CloudflareOperation, string[]>> = {
  'account-get': ['accountId'],
  'zone-list': ['name'], 'zone-get': ['zoneId'],
  'dns-list-records': ['name', 'type'], 'dns-create-record': ['name', 'type', 'content', 'ttl', 'proxied'],
  'dns-update-record': ['recordId', 'name', 'type', 'content', 'ttl', 'proxied'], 'dns-delete-record': ['recordId'],
  'ssl-get-setting': ['settingId'], 'ssl-update-setting': ['settingId', 'value'],
  'ruleset-get': ['rulesetId'], 'ruleset-create': ['name', 'description', 'kind', 'phase', 'expression', 'action'],
  'ruleset-update': ['rulesetId', 'name', 'description', 'expression', 'action'], 'ruleset-delete': ['rulesetId'],
  'redirect-create': ['expression', 'targetUrl', 'statusCode', 'enabled'], 'redirect-update': ['rulesetId', 'expression', 'targetUrl', 'statusCode', 'enabled'], 'redirect-delete': ['rulesetId'],
  'cache-update-settings': ['settingId', 'value'], 'cache-purge': ['urls', 'purgeEverything'],
  'analytics-dashboard': ['since', 'until'], 'analytics-events': ['dataset', 'since', 'until']
}

const DESTRUCTIVE = new Set<CloudflareOperation>(['dns-delete-record', 'ruleset-delete', 'redirect-delete', 'cache-purge'])

function rowText(row: Record<string, unknown>): string {
  return Object.values(row).map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
}

export default function CloudflareCoreManagersNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { updateNodeData } = useReactFlow()
  const intent = normalizeCloudflareIntent(data.cloudflareCoreIntent ?? { schemaVersion: 1, manager: 'account', operation: 'account-list', input: {} })
  const [manager, setManager] = useState<CloudflareManagerKind>(intent.manager)
  const [operation, setOperation] = useState<CloudflareOperation>(intent.operation)
  const [input, setInput] = useState<Record<string, unknown>>(intent.input ?? {})
  const [credentials, setCredentials] = useState<CloudflareCredentialSummary[]>([])
  const [credentialLabel, setCredentialLabel] = useState('')
  const [credentialToken, setCredentialToken] = useState('')
  const [credentialId, setCredentialId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [zoneName, setZoneName] = useState('')
  const [binding, setBinding] = useState<CloudflareBinding | null>(null)
  const [runtime, setRuntime] = useState('Checking Cloudflare API client…')
  const [result, setResult] = useState<CloudflareOperationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [operationState, setOperationState] = useState('')
  const accountSearch = useRegexSearchField()
  const zoneSearch = useRegexSearchField()
  const dnsSearch = useRegexSearchField()
  const sslSearch = useRegexSearchField()
  const rulesetSearch = useRegexSearchField()
  const redirectSearch = useRegexSearchField()
  const cacheSearch = useRegexSearchField()
  const analyticsSearch = useRegexSearchField()
  const operationSearch = useRegexSearchField()
  const credentialSearch = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const operationSearchRef = useRef<HTMLInputElement>(null)
  const credentialSearchRef = useRef<HTMLInputElement>(null)
  const api = window.nodeTerminal.cloudflareCoreManagers
  const tunnelIntent: TunnelPortableIntent = data.cloudflareTunnelIntent ?? {
    ...DEFAULT_TUNNEL_PORTABLE_INTENT,
    nodeId: id,
    displayName: 'Cloudflare Tunnel'
  }
  const [tunnelState, setTunnelState] = useState<TunnelLiveState | null>(null)
  const operations = CLOUDFLARE_OPERATIONS_BY_MANAGER[manager]
  const fields = FIELD_NAMES[operation] ?? []
  const resultSearch = { account: accountSearch, zone: zoneSearch, dns: dnsSearch, 'ssl-tls': sslSearch, ruleset: rulesetSearch, redirect: redirectSearch, cache: cacheSearch, analytics: analyticsSearch }[manager]
  const visibleOperations = useMemo(() => operations.filter((item) => operationSearch.test(CLOUDFLARE_OPERATION_LABELS[item])), [operations, operationSearch])
  const operationChoices = visibleOperations.includes(operation) ? visibleOperations : [operation, ...visibleOperations]
  const visibleRows = useMemo(() => (result?.rows ?? []).filter((row) => resultSearch.test(rowText(row))), [result, resultSearch])
  const visibleCredentials = useMemo(() => credentials.filter((item) => credentialSearch.test(`${item.label} ${item.accountId ?? ''}`)), [credentials, credentialSearch])
  const credentialReady = Boolean(credentialId || credentials.length > 0)
  const bindingRequired = !['account-list', 'zone-list'].includes(operation)

  const persistIntent = (next: Partial<CloudflarePortableIntent>): void => {
    const nextIntent: CloudflarePortableIntent = { ...intent, manager, operation, input: input as CloudflarePortableIntent['input'], ...next, schemaVersion: 1 }
    updateNodeData(id, { cloudflareCoreIntent: nextIntent })
  }

  useEffect(() => {
    if (!api) { setRuntime('Cloudflare manager is unavailable in this shell.'); return }
    let active = true
    void Promise.all([api.runtime(), api.credentials(), api.binding(id)]).then(([status, saved, current]) => {
      if (!active) return
      setRuntime(status.available ? `${status.origin}: ${status.version ?? 'Cloudflare API'}` : status.disabledReason ?? 'Cloudflare API unavailable')
      setCredentials(saved)
      setBinding(current)
      setCredentialId(current?.credentialId ?? saved[0]?.id ?? '')
      setAccountId(current?.accountId ?? intent.accountIdIntent ?? '')
      setZoneId(current?.zoneId ?? '')
      setZoneName(current?.zoneName ?? intent.zoneNameIntent ?? '')
    }).catch((cause) => active && setRuntime(cause instanceof Error ? cause.message : String(cause)))
    return () => { active = false }
  }, [api, id])

  useEffect(() => {
    if (!api) return
    return api.onProgress((progress) => { if (progress.nodeId === id) setOperationState(progress.message) })
  }, [api, id])

  useEffect(() => {
    if (!api?.tunnelState) return
    let active = true
    void api.tunnelState(id).then((state) => { if (active) setTunnelState(state) }).catch(() => { if (active) setTunnelState(null) })
    const unsubscribe = api.onTunnelState((state) => { if (state.nodeId === id) setTunnelState(state) })
    return () => { active = false; unsubscribe() }
  }, [api, id])

  const probeTunnelFacet = async (facet: TunnelFacet): Promise<void> => {
    if (!api?.probeTunnelFacet) return
    try { setTunnelState(await api.probeTunnelFacet(id, facet)) }
    catch { setTunnelState(await api.tunnelState(id)) }
  }

  const saveCredential = async (): Promise<void> => {
    if (!api) return
    setBusy(true); setError('')
    try {
      const saved = await api.saveCredential({ label: credentialLabel, token: credentialToken, accountId: accountId || null })
      setCredentials((current) => [...current.filter((item) => item.id !== saved.id), saved]); setCredentialId(saved.id); setCredentialLabel(''); setCredentialToken('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const saveBinding = async (): Promise<void> => {
    if (!api || !credentialId) return
    setBusy(true); setError('')
    try { setBinding(await api.bind({ nodeId: id, credentialId, accountId: accountId || null, zoneId: zoneId || null, zoneName: zoneName || null })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const run = async (): Promise<void> => {
    if (!api || !credentialReady || (bindingRequired && !binding)) { setError(bindingRequired ? 'Choose a local Cloudflare credential and account or zone first.' : 'Choose a local Cloudflare credential first.'); return }
    const operationInput: Record<string, unknown> = { ...input }
    if (operation === 'ruleset-create' || operation === 'ruleset-update' || operation === 'redirect-create' || operation === 'redirect-update') {
      operationInput.rules = [{
        expression: operationInput.expression ?? '',
        action: operationInput.action ?? (operation.startsWith('redirect-') ? 'redirect' : 'execute'),
        ...(operationInput.targetUrl ? { targetUrl: operationInput.targetUrl } : {}),
        ...(operationInput.statusCode ? { statusCode: operationInput.statusCode } : {}),
        ...(operationInput.enabled !== undefined ? { enabled: operationInput.enabled } : {})
      }]
    }
    const request: CloudflareOperationRequest = { manager, operation, credentialId: credentialId || credentials[0]?.id, input: operationInput, page: result?.nextPage ?? 1, perPage: 100 }
    setBusy(true); setError(''); setOperationState('Preparing operation preview…')
    try {
      const preview = await api.preview(id, request)
      const execute = async (): Promise<void> => {
        try { const next = await api.execute(id, request); setResult(next); setOperationState(next.summary) }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
      }
      if (preview.destructive) openDestructiveGate({ title: `Confirm ${CLOUDFLARE_OPERATION_LABELS[operation]}`, description: 'This Cloudflare operation changes provider state.', affected: [`${manager} · ${CLOUDFLARE_OPERATION_LABELS[operation]}`], confirmLabel: 'Run operation', onConfirm: () => void execute() })
      else await execute()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) }
  }

  const chooseManager = (next: CloudflareManagerKind): void => {
    const nextOperation = CLOUDFLARE_OPERATIONS_BY_MANAGER[next][0]
    setManager(next); setOperation(nextOperation); setInput({}); setResult(null); persistIntent({ manager: next, operation: nextOperation, input: {} })
  }

  return <div className="cloudflare-core-manager nodrag" aria-label="Cloudflare core managers">
    <NodeResizer minWidth={620} minHeight={560} isVisible={selected} color="#f38020" />
    <header className="cloudflare-core-manager__header"><strong>Cloudflare managers</strong><span>{runtime}</span></header>
    <section aria-label="Local Cloudflare credential">
      <h5>Local credential</h5>
      <div className="cloudflare-core-manager__search"><Input ref={credentialSearchRef} type="search" value={credentialSearch.value} onChange={(event) => credentialSearch.setValue(event.target.value)} aria-label="Search Cloudflare credentials" placeholder="Search credentials" /><AnchoredRegexBuilder search={credentialSearch} fieldRef={credentialSearchRef} label="Regex builder for Cloudflare credentials" /></div>
      <div role="listbox" aria-label="Cloudflare credentials">{visibleCredentials.length ? visibleCredentials.map((item) => <button key={item.id} role="option" aria-selected={credentialId === item.id} onClick={() => setCredentialId(item.id)}>{item.label}<small>{item.accountId ?? 'account selected after binding'}</small></button>) : <span>No local Cloudflare credentials are available.</span>}</div>
      <Input value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} aria-label="New credential label" placeholder="New credential label" />
      <Input type="password" value={credentialToken} onChange={(event) => setCredentialToken(event.target.value)} aria-label="New Cloudflare API token" placeholder="New token, held only in local secure storage" />
      <Button disabled={busy || !credentialLabel || !credentialToken} onClick={() => void saveCredential()}>Save local credential</Button>
      <Input value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Cloudflare account id" placeholder="Account id, optional for zone-only managers" />
      <Input value={zoneId} onChange={(event) => setZoneId(event.target.value)} aria-label="Cloudflare zone id" placeholder="Zone id, if known" />
      <Input value={zoneName} onChange={(event) => setZoneName(event.target.value)} aria-label="Cloudflare zone name" placeholder="Zone name, for rebind intent" />
      <Button disabled={busy || !credentialId || (!accountId && !zoneId && !zoneName)} onClick={() => void saveBinding()}>{binding ? 'Update binding' : 'Configure binding'}</Button>
      {binding ? <Button disabled={busy} onClick={() => void api?.unbind(id).then(() => setBinding(null))}>Leave unbound</Button> : null}
    </section>
    <div className="cloudflare-core-manager__tabs" role="tablist" aria-label="Cloudflare manager areas">{CLOUDFLARE_MANAGER_KINDS.map((item) => <button key={item} role="tab" aria-selected={manager === item} onClick={() => chooseManager(item)}>{item}</button>)}</div>
    <section aria-label="Guided Cloudflare operation">
      <label htmlFor={`${id}-operation`}>Operation</label>
      <select id={`${id}-operation`} value={operation} onChange={(event) => { const next = event.target.value as CloudflareOperation; setOperation(next); setInput({}); setResult(null); persistIntent({ operation: next, input: {} }) }}>{operationChoices.map((item) => <option key={item} value={item}>{CLOUDFLARE_OPERATION_LABELS[item]}</option>)}</select>
      {fields.map((field) => <Input key={field} type={field.toLowerCase().includes('token') ? 'password' : 'text'} value={String(input[field] ?? '')} onChange={(event) => { const raw = event.target.value; const next = { ...input, [field]: field === 'ttl' || field === 'statusCode' ? Number(raw) : field === 'proxied' || field === 'enabled' || field === 'purgeEverything' ? raw === 'true' : field === 'urls' ? raw.split(',').map((value) => value.trim()).filter(Boolean) : raw }; setInput(next); persistIntent({ input: next as CloudflarePortableIntent['input'] }) }} aria-label={field} placeholder={field} />)}
      <div className="cloudflare-core-manager__toolbar"><div className="cloudflare-core-manager__search"><Input ref={searchRef} type="search" value={resultSearch.value} onChange={(event) => resultSearch.setValue(event.target.value)} aria-label={`Search ${manager} results`} placeholder="Search results" /><AnchoredRegexBuilder search={resultSearch} fieldRef={searchRef} label={`Regex builder for ${manager} results`} /></div><Button disabled={busy || !credentialReady || (bindingRequired && !binding)} title={bindingRequired && !binding ? 'Configure a local Cloudflare credential and account or zone first.' : 'Preview and run the typed operation'} onClick={() => void run()}>{busy ? 'Running…' : 'Preview and run'}</Button></div>
      <div className="cloudflare-core-manager__search"><Input ref={operationSearchRef} type="search" value={operationSearch.value} onChange={(event) => operationSearch.setValue(event.target.value)} aria-label="Search Cloudflare operations" placeholder="Search operations" /><AnchoredRegexBuilder search={operationSearch} fieldRef={operationSearchRef} label="Regex builder for Cloudflare operations" /></div>
      {resultSearch.error ? <p role="alert">{resultSearch.error}</p> : null}{operationSearch.error ? <p role="alert">{operationSearch.error}</p> : null}{error ? <p role="alert">{error}</p> : null}{operationState ? <p role="status">{vocab(operationState)}</p> : null}
      {visibleRows.length ? <div role="list">{visibleRows.map((row, index) => <article key={index} role="listitem"><pre>{JSON.stringify(row, null, 2)}</pre></article>)}</div> : <p>No Cloudflare results yet. Choose a manager, bind a local credential, and run a guided operation.</p>}
      {result?.nextPage ? <Button disabled={busy} onClick={() => void run()}>Load next page</Button> : null}{busy ? <Button onClick={() => void api?.cancel(result?.operationId ?? '')}>Cancel</Button> : null}
    </section>
    <TunnelStatePanel
      intent={tunnelIntent}
      live={tunnelState}
      onRetry={api?.probeTunnelFacet ? (facet) => void probeTunnelFacet(facet) : undefined}
      onCancel={api?.cancelTunnelProbe ? () => void api.cancelTunnelProbe(id) : undefined}
    />
  </div>
}
