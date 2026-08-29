import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AwsCloudControlResource,
  AwsCrudPreview,
  AwsManagerStatus,
  AwsPage,
  AwsResource,
  AwsResourceType
} from '@shared/aws'
import { MaterialSymbol } from '../MaterialSymbol'
import { openDestructiveGate } from '../../state/destructiveGate'

export interface AwsManagerPanelProps {
  onClose: () => void
}

type Tab = 'discovery' | 'cloud-control'
type Api = typeof window.nodeTerminal.aws

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusCopy(status: AwsManagerStatus | null): string {
  if (!status) return 'Checking AWS credentials and permissions…'
  if (status.health === 'ready') return `Connected to ${status.region}${status.accountId ? ` · account ${status.accountId}` : ''}`
  if (status.health === 'missing-credentials') return 'AWS credentials are not configured. Add a profile through the identity settings before querying resources.'
  if (status.health === 'permission-denied') return status.detail ?? 'AWS denied the identity check.'
  return status.detail ?? 'AWS status is unavailable.'
}

function PageMeta({ page }: { page: AwsPage<unknown> | null }) {
  if (!page) return null
  return (
    <div className="aws-manager__meta" role="status">
      <span><MaterialSymbol name={page.complete ? 'check_circle' : 'warning'} size={16} /> {page.complete ? 'Complete' : 'Partial results'}</span>
      <span>{page.items.length} items · page {page.page}</span>
      <span>{page.source === 'tagging-api-fallback' ? 'Tagging API fallback' : page.source}</span>
      {page.detail && <span>{page.detail}</span>}
    </div>
  )
}

function ContextCard({ preview }: { preview: AwsCrudPreview | null }) {
  if (!preview) return <p className="aws-manager__empty">Choose an operation to see its typed request preview.</p>
  return (
    <details className="aws-manager__context" open>
      <summary>Typed request preview {preview.destructive ? '(destructive)' : ''}</summary>
      <dl>
        <dt>Service and operation</dt><dd>{preview.service} · {preview.operation}</dd>
        <dt>Region</dt><dd>{preview.region}</dd>
        <dt>Resource type</dt><dd>{preview.typeName || 'Not set'}</dd>
        <dt>Identifier</dt><dd>{preview.identifier ?? 'Not set'}</dd>
      </dl>
      <pre>{JSON.stringify(preview.properties, null, 2)}</pre>
      <p className="aws-manager__privacy">Credentials and signed headers are omitted from this preview.</p>
    </details>
  )
}

