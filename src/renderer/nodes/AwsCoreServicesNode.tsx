import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { openDestructiveGate } from '../state/destructiveGate'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import {
  AWS_CORE_OPERATIONS_BY_SERVICE,
  AWS_CORE_OPERATION_LABELS,
  AWS_CORE_SERVICE_LABELS,
  AWS_CORE_SERVICES,
  type AwsCoreBinding,
  type AwsCoreOperation,
  type AwsCorePortableIntent,
  type AwsCoreRequest,
  type AwsCoreResult,
  type AwsCoreServiceId
} from '@shared/aws-core-services'
import type { CanvasNode } from '../state/workspace'

const OPERATION_KEYS: Partial<Record<AwsCoreOperation, string[]>> = {
  's3-list-objects': ['bucket'], 's3-create-bucket': ['bucket'], 's3-delete-bucket': ['bucket'],
  'ec2-start-instances': ['instanceIds'], 'ec2-stop-instances': ['instanceIds'], 'ec2-terminate-instances': ['instanceIds'],
  'iam-get-user': ['userName'], 'iam-get-role': ['roleName'], 'iam-create-user': ['userName'], 'iam-delete-user': ['userName'],
  'lambda-get-function': ['functionName'], 'lambda-delete-function': ['functionName'],
  'cloudwatch-get-metric-data': ['metricDataQueries', 'startTime', 'endTime'],
  'logs-describe-log-streams': ['logGroupName'], 'logs-get-log-events': ['logGroupName', 'logStreamName'], 'logs-filter-log-events': ['logGroupName', 'filterPattern']
}

const DESTRUCTIVE = new Set<AwsCoreOperation>(['s3-delete-bucket', 'ec2-terminate-instances', 'iam-delete-user', 'lambda-delete-function'])

function rowText(row: Record<string, unknown>): string {
  return Object.values(row).map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
}

