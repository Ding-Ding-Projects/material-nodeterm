import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CloudFormationApi,
  CloudFormationCapability,
  CloudFormationChange,
  CloudFormationChangeSet,
  CloudFormationParameter,
  CloudFormationProfile,
  CloudFormationStackEvent,
  CloudFormationStackSummary,
  CloudFormationTag,
  CloudFormationTemplateInfo
} from '@shared/cloudformation'
import { useActiveSessionApi } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { MaterialSymbol } from '../MaterialSymbol'

export interface CloudFormationManagerPanelProps {
  onClose: () => void
}

type PanelTab = 'template' | 'change-set' | 'events'

const CAPABILITIES: CloudFormationCapability[] = ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']

const toast = (message: string, kind: 'error' | 'info' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind, message } }))
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}

function statusTone(status: string): string {
  if (/_FAILED$|ROLLBACK/.test(status)) return 'is-error'
  if (/_IN_PROGRESS$/.test(status)) return 'is-running'
  if (/_COMPLETE$/.test(status)) return 'is-success'
  return ''
}

function ChangeRows({ changes }: { changes: CloudFormationChange[] }): React.JSX.Element {
  if (changes.length === 0) return <p className="cf-empty">No resource changes were returned by CloudFormation.</p>
  return (
    <div className="cf-change-table" role="table" aria-label="Exact change-set resource changes">
      <div className="cf-change-row cf-change-row--head" role="row">
        <span>Action</span><span>Logical resource</span><span>Type</span><span>Replacement</span><span>Details</span>
      </div>
      {changes.map((item, index) => (
        <div key={`${item.logicalResourceId}-${index}`} className={`cf-change-row cf-change-row--${item.action.toLowerCase()}`} role="row">
          <strong>{item.action}</strong>
          <span>{item.logicalResourceId || 'Unknown resource'}</span>
          <span>{item.resourceType}</span>
          <span>{item.replacement ?? 'Not reported'}</span>
          <span>{item.details.length ? item.details.join('; ') : 'No additional detail'}</span>
        </div>
      ))}
    </div>
  )
}

function EventList({ events }: { events: CloudFormationStackEvent[] }): React.JSX.Element {
  return events.length === 0 ? <p className="cf-empty">No stack events are available yet.</p> : (
    <ul className="cf-events" aria-label="CloudFormation stack events">
      {events.map((item) => (
        <li key={item.eventId} className={statusTone(item.status)}>
          <div><strong>{item.status}</strong> <span>{item.logicalResourceId ?? item.stackName}</span></div>
          <time dateTime={item.timestamp}>{item.timestamp}</time>
          {item.statusReason && <p>{item.statusReason}</p>}
        </li>
      ))}
    </ul>
  )
}

export function CloudFormationManagerPanel({ onClose }: CloudFormationManagerPanelProps): React.JSX.Element {
  const api = useActiveSessionApi()
  const cloudFormation = api.cloudFormation
  return createPortal(
    <div className="drawer-overlay md3-cloudformation" onClick={onClose}>
      <aside className="drawer cloudformation" role="dialog" aria-label="CloudFormation manager" onClick={(event) => event.stopPropagation()}>
        <div className="drawer__head">
          <h2>CloudFormation manager</h2>
          <button className="drawer__close" onClick={onClose} aria-label="Close CloudFormation manager"><MaterialSymbol name="close" size={18} /></button>
        </div>
        {!cloudFormation ? (
          <div className="drawer__body"><p className="cf-empty" role="alert">CloudFormation is not available for this session. This manager never falls back to another machine.</p></div>
        ) : <CloudFormationBody api={cloudFormation} />}
      </aside>
    </div>,
    document.body
  )
}