function DiscoveryTab({ api }: { api: Api }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<AwsPage<AwsResource> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const search = useCallback(async () => {
    setBusy(true)
    setError(null)
    try { setPage(await api.discoverResources({ query, maxPages: 20 })) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }, [api, query])
  useEffect(() => { void search() }, [])
  return (
    <section className="aws-manager__section" aria-labelledby="aws-discovery-heading">
      <div className="aws-manager__toolbar">
        <label htmlFor="aws-resource-search">Search resources</label>
        <input id="aws-resource-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Plain text query, such as service:ec2" />
        <button type="button" onClick={() => void search()} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {error && <div className="aws-manager__error" role="alert">{error}</div>}
      <PageMeta page={page} />
      <ul className="aws-manager__resource-list">
        {(page?.items ?? []).map((resource) => (
          <li key={resource.arn} className="aws-manager__resource-row">
            <strong>{resource.resourceType ?? resource.service ?? 'AWS resource'}</strong>
            <code>{resource.arn}</code>
            <span>{resource.region ?? 'Region unknown'} · {resource.accountId ?? 'Account unknown'}</span>
            {resource.discoveredBy === 'tagging-api-fallback' && <small>Discovered by Tagging API fallback, resource type metadata is unavailable.</small>}
          </li>
        ))}
      </ul>
      {page && page.items.length === 0 && <p className="aws-manager__empty">No resources matched this query. A failed read is shown as an error or partial state, not as an empty result.</p>}
    </section>
  )
}

function CloudControlTab({ api }: { api: Api }) {
  const [types, setTypes] = useState<AwsPage<AwsResourceType> | null>(null)
  const [resources, setResources] = useState<AwsPage<AwsCloudControlResource> | null>(null)
  const [typeName, setTypeName] = useState('AWS::S3::Bucket')
  const [typeSearch, setTypeSearch] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [properties, setProperties] = useState('{}')
  const [preview, setPreview] = useState<AwsCrudPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadTypes = useCallback(async () => {
    setBusy(true); setError(null)
    try { setTypes(await api.listResourceTypes({ maxPages: 20 })) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }, [api])
  useEffect(() => { void loadTypes() }, [loadTypes])

  const parsedProperties = useMemo(() => {
    try {
      const value = JSON.parse(properties) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch { return null }
  }, [properties])
  const visibleTypes = useMemo(() => {
    const needle = typeSearch.trim().toLowerCase()
    return (types?.items ?? []).filter((item) => !needle || item.typeName.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle))
  }, [types, typeSearch])

  const makePreview = async (action: 'list' | 'read' | 'create' | 'update' | 'delete') => {
    setError(null)
    try {
      const next = await api.preview({ action, typeName, identifier: identifier || undefined, properties: parsedProperties ?? {}, })
      setPreview(next)
    } catch (e) { setError(errorMessage(e)) }
  }

  const list = async () => {
    setBusy(true); setError(null)
    try { setResources(await api.listResources({ typeName, maxPages: 20 })) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const mutate = async (action: 'create' | 'update' | 'delete') => {
    if (!parsedProperties && action !== 'delete') { setError('Properties must be a JSON object before this operation can be previewed.'); return }
    setBusy(true); setError(null)
    try {
      const result = action === 'create'
        ? await api.createResource({ typeName, properties: parsedProperties ?? {} })
        : action === 'update'
          ? await api.updateResource({ typeName, identifier, properties: parsedProperties ?? {} })
          : await api.deleteResource({ typeName, identifier })
      setPreview(result.preview)
      if (result.detail) setError(result.detail)
      if (result.resource) setResources((current) => current ? { ...current, items: [...current.items, result.resource!] } : current)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const read = async () => {
    setBusy(true); setError(null)
    try {
      const result = await api.readResource({ typeName, identifier })
      setPreview(result.preview)
      if (result.detail) setError(result.detail)
      if (result.resource) setResources((current) => current ? { ...current, items: current.items.map((item) => item.identifier === result.resource!.identifier ? result.resource! : item) } : current)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const requestDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!preview || preview.action !== 'delete') return
    const opened = openDestructiveGate({
      title: `Delete ${typeName} resource`,
      description: `Permanently delete AWS resource ${identifier}. This provider action cannot be undone by the manager.`,
      affected: [identifier],
      confirmLabel: 'Delete resource',
      anchor: (() => { const rect = event.currentTarget.getBoundingClientRect(); return { x: rect.left, y: rect.bottom } })(),
      restoreFocusEl: event.currentTarget,
      onConfirm: () => { void mutate('delete') }
    })
    if (!opened) setError('Another destructive confirmation is already open.')
  }

  return (
    <section className="aws-manager__section" aria-labelledby="aws-cloud-control-heading">
      <div className="aws-manager__toolbar">
        <button type="button" onClick={() => void loadTypes()} disabled={busy}>Refresh resource types</button>
        <label htmlFor="aws-type-search">Search resource types</label>
        <input id="aws-type-search" value={typeSearch} onChange={(e) => setTypeSearch(e.target.value)} placeholder="Filter the verified type catalog" />
        <label htmlFor="aws-type-name">Type name</label>
        <input id="aws-type-name" list="aws-type-options" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
        <datalist id="aws-type-options">{visibleTypes.map((item) => <option key={item.typeName} value={item.typeName}>{item.description ?? ''}</option>)}</datalist>
        <button type="button" onClick={() => void list()} disabled={busy}>List resources</button>
      </div>
      <div className="aws-manager__crud-form">
        <label htmlFor="aws-resource-identifier">Identifier</label>
        <input id="aws-resource-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Required for read, update, and delete" />
        <label htmlFor="aws-resource-properties">Desired state JSON</label>
        <textarea id="aws-resource-properties" value={properties} onChange={(e) => setProperties(e.target.value)} rows={6} spellCheck={false} />
        <div className="aws-manager__actions" role="group" aria-label="Cloud Control actions">
          {(['list', 'read', 'create', 'update', 'delete'] as const).map((action) => <button key={action} type="button" onClick={() => action === 'list' ? void makePreview(action) : void makePreview(action)}>{`Preview ${action}`}</button>)}
          <button type="button" onClick={() => void read()} disabled={busy || !preview || preview.action !== 'read'}>Read</button>
          <button type="button" onClick={() => void mutate('create')} disabled={busy || !preview || preview.action !== 'create'}>Create</button>
          <button type="button" onClick={() => void mutate('update')} disabled={busy || !preview || preview.action !== 'update'}>Update</button>
          <button type="button" onClick={requestDelete} disabled={busy || !preview || preview.action !== 'delete'}>Delete</button>
        </div>
      </div>
      {error && <div className="aws-manager__error" role="alert">{error}</div>}
      <PageMeta page={types} />
      <PageMeta page={resources} />
      <ContextCard preview={preview} />
      <ul className="aws-manager__resource-list">
        {(resources?.items ?? []).map((resource) => <li key={resource.identifier} className="aws-manager__resource-row"><strong>{resource.identifier}</strong><pre>{JSON.stringify(resource.properties, null, 2)}</pre><span>{resource.status ?? 'Listed'}</span></li>)}
      </ul>
    </section>
  )
}

export function AwsManagerPanel({ onClose }: AwsManagerPanelProps) {
  const api = window.nodeTerminal.aws
  const [tab, setTab] = useState<Tab>('discovery')
  const [status, setStatus] = useState<AwsManagerStatus | null>(null)
  useEffect(() => { void api.status().then(setStatus).catch(() => setStatus(null)) }, [api])
  return (
    <aside className="drawer aws-manager" role="dialog" aria-label="AWS managers">
      <header className="aws-manager__header"><div><h2>AWS managers</h2><p>{statusCopy(status)}</p></div><button type="button" onClick={onClose} aria-label="Close AWS managers"><MaterialSymbol name="close" size={20} /></button></header>
      <nav className="aws-manager__tabs" role="tablist" aria-label="AWS manager tabs">
        <button role="tab" aria-selected={tab === 'discovery'} onClick={() => setTab('discovery')}>Resource Explorer</button>
        <button role="tab" aria-selected={tab === 'cloud-control'} onClick={() => setTab('cloud-control')}>Cloud Control</button>
      </nav>
      {tab === 'discovery' ? <DiscoveryTab api={api} /> : <CloudControlTab api={api} />}
    </aside>
  )
}