export default function AwsCoreServicesNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { updateNodeData } = useReactFlow()
  const intent = (data.awsCoreIntent ?? {
    schemaVersion: 1, service: 's3', operation: 's3-list-buckets', regionIntent: 'us-east-1', input: {}
  }) as AwsCorePortableIntent
  const [service, setService] = useState<AwsCoreServiceId>(intent.service)
  const [operation, setOperation] = useState<AwsCoreOperation>(intent.operation)
  const [input, setInput] = useState<Record<string, string | number | boolean>>(intent.input ?? {})
  const [profiles, setProfiles] = useState<Array<{ name: string; configuredRegion: string | null }>>([])
  const [binding, setBinding] = useState<AwsCoreBinding | null>(null)
  const [profileName, setProfileName] = useState('')
  const [region, setRegion] = useState(intent.regionIntent || 'us-east-1')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [runtime, setRuntime] = useState('Checking AWS CLI…')
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [result, setResult] = useState<AwsCoreResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [operationState, setOperationState] = useState('')
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  const api = window.nodeTerminal.awsCoreServices
  const operations = AWS_CORE_OPERATIONS_BY_SERVICE[service]
  const fields = OPERATION_KEYS[operation] ?? []
  const visibleRows = useMemo(() => rows.filter((row) => search.test(rowText(row))), [rows, search])

  const persistIntent = (next: Partial<AwsCorePortableIntent>): void => {
    const nextIntent: AwsCorePortableIntent = { ...intent, service, operation, regionIntent: region, input, ...next, schemaVersion: 1 }
    updateNodeData(id, { awsCoreIntent: nextIntent })
  }

  useEffect(() => {
    if (!api) { setRuntime('AWS core-service manager is unavailable in this shell.') ; return }
    let active = true
    void Promise.all([api.runtime(), api.profiles(), api.binding(id)]).then(([status, choices, current]) => {
      if (!active) return
      setRuntime(status.available ? `${status.origin}: ${status.version ?? 'AWS CLI v2'}` : status.disabledReason ?? 'AWS CLI unavailable')
      setProfiles(choices)
      setBinding(current)
      setProfileName(current?.profileName ?? choices[0]?.name ?? '')
      setRegion(current?.region ?? intent.regionIntent)
      setEndpointUrl(current?.endpointUrl ?? '')
    }).catch((cause) => active && setRuntime(cause instanceof Error ? cause.message : String(cause)))
    return () => { active = false }
  }, [api, id])

  useEffect(() => {
    if (!api) return
    return api.onProgress((progress) => {
      if (progress.nodeId === id) setOperationState(progress.message)
    })
  }, [api, id])

  const saveBinding = async (): Promise<void> => {
    if (!api || !profileName || !region) return
    setBusy(true); setError('')
    try { setBinding(await api.bind({ nodeId: id, profileName, region, endpointUrl: endpointUrl || null })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const run = async (): Promise<void> => {
    if (!api || !binding) { setError('Choose a local AWS profile and region first.') ; return }
    const request: AwsCoreRequest = { service, operation, input, maxResults: 100, nextToken: result?.nextToken ?? undefined }
    setBusy(true); setError(''); setOperationState('Preparing operation preview…')
    try {
      const preview = await api.preview(id, request)
      const execute = async (): Promise<void> => {
        try { const next = await api.execute(id, request); setResult(next); setRows(next.rows); setOperationState(next.summary) }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }
      if (preview.destructive) {
        openDestructiveGate({ title: `Confirm ${AWS_CORE_OPERATION_LABELS[operation]}`, description: 'This AWS operation changes provider state.', affected: [`${AWS_CORE_SERVICE_LABELS[service]} · ${AWS_CORE_OPERATION_LABELS[operation]}`], confirmLabel: 'Run operation', onConfirm: () => void execute() })
      } else await execute()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) }
  }

  const chooseService = (next: AwsCoreServiceId): void => {
    const nextOperation = AWS_CORE_OPERATIONS_BY_SERVICE[next][0]
    setService(next); setOperation(nextOperation); setInput({}); setResult(null); setRows([])
    persistIntent({ service: next, operation: nextOperation, input: {} })
  }

  return <div className="aws-core-manager nodrag" aria-label="AWS core services manager">
    <NodeResizer minWidth={560} minHeight={420} isVisible={selected} color="#ff9900" />
    <header className="aws-core-manager__header"><strong>AWS core services</strong><span>{runtime}</span></header>
    <div className="aws-core-manager__tabs" role="tablist" aria-label="AWS services">
      {AWS_CORE_SERVICES.map((item) => <button key={item} role="tab" aria-selected={service === item} onClick={() => chooseService(item)}>{AWS_CORE_SERVICE_LABELS[item]}</button>)}
    </div>
    <section className="aws-core-manager__binding" aria-label="Local AWS binding">
      <h5>Choose local profile and region</h5>
      <div className="aws-core-manager__pills" role="listbox" aria-label="AWS profiles">
        {profiles.length ? profiles.map((item) => <button key={item.name} role="option" aria-selected={profileName === item.name} className={profileName === item.name ? 'selected' : ''} onClick={() => setProfileName(item.name)}>{item.name}<small>{item.configuredRegion ?? 'region not configured'}</small></button>) : <span>Profiles appear after the AWS CLI is available.</span>}
      </div>
      <Input value={region} onChange={(event) => setRegion(event.target.value)} aria-label="AWS region" placeholder="us-east-1" />
      <Input value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} aria-label="Optional HTTPS endpoint" placeholder="Optional HTTPS endpoint" />
      <Button disabled={busy || !profileName || !region} onClick={() => void saveBinding()}>{binding ? 'Update binding' : 'Configure binding'}</Button>
      {binding ? <Button disabled={busy} onClick={() => void api?.unbind(id).then(() => setBinding(null))}>Leave unbound</Button> : null}
    </section>
    <section className="aws-core-manager__operation" aria-label="Guided AWS operation">
      <label htmlFor={`${id}-operation`}>Operation</label>
      <select id={`${id}-operation`} value={operation} onChange={(event) => { const next = event.target.value as AwsCoreOperation; setOperation(next); setInput({}); setResult(null); persistIntent({ operation: next, input: {} }) }}>
        {operations.map((item) => <option key={item} value={item}>{AWS_CORE_OPERATION_LABELS[item]}</option>)}
      </select>
      {fields.map((field) => <Input key={field} value={String(input[field] ?? '')} onChange={(event) => { const next = { ...input, [field]: event.target.value }; setInput(next); persistIntent({ input: next }) }} aria-label={field} placeholder={field} />)}
      <div className="aws-core-manager__toolbar"><div className="aws-core-manager__search"><Input ref={searchRef} type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)} aria-label="Search AWS results" placeholder="Search results" /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex builder for AWS results" /></div><Button disabled={busy || !binding} title={!binding ? 'Configure a local AWS profile and region first.' : 'Preview and run the selected operation'} onClick={() => void run()}>{busy ? 'Running…' : 'Preview and run'}</Button></div>
      {search.error ? <p className="aws-core-manager__error" role="alert">{search.error}</p> : null}
      {error ? <p className="aws-core-manager__error" role="alert">{error}</p> : null}
      {operationState ? <p role="status">{vocab(operationState)}</p> : null}
      {visibleRows.length ? <div className="aws-core-manager__rows" role="list">{visibleRows.map((row, index) => <article key={index} role="listitem"><pre>{JSON.stringify(row, null, 2)}</pre></article>)}</div> : <p>No AWS results yet. Configure a profile, select an operation, and run it.</p>}
      {result?.nextToken ? <Button disabled={busy} onClick={() => void run()}>Load next page</Button> : null}
      {busy ? <Button onClick={() => void api?.cancel(result?.operationId ?? '')}>Cancel</Button> : null}
    </section>
  </div>
}
