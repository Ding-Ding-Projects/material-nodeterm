import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type {
  AwsManagerBinding,
  AwsManagerMode,
  AwsManagerOperation,
  AwsManagerProgress,
  AwsManagerRequest,
  AwsManagerResult,
  AwsManagerPortableIntent,
  AwsOperationPreview,
  AwsProfileChoice
} from '@shared/aws-resource'
import type { CanvasNode } from '../state/workspace'
import { useActiveSessionApi } from '../session/session'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { openDestructiveGate } from '../state/destructiveGate'

const REGION_OPTIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-west-2',
  'eu-west-3', 'eu-central-1', 'eu-north-1', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2',
  'ap-southeast-1', 'ap-southeast-2', 'sa-east-1'
] as const

const RESOURCE_OPERATIONS: readonly AwsManagerOperation[] = ['resource-list-views', 'resource-search']
const CLOUD_OPERATIONS: readonly AwsManagerOperation[] = [
  'cloud-list-types', 'cloud-list-resources', 'cloud-get-resource', 'cloud-create-resource',
  'cloud-update-resource', 'cloud-delete-resource', 'cloud-request-status'
]

const OPERATION_LABELS: Record<AwsManagerOperation, string> = {
  'resource-list-views': 'List views',
  'resource-search': 'Search resources',
  'cloud-list-types': 'List public resource types',
  'cloud-list-resources': 'List resources',
  'cloud-get-resource': 'Get resource',
  'cloud-create-resource': 'Create resource',
  'cloud-update-resource': 'Update resource',
  'cloud-delete-resource': 'Delete resource',
  'cloud-request-status': 'Check request status'
}

function operationRisk(operation: AwsManagerOperation): 'read-only' | 'write' | 'destructive' {
  return operation === 'cloud-delete-resource' ? 'destructive' : operation.startsWith('cloud-') && ['cloud-create-resource', 'cloud-update-resource'].includes(operation) ? 'write' : 'read-only'
}

function resultCorpus(row: Record<string, unknown>): string {
  return Object.values(row).map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
}