function CloudFormationBody({ api }: { api: CloudFormationApi }): React.JSX.Element {
  const [tab, setTab] = useState<PanelTab>('template')
  const [status, setStatus] = useState<{ available: boolean; version: string | null; reason: string | null } | null>(null)
  const [profiles, setProfiles] = useState<CloudFormationProfile[]>([])
  const [regions, setRegions] = useState<string[]>([])
  const [profile, setProfile] = useState('default')
  const [region, setRegion] = useState('us-east-1')
  const [stacks, setStacks] = useState<CloudFormationStackSummary[]>([])
  const [stackName, setStackName] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateBody, setTemplateBody] = useState('')
  const [templateInfo, setTemplateInfo] = useState<CloudFormationTemplateInfo | null>(null)
  const [parameters, setParameters] = useState<CloudFormationParameter[]>([])
  const [capabilities, setCapabilities] = useState<CloudFormationCapability[]>([])
  const [tags, setTags] = useState<CloudFormationTag[]>([])
  const [changeSetName, setChangeSetName] = useState('reviewed-change-set')
  const [changeSetType, setChangeSetType] = useState<'CREATE' | 'UPDATE'>('UPDATE')
  const [changeSet, setChangeSet] = useState<CloudFormationChangeSet | null>(null)
  const [events, setEvents] = useState<CloudFormationStackEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const search = useRegexSearchField()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const loadContext = useCallback(async () => {
    setError(null)
    try {
      const [s, p, r] = await Promise.all([api.status(), api.profiles(), api.regions()])
      setStatus(s)
      setProfiles(p)
      setRegions(r)
      if (p.length && !p.some((item) => item.name === profile)) setProfile(p[0].name)
      if (r.length && !r.includes(region)) setRegion(r[0])
    } catch (e) { setError(describeError(e)) }
  }, [api, profile, region])

  useEffect(() => { void loadContext() }, [loadContext])

  const loadStacks = useCallback(async () => {
    try { setStacks(await api.stacks({ profile, region })) } catch (e) { setError(describeError(e)) }
  }, [api, profile, region])

  useEffect(() => { if (status?.available) void loadStacks() }, [loadStacks, status?.available])

  const pickTemplate = async (file: File): Promise<void> => {
    if (file.size > 1024 * 1024) { setError('Template is larger than the 1 MiB safety limit.'); return }
    try {
      setTemplateName(file.name)
      const body = await file.text()
      setTemplateBody(body)
      setTemplateInfo(null)
      setChangeSet(null)
      setError(null)
    } catch (e) { setError(describeError(e)) }
  }

  const validate = async (): Promise<void> => {
    if (!templateBody.trim()) { setError('Choose a local CloudFormation template first.'); return }
    setBusy(true); setError(null)
    try {
      const result = await api.validate({ profile, region, templateBody })
      setTemplateInfo(result)
      if (!result.valid) setError(result.error ?? 'CloudFormation rejected this template.')
      else {
        setParameters(result.parameters.map((p) => ({ parameterKey: p.key, parameterValue: p.defaultValue ?? '', usePreviousValue: false })))
        setTab('template')
      }
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }

  const createPreview = async (): Promise<void> => {
    if (!templateInfo?.valid || !stackName.trim() || !changeSetName.trim()) { setError('Validate the template and provide a stack and change-set name first.'); return }
    setBusy(true); setError(null)
    try {
      const result = await api.createChangeSet({ profile, region, templateBody, stackName: stackName.trim(), changeSetName: changeSetName.trim(), changeSetType, parameters, capabilities, tags })
      setChangeSet(result)
      setTab('change-set')
      toast(`Change set ${result.name} is ready for review.`)
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }

  const refreshEvents = async (): Promise<void> => {
    if (!stackName.trim()) return
    try { setEvents((await api.events({ profile, region, stackName: stackName.trim() })).events); setTab('events') } catch (e) { setError(describeError(e)) }
  }

  const execute = (): void => {
    if (!changeSet || changeSet.status !== 'CREATE_COMPLETE' || changeSet.executionStatus !== 'AVAILABLE') { setError('Only an available change set can be executed. Refresh its preview first.'); return }
    const run = async (): Promise<void> => {
      setBusy(true); setError(null)
      try {
        await api.executeChangeSet({ profile, region, stackName: changeSet.stackName, changeSetName: changeSet.name })
        toast(`Started ${changeSet.stackName} ${changeSet.changes.length ? 'change' : 'operation'}.`)
        await refreshEvents()
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
    }
    if (changeSet.destructive) {
      openDestructiveGate({
        title: `Execute destructive change set ${changeSet.name}`,
        description: 'This reviewed change set includes resource removal or replacement. Both keys and the full slider are required before AWS is called.',
        affected: changeSet.changes.filter((item) => item.action === 'Remove' || item.replacement === 'True').map((item) => `${item.action} ${item.logicalResourceId} (${item.resourceType})`),
        confirmLabel: 'Execute change set',
        onConfirm: () => { void run() }
      })
    } else void run()
  }

  const waitForStack = async (): Promise<void> => {
    if (!stackName.trim()) return
    setBusy(true); setError(null)
    try {
      const waiter = changeSetType === 'CREATE' ? 'stack-create-complete' : 'stack-update-complete'
      const result = await api.wait({ profile, region, stackName: stackName.trim(), waiter })
      setEvents(result.events)
      if (result.status === 'success') toast(`${stackName} reached ${result.stack?.status ?? 'complete'}.`)
      else setError(result.error ?? `The waiter ended with ${result.status}.`)
      setTab('events')
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }

  const visibleStacks = useMemo(() => stacks.filter((stack) => search.test(`${stack.stackName} ${stack.status} ${stack.statusReason ?? ''}`)), [search, stacks])

  return <div className="drawer__body cf-body">
    <div className="cf-context">
      <label>Profile<select value={profile} onChange={(e) => setProfile(e.target.value)}>{profiles.length ? profiles.map((p) => <option key={p.name} value={p.name}>{p.name}{p.accountId ? ` · ${p.accountId}` : ''}</option>) : <option value="default">default</option>}</select></label>
      <label>Region<select value={region} onChange={(e) => setRegion(e.target.value)}>{(regions.length ? regions : [region]).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <button className="sc-btn" type="button" onClick={() => void loadContext()}>Refresh account</button>
    </div>
    {status && !status.available && <p className="cf-warning" role="alert">AWS CLI is unavailable: {status.reason ?? 'the executable could not be started'}. No arbitrary command entry is provided.</p>}
    {error && <p className="cf-error" role="alert">{error}</p>}
    <div className="cf-tabs" role="tablist" aria-label="CloudFormation manager sections">
      {(['template', 'change-set', 'events'] as PanelTab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item === 'template' ? 'Template' : item === 'change-set' ? 'Change set' : 'Events'}</button>)}
    </div>
    {tab === 'template' && <>
      <section className="cf-section"><h3>1. Choose and validate a template</h3><p className="cf-help">The file stays local until the reviewed validation request. JSON and YAML are accepted; the core validates bounded bytes before sending them to CloudFormation.</p><input type="file" accept=".json,.yaml,.yml,application/json,text/yaml" onChange={(e) => { const file = e.target.files?.[0]; if (file) void pickTemplate(file) }} aria-label="Choose CloudFormation template" />{templateName && <p className="cf-file">{templateName} · {templateBody.length.toLocaleString()} characters</p>}<button className="sc-btn primary" type="button" onClick={() => void validate()} disabled={busy || !templateBody.trim()}>Validate template</button>{templateInfo && <div className={templateInfo.valid ? 'cf-valid' : 'cf-error'}><strong>{templateInfo.valid ? 'Template is valid' : 'Template is invalid'}</strong>{templateInfo.description && <p>{templateInfo.description}</p>}{templateInfo.error && <p>{templateInfo.error}</p>}{templateInfo.warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}</div>}</section>
      <section className="cf-section"><h3>2. Choose the stack</h3><label>Stack name<select value={stackName} onChange={(e) => setStackName(e.target.value)}><option value="">Choose an existing stack…</option>{visibleStacks.map((stack) => <option key={stack.stackId} value={stack.stackName}>{stack.stackName} · {stack.status}</option>)}</select></label><div className="cf-search"><input ref={searchInputRef} type="search" value={search.value} onChange={(e) => search.setValue(e.target.value)} placeholder={search.mode === 'regex' ? 'Filter stacks (regex)…' : 'Filter stacks…'} aria-label="Search CloudFormation stacks" /><AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — CloudFormation stack search" /></div><label>Or enter a new stack name<input value={stackName} onChange={(e) => setStackName(e.target.value)} placeholder="my-stack" /></label></section>
      <section className="cf-section"><h3>3. Parameters, capabilities, and tags</h3>{parameters.length === 0 ? <p className="cf-empty">Validate a template with parameters to edit them here.</p> : parameters.map((param, index) => <label key={param.parameterKey}>{param.parameterKey}<input value={param.parameterValue} onChange={(e) => setParameters((current) => current.map((item, i) => i === index ? { ...item, parameterValue: e.target.value, usePreviousValue: false } : item))} /><span><input type="checkbox" checked={!!param.usePreviousValue} onChange={(e) => setParameters((current) => current.map((item, i) => i === index ? { ...item, usePreviousValue: e.target.checked } : item))} /> Use previous value</span></label>)}<fieldset><legend>Capabilities</legend>{CAPABILITIES.map((capability) => <label key={capability}><input type="checkbox" checked={capabilities.includes(capability)} onChange={(e) => setCapabilities((current) => e.target.checked ? [...current, capability] : current.filter((item) => item !== capability))} /> {capability}{capability !== 'CAPABILITY_AUTO_EXPAND' && <small> Review IAM permissions before enabling.</small>}</label>)}</fieldset><label>Tag key/value<input aria-label="New tag key" placeholder="Environment=staging" onKeyDown={(e) => { if (e.key === 'Enter') { const [key, ...rest] = e.currentTarget.value.split('='); if (key?.trim()) setTags((current) => [...current, { key: key.trim(), value: rest.join('=').trim() }]); e.currentTarget.value = '' } }} /></label>{tags.length > 0 && <ul className="cf-tags">{tags.map((tag) => <li key={`${tag.key}-${tag.value}`}>{tag.key} = {tag.value}<button type="button" onClick={() => setTags((current) => current.filter((item) => item !== tag))} aria-label={`Remove tag ${tag.key}`}>Remove</button></li>)}</ul>}<label>Change-set name<input value={changeSetName} onChange={(e) => setChangeSetName(e.target.value)} /></label><label>Operation<select value={changeSetType} onChange={(e) => setChangeSetType(e.target.value as 'CREATE' | 'UPDATE')}><option value="UPDATE">Update existing stack</option><option value="CREATE">Create new stack</option></select></label><button className="sc-btn primary" type="button" onClick={() => void createPreview()} disabled={busy || !templateInfo?.valid || !stackName.trim()}>Create reviewed change set</button></section>
    </>}
    {tab === 'change-set' && <section className="cf-section"><h3>Exact change-set preview</h3>{!changeSet ? <p className="cf-empty">No change set has been created in this session.</p> : <><p><strong>{changeSet.name}</strong> · {changeSet.status} · execution {changeSet.executionStatus}</p>{changeSet.statusReason && <p className="cf-warning">{changeSet.statusReason}</p>}{changeSet.iamWarnings.length > 0 && <div className="cf-warning"><strong>IAM review required</strong>{changeSet.iamWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}<ChangeRows changes={changeSet.changes} /><div className="cf-actions"><button className="sc-btn" type="button" onClick={() => void api.describeChangeSet({ profile, region, stackName: changeSet.stackName, changeSetName: changeSet.name }).then(setChangeSet).catch((e) => setError(describeError(e)))}>Refresh preview</button><button className="sc-btn primary" type="button" disabled={busy || changeSet.executionStatus !== 'AVAILABLE' || changeSet.status !== 'CREATE_COMPLETE'} onClick={execute}>Review and execute</button></div></>}</section>}
    {tab === 'events' && <section className="cf-section"><h3>Stack events and waiter</h3><div className="cf-actions"><button className="sc-btn" type="button" onClick={() => void refreshEvents()} disabled={!stackName.trim()}>Refresh events</button><button className="sc-btn" type="button" onClick={() => void waitForStack()} disabled={!stackName.trim() || busy}>Wait for {changeSetType === 'CREATE' ? 'create' : 'update'}</button></div><EventList events={events} /></section>}
  </div>
}
