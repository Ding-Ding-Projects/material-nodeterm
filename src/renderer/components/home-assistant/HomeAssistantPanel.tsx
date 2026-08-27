import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeAssistantClientEvent, HomeAssistantEntity, HomeAssistantInstance, HomeAssistantNodeIntent, HomeAssistantTransport } from '@shared/home-assistant'
import { DEFAULT_HOME_ASSISTANT_NODE_INTENT, validateHomeAssistantInstanceInput } from '@shared/home-assistant'
import { useActiveSessionApi } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'

interface Props {
  nodeId: string
  boundEndpoint: string | null
  onBind: (endpoint: string | null) => void
  intent?: HomeAssistantNodeIntent
  onIntentChange: (intent: HomeAssistantNodeIntent) => void
}

const operationId = (): string => `ha-discovery-${crypto.randomUUID()}`

export function HomeAssistantPanel({ nodeId, boundEndpoint, onBind, intent = DEFAULT_HOME_ASSISTANT_NODE_INTENT, onIntentChange }: Props): React.JSX.Element {
  const api = useActiveSessionApi().homeAssistant
  const [instances, setInstances] = useState<HomeAssistantInstance[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([])
  const [transport, setTransportState] = useState<HomeAssistantTransport>(intent.transport)
  const [busyOperation, setBusyOperation] = useState<string | null>(null)
  const [progress, setProgress] = useState<HomeAssistantClientEvent | null>(null)
  const [message, setMessage] = useState('Configure or rebind this node to a Home Assistant instance on this computer.')
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const instanceSearch = useRegexSearchField()
  const entitySearch = useRegexSearchField()
  const domainSearch = useRegexSearchField()
  const instanceSearchRef = useRef<HTMLInputElement>(null)
  const entitySearchRef = useRef<HTMLInputElement>(null)
  const domainSearchRef = useRef<HTMLInputElement>(null)
  const [domain, setDomainState] = useState(intent.domain)
  const setTransport = (value: HomeAssistantTransport): void => { setTransportState(value); onIntentChange({ transport: value, domain }) }
  const setDomain = (value: string): void => { setDomainState(value); onIntentChange({ transport, domain: value }) }

  const reload = async (): Promise<void> => {
    try {
      const next = await api.instances()
      setInstances(next)
      const bound = next.find((item) => item.baseUrl === boundEndpoint)
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : bound?.id ?? next[0]?.id ?? '')
      if (!next.length) setMessage('No Home Assistant instances are configured on this computer. Add one to continue.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read Home Assistant instances. Retry the local metadata read.')
    }
  }

  useEffect(() => { void reload() }, [])
  useEffect(() => api.onEvent((event) => {
    if (event.operationId !== busyOperation) return
    setProgress(event)
    setMessage(event.message)
  }), [api, busyOperation])

  const selected = instances.find((item) => item.id === selectedId) ?? null
  const filteredInstances = instances.filter((item) => instanceSearch.test(`${item.displayName} ${item.baseUrl}`))
  const domains = useMemo(() => [...new Set(entities.map((entity) => entity.domain))].sort(), [entities])
  const filteredDomains = domains.filter((item) => domainSearch.test(item))
  const visibleEntities = entities.filter((entity) => (domain === 'all' || entity.domain === domain) && entitySearch.test(`${entity.entityId} ${entity.friendlyName} ${entity.state}`))

  const save = async (): Promise<void> => {
    setFormError(null)
    let input
    try { input = validateHomeAssistantInstanceInput({ displayName, baseUrl, token: token || null }) }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Instance details are invalid.'); return }
    try {
      const saved = await api.saveInstance(input)
      setDisplayName(''); setBaseUrl(''); setToken(''); setEditing(false)
      await reload()
      setSelectedId(saved.id)
      onBind(saved.baseUrl)
      setMessage(`${saved.displayName} was saved locally and bound to this node. The access token is not readable from the interface.`)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not save the Home Assistant instance.') }
  }

  const discover = async (): Promise<void> => {
    if (!selected) { setMessage('Select an instance before discovery.'); return }
    const id = operationId()
    setBusyOperation(id)
    setProgress({ operationId: id, instanceId: selected.id, transport, phase: 'connecting', progress: 0, message: `Starting ${transport === 'rest' ? 'REST' : 'WebSocket'} discovery.` })
    try {
      const result = await api.discover({ instanceId: selected.id, transport, operationId: id })
      if (result.state !== 'cancelled') setEntities(result.entities)
      setMessage(result.reason ?? `Discovered ${result.entities.length} entities across ${result.domains.length} domains.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Home Assistant discovery failed. Check the address and stored token, then retry.')
    } finally { setBusyOperation(null) }
  }

  const remove = (instance: HomeAssistantInstance, target: HTMLButtonElement): void => {
    const rect = target.getBoundingClientRect()
    openDestructiveGate({
      title: 'Remove Home Assistant instance',
      description: `Remove “${instance.displayName}” and its locally stored access token from this computer. Canvas nodes using it will become unbound.`,
      affected: [instance.displayName, instance.baseUrl],
      confirmLabel: 'Remove instance',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: target,
      onConfirm: () => { void api.removeInstance(instance.id).then(async (removed) => {
        if (removed && boundEndpoint === instance.baseUrl) onBind(null)
        setEntities([])
        await reload()
        setMessage(removed ? 'Instance metadata and its stored token were removed from this computer.' : 'The instance was already absent; no stored metadata changed.')
      }).catch((error) => setMessage(error instanceof Error ? error.message : 'The instance could not be removed. Its token may still be stored.')) }
    })
  }

  return <section className="ha-client nodrag" aria-label="Home Assistant multi-instance client">
    <div className="ha-client__status" role="status" aria-live="polite">
      <strong>{busyOperation ? 'Discovery in progress' : selected ? `${selected.displayName}${boundEndpoint === selected.baseUrl ? ' · bound' : ''}` : 'Unbound'}</strong>
      <span>{message}</span>
      {progress && <progress max={1} value={progress.progress} aria-label={progress.message} />}
    </div>

    <div className="ha-client__picker">
      <label>Instance
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!filteredInstances.length || !!busyOperation} aria-describedby={`${nodeId}-ha-instance-help`}>
          {!filteredInstances.length && <option value="">No matching instances</option>}
          {filteredInstances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · {instance.baseUrl}{instance.hasToken ? '' : ' · token required'}</option>)}
        </select>
      </label>
      <div className="ha-client__search-row">
        <input ref={instanceSearchRef} value={instanceSearch.value} onChange={(event) => instanceSearch.setValue(event.target.value)} placeholder="Filter instances" aria-label="Filter Home Assistant instances" />
        <AnchoredRegexBuilder search={instanceSearch} fieldRef={instanceSearchRef} label="Regex for Home Assistant instances" />
      </div>
      <p id={`${nodeId}-ha-instance-help`} className="service-node__note">Instance addresses and access tokens stay on this computer. A project opened elsewhere shows an explicit unbound state until you configure or rebind it.</p>
    </div>

    <div className="ha-client__actions">
      <button type="button" onClick={() => { if (selected) { onBind(selected.baseUrl); setMessage(`${selected.displayName} is now bound to this node on this computer.`) } }} disabled={!selected || boundEndpoint === selected.baseUrl || !!busyOperation} title={!selected ? 'Select an instance first.' : boundEndpoint === selected.baseUrl ? 'This instance is already bound.' : 'Bind this machine-local instance to the node.'}>Bind selected</button>
      <button type="button" onClick={() => setEditing((value) => !value)} disabled={!!busyOperation}>{editing ? 'Cancel configure' : 'Add instance…'}</button>
      <button type="button" onClick={(event) => selected && remove(selected, event.currentTarget)} disabled={!selected || !!busyOperation} title={!selected ? 'Select an instance before removing it.' : 'Opens the two-key confirmation flow.'}>Remove…</button>
    </div>

    {editing && <div className="ha-client__form" role="region" aria-label="Configure Home Assistant instance">
      <h3>Add Home Assistant instance</h3>
      <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus maxLength={120} placeholder="Living room" /></label>
      <label>Base address<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://homeassistant.example.com" spellCheck={false} /></label>
      <label>Long-lived access token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="Stored securely on this computer" /></label>
      <p className="service-node__note">Use HTTPS. Plain HTTP is accepted only for localhost. The token crosses the privileged boundary once, is stored through the existing credential seam, and is never returned.</p>
      {formError && <p className="ha-client__error" role="alert">{formError}</p>}
      <button type="button" onClick={() => void save()} disabled={!displayName.trim() || !baseUrl.trim() || !token}>Save and bind</button>
    </div>}

    <div className="ha-client__discovery">
      <fieldset disabled={!selected || !selected.hasToken || !!busyOperation}>
        <legend>Discovery transport</legend>
        <label><input type="radio" name={`${nodeId}-ha-transport`} checked={transport === 'rest'} onChange={() => setTransport('rest')} /> REST snapshot</label>
        <label><input type="radio" name={`${nodeId}-ha-transport`} checked={transport === 'websocket'} onChange={() => setTransport('websocket')} /> WebSocket snapshot</label>
      </fieldset>
      <div className="ha-client__actions">
        <button type="button" onClick={() => void discover()} disabled={!selected || !selected.hasToken || !!busyOperation} title={!selected ? 'Select an instance first.' : !selected.hasToken ? 'Store an access token for this instance first.' : 'Discover current entities.'}>Discover entities</button>
        <button type="button" onClick={() => busyOperation && void api.cancel(busyOperation)} disabled={!busyOperation}>Cancel discovery</button>
        <button type="button" onClick={() => void discover()} disabled={!selected || !selected.hasToken || !!busyOperation}>Retry</button>
      </div>
    </div>

    <div className="ha-client__filters">
      <label>Domain<select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="all">All domains</option>{filteredDomains.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <div className="ha-client__search-row"><input ref={domainSearchRef} value={domainSearch.value} onChange={(event) => domainSearch.setValue(event.target.value)} placeholder="Filter domains" aria-label="Filter Home Assistant domains" /><AnchoredRegexBuilder search={domainSearch} fieldRef={domainSearchRef} label="Regex for Home Assistant domains" /></div>
      <div className="ha-client__search-row"><input ref={entitySearchRef} value={entitySearch.value} onChange={(event) => entitySearch.setValue(event.target.value)} placeholder="Search entities" aria-label="Search Home Assistant entities" /><AnchoredRegexBuilder search={entitySearch} fieldRef={entitySearchRef} label="Regex for Home Assistant entities" /></div>
    </div>
    <div className="ha-client__entities" role="list" aria-label="Discovered Home Assistant entities">
      {!visibleEntities.length ? <p className="ha-client__empty">No discovered entities match these filters. Run discovery or change the filters.</p> : visibleEntities.map((entity) => <article key={entity.entityId} role="listitem" className="ha-client__entity"><div><strong>{entity.friendlyName}</strong><code>{entity.entityId}</code></div><span>{entity.state}{entity.unitOfMeasurement ? ` ${entity.unitOfMeasurement}` : ''}</span></article>)}
    </div>
  </section>
}
