import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AwsAllServicesCatalog,
  AwsCommandModel,
  AwsExecutionRequest,
  AwsFieldModel,
  AwsLocalExecutionBinding,
  AwsPortableServiceIntent,
  AwsServiceModel,
  AwsValue
} from '@shared/aws-all-services'
import {
  buildAwsExecutionPreview,
  findAwsCommand,
  findAwsService,
  normalizeAwsAllServicesCatalog,
  validateAwsCommandValues,
  validateAwsFieldValue
} from '@shared/aws-all-services'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { Button, Card, Checkbox, NumberField, Progress, StatusChip, TextField } from '../../ui/md3'
import { DestructiveConfirmGate } from '../DestructiveConfirmGate'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import './aws-all-services.css'

export interface AwsExecutionProgress {
  phase: 'preparing' | 'running' | 'waiting' | 'retrying' | 'complete' | 'failed' | 'cancelled'
  message: string
  completed?: number
  total?: number
  partialResults?: number
}

export interface AwsExecutionResult {
  summary: string
  resultCount: number
  outputPreview?: string
}

export interface AwsAllServicesClient {
  catalog(): Promise<AwsAllServicesCatalog>
  refreshCatalog(): Promise<AwsAllServicesCatalog>
  binding(nodeId: string): Promise<AwsLocalExecutionBinding>
  saveBinding(nodeId: string, binding: AwsLocalExecutionBinding): Promise<void>
  profiles(): Promise<readonly { id: string; label: string; accountLabel?: string; roleLabel?: string }[]>
  regions(): Promise<readonly { id: string; label: string }[]>
  chooseFile(input: { nodeId: string; fieldId: string; title: string }): Promise<string | null>
  execute(
    nodeId: string,
    request: AwsExecutionRequest,
    onProgress: (progress: AwsExecutionProgress) => void
  ): Promise<AwsExecutionResult>
  cancel(nodeId: string): Promise<void>
}

export interface AwsAllServicesPanelProps {
  nodeId: string
  intent: AwsPortableServiceIntent
  onIntentChange: (intent: AwsPortableServiceIntent) => void
  client?: AwsAllServicesClient
  unavailableReason?: string
}

type PickerItem = { id: string; label: string; description?: string; keywords?: string }

function SearchableChoiceList(props: {
  id: string
  label: string
  items: readonly PickerItem[]
  value: string | null | undefined
  onChange: (id: string) => void
  emptyMessage: string
  disabled?: boolean
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const search = useRegexSearchField()
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = props.items.filter((item) => search.test(`${item.label} ${item.id} ${item.keywords ?? ''} ${item.description ?? ''}`))
  return (
    <section className="aws-all-services__picker" aria-labelledby={`${props.id}-label`}>
      <div className="aws-all-services__picker-head">
        <h4 id={`${props.id}-label`}>{vocab(props.label)}</h4>
        <span role="status" aria-live="polite">{filtered.length} {vocab(filtered.length === 1 ? 'result' : 'results')}</span>
      </div>
      <div className="aws-all-services__search-row">
        <TextField
          ref={inputRef}
          label={`${props.label} search`}
          value={search.value}
          disabled={props.disabled}
          spellCheck={false}
          invalid={!!search.error}
          supportText={search.error ?? undefined}
          onChange={(event) => search.setValue(event.target.value)}
          trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={inputRef} label={`Regex for ${props.label.toLowerCase()} search`} />}
        />
      </div>
      {filtered.length ? (
        <div className="aws-all-services__choice-list" role="radiogroup" aria-label={vocab(props.label)}>
          {filtered.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`aws-all-services__choice${props.value === item.id ? ' is-selected' : ''}`}
              role="radio"
              aria-checked={props.value === item.id}
              disabled={props.disabled}
              onClick={() => props.onChange(item.id)}
            >
              <strong>{item.label}</strong>
              {item.description ? <span>{item.description}</span> : null}
              <code>{item.id}</code>
            </button>
          ))}
        </div>
      ) : <p className="aws-all-services__empty">{vocab(props.emptyMessage)}</p>}
    </section>
  )
}

function scalarFromInput(field: AwsFieldModel, raw: string): AwsValue {
  if (field.kind === 'number') return raw === '' ? null : Number(raw)
  return raw
}