function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `aws-operation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function requestFor(operation: AwsManagerOperation, values: { query: string; viewArn: string; typeName: string; identifier: string; desiredState: string; patchDocument: string; requestToken: string; nextToken: string; maxResults: number }): AwsManagerRequest {
  return {
    operation,
    ...(values.query.trim() ? { query: values.query } : {}),
    ...(values.viewArn.trim() ? { viewArn: values.viewArn } : {}),
    ...(values.typeName.trim() ? { typeName: values.typeName } : {}),
    ...(values.identifier.trim() ? { identifier: values.identifier } : {}),
    ...(values.desiredState.trim() ? { desiredState: values.desiredState } : {}),
    ...(values.patchDocument.trim() ? { patchDocument: values.patchDocument } : {}),
    ...(values.requestToken.trim() ? { requestToken: values.requestToken } : {}),
    ...(values.nextToken.trim() ? { nextToken: values.nextToken } : {}),
    maxResults: values.maxResults
  }
}

function fieldLabel(operation: AwsManagerOperation): string {
  if (operation === 'resource-search') return 'Resource query'
  if (operation === 'resource-list-views') return 'View ARN (optional)'
  if (operation === 'cloud-list-resources') return 'Resource type'
  if (operation === 'cloud-get-resource' || operation === 'cloud-update-resource' || operation === 'cloud-delete-resource') return 'Resource type and identifier'
  if (operation === 'cloud-request-status') return 'Request token'
  return 'Operation inputs'
}

/** Guided Resource Explorer and Cloud Control manager node. Provider state remains local to core. */
export default function AwsResourceNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const vocab = useVocabularyMapper()
  const nodeIntent = data.awsManagerIntent
  const [mode, setMode] = useState<AwsManagerMode>(nodeIntent?.mode === 'cloud-control' ? 'cloud-control' : 'resource-explorer')
  const [operation, setOperation] = useState<AwsManagerOperation>(mode === 'cloud-control' ? CLOUD_OPERATIONS[0] : RESOURCE_OPERATIONS[0])
  const [runtime, setRuntime] = useState<{ available: boolean; origin: string; version: string | null; disabledReason: string | null } | null>(null)
  const [profiles, setProfiles] = useState<AwsProfileChoice[]>([])
  const [binding, setBinding] = useState<AwsManagerBinding | null>(null)
  const [profileName, setProfileName] = useState('')
  const [region, setRegion] = useState(nodeIntent?.regionIntent ?? 'us-east-1')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [query, setQuery] = useState(nodeIntent?.resourceQuery ?? '')
  const [viewArn, setViewArn] = useState('')
  const [typeName, setTypeName] = useState(nodeIntent?.cloudControlTypeName ?? '')
  const [identifier, setIdentifier] = useState('')
  const [desiredState, setDesiredState] = useState('{}')
  const [patchDocument, setPatchDocument] = useState('[]')
  const [requestToken, setRequestToken] = useState('')
  const [nextToken, setNextToken] = useState('')
  const [maxResults, setMaxResults] = useState(100)
  const [preview, setPreview] = useState<AwsOperationPreview | null>(null)
  const [result, setResult] = useState<AwsManagerResult | null>(null)
  const [progress, setProgress] = useState<AwsManagerProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resultSearch = useRegexSearchField()
  const resultSearchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (): Promise<void> => {
    const manager = api.awsResource
    if (!manager) {
      setRuntime({ available: false, origin: 'unavailable', version: null, disabledReason: 'This session does not expose the AWS manager bridge.' })
      return
    }
    try {
      const [status, choices, current] = await Promise.all([manager.runtime(), manager.profiles(), manager.binding(id)])
      setRuntime(status)
      setProfiles(choices)
      setBinding(current)
      if (current) {
        setProfileName(current.profileName)
        setRegion(current.region)
        setEndpointUrl(current.endpointUrl ?? '')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api.awsResource, id])

  useEffect(() => {
    void load()
    return api.awsResource?.onProgress((item) => {
      if (item.nodeId === id) setProgress(item)
    })
  }, [api.awsResource, id, load])

  const operations = mode === 'cloud-control' ? CLOUD_OPERATIONS : RESOURCE_OPERATIONS
  useEffect(() => {
    if (!operations.includes(operation)) setOperation(operations[0])
  }, [mode, operation, operations])

  const filteredRows = useMemo(() => {
    const rows = result?.rows ?? []
    return rows.filter((row) => resultSearch.test(resultCorpus(row)))
  }, [result, resultSearch])

  const persistIntent = (nextMode: AwsManagerMode = mode, overrides: Partial<Pick<AwsManagerPortableIntent, 'regionIntent' | 'resourceQuery' | 'cloudControlTypeName'>> = {}): void => {
    updateNodeData(id, {
      awsManagerIntent: {
        schemaVersion: 1,
        mode: nextMode,
        regionIntent: (overrides.regionIntent ?? region.trim()) || 'us-east-1',
        resourceQuery: overrides.resourceQuery ?? query,
        cloudControlTypeName: overrides.cloudControlTypeName ?? typeName
      }
    })
  }

  const bind = async (): Promise<void> => {
    if (!api.awsResource || !profileName.trim() || !region.trim()) return
    setBusy(true); setError(null)
    try {
      const next = await api.awsResource.bind({ nodeId: id, profileName, region, endpointUrl: endpointUrl || null })
      setBinding(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const buildRequest = (): AwsManagerRequest => requestFor(operation, { query, viewArn, typeName, identifier, desiredState, patchDocument, requestToken, nextToken, maxResults })

  const makePreview = async (): Promise<void> => {
    if (!api.awsResource) return
    setBusy(true); setError(null)
    try { setPreview(await api.awsResource.preview(id, buildRequest())) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const execute = async (): Promise<void> => {
    if (!api.awsResource || !preview) return
    const run = async (): Promise<void> => {
      setBusy(true); setError(null); setResult(null)
      try { setResult(await api.awsResource!.execute(id, newOperationId(), buildRequest())) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    }
    if (operationRisk(operation) !== 'destructive') { await run(); return }
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rect = target?.getBoundingClientRect()
    openDestructiveGate({
      title: 'Delete AWS resource',
      description: 'This action asks AWS Cloud Control to delete the named resource. Review the preview before authorizing.',
      affected: [typeName || 'Resource type', identifier || 'Resource identifier'],
      confirmLabel: 'Delete resource',
      anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
      restoreFocusEl: target,
      onConfirm: () => { void run() }
    })
  }

  const fill = nodeHeaderFillStyle(data.color)
  const title = data.title || (mode === 'cloud-control' ? 'AWS Cloud Control' : 'AWS Resource Explorer')
  const note = runtime?.available ? `AWS CLI ${runtime.origin}${runtime.version ? `: ${runtime.version}` : ''}` : runtime ? runtime.disabledReason ?? 'AWS CLI is unavailable.' : 'Checking AWS CLI availability…'

  return (
    <div className={`term-node aws-resource-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={520} minHeight={420} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <EditableNodeTitle value={title} onChange={(next) => updateNodeData(id, { title: next })} emptyLabel="AWS manager" title="Rename AWS manager" ariaLabel="AWS manager node name" rejectEmpty={false} />
        <span className="term-node__spacer" />
        <button type="button" className="aws-resource-node__refresh" onClick={() => void load()} disabled={busy} aria-label="Refresh AWS status">↻</button>
      </div>
      <div className="aws-resource-node__body nodrag nowheel">
        <div className="aws-resource-node__runtime" role="status">{note}</div>
        <div className="aws-resource-node__modes" role="tablist" aria-label="AWS manager mode">
          <button type="button" role="tab" aria-selected={mode === 'resource-explorer'} onClick={() => { setMode('resource-explorer'); persistIntent('resource-explorer') }}>Resource Explorer</button>
          <button type="button" role="tab" aria-selected={mode === 'cloud-control'} onClick={() => { setMode('cloud-control'); persistIntent('cloud-control') }}>Cloud Control</button>
        </div>
        <section className="aws-resource-node__binding" aria-label="Local AWS binding">
          <div className="aws-resource-node__binding-grid">
            <label>Profile
              <input list={`${id}-profiles`} value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Choose a configured profile" />
              <datalist id={`${id}-profiles`}>{profiles.map((choice) => <option key={choice.name} value={choice.name}>{choice.configuredRegion ?? 'No configured region'}</option>)}</datalist>
            </label>
            <label>Region
              <input list={`${id}-regions`} value={region} onChange={(event) => { setRegion(event.target.value); persistIntent(mode, { regionIntent: event.target.value }) }} />
              <datalist id={`${id}-regions`}>{REGION_OPTIONS.map((item) => <option key={item} value={item} />)}</datalist>
            </label>
            <label>Endpoint (optional)
              <input value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://endpoint.example" />
            </label>
          </div>
          <div className="aws-resource-node__actions">
            <button type="button" onClick={() => void bind()} disabled={busy || !profileName.trim() || !region.trim()}>Save local binding</button>
            <span className="aws-resource-node__binding-state">{binding ? `Bound to ${binding.profileName} in ${binding.region}` : 'Not bound. Choose a local profile and region.'}</span>
          </div>
        </section>
        <div className="aws-resource-node__operations" role="tablist" aria-label="AWS operations">
          {operations.map((item) => <button key={item} type="button" role="tab" aria-selected={operation === item} className={operation === item ? 'is-selected' : ''} onClick={() => { setOperation(item); setPreview(null); setError(null) }}>{OPERATION_LABELS[item]}</button>)}
        </div>
        <section className="aws-resource-node__inputs" aria-label={fieldLabel(operation)}>
          {operation === 'resource-search' && <label>Resource query<input value={query} onChange={(event) => { setQuery(event.target.value); persistIntent(mode, { resourceQuery: event.target.value }) }} placeholder="Use Resource Explorer query syntax" /></label>}
          {operation === 'resource-list-views' && <label>View ARN (optional)<input value={viewArn} onChange={(event) => setViewArn(event.target.value)} placeholder="Use the default view when empty" /></label>}
          {['cloud-list-resources', 'cloud-get-resource', 'cloud-create-resource', 'cloud-update-resource', 'cloud-delete-resource'].includes(operation) && <label>Resource type<input value={typeName} onChange={(event) => { setTypeName(event.target.value); persistIntent(mode, { cloudControlTypeName: event.target.value }) }} placeholder="AWS::Service::ResourceType" /></label>}
          {['cloud-get-resource', 'cloud-update-resource', 'cloud-delete-resource'].includes(operation) && <label>Resource identifier<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Choose an identifier from the list result" /></label>}
          {operation === 'cloud-create-resource' && <label>Desired state JSON<textarea value={desiredState} onChange={(event) => setDesiredState(event.target.value)} spellCheck={false} aria-describedby={`${id}-json-note`} /><small id={`${id}-json-note`}>Object JSON is validated by the core before an AWS request is started.</small></label>}
          {operation === 'cloud-update-resource' && <label>Patch document JSON<textarea value={patchDocument} onChange={(event) => setPatchDocument(event.target.value)} spellCheck={false} /></label>}
          {operation === 'cloud-request-status' && <label>Request token<input value={requestToken} onChange={(event) => setRequestToken(event.target.value)} /></label>}
          <label>Maximum results<input type="number" min={1} max={100} value={maxResults} onChange={(event) => setMaxResults(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></label>
          <div className="aws-resource-node__actions"><button type="button" onClick={() => void makePreview()} disabled={busy || !runtime?.available || !binding}>Preview generated operation</button><button type="button" onClick={() => void execute()} disabled={busy || !preview}>Run operation</button></div>
        </section>
        {preview && <details className="aws-resource-node__preview" open><summary>Review operation: {preview.service} {preview.operation} ({preview.risk})</summary><code>{preview.argv.join(' ')}</code><span>{preview.pagination}; retry: {preview.retry}</span></details>}
        {progress && <div className="aws-resource-node__progress" role="status">{progress.phase}: {progress.message}{progress.phase === 'started' && api.awsResource && <button type="button" onClick={() => void api.awsResource!.cancel(progress.operationId)}>Cancel</button>}</div>}
        {error && <div className="aws-resource-node__error" role="alert">{vocab(error)}</div>}
        {result && <section className="aws-resource-node__results" aria-label="AWS operation results">
          <div className="aws-resource-node__results-search"><label htmlFor={`${id}-result-search`}>Search results</label><input id={`${id}-result-search`} ref={resultSearchRef} value={resultSearch.value} onChange={(event) => resultSearch.setValue(event.target.value)} placeholder="Filter returned rows" /><AnchoredRegexBuilder search={resultSearch} fieldRef={resultSearchRef} label="Open regex builder for AWS result search" /></div>
          <p role="status">{result.summary} Showing {filteredRows.length} of {result.rows.length} rows.</p>
          <div className="aws-resource-node__result-list">{filteredRows.map((row, index) => <pre key={index}>{JSON.stringify(row, null, 2)}</pre>)}</div>
          {result.nextToken && <button type="button" onClick={() => setNextToken(result.nextToken ?? '')}>Use next page token</button>}
          {result.requestToken && <button type="button" onClick={() => setRequestToken(result.requestToken ?? '')}>Use request token</button>}
        </section>}
        <p className="aws-resource-node__hint">Portable project data keeps only the selected mode, region intent, and query. Profiles, endpoints, request tokens, result rows, CLI paths, and credentials stay local to this computer.</p>
      </div>
    </div>
  )
}
