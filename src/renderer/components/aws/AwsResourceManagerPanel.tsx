import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { CanvasNodeState } from '@shared/types'
import {
  createAwsResourceManagerIntent,
  type AwsManagerField,
  type AwsManagerOperationProgress,
  type AwsManagerResource,
  type AwsResourceManagerDefinition,
  type AwsResourceManagerId,
  type AwsResourceManagerIntent
} from '@shared/aws-resource-managers'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../state/destructiveGate'

interface AwsResourceManagerPanelProps {
  nodeId: string
  data: CanvasNodeState
}

function fieldValue(intent: AwsResourceManagerIntent | undefined, field: AwsManagerField): string | number | boolean {
  const value = intent?.safeValues[field.id]
  return value === undefined ? field.defaultValue : value
}

function managerLabel(definition: AwsResourceManagerDefinition): string {
  return `${definition.label} (${definition.id.toUpperCase()})`
}

/** Guided AWS manager surface. It never accepts a raw command or request body. */
export function AwsResourceManagerPanel({ nodeId, data }: AwsResourceManagerPanelProps): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const [catalog, setCatalog] = useState<readonly AwsResourceManagerDefinition[]>([])
  const [available, setAvailable] = useState<{ available: boolean; reason?: string; nextAction?: string }>({ available: false })
  const [resources, setResources] = useState<readonly AwsManagerResource[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<AwsManagerOperationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const managerSearch = useRegexSearchField({ mode: 'text' })
  const operationSearch = useRegexSearchField({ mode: 'text' })
  const resourceSearch = useRegexSearchField({ mode: 'text' })
  const managerSearchRef = useRef<HTMLInputElement>(null)
  const operationSearchRef = useRef<HTMLInputElement>(null)
  const resourceSearchRef = useRef<HTMLInputElement>(null)
  const intent = data.awsResourceManagerIntent ?? createAwsResourceManagerIntent()
  const definition = catalog.find((entry) => entry.id === intent.manager)
  const operation = definition?.operations.find((entry) => entry.id === intent.operation) ?? definition?.operations[0]

  useEffect(() => {
    let active = true
    void window.nodeTerminal.awsManagers.catalog().then((next) => { if (active) setCatalog(next) }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void window.nodeTerminal.awsManagers.availability(intent.manager).then((next) => { if (active) setAvailable(next) }).catch(() => { if (active) setAvailable({ available: false, reason: 'AWS manager availability could not be checked.', nextAction: 'Retry the availability check.' }) })
    return () => { active = false }
  }, [intent.manager])

  const visibleManagers = useMemo(() => catalog.filter((entry) => managerSearch.test(managerLabel(entry))), [catalog, managerSearch])
  const visibleOperations = useMemo(() => (definition?.operations ?? []).filter((entry) => operationSearch.test(`${entry.label} ${entry.description}`)), [definition, operationSearch])
  const visibleResources = useMemo(() => resources.filter((entry) => resourceSearch.test(`${entry.label} ${entry.kind} ${entry.status}`)), [resources, resourceSearch])

  const chooseManager = (manager: AwsResourceManagerId): void => {
    const next = createAwsResourceManagerIntent(manager)
    updateNodeData(nodeId, { awsResourceManagerIntent: next })
    setSelected(new Set())
    setResources([])
    setProgress(null)
    setError(null)
  }

  const chooseOperation = (operationId: string): void => {
    const next = { ...createAwsResourceManagerIntent(intent.manager), operation: operationId }
    updateNodeData(nodeId, { awsResourceManagerIntent: next })
    setSelected(new Set())
    setProgress(null)
  }

  const setField = (field: AwsManagerField, value: string | number | boolean): void => {
    const safeValues = { ...intent.safeValues, [field.id]: value }
    updateNodeData(nodeId, { awsResourceManagerIntent: { ...intent, operation: operation?.id ?? intent.operation, safeValues } })
  }

  const refreshResources = async (): Promise<void> => {
    setError(null)
    try {
      const result = await window.nodeTerminal.awsManagers.list({ manager: intent.manager, query: resourceSearch.value || undefined, region: typeof intent.safeValues.region === 'string' ? intent.safeValues.region : undefined })
      setResources(result.resources)
      if (result.warning) setError(result.warning)
    } catch (reason) { setError(String(reason)) }
  }

  const executeOperation = async (): Promise<void> => {
    if (!operation || selected.size === 0) return
    setError(null)
    try {
      const next = await window.nodeTerminal.awsManagers.run({ manager: intent.manager, operation: operation.id, resourceIds: [...selected], values: intent.safeValues })
      setProgress(next)
    } catch (reason) { setError(String(reason)) }
  }

  const runOperation = (event?: React.MouseEvent<HTMLButtonElement>): void => {
    if (!operation || selected.size === 0) return
    if (operation.risk === 'destructive') {
      const rect = event?.currentTarget.getBoundingClientRect()
      openDestructiveGate({
        title: operation.label,
        description: operation.description,
        affected: [...selected],
        confirmLabel: operation.label,
        anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
        restoreFocusEl: event?.currentTarget ?? null,
        onConfirm: () => { void executeOperation() }
      })
      return
    }
    void executeOperation()
  }

  const refreshProgress = async (): Promise<void> => {
    if (!progress) return
    try { setProgress(await window.nodeTerminal.awsManagers.progress(progress.jobId)) } catch (reason) { setError(String(reason)) }
  }

  return (
    <div className="service-node__body aws-manager-panel" role="region" aria-label="AWS resource managers">
      <div className="aws-manager-panel__section">
        <label className="service-node__field">Manager
          <div className="aws-manager-panel__search"><input ref={managerSearchRef} value={managerSearch.value} onChange={(event) => managerSearch.setValue(event.target.value)} placeholder="Search managers" aria-label="Search AWS managers" /><AnchoredRegexBuilder search={managerSearch} fieldRef={managerSearchRef} label="Regex for AWS manager search" /></div>
          <select value={intent.manager} onChange={(event) => chooseManager(event.target.value as AwsResourceManagerId)} aria-label="AWS manager">
            {visibleManagers.map((entry) => <option key={entry.id} value={entry.id}>{managerLabel(entry)}</option>)}
          </select>
        </label>
        <p className="service-node__note">{definition?.description ?? 'Loading the guided AWS manager catalog.'}</p>
      </div>
      <div className="aws-manager-panel__section">
        <label className="service-node__field">Operation
          <div className="aws-manager-panel__search"><input ref={operationSearchRef} value={operationSearch.value} onChange={(event) => operationSearch.setValue(event.target.value)} placeholder="Search operations" aria-label="Search AWS operations" /><AnchoredRegexBuilder search={operationSearch} fieldRef={operationSearchRef} label="Regex for AWS operation search" /></div>
          <select value={operation?.id ?? ''} onChange={(event) => chooseOperation(event.target.value)} aria-label="AWS operation">
            {visibleOperations.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <p className="service-node__note">{operation?.description ?? 'Choose an operation from the verified catalog.'}</p>
      </div>
      {operation && operation.fields.length > 0 && <div className="aws-manager-panel__fields">{operation.fields.map((field) => {
        const value = fieldValue(intent, field)
        if (field.kind === 'boolean') return <label className="service-node__check" key={field.id}><input type="checkbox" checked={value === true} onChange={(event) => setField(field, event.target.checked)} /> {field.label}</label>
        if (field.kind === 'choice') return <label className="service-node__field" key={field.id}>{field.label}<select value={String(value)} onChange={(event) => setField(field, event.target.value)} aria-label={field.label}>{field.options?.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className="service-node__note">{field.description}</span></label>
        return <label className="service-node__field" key={field.id}>{field.label}<input className="service-node__input nodrag" type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} value={String(value)} min={field.minimum} max={field.maximum} step={field.step} pattern={field.pattern} onChange={(event) => setField(field, field.kind === 'number' ? Number(event.target.value) : event.target.value)} aria-label={field.label} /><span className="service-node__note">{field.description}</span></label>
      })}</div>}
      <div className="aws-manager-panel__section">
        <div className="aws-manager-panel__search"><input ref={resourceSearchRef} value={resourceSearch.value} onChange={(event) => resourceSearch.setValue(event.target.value)} placeholder="Search resources" aria-label="Search AWS resources" /><AnchoredRegexBuilder search={resourceSearch} fieldRef={resourceSearchRef} label="Regex for AWS resource search" /><button type="button" onClick={() => void refreshResources()}>Refresh</button></div>
        {visibleResources.length > 0 ? <ul className="aws-manager-panel__resources">{visibleResources.map((resource) => <li key={resource.id}><label><input type="checkbox" checked={selected.has(resource.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(resource.id); else next.delete(resource.id); return next })} /> <span>{resource.label}</span> <small>{resource.kind} · {resource.status}</small></label></li>)}</ul> : <p className="service-node__note">No verified AWS resources are loaded yet. Refresh to query the configured adapter.</p>}
      </div>
      <div className="aws-manager-panel__actions"><button type="button" disabled={!available.available || selected.size === 0 || !operation} onClick={(event) => runOperation(event)} title={!available.available ? available.nextAction : undefined}>Run selected operation</button>{progress && <><button type="button" onClick={() => void refreshProgress()}>Refresh progress</button>{progress.canCancel && <button type="button" onClick={() => void window.nodeTerminal.awsManagers.cancel(progress.jobId).then(setProgress).catch((reason) => setError(String(reason)))}>Cancel</button>}{progress.canRetry && <button type="button" onClick={() => void window.nodeTerminal.awsManagers.retry(progress.jobId).then(setProgress).catch((reason) => setError(String(reason)))}>Retry</button>}</>}</div>
      {!available.available && <p className="service-node__note" role="status">{available.reason ?? 'AWS manager adapter is not available.'} {available.nextAction ?? 'Refresh after configuring the adapter.'}</p>}
      {progress && <p className="service-node__note" role="status">{progress.stage}: {progress.completed}/{progress.total}. {progress.message}</p>}
      {error && <p className="service-node__note" role="alert">{error}</p>}
    </div>
  )
}