function FieldEditor(props: {
  nodeId: string
  field: AwsFieldModel
  value: AwsValue | undefined
  localFile?: string
  disabled: boolean
  onChange: (value: AwsValue | undefined) => void
  onChooseFile: () => void
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { field, value } = props
  const validation = validateAwsFieldValue(field, value)
  if (field.sensitive) {
    return (
      <Card tone="container-low" className="aws-all-services__field aws-all-services__field--disabled">
        <strong>{field.label}</strong>
        <p>{field.description}</p>
        <p>{vocab('This value comes from protected local credential storage and is never entered in this form.')}</p>
      </Card>
    )
  }
  if (field.kind === 'boolean') {
    return (
      <Card tone="container-low" className="aws-all-services__field">
        <label className="aws-all-services__boolean">
          <Checkbox
            checked={value === true}
            disabled={props.disabled}
            aria-label={field.label}
            vocabularyMode="external"
            onChange={(event) => props.onChange(event.target.checked)}
          />
          <span><strong>{field.label}</strong><small>{field.description}</small></span>
        </label>
      </Card>
    )
  }
  if (field.kind === 'enum') {
    return (
      <Card tone="container-low" className="aws-all-services__field">
        <p className="aws-all-services__field-description"><strong>{field.label}</strong> {field.required ? <em>{vocab('Required')}</em> : null}<br />{field.description}</p>
        <SearchableChoiceList
          id={`${props.nodeId}-${field.id}`}
          label={field.label}
          items={(field.choices ?? []).map((choice) => ({ id: choice.value, label: choice.label, description: choice.description }))}
          value={typeof value === 'string' ? value : null}
          disabled={props.disabled}
          onChange={(choice) => props.onChange(choice)}
          emptyMessage="No modeled values match this search."
        />
      </Card>
    )
  }
  if (field.kind === 'file') {
    return (
      <Card tone="container-low" className="aws-all-services__field">
        <TextField
          label={field.label}
          value={props.localFile ?? ''}
          readOnly
          disabled={props.disabled}
          vocabularyMode="external"
          supportText={props.localFile ? vocab('Selected on this computer only. It will be omitted from project export.') : field.description}
          trailingSlot={<Button size="small" variant="text" disabled={props.disabled} onClick={props.onChooseFile}>Browse</Button>}
        />
      </Card>
    )
  }
  if (field.kind === 'list') {
    const items = Array.isArray(value) ? value : []
    return (
      <Card tone="container-low" className="aws-all-services__field">
        <div className="aws-all-services__field-title"><strong>{field.label}</strong><span>{field.description}</span></div>
        <div className="aws-all-services__repeatable">
          {items.map((item, index) => (
            <div className="aws-all-services__repeatable-row" key={`${field.id}-${index}`}>
              <TextField
                label={`${field.label} ${index + 1}`}
                value={typeof item === 'string' ? item : JSON.stringify(item)}
                disabled={props.disabled}
                vocabularyMode="external"
                onChange={(event) => {
                  const next = [...items]
                  next[index] = event.target.value
                  props.onChange(next)
                }}
              />
              <Button variant="text" danger disabled={props.disabled} onClick={() => props.onChange(items.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
            </div>
          ))}
          <Button variant="outlined" disabled={props.disabled} onClick={() => props.onChange([...items, field.item?.defaultValue ?? ''])}>Add item</Button>
        </div>
      </Card>
    )
  }
  if (field.kind === 'map') {
    const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []
    return (
      <Card tone="container-low" className="aws-all-services__field">
        <div className="aws-all-services__field-title"><strong>{field.label}</strong><span>{field.description}</span></div>
        <div className="aws-all-services__repeatable">
          {entries.map(([key, entryValue], index) => (
            <div className="aws-all-services__map-row" key={`${key}-${index}`}>
              <TextField label="Key" value={key} disabled={props.disabled} vocabularyMode="external" onChange={(event) => {
                const next = Object.fromEntries(entries)
                delete next[key]
                next[event.target.value] = entryValue
                props.onChange(next)
              }} />
              <TextField label="Value" value={typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue)} disabled={props.disabled} vocabularyMode="external" onChange={(event) => {
                props.onChange({ ...Object.fromEntries(entries), [key]: event.target.value })
              }} />
              <Button variant="text" danger disabled={props.disabled} onClick={() => props.onChange(Object.fromEntries(entries.filter(([entryKey]) => entryKey !== key)))}>Remove</Button>
            </div>
          ))}
          <Button variant="outlined" disabled={props.disabled} onClick={() => props.onChange({ ...Object.fromEntries(entries), [`key-${entries.length + 1}`]: '' })}>Add entry</Button>
        </div>
      </Card>
    )
  }
  if (field.kind === 'structure') {
    const structure = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return (
      <Card tone="container-low" className="aws-all-services__field aws-all-services__structure">
        <div className="aws-all-services__field-title"><strong>{field.label}</strong><span>{field.description}</span></div>
        {(field.members ?? []).map((member) => (
          <FieldEditor
            key={member.id}
            nodeId={`${props.nodeId}-${field.id}`}
            field={member}
            value={structure[member.id]}
            disabled={props.disabled}
            onChooseFile={props.onChooseFile}
            onChange={(next) => props.onChange({ ...structure, ...(next === undefined ? {} : { [member.id]: next }) })}
          />
        ))}
      </Card>
    )
  }
  const raw = value === undefined || value === null ? '' : String(value)
  return (
    <Card tone="container-low" className="aws-all-services__field">
      {field.kind === 'number' ? (
        <label className="aws-all-services__number-field">
          <span>{field.label}</span>
          <NumberField
            value={raw}
            disabled={props.disabled}
            min={field.minimum}
            max={field.maximum}
            aria-label={field.label}
            onChange={(event) => props.onChange(scalarFromInput(field, event.target.value))}
          />
          <small>{validation.error ?? field.description}</small>
        </label>
      ) : (
        <TextField
          label={field.label}
          value={raw}
          type={field.kind === 'date-time' ? 'datetime-local' : 'text'}
          placeholder={field.placeholder}
          disabled={props.disabled}
          required={field.required}
          invalid={!validation.valid}
          supportText={validation.error ?? field.description}
          vocabularyMode="external"
          onChange={(event) => props.onChange(scalarFromInput(field, event.target.value))}
        />
      )}
    </Card>
  )
}

function PreviewFacts(props: { request: AwsExecutionRequest }): React.JSX.Element {
  const { preview } = props.request
  return (
    <Card tone="container-high" className="aws-all-services__preview">
      <div className="aws-all-services__preview-head">
        <h4>Execution preview</h4>
        <StatusChip tone={preview.risk === 'destructive' ? 'attention' : preview.risk === 'write' ? 'running' : 'ok'}>{preview.risk}</StatusChip>
      </div>
      <dl>
        <div><dt>Service</dt><dd>{preview.serviceId}</dd></div>
        <div><dt>Operation</dt><dd>{preview.commandId}</dd></div>
        <div><dt>Profile</dt><dd>{preview.profileId ?? 'Choose a profile'}</dd></div>
        <div><dt>Account</dt><dd>{preview.accountId ?? 'Resolved at run time'}</dd></div>
        <div><dt>Role</dt><dd>{preview.roleId ?? 'No role selected'}</dd></div>
        <div><dt>Region</dt><dd>{preview.region ?? 'Profile default'}</dd></div>
        <div><dt>Endpoint</dt><dd>{preview.endpoint ?? 'AWS default'}</dd></div>
        <div><dt>Pagination</dt><dd>{preview.pagination.enabled ? 'Enabled' : 'Off'}</dd></div>
        <div><dt>Waiter</dt><dd>{preview.waiterId ?? 'None'}</dd></div>
        <div><dt>Retry</dt><dd>{preview.retryMode}</dd></div>
        <div><dt>Streaming</dt><dd>{preview.streaming ? 'Enabled' : 'Off'}</dd></div>
        <div><dt>Output</dt><dd>{preview.outputMode}</dd></div>
      </dl>
      <div className="aws-all-services__argv" aria-label="Generated argument vector">
        {preview.argv.map((arg, index) => <code key={`${index}-${arg}`}>{arg}</code>)}
      </div>
      {preview.omissions.length ? (
        <details>
          <summary>{preview.omissions.length} portable omission{preview.omissions.length === 1 ? '' : 's'}</summary>
          <ul>{preview.omissions.map((omission) => <li key={omission.fieldId}><strong>{omission.fieldId}</strong>: {omission.explanation}</li>)}</ul>
        </details>
      ) : null}
    </Card>
  )
}

export function AwsAllServicesPanel({ nodeId, intent, onIntentChange, client, unavailableReason }: AwsAllServicesPanelProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [catalog, setCatalog] = useState<AwsAllServicesCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!client)
  const [binding, setBinding] = useState<AwsLocalExecutionBinding>({})
  const [profiles, setProfiles] = useState<readonly PickerItem[]>([])
  const [regions, setRegions] = useState<readonly PickerItem[]>([])
  const [progress, setProgress] = useState<AwsExecutionProgress | null>(null)
  const [result, setResult] = useState<AwsExecutionResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<AwsExecutionRequest | null>(null)
  const running = !!progress && !['complete', 'failed', 'cancelled'].includes(progress.phase)

  const load = async (refresh = false): Promise<void> => {
    if (!client) return
    setLoading(true)
    setCatalogError(null)
    try {
      const [catalogRaw, localBinding, profileRows, regionRows] = await Promise.all([
        refresh ? client.refreshCatalog() : client.catalog(),
        client.binding(nodeId),
        client.profiles(),
        client.regions()
      ])
      setCatalog(normalizeAwsAllServicesCatalog(catalogRaw))
      setBinding(localBinding)
      setProfiles(profileRows.map((profile) => ({ id: profile.id, label: profile.label, description: [profile.accountLabel, profile.roleLabel].filter(Boolean).join(' · ') })))
      setRegions(regionRows)
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(false) }, [client, nodeId])

  const service = useMemo(() => catalog ? findAwsService(catalog, intent.serviceId) : null, [catalog, intent.serviceId])
  const command = useMemo(() => findAwsCommand(service, intent.commandId), [service, intent.commandId])
  const errors = command ? validateAwsCommandValues(command, intent.values) : {}
  let request: AwsExecutionRequest | null = null
  let previewError: string | null = null
  if (service && command) {
    try { request = buildAwsExecutionPreview({ intent, binding, service, command }) }
    catch (error) { previewError = error instanceof Error ? error.message : String(error) }
  }

  const updateBinding = (next: AwsLocalExecutionBinding): void => {
    setBinding(next)
    if (client) void client.saveBinding(nodeId, next).catch((error) => setRunError(error instanceof Error ? error.message : String(error)))
  }
  const updateValue = (fieldId: string, value: AwsValue | undefined): void => {
    const values = { ...intent.values }
    if (value === undefined || value === null || value === '') delete values[fieldId]
    else values[fieldId] = value
    onIntentChange({ ...intent, values })
  }
  const execute = async (candidate: AwsExecutionRequest): Promise<void> => {
    if (!client) return
    setRunError(null)
    setResult(null)
    setProgress({ phase: 'preparing', message: 'Preparing the modeled AWS operation.' })
    try {
      const completed = await client.execute(nodeId, candidate, setProgress)
      setResult(completed)
      setProgress({ phase: 'complete', message: completed.summary, completed: completed.resultCount, total: completed.resultCount })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRunError(message)
      setProgress({ phase: 'failed', message })
    }
  }
  const start = (): void => {
    if (!request) return
    if (request.preview.risk === 'destructive') setConfirmRequest(request)
    else void execute(request)
  }

  if (!client) {
    return (
      <Card tone="container-low" className="aws-all-services aws-all-services--unavailable" role="status">
        <h3>{vocab('AWS all-service interface')}</h3>
        <p>{vocab(unavailableReason ?? 'The local AWS model inventory is unavailable. Install or repair the bundled AWS CLI model provider, then refresh this node.')}</p>
        <Button disabled title={vocab('The AWS model provider must be available before refresh can run.')}>Refresh models</Button>
      </Card>
    )
  }

  return (
    <div className="aws-all-services" aria-label={vocab('AWS all-service interface')}>
      <header className="aws-all-services__top">
        <div><h3>{vocab('All AWS services')}</h3><p>{catalog ? `AWS CLI ${catalog.cliVersion} · ${catalog.services.length} modeled services` : vocab('Reading the installed AWS CLI model inventory…')}</p></div>
        <Button variant="outlined" disabled={loading || running} onClick={() => void load(true)}>Refresh models</Button>
      </header>
      {loading ? <Progress indeterminate aria-label={vocab('Loading AWS model inventory')} /> : null}
      {catalogError ? <Card tone="outlined" className="aws-all-services__error" role="alert"><strong>{vocab('Model inventory unavailable')}</strong><p>{catalogError}</p><Button variant="outlined" onClick={() => void load(true)}>Retry</Button></Card> : null}
      {catalog ? (
        <div className="aws-all-services__layout">
          <SearchableChoiceList
            id={`${nodeId}-services`}
            label="Services"
            items={catalog.services.map((item) => ({ id: item.id, label: item.label, description: item.description, keywords: item.name }))}
            value={intent.serviceId}
            disabled={running}
            onChange={(serviceId) => onIntentChange({ ...intent, serviceId, commandId: null, values: {}, waiterId: null })}
            emptyMessage="No installed AWS service models match this search. Refresh after installing a newer AWS CLI."
          />
          <SearchableChoiceList
            id={`${nodeId}-commands`}
            label="Commands"
            items={(service?.commands ?? []).map((item) => ({ id: item.id, label: item.label, description: item.description, keywords: item.name }))}
            value={intent.commandId}
            disabled={!service || running}
            onChange={(commandId) => onIntentChange({ ...intent, commandId, values: {}, waiterId: null, streaming: false, pagination: { enabled: false } })}
            emptyMessage={service ? 'No modeled commands match this search.' : 'Choose a service to list its modeled commands.'}
          />
        </div>
      ) : null}

      {command ? (
        <div className="aws-all-services__operation">
          <Card tone="container" className="aws-all-services__command-summary">
            <div><h3>{command.label}</h3><p>{command.description}</p></div>
            <StatusChip tone={command.risk === 'destructive' ? 'attention' : command.risk === 'write' ? 'running' : 'ok'}>{command.risk}</StatusChip>
          </Card>

          <SearchableChoiceList id={`${nodeId}-profiles`} label="Profiles" items={profiles} value={binding.profileId} disabled={running} onChange={(profileId) => updateBinding({ ...binding, profileId })} emptyMessage="No local AWS profiles are available. Configure a profile in the AWS identity manager." />
          <SearchableChoiceList id={`${nodeId}-regions`} label="Regions" items={regions} value={intent.region} disabled={running} onChange={(region) => onIntentChange({ ...intent, region })} emptyMessage="No modeled regions are available. Refresh the local AWS metadata." />

          <section className="aws-all-services__fields" aria-label={vocab('Modeled command options')}>
            {command.fields.map((field) => (
              <FieldEditor
                key={field.id}
                nodeId={nodeId}
                field={field}
                value={intent.values[field.id]}
                localFile={binding.localFiles?.[field.id]}
                disabled={running}
                onChange={(value) => updateValue(field.id, value)}
                onChooseFile={() => { if (client) void client.chooseFile({ nodeId, fieldId: field.id, title: field.label }).then((path) => { if (path) updateBinding({ ...binding, localFiles: { ...(binding.localFiles ?? {}), [field.id]: path } }) }) }}
              />
            ))}
          </section>

          <Card tone="container-low" className="aws-all-services__execution-options">
            <fieldset><legend>{vocab('Output mode')}</legend>{(['json', 'yaml', 'text', 'table'] as const).map((mode) => <Button key={mode} size="small" variant={intent.outputMode === mode ? 'filled' : 'outlined'} disabled={running} onClick={() => onIntentChange({ ...intent, outputMode: mode })}>{mode}</Button>)}</fieldset>
            <fieldset><legend>{vocab('Retry mode')}</legend>{(['standard', 'adaptive', 'legacy'] as const).map((mode) => <Button key={mode} size="small" variant={intent.retryMode === mode ? 'filled' : 'outlined'} disabled={running} onClick={() => onIntentChange({ ...intent, retryMode: mode })}>{mode}</Button>)}</fieldset>
            {command.pagination?.supported ? <label className="aws-all-services__boolean"><Checkbox checked={intent.pagination.enabled} disabled={running} onChange={(event) => onIntentChange({ ...intent, pagination: { ...intent.pagination, enabled: event.target.checked } })} /><span><strong>{vocab('Pagination')}</strong><small>{vocab('Request additional pages with bounded page and item limits.')}</small></span></label> : null}
            {intent.pagination.enabled ? <div className="aws-all-services__limits"><label>{vocab('Page size')}<NumberField min={1} value={intent.pagination.pageSize ?? ''} disabled={running} onChange={(event) => onIntentChange({ ...intent, pagination: { ...intent.pagination, pageSize: Number(event.target.value) || undefined } })} /></label><label>{vocab('Maximum items')}<NumberField min={1} value={intent.pagination.maximumItems ?? ''} disabled={running} onChange={(event) => onIntentChange({ ...intent, pagination: { ...intent.pagination, maximumItems: Number(event.target.value) || undefined } })} /></label></div> : null}
            {command.streaming ? <label className="aws-all-services__boolean"><Checkbox checked={intent.streaming} disabled={running} onChange={(event) => onIntentChange({ ...intent, streaming: event.target.checked })} /><span><strong>{vocab('Stream output')}</strong><small>{vocab('Show records as the local AWS CLI produces them.')}</small></span></label> : null}
            {command.waiters?.length ? <SearchableChoiceList id={`${nodeId}-waiters`} label="Waiters" items={[{ id: 'none', label: 'No waiter', description: 'Return when the command completes.' }, ...command.waiters]} value={intent.waiterId ?? 'none'} disabled={running} onChange={(waiterId) => onIntentChange({ ...intent, waiterId: waiterId === 'none' ? null : waiterId })} emptyMessage="No waiters match this search." /> : null}
          </Card>

          {request ? <PreviewFacts request={request} /> : <Card tone="outlined" className="aws-all-services__error" role="alert">{previewError ?? Object.values(errors)[0] ?? vocab('Complete the required modeled fields to prepare an execution preview.')}</Card>}

          {progress ? (
            <Card tone="container-high" className="aws-all-services__progress" role="status" aria-live="polite">
              <div><strong>{progress.message}</strong><span>{progress.partialResults !== undefined ? `${progress.partialResults} partial results` : progress.phase}</span></div>
              <Progress indeterminate={progress.total === undefined} value={progress.completed} max={progress.total} aria-label={progress.message} vocabularyMode="external" />
            </Card>
          ) : null}
          {runError ? <Card tone="outlined" className="aws-all-services__error" role="alert"><strong>{vocab('AWS operation failed')}</strong><p>{runError}</p><Button variant="outlined" disabled={!request || running} onClick={start}>Retry operation</Button></Card> : null}
          {result ? <Card tone="container-low" className="aws-all-services__result"><strong>{result.summary}</strong><p>{result.resultCount} {vocab(result.resultCount === 1 ? 'result' : 'results')}</p>{result.outputPreview ? <pre>{result.outputPreview}</pre> : null}</Card> : null}

          <div className="aws-all-services__actions">
            {running ? <Button variant="outlined" danger onClick={() => void client.cancel(nodeId)}>Cancel operation</Button> : null}
            <Button disabled={!request || running || Object.keys(errors).length > 0} danger={request?.preview.risk === 'destructive'} onClick={start}>Review and run</Button>
          </div>
        </div>
      ) : null}

      {confirmRequest ? (
        <DestructiveConfirmGate
          title="Run destructive AWS operation"
          description="This modeled operation can permanently change or delete AWS resources. Review the exact service, operation, account, role, region, endpoint, and arguments before authorizing it."
          affected={[`${confirmRequest.preview.serviceId} ${confirmRequest.preview.commandId}`, confirmRequest.preview.accountId ?? 'Account resolved at run time', confirmRequest.preview.region ?? 'Profile default region']}
          confirmLabel="Run operation"
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => { const accepted = confirmRequest; setConfirmRequest(null); void execute(accepted) }}
        />
      ) : null}
    </div>
  )
}

