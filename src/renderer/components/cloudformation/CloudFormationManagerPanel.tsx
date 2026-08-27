import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CLOUDFORMATION_CAPABILITIES,
  CLOUDFORMATION_REGIONS,
  type CloudFormationChangeSetPreview,
  type CloudFormationParameterValue,
  type CloudFormationStatus,
  type CloudFormationTemplateInspection
} from '@shared/cloudformation'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'

function newRequestId(): string {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function CloudFormationManagerPanel(): React.JSX.Element {
  const api = window.nodeTerminal.cloudFormation
  const [status, setStatus] = useState<CloudFormationStatus | null>(null)
  const [profile, setProfile] = useState('')
  const [region, setRegion] = useState('us-east-1')
  const [stacks, setStacks] = useState<Awaited<ReturnType<NonNullable<typeof api>['listStacks']>>>([])
  const [selectedStack, setSelectedStack] = useState('')
  const [templatePath, setTemplatePath] = useState('')
  const [stackName, setStackName] = useState('')
  const [changeSetName, setChangeSetName] = useState('preview')
  const [changeSetType, setChangeSetType] = useState<'CREATE' | 'UPDATE'>('CREATE')
  const [parameters, setParameters] = useState<CloudFormationParameterValue[]>([])
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [inspection, setInspection] = useState<CloudFormationTemplateInspection | null>(null)
  const [preview, setPreview] = useState<CloudFormationChangeSetPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const activeRequestRef = useRef<string | null>(null)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const profileSearch = useRegexSearchField()
  const profileSearchRef = useRef<HTMLInputElement>(null)
  const regionSearch = useRegexSearchField()
  const regionSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!api) return
    let live = true
    void api.status().then((next) => {
      if (!live) return
      setStatus(next)
      setProfile((current) => current || next.profiles[0] || '')
    }).catch((cause) => live && setError(errorText(cause)))
    return () => { live = false }
  }, [api])

  useEffect(() => {
    if (!api || !profile || !region) return
    let live = true
    void api.listStacks({ profile, region }).then((next) => {
      if (!live) return
      setStacks(next)
      setSelectedStack((current) => current || next[0]?.stackName || '')
    }).catch((cause) => live && setError(errorText(cause)))
    return () => { live = false }
  }, [api, profile, region])

  const visibleStacks = useMemo(() => stacks.filter((row) => search.test(`${row.stackName} ${row.status} ${row.statusReason ?? ''}`)), [search, stacks])
  const visibleProfiles = useMemo(() => (status?.profiles ?? []).filter((item) => profileSearch.test(item)), [profileSearch, status])
  const visibleRegions = useMemo(() => CLOUDFORMATION_REGIONS.filter((item) => regionSearch.test(item)), [regionSearch])
  const toggleCapability = (capability: string): void => {
    setCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability])
  }
  const addParameter = (): void => setParameters((current) => [...current, { key: '', value: '' }])
  const updateParameter = (index: number, patch: Partial<CloudFormationParameterValue>): void => {
    setParameters((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  const inspect = async (): Promise<void> => {
    if (!api) return
    setBusy(true)
    setError('')
    try {
      const next = await api.inspectTemplate({ profile, region, templatePath })
      setInspection(next)
      setParameters((current) => next.parameters.map((parameter) => current.find((item) => item.key === parameter.key) ?? { key: parameter.key, value: parameter.defaultValue ?? '' }))
      setCapabilities(next.capabilities)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const previewChangeSet = async (): Promise<void> => {
    if (!api) return
    const requestId = newRequestId()
    activeRequestRef.current = requestId
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      const nextInspection = inspection ?? await api.inspectTemplate({ profile, region, templatePath })
      setInspection(nextInspection)
      const next = await api.previewChangeSet({
        requestId,
        profile,
        region,
        templatePath,
        stackName,
        changeSetName,
        changeSetType,
        parameters,
        capabilities: capabilities.filter((item): item is typeof CLOUDFORMATION_CAPABILITIES[number] => (CLOUDFORMATION_CAPABILITIES as readonly string[]).includes(item))
      })
      setPreview(next)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      if (activeRequestRef.current === requestId) activeRequestRef.current = null
      setBusy(false)
    }
  }
  const cancel = (): void => {
    if (!api) return
    const requestId = activeRequestRef.current
    if (requestId) void api.cancelPreview(requestId)
  }

  if (!api) return <div className="cloudformation-manager nodrag" role="status">CloudFormation is unavailable in this session.</div>
  return (
    <div className="cloudformation-manager nodrag" aria-label="CloudFormation manager">
      <section className="cloudformation-manager__status" aria-label="CloudFormation status">
        <strong>{status?.available ? 'AWS CLI ready' : 'AWS CLI unavailable'}</strong>
        <span>{status?.version ?? status?.unavailableReason ?? 'Checking AWS CLI…'}</span>
        {status?.origin ? <small>Using {status.origin} CLI</small> : null}
      </section>
      <section className="cloudformation-manager__scope" aria-label="AWS scope">
        <label htmlFor="cloudformation-profile-search">AWS profile</label>
        <div className="cloudformation-manager__search"><Input ref={profileSearchRef} id="cloudformation-profile-search" type="search" value={profileSearch.value} onChange={(event) => profileSearch.setValue(event.target.value)} placeholder="Search detected profiles" /><AnchoredRegexBuilder search={profileSearch} fieldRef={profileSearchRef} label="Regex builder for AWS profile search" /></div>
        <div className="cloudformation-manager__pills" role="listbox" aria-label="Detected AWS profiles">{visibleProfiles.map((item) => <button key={item} type="button" role="option" aria-selected={item === profile} onClick={() => setProfile(item)}>{item}</button>)}</div>
        <label htmlFor="cloudformation-region-search">AWS region</label>
        <div className="cloudformation-manager__search"><Input ref={regionSearchRef} id="cloudformation-region-search" type="search" value={regionSearch.value} onChange={(event) => regionSearch.setValue(event.target.value)} placeholder="Search AWS regions" /><AnchoredRegexBuilder search={regionSearch} fieldRef={regionSearchRef} label="Regex builder for AWS region search" /></div>
        <div className="cloudformation-manager__pills" role="listbox" aria-label="AWS regions">{visibleRegions.map((item) => <button key={item} type="button" role="option" aria-selected={item === region} onClick={() => setRegion(item)}>{item}</button>)}</div>
      </section>
      <section className="cloudformation-manager__stacks" aria-label="CloudFormation stacks">
        <div className="cloudformation-manager__toolbar"><div className="cloudformation-manager__search"><Input ref={searchRef} type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Search stacks" aria-label="Search CloudFormation stacks" /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex builder for CloudFormation stack search" /></div></div>
        {search.error ? <p className="cloudformation-manager__error" role="alert">{search.error}</p> : null}
        <div className="cloudformation-manager__rows">{visibleStacks.map((row) => <button key={row.stackId} type="button" className={selectedStack === row.stackName ? 'selected' : ''} onClick={() => { setSelectedStack(row.stackName); setStackName(row.stackName); setChangeSetType('UPDATE') }}><strong>{row.stackName}</strong><span>{row.status}</span></button>)}</div>
        {!visibleStacks.length ? <p className="cloudformation-manager__empty">No stacks match this search in the selected profile and region.</p> : null}
      </section>
      <section className="cloudformation-manager__form" aria-label="Change-set preview form">
        <label htmlFor="cloudformation-template">Template file</label>
        <div className="cloudformation-manager__path"><Input id="cloudformation-template" value={templatePath} onChange={(event) => setTemplatePath(event.target.value)} placeholder="Choose a local YAML or JSON template" /><Button type="button" onClick={async () => { const picked = await window.nodeTerminal.dialog.selectFile(); if (picked) setTemplatePath(picked) }}>Browse</Button></div>
        <div className="cloudformation-manager__fields"><Input value={stackName} onChange={(event) => setStackName(event.target.value)} aria-label="Stack name" placeholder="Stack name" /><Input value={changeSetName} onChange={(event) => setChangeSetName(event.target.value)} aria-label="Change-set name" placeholder="Change-set name" /><div className="cloudformation-manager__pills" role="radiogroup" aria-label="Change-set type"><button type="button" className={changeSetType === 'CREATE' ? 'selected' : ''} aria-checked={changeSetType === 'CREATE'} role="radio" onClick={() => setChangeSetType('CREATE')}>Create</button><button type="button" className={changeSetType === 'UPDATE' ? 'selected' : ''} aria-checked={changeSetType === 'UPDATE'} role="radio" onClick={() => setChangeSetType('UPDATE')}>Update</button></div></div>
        <div className="cloudformation-manager__parameters"><header><strong>Template parameters</strong><Button type="button" onClick={addParameter}>Add parameter</Button></header>{parameters.map((item, index) => <div key={`${item.key}-${index}`} className="cloudformation-manager__parameter"><Input value={item.key} onChange={(event) => updateParameter(index, { key: event.target.value })} aria-label={`Parameter ${index + 1} key`} placeholder="Parameter key" /><Input value={item.value ?? ''} onChange={(event) => updateParameter(index, { value: event.target.value, usePreviousValue: false })} aria-label={`Parameter ${index + 1} value`} placeholder="Parameter value" /><label><input type="checkbox" checked={item.usePreviousValue === true} onChange={(event) => updateParameter(index, { usePreviousValue: event.target.checked })} /> Use previous</label></div>)}</div>
        <div className="cloudformation-manager__pills" role="group" aria-label="Template capabilities">{CLOUDFORMATION_CAPABILITIES.map((capability) => <button key={capability} type="button" className={capabilities.includes(capability) ? 'selected' : ''} aria-pressed={capabilities.includes(capability)} onClick={() => toggleCapability(capability)}>{capability}</button>)}</div>
        {inspection?.description ? <p>{inspection.description}</p> : null}
        {error ? <p className="cloudformation-manager__error" role="alert">{error}</p> : null}
        <div className="cloudformation-manager__actions"><Button type="button" disabled={busy || !templatePath || !profile} onClick={() => void inspect()}>Inspect template</Button><Button type="button" disabled={busy || !templatePath || !profile || !stackName || !changeSetName} onClick={() => void previewChangeSet()}>Preview change set</Button>{busy ? <Button type="button" onClick={cancel}>Cancel</Button> : null}</div>
      </section>
      {preview ? <section className="cloudformation-manager__preview" aria-label="Change-set preview results"><header><strong>{preview.changeSetName}</strong><span>{preview.status} · {preview.executionStatus}</span></header>{preview.statusReason ? <p>{preview.statusReason}</p> : null}<div className="cloudformation-manager__rows">{preview.changes.map((change, index) => <article key={`${change.logicalResourceId}-${index}`}><strong>{change.action}: {change.logicalResourceId}</strong><span>{change.resourceType} · replacement {change.replacement}</span>{change.scope.length ? <small>{change.scope.join(', ')}</small> : null}{change.details.length ? <small>{change.details.join('; ')}</small> : null}</article>)}</div>{!preview.changes.length ? <p>No resource changes were reported by CloudFormation.</p> : null}</section> : null}
    </div>
  )
}
