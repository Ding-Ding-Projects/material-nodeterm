import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  AWS_CORE_OPERATIONS,
  AWS_CORE_OPERATION_LABELS,
  AWS_CORE_SERVICES,
  AWS_PLATFORM_OPERATIONS,
  AWS_PLATFORM_OPERATION_LABELS,
  AWS_PLATFORM_SERVICES
} from '@shared/aws-resource'
import type {
  AwsManagerBinding,
  AwsManagerMode,
  AwsManagerOperation,
  AwsManagerProgress,
  AwsManagerRequest,
  AwsManagerResult,
  AwsManagerPortableIntent,
  AwsOperationPreview,
  AwsProfileChoice,
  AwsCoreOperation,
  AwsCoreServiceId,
  AwsPlatformOperation,
  AwsPlatformServiceId
} from '@shared/aws-resource'
import { CLOUDFORMATION_CAPABILITIES, type CloudFormationCapability, type CloudFormationChangeSetType } from '@shared/cloudformation'
import type { CanvasNode } from '../state/workspace'
import { useActiveSessionApi } from '../session/session'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { openDestructiveGate } from '../state/destructiveGate'
import { CdkManagerPanel } from '../components/aws/CdkManagerPanel'

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
const CLOUDFORMATION_OPERATIONS: readonly AwsManagerOperation[] = [
  'cloudformation-validate-template', 'cloudformation-list-stacks', 'cloudformation-create-change-set',
  'cloudformation-describe-change-set', 'cloudformation-execute-change-set', 'cloudformation-delete-change-set'
]
const CORE_SERVICE_LABELS: Record<AwsCoreServiceId, string> = { s3: 'S3', ec2: 'EC2', iam: 'IAM', sts: 'STS', lambda: 'Lambda', cloudwatch: 'CloudWatch', logs: 'CloudWatch Logs' }

const OPERATION_LABELS: Record<AwsManagerOperation, string> = {
  'resource-list-views': 'List views',
  'resource-search': 'Search resources',
  'cloud-list-types': 'List public resource types',
  'cloud-list-resources': 'List resources',
  'cloud-get-resource': 'Get resource',
  'cloud-create-resource': 'Create resource',
  'cloud-update-resource': 'Update resource',
  'cloud-delete-resource': 'Delete resource',
  'cloud-request-status': 'Check request status',
  'cloudformation-validate-template': 'Validate template',
  'cloudformation-list-stacks': 'List stacks',
  'cloudformation-create-change-set': 'Preview change set',
  'cloudformation-describe-change-set': 'Describe change set',
  'cloudformation-execute-change-set': 'Execute change set',
  'cloudformation-delete-change-set': 'Delete change set',
  ...AWS_CORE_OPERATION_LABELS,
  ...AWS_PLATFORM_OPERATION_LABELS
}

function operationRisk(operation: AwsManagerOperation): 'read-only' | 'write' | 'destructive' {
  if (['cloud-delete-resource', 's3-delete-bucket', 'ec2-terminate-instances', 'iam-delete-user', 'lambda-delete-function', 'cloudformation-delete-change-set', ...AWS_PLATFORM_OPERATIONS.filter((item) => item.includes('delete-'))].includes(operation)) return 'destructive'
  if (['cloud-create-resource', 'cloud-update-resource', 's3-create-bucket', 'ec2-start-instances', 'ec2-stop-instances', 'iam-create-user', ...AWS_PLATFORM_OPERATIONS.filter((item) => item.includes('create-') || item.includes('update-') || item === 'route53-change-record')].includes(operation)) return 'write'
  return 'read-only'
}

function resultCorpus(row: Record<string, unknown>): string {
  return Object.values(row).map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
}

function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `aws-operation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function requestFor(operation: AwsManagerOperation, values: { query: string; viewArn: string; typeName: string; identifier: string; desiredState: string; patchDocument: string; requestToken: string; nextToken: string; maxResults: number; templatePath: string; stackName: string; changeSetName: string; changeSetType: CloudFormationChangeSetType; parameters: Array<{ key: string; value?: string; usePreviousValue?: boolean }>; capabilities: CloudFormationCapability[]; confirmed?: boolean }): AwsManagerRequest {
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
    ...(values.templatePath.trim() ? { templatePath: values.templatePath } : {}),
    ...(values.stackName.trim() ? { stackName: values.stackName } : {}),
    ...(values.changeSetName.trim() ? { changeSetName: values.changeSetName } : {}),
    ...(values.changeSetType ? { changeSetType: values.changeSetType } : {}),
    ...(values.parameters.length ? { parameters: values.parameters } : {}),
    ...(values.capabilities.length ? { capabilities: values.capabilities } : {}),
    maxResults: values.maxResults,
    confirmed: values.confirmed === true
  }
}

function fieldLabel(operation: AwsManagerOperation): string {
  if (operation === 'resource-search') return 'Resource query'
  if (operation === 'resource-list-views') return 'View ARN (optional)'
  if (operation === 'cloud-list-resources') return 'Resource type'
  if (operation === 'cloud-get-resource' || operation === 'cloud-update-resource' || operation === 'cloud-delete-resource') return 'Resource type and identifier'
  if (operation === 'cloud-request-status') return 'Request token'
  if (operation.startsWith('cloudformation-')) return 'CloudFormation inputs'
  return 'Operation inputs'
}

/** Guided Resource Explorer and Cloud Control manager node. Provider state remains local to core. */
export default function AwsResourceNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const vocab = useVocabularyMapper()
  const nodeIntent = data.awsManagerIntent
  const [mode, setMode] = useState<AwsManagerMode>(nodeIntent?.mode === 'cloud-control' ? 'cloud-control' : nodeIntent?.mode === 'core-services' ? 'core-services' : nodeIntent?.mode === 'cloudformation' ? 'cloudformation' : nodeIntent?.mode === 'cdk' ? 'cdk' : 'resource-explorer')
  const [coreService, setCoreService] = useState<AwsCoreServiceId>(nodeIntent?.coreService ?? 's3')
  const [platformService, setPlatformService] = useState<AwsPlatformServiceId>(nodeIntent?.platformService ?? 'ecr')
  const [operation, setOperation] = useState<AwsManagerOperation>(mode === 'cloud-control' ? CLOUD_OPERATIONS[0] : mode === 'core-services' ? (nodeIntent?.coreOperation ?? AWS_CORE_OPERATIONS.s3[0]) : mode === 'cloudformation' ? CLOUDFORMATION_OPERATIONS[0] : mode === 'platform-managers' ? (nodeIntent?.platformOperation ?? AWS_PLATFORM_OPERATIONS[0]) : RESOURCE_OPERATIONS[0])
  const [coreInput, setCoreInput] = useState<Record<string, unknown>>(nodeIntent?.platformInput ?? nodeIntent?.coreInput ?? {})
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
  const [templatePath, setTemplatePath] = useState('')
  const [stackName, setStackName] = useState(nodeIntent?.cloudFormation?.stackName ?? '')
  const [changeSetName, setChangeSetName] = useState('preview')
  const [changeSetType, setChangeSetType] = useState<CloudFormationChangeSetType>(nodeIntent?.cloudFormation?.changeSetType ?? 'CREATE')
  const [cfParameters, setCfParameters] = useState<Array<{ key: string; value?: string; usePreviousValue?: boolean }>>([])
  const [cfCapabilities, setCfCapabilities] = useState<CloudFormationCapability[]>(nodeIntent?.cloudFormation?.capabilities ?? [])
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

  const operations: readonly AwsManagerOperation[] = mode === 'cloud-control' ? CLOUD_OPERATIONS : mode === 'core-services' ? AWS_CORE_OPERATIONS[coreService] : mode === 'cloudformation' ? CLOUDFORMATION_OPERATIONS : mode === 'cdk' ? [] : mode === 'platform-managers' ? AWS_PLATFORM_OPERATIONS.filter((item) => item.startsWith(`${platformService}-`)) : RESOURCE_OPERATIONS
  useEffect(() => {
    if (operations.length > 0 && !operations.includes(operation)) setOperation(operations[0])
  }, [mode, operation, operations])

  const filteredRows = useMemo(() => {
    const rows = result?.rows ?? []
    return rows.filter((row) => resultSearch.test(resultCorpus(row)))
  }, [result, resultSearch])

  const persistIntent = (nextMode: AwsManagerMode = mode, overrides: Partial<Pick<AwsManagerPortableIntent, 'regionIntent' | 'resourceQuery' | 'cloudControlTypeName' | 'coreService' | 'coreOperation' | 'coreInput' | 'platformService' | 'platformOperation' | 'platformInput' | 'cdk'>> = {}): void => {
    updateNodeData(id, {
      awsManagerIntent: {
        schemaVersion: 1,
        mode: nextMode,
        regionIntent: (overrides.regionIntent ?? region.trim()) || 'us-east-1',
        resourceQuery: overrides.resourceQuery ?? query,
        cloudControlTypeName: overrides.cloudControlTypeName ?? typeName,
        coreService: overrides.coreService ?? coreService,
        coreOperation: overrides.coreOperation ?? (operation as AwsCoreOperation),
        coreInput: overrides.coreInput ?? coreInput as AwsManagerPortableIntent['coreInput'],
        platformService: overrides.platformService ?? platformService,
        platformOperation: overrides.platformOperation ?? (operation as AwsPlatformOperation),
        platformInput: overrides.platformInput ?? coreInput as AwsManagerPortableIntent['platformInput'],
        ...(nextMode === 'cloudformation' ? { cloudFormation: { schemaVersion: 1, stackName: stackName.trim(), changeSetType, parameterKeys: cfParameters.map((item) => item.key).filter(Boolean), capabilities: cfCapabilities } } : {})
        ,...(nextMode === 'cdk' && (overrides.cdk ?? nodeIntent?.cdk) ? { cdk: overrides.cdk ?? nodeIntent?.cdk } : {})
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

  const buildRequest = (confirmed = false): AwsManagerRequest => mode === 'core-services' || mode === 'platform-managers'
    ? { operation, service: mode === 'core-services' ? coreService : platformService, input: coreInput, nextToken: nextToken.trim() || undefined, maxResults, confirmed }
    : requestFor(operation, { query, viewArn, typeName, identifier, desiredState, patchDocument, requestToken, nextToken, maxResults, templatePath, stackName, changeSetName, changeSetType, parameters: cfParameters, capabilities: cfCapabilities, confirmed })

  const updatePlatformInput = (key: string, value: string | number | boolean): void => {
    const next = { ...coreInput, [key]: value }
    setCoreInput(next)
    persistIntent('platform-managers', { platformService, platformOperation: operation as AwsPlatformOperation, platformInput: next })
  }

  const makePreview = async (): Promise<void> => {
    if (!api.awsResource) return
    setBusy(true); setError(null)
    try { setPreview(await api.awsResource.preview(id, buildRequest())) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  const execute = async (): Promise<void> => {
    if (!api.awsResource || !preview) return
    const run = async (): Promise<void> => {
      setBusy(true); setError(null); setResult(null)
      try { setResult(await api.awsResource!.execute(id, newOperationId(), buildRequest(true))) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
    }
    if (operationRisk(operation) !== 'destructive') { await run(); return }
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rect = target?.getBoundingClientRect()
    openDestructiveGate({
      title: mode === 'core-services' ? `Confirm ${OPERATION_LABELS[operation]}` : 'Delete AWS resource',
      description: mode === 'core-services' ? 'This AWS operation changes provider state. Review the generated operation before authorizing.' : 'This action asks AWS Cloud Control to delete the named resource. Review the preview before authorizing.',
      affected: mode === 'core-services' ? [`${CORE_SERVICE_LABELS[coreService]} · ${OPERATION_LABELS[operation]}`] : [typeName || 'Resource type', identifier || 'Resource identifier'],
      confirmLabel: mode === 'core-services' ? 'Run operation' : 'Delete resource',
      anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
      restoreFocusEl: target,
      onConfirm: () => { void run() }
    })
  }

  const fill = nodeHeaderFillStyle(data.color)
  const title = data.title || (mode === 'cloud-control' ? 'AWS Cloud Control' : mode === 'core-services' ? `${CORE_SERVICE_LABELS[coreService]} manager` : mode === 'cloudformation' ? 'AWS CloudFormation' : mode === 'cdk' ? 'AWS CDK' : mode === 'platform-managers' ? `${platformService.toUpperCase()} manager` : 'AWS Resource Explorer')
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
          <button type="button" role="tab" aria-selected={mode === 'core-services'} onClick={() => { setMode('core-services'); setCoreService('s3'); setOperation(AWS_CORE_OPERATIONS.s3[0]); setCoreInput({}); persistIntent('core-services', { coreService: 's3', coreOperation: AWS_CORE_OPERATIONS.s3[0], coreInput: {} }) }}>Core services</button>
          <button type="button" role="tab" aria-selected={mode === 'cloudformation'} onClick={() => { setMode('cloudformation'); setOperation(CLOUDFORMATION_OPERATIONS[0]); persistIntent('cloudformation') }}>CloudFormation</button>
          <button type="button" role="tab" aria-selected={mode === 'cdk'} onClick={() => { setMode('cdk'); persistIntent('cdk') }}>CDK</button>
          <button type="button" role="tab" aria-selected={mode === 'platform-managers'} onClick={() => { setMode('platform-managers'); setPlatformService('ecr'); setOperation(AWS_PLATFORM_OPERATIONS[0]); setCoreInput({}); persistIntent('platform-managers', { platformService: 'ecr', platformOperation: AWS_PLATFORM_OPERATIONS[0], platformInput: {} }) }}>Containers, data and cost</button>
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
        {mode === 'cdk' ? <CdkManagerPanel
          api={{ cdk: api.cdk, dialog: api.dialog }}
          awsBinding={binding ? { profileName: binding.profileName, region: binding.region } : null}
          onIntentChange={(intent) => updateNodeData(id, { awsManagerIntent: { ...AWS_MANAGER_DEFAULT_INTENT, ...nodeIntent, mode: 'cdk', cdk: intent } })}
        /> : <>
        {mode === 'core-services' && <div className="aws-resource-node__operations" role="tablist" aria-label="AWS core services">
          {AWS_CORE_SERVICES.map((item) => <button key={item} type="button" role="tab" aria-selected={coreService === item} className={coreService === item ? 'is-selected' : ''} onClick={() => { setCoreService(item); const next = AWS_CORE_OPERATIONS[item][0]; setOperation(next); setCoreInput({}); setPreview(null); persistIntent('core-services', { coreService: item, coreOperation: next, coreInput: {} }) }}>{CORE_SERVICE_LABELS[item]}</button>)}
        </div>}
        {mode === 'platform-managers' && <div className="aws-resource-node__operations" role="tablist" aria-label="AWS platform managers">
          {AWS_PLATFORM_SERVICES.map((item) => <button key={item} type="button" role="tab" aria-selected={platformService === item} className={platformService === item ? 'is-selected' : ''} onClick={() => { setPlatformService(item); const next = AWS_PLATFORM_OPERATIONS.find((candidate) => candidate.startsWith(`${item}-`))!; setOperation(next); setCoreInput({}); setPreview(null); persistIntent('platform-managers', { platformService: item, platformOperation: next, platformInput: {} }) }}>{item.toUpperCase()}</button>)}
        </div>}
        {mode === 'cloudformation' && <section className="aws-resource-node__inputs" aria-label="CloudFormation change-set inputs">
          <label>Template file
            <div className="aws-resource-node__path-row"><input value={templatePath} onChange={(event) => setTemplatePath(event.target.value)} placeholder="Choose a local YAML or JSON template" /><button type="button" onClick={async () => { const picked = await api.dialog.selectFile(); if (picked) setTemplatePath(picked) }}>Browse</button></div>
          </label>
          <label>Stack name<input value={stackName} onChange={(event) => setStackName(event.target.value)} placeholder="Choose a stack name" /></label>
          <label>Change-set name<input value={changeSetName} onChange={(event) => setChangeSetName(event.target.value)} placeholder="preview" /></label>
          {['cloudformation-describe-change-set', 'cloudformation-execute-change-set', 'cloudformation-delete-change-set'].includes(operation) && <label>Existing change-set name<input value={changeSetName} onChange={(event) => setChangeSetName(event.target.value)} placeholder="Choose a change-set name" /></label>}
          <div className="aws-resource-node__operations" role="radiogroup" aria-label="CloudFormation change-set type"><button type="button" role="radio" aria-checked={changeSetType === 'CREATE'} className={changeSetType === 'CREATE' ? 'is-selected' : ''} onClick={() => setChangeSetType('CREATE')}>Create</button><button type="button" role="radio" aria-checked={changeSetType === 'UPDATE'} className={changeSetType === 'UPDATE' ? 'is-selected' : ''} onClick={() => setChangeSetType('UPDATE')}>Update</button></div>
          <label>Template parameters</label>
          {cfParameters.map((parameter, index) => <div key={`${parameter.key}-${index}`} className="aws-resource-node__parameter-row"><input value={parameter.key} onChange={(event) => setCfParameters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} placeholder="Parameter key" /><input value={parameter.value ?? ''} disabled={parameter.usePreviousValue === true} onChange={(event) => setCfParameters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="Parameter value" /><label><input type="checkbox" checked={parameter.usePreviousValue === true} onChange={(event) => setCfParameters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, usePreviousValue: event.target.checked } : item))} /> Use previous</label></div>)}
          <button type="button" onClick={() => setCfParameters((current) => [...current, { key: '', value: '' }])}>Add parameter</button>
          <div className="aws-resource-node__operations" role="group" aria-label="CloudFormation capabilities">{CLOUDFORMATION_CAPABILITIES.map((capability) => <button key={capability} type="button" aria-pressed={cfCapabilities.includes(capability)} className={cfCapabilities.includes(capability) ? 'is-selected' : ''} onClick={() => setCfCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability])}>{capability}</button>)}</div>
        </section>}
        <div className="aws-resource-node__operations" role="tablist" aria-label="AWS operations">
          {operations.map((item) => <button key={item} type="button" role="tab" aria-selected={operation === item} className={operation === item ? 'is-selected' : ''} onClick={() => { setOperation(item); setPreview(null); setError(null); if (mode === 'core-services') { setCoreInput({}); persistIntent('core-services', { coreOperation: item as AwsCoreOperation, coreInput: {} }) } }}>{OPERATION_LABELS[item] ?? AWS_CORE_OPERATION_LABELS[item as AwsCoreOperation]}</button>)}
        </div>
        <section className="aws-resource-node__inputs" aria-label={fieldLabel(operation)}>
          {mode === 'core-services' && <>
            {['s3-list-objects', 's3-create-bucket', 's3-delete-bucket'].includes(operation) && <label>Bucket name<input value={String(coreInput.bucket ?? '')} onChange={(event) => { const next = { ...coreInput, bucket: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreOperation: operation as AwsCoreOperation, coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} placeholder="Choose a bucket name" /></label>}
            {['ec2-start-instances', 'ec2-stop-instances', 'ec2-terminate-instances'].includes(operation) && <label>Instance IDs<input value={String(coreInput.instanceIds ?? '')} onChange={(event) => { const next = { ...coreInput, instanceIds: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} placeholder="i-0123..., i-0456..." /></label>}
            {['iam-get-user', 'iam-create-user', 'iam-delete-user'].includes(operation) && <label>User name<input value={String(coreInput.userName ?? '')} onChange={(event) => { const next = { ...coreInput, userName: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
            {['iam-get-role'].includes(operation) && <label>Role name<input value={String(coreInput.roleName ?? '')} onChange={(event) => { const next = { ...coreInput, roleName: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
            {['lambda-get-function', 'lambda-delete-function'].includes(operation) && <label>Function name<input value={String(coreInput.functionName ?? '')} onChange={(event) => { const next = { ...coreInput, functionName: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
            {operation === 'cloudwatch-get-metric-data' && <><label>Metric data queries JSON<textarea value={String(coreInput.metricDataQueries ?? '')} onChange={(event) => { const next = { ...coreInput, metricDataQueries: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label><label>Start time<input value={String(coreInput.startTime ?? '')} onChange={(event) => { const next = { ...coreInput, startTime: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} type="datetime-local" /></label><label>End time<input value={String(coreInput.endTime ?? '')} onChange={(event) => { const next = { ...coreInput, endTime: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} type="datetime-local" /></label></>}
            {operation === 'cloudwatch-list-metrics' && <label>Namespace (optional)<input value={String(coreInput.namespace ?? '')} onChange={(event) => { const next = { ...coreInput, namespace: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
            {['logs-describe-log-streams', 'logs-get-log-events', 'logs-filter-log-events'].includes(operation) && <label>Log group name<input value={String(coreInput.logGroupName ?? '')} onChange={(event) => { const next = { ...coreInput, logGroupName: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
            {['logs-get-log-events'].includes(operation) && <label>Log stream name<input value={String(coreInput.logStreamName ?? '')} onChange={(event) => { const next = { ...coreInput, logStreamName: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
            {['logs-filter-log-events'].includes(operation) && <label>Filter pattern<input value={String(coreInput.filterPattern ?? '')} onChange={(event) => { const next = { ...coreInput, filterPattern: event.target.value }; setCoreInput(next); persistIntent('core-services', { coreInput: next as AwsManagerPortableIntent['coreInput'] }) }} /></label>}
          </>}
          {mode === 'platform-managers' && <>
            {['ecr-describe-images', 'ecr-create-repository', 'ecr-delete-repository'].includes(operation) && <label>Repository name<input value={String(coreInput.repositoryName ?? '')} onChange={(event) => updatePlatformInput('repositoryName', event.target.value)} placeholder="Choose a repository name" /></label>}
            {operation === 'ecr-create-repository' && <label>Tag mutability<select value={String(coreInput.tagMutability ?? 'IMMUTABLE')} onChange={(event) => updatePlatformInput('tagMutability', event.target.value)}><option value="IMMUTABLE">Immutable</option><option value="MUTABLE">Mutable</option></select></label>}
            {['ecs-list-services', 'ecs-update-service', 'ecs-delete-service'].includes(operation) && <label>Cluster name<input value={String(coreInput.cluster ?? '')} onChange={(event) => updatePlatformInput('cluster', event.target.value)} placeholder="Choose a discovered cluster" /></label>}
            {['ecs-update-service', 'ecs-delete-service'].includes(operation) && <label>Service name<input value={String(coreInput.service ?? '')} onChange={(event) => updatePlatformInput('service', event.target.value)} /></label>}
            {operation === 'ecs-update-service' && <label>Desired task count<input type="number" min={0} max={1000} step={1} value={Number(coreInput.desiredCount ?? 1)} onChange={(event) => updatePlatformInput('desiredCount', Math.max(0, Math.min(1000, Number(event.target.value) || 0)))} /></label>}
            {['eks-describe-cluster', 'eks-update-nodegroup', 'eks-delete-cluster'].includes(operation) && <label>Cluster name<input value={String(coreInput.clusterName ?? '')} onChange={(event) => updatePlatformInput('clusterName', event.target.value)} /></label>}
            {operation === 'eks-update-nodegroup' && <><label>Node group name<input value={String(coreInput.nodegroupName ?? '')} onChange={(event) => updatePlatformInput('nodegroupName', event.target.value)} /></label><label>Minimum nodes<input type="number" min={0} max={1000} value={Number(coreInput.minimum ?? 1)} onChange={(event) => updatePlatformInput('minimum', Math.max(0, Math.min(1000, Number(event.target.value) || 0)))} /></label><label>Desired nodes<input type="number" min={0} max={1000} value={Number(coreInput.desired ?? 2)} onChange={(event) => updatePlatformInput('desired', Math.max(0, Math.min(1000, Number(event.target.value) || 0)))} /></label><label>Maximum nodes<input type="number" min={1} max={1000} value={Number(coreInput.maximum ?? 4)} onChange={(event) => updatePlatformInput('maximum', Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} /></label></>}
            {['rds-describe-db-instances', 'rds-create-db-instance', 'rds-create-db-snapshot', 'rds-delete-db-instance'].includes(operation) && <label>Database identifier<input value={String(coreInput.identifier ?? '')} onChange={(event) => updatePlatformInput('identifier', event.target.value)} /></label>}
            {operation === 'rds-create-db-instance' && <><label>Instance class<input value={String(coreInput.instanceClass ?? 'db.t3.micro')} onChange={(event) => updatePlatformInput('instanceClass', event.target.value)} /></label><label>Engine<select value={String(coreInput.engine ?? 'postgres')} onChange={(event) => updatePlatformInput('engine', event.target.value)}><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="aurora-postgresql">Aurora PostgreSQL</option><option value="aurora-mysql">Aurora MySQL</option></select></label><label>Allocated storage (GiB)<input type="number" min={20} max={65536} value={Number(coreInput.storageGiB ?? 20)} onChange={(event) => updatePlatformInput('storageGiB', Math.max(20, Math.min(65536, Number(event.target.value) || 20)))} /></label><label>Backup retention (days)<input type="number" min={0} max={35} value={Number(coreInput.backupDays ?? 7)} onChange={(event) => updatePlatformInput('backupDays', Math.max(0, Math.min(35, Number(event.target.value) || 0)))} /></label></>}
            {operation === 'rds-create-db-snapshot' && <label>Snapshot identifier<input value={String(coreInput.snapshotIdentifier ?? '')} onChange={(event) => updatePlatformInput('snapshotIdentifier', event.target.value)} /></label>}
            {['database-list-tables', 'database-create-table', 'database-delete-table'].includes(operation) && <label>Table name<input value={String(coreInput.tableName ?? '')} onChange={(event) => updatePlatformInput('tableName', event.target.value)} /></label>}
            {operation === 'database-create-table' && <><label>Attribute definitions JSON<textarea value={String(coreInput.attributeDefinitions ?? 'AttributeName=id,AttributeType=S')} onChange={(event) => updatePlatformInput('attributeDefinitions', event.target.value)} /></label><label>Key schema JSON<textarea value={String(coreInput.keySchema ?? 'AttributeName=id,KeyType=HASH')} onChange={(event) => updatePlatformInput('keySchema', event.target.value)} /></label></>}
            {['vpc-describe-vpcs', 'vpc-create-subnet', 'vpc-delete-vpc'].includes(operation) && <label>VPC id<input value={String(coreInput.vpcId ?? '')} onChange={(event) => updatePlatformInput('vpcId', event.target.value)} /></label>}
            {['vpc-create-vpc', 'vpc-create-subnet'].includes(operation) && <label>IPv4 CIDR<input value={String(coreInput.cidr ?? '')} onChange={(event) => updatePlatformInput('cidr', event.target.value)} placeholder="10.0.0.0/16" /></label>}
            {operation === 'route53-change-record' && <><label>Hosted zone id<input value={String(coreInput.hostedZoneId ?? '')} onChange={(event) => updatePlatformInput('hostedZoneId', event.target.value)} /></label><label>Change batch JSON<textarea value={String(coreInput.changeBatch ?? '{"Changes":[]}')} onChange={(event) => updatePlatformInput('changeBatch', event.target.value)} /></label></>}
            {operation === 'route53-delete-hosted-zone' && <label>Hosted zone id<input value={String(coreInput.hostedZoneId ?? '')} onChange={(event) => updatePlatformInput('hostedZoneId', event.target.value)} /></label>}
            {operation === 'cost-get-cost-and-usage' && <><label>Time period JSON<textarea value={String(coreInput.timePeriod ?? '{"Start":"2026-01-01","End":"2026-02-01"}')} onChange={(event) => updatePlatformInput('timePeriod', event.target.value)} /></label><label>Granularity<select value={String(coreInput.granularity ?? 'MONTHLY')} onChange={(event) => updatePlatformInput('granularity', event.target.value)}><option value="DAILY">Daily</option><option value="MONTHLY">Monthly</option></select></label><label>Metrics<input value={String(coreInput.metrics ?? 'UnblendedCost')} onChange={(event) => updatePlatformInput('metrics', event.target.value)} /></label></>}
            {operation === 'cost-create-budget' && <><label>Account id<input value={String(coreInput.accountId ?? '')} onChange={(event) => updatePlatformInput('accountId', event.target.value)} /></label><label>Budget JSON<textarea value={String(coreInput.budget ?? '{"BudgetLimit":{"Amount":"100","Unit":"USD"},"BudgetName":"monthly-budget","BudgetType":"COST","TimeUnit":"MONTHLY"}')} onChange={(event) => updatePlatformInput('budget', event.target.value)} /></label></>}
          </>}
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
        </>}
        <p className="aws-resource-node__hint">Portable project data keeps only the selected mode, region intent, and query. Profiles, endpoints, request tokens, result rows, CLI paths, and credentials stay local to this computer.</p>
      </div>
    </div>
  )
}
