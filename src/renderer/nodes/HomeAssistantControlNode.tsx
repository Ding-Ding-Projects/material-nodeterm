import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { HomeAssistantConnectionSummary, HomeAssistantControlConfig, HomeAssistantEntity, HomeAssistantServiceSchema } from '@shared/home-assistant-control'
import { DEFAULT_HOME_ASSISTANT_CONTROL_CONFIG, validateHomeAssistantControlConfig } from '@shared/home-assistant-control'
import type { CanvasNode } from '../state/workspace'
import { useSession } from '../session/session'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { notify } from '../lib/adhdNotify'
import { MaterialSymbol } from '../components/MaterialSymbol'
import { Button, Checkbox, Slider, TextArea } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'

function numberAttr(entity: HomeAssistantEntity, key: string, fallback: number): number {
  const value = entity.attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

type SchemaValue = string | number | boolean | null

function selectorConfig(field: HomeAssistantServiceSchema['fields'][number]): { kind: string; options: string[]; config: Record<string, unknown> } {
  const selector = field.selector ?? {}
  const entries = Object.entries(selector)
  const [kind, rawConfig] = entries[0] ?? ['text', {}]
  const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig as Record<string, unknown> : {}
  const options = Array.isArray(config.options) ? config.options.filter((value): value is string => typeof value === 'string').slice(0, 500) : []
  return { kind, options, config }
}

function stringValue(value: SchemaValue | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function coerceSchemaValues(service: HomeAssistantServiceSchema | undefined, values: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  if (!service) return values
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const field = service.fields.find((candidate) => candidate.name === name)
    const kind = field ? selectorConfig(field).kind : 'text'
    if (kind === 'boolean' && typeof value === 'string') return [name, value === 'true']
    if (kind === 'number' && typeof value === 'string') {
      const parsed = Number(value)
      return [name, Number.isFinite(parsed) ? parsed : value]
    }
    return [name, value]
  }))
}

export default function HomeAssistantControlNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { api } = useSession()
  const text = useLocalizedVocabularyText()
  const { updateNodeData } = useReactFlow()
  const config = validateHomeAssistantControlConfig(data.homeAssistantControlConfig ?? DEFAULT_HOME_ASSISTANT_CONTROL_CONFIG)
  const [connections, setConnections] = useState<HomeAssistantConnectionSummary[]>([])
  const [connectionId, setConnectionId] = useState<string>('')
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([])
  const [services, setServices] = useState<HomeAssistantServiceSchema[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(() => text('homeAssistantControl.status.chooseConnection', 'Choose a local connection. Project data contains only portable entity and service hints.'))
  const [newConnection, setNewConnection] = useState({ label: '', baseUrl: '', token: '' })
  const [fallbackValues, setFallbackValues] = useState<Record<string, string>>({})
  const entitySearch = useRegexSearchField()
  const entitySearchRef = useRef<HTMLInputElement>(null)
  const connectionSearch = useRegexSearchField()
  const connectionSearchRef = useRef<HTMLInputElement>(null)
  const serviceSearch = useRegexSearchField()
  const serviceSearchRef = useRef<HTMLInputElement>(null)

  const setConfig = useCallback((patch: Partial<HomeAssistantControlConfig>) => {
    updateNodeData(id, { homeAssistantControlConfig: { ...config, ...patch } })
  }, [config, id, updateNodeData])

  const refreshConnections = useCallback(async () => {
    const [next, status] = await Promise.all([api.homeAssistantControl.connections(), api.homeAssistantControl.status(id)])
    setConnections(next)
    setConnectionId(status.connection?.id ?? '')
    setMessage(status.reason ?? text('homeAssistantControl.status.bound', 'Bound to {label}.', { label: status.connection?.label ?? 'Home Assistant' }))
  }, [api.homeAssistantControl, id, text])

  useEffect(() => { void refreshConnections().catch((error) => setMessage(error instanceof Error ? error.message : text('homeAssistantControl.status.connectionsUnavailable', 'Local Home Assistant connections are unavailable.'))) }, [refreshConnections, text])

  const discover = useCallback(async () => {
    setBusy(true)
    setMessage(text('homeAssistantControl.status.discovering', 'Discovering entities and verified service schemas…'))
    try {
      const [nextEntities, nextServices] = await Promise.all([api.homeAssistantControl.entities(id), api.homeAssistantControl.services(id)])
      setEntities(nextEntities)
      setServices(nextServices)
      setMessage(text('homeAssistantControl.status.discovered', '{entities} entities and {services} services loaded from the bound instance.', { entities: String(nextEntities.length), services: String(nextServices.length) }))
      notify({ kind: 'success', title: text('homeAssistantControl.notification.discoveryComplete', 'Home Assistant discovery complete'), body: text('homeAssistantControl.notification.discoveryAvailable', '{entities} entities and {services} services are available.', { entities: String(nextEntities.length), services: String(nextServices.length) }) })
    } catch (error) {
      const reason = error instanceof Error ? error.message : text('homeAssistantControl.status.connectionNoAnswer', 'the local connection did not answer')
      const failure = text('homeAssistantControl.status.discoveryIncomplete', 'Discovery did not complete: {reason}. Retry or rebind.', { reason })
      setMessage(failure)
      notify({ kind: 'error', title: text('homeAssistantControl.notification.discoveryIncomplete', 'Home Assistant discovery did not complete'), body: text('homeAssistantControl.notification.discoveryRetry', '{reason}. Retry or rebind.', { reason }) })
    } finally { setBusy(false) }
  }, [api.homeAssistantControl, id, text])

  const filteredConnections = useMemo(() => connections.filter((item) => connectionSearch.test(`${item.label} ${item.origin}`)), [connections, connectionSearch])
  const filteredEntities = useMemo(() => entities.filter((entity) => entitySearch.test(`${entity.friendlyName} ${entity.entityId} ${entity.domain} ${entity.state}`)), [entities, entitySearch])
  // The runtime value may be null while no entity is selected. The schema renderer only reads
  // entityId behind selectedService, which is itself suppressed whenever this value is null.
  const selectedEntity = (entities.find((entity) => entity.entityId === config.entityHint) ?? null) as HomeAssistantEntity
  const availableServices = useMemo(() => services.filter((service) => !selectedEntity || service.domain === selectedEntity.domain || ['homeassistant', 'scene', 'script'].includes(service.domain)).filter((service) => serviceSearch.test(`${service.domain}.${service.service} ${service.name} ${service.description}`)), [selectedEntity, serviceSearch, services])
  const selectedService = selectedEntity
    ? services.find((service) => `${service.domain}.${service.service}` === config.serviceHint) ?? null
    : null

  const call = async (domain: string, service: string, values: Record<string, string | number | boolean | null> = {}): Promise<void> => {
    if (!selectedEntity) return
    setBusy(true)
    setMessage(text('homeAssistantControl.status.runningService', 'Running {serviceName}…', { serviceName: `${domain}.${service}` }))
    try {
      const result = await api.homeAssistantControl.call({ nodeId: id, domain, service, entityId: selectedEntity.entityId, data: coerceSchemaValues(services.find((candidate) => candidate.domain === domain && candidate.service === service), values) })
      setMessage(result.message)
      notify({ kind: 'success', title: text('homeAssistantControl.notification.actionConfirmed', 'Home Assistant action confirmed'), body: result.message })
      await discover()
    } catch (error) { const reason = error instanceof Error ? error.message : text('homeAssistantControl.status.instanceNoAnswer', 'the instance did not answer'); setMessage(text('homeAssistantControl.status.actionNotConfirmed', 'Action was not confirmed: {reason}.', { reason })); notify({ kind: 'error', title: text('homeAssistantControl.notification.actionNotConfirmed', 'Home Assistant action was not confirmed'), body: reason }) }
    finally { setBusy(false) }
  }

  const domainControls = (): React.JSX.Element => {
    if (!selectedEntity) return <p className="home-assistant-control__empty">{text('homeAssistantControl.entity.chooseToReveal', 'Choose an entity to reveal controls supported by its domain.')}</p>
    const domain = selectedEntity.domain
    const turnOn = text('homeAssistantControl.action.turnOn', 'Turn on')
    const turnOff = text('homeAssistantControl.action.turnOff', 'Turn off')
    if (domain === 'light') { const brightness = numberAttr(selectedEntity, 'brightness', 0); return <><div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_on')}>{turnOn}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_off')}>{turnOff}</Button></div><label>{text('homeAssistantControl.field.brightness', 'Brightness')}<Slider vocabularyMode="factual"  min={0} max={255} value={brightness} disabled={busy} onChange={(event) => void call(domain, 'turn_on', { brightness: Number(event.currentTarget.value) })} /></label></> }
    if (domain === 'fan') { const percentage = numberAttr(selectedEntity, 'percentage', 0); return <><div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_on')}>{turnOn}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_off')}>{turnOff}</Button></div><label>{text('homeAssistantControl.field.speed', 'Speed')}<Slider vocabularyMode="factual"  min={0} max={100} value={percentage} disabled={busy} onChange={(event) => void call(domain, 'set_percentage', { percentage: Number(event.currentTarget.value) })} /></label></> }
    if (domain === 'media_player') { const volume = numberAttr(selectedEntity, 'volume_level', 0); const muted = selectedEntity.attributes.is_volume_muted === true; return <><div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'media_play')}>{text('homeAssistantControl.action.play', 'Play')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'media_pause')}>{text('homeAssistantControl.action.pause', 'Pause')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'media_stop')}>{text('homeAssistantControl.action.stop', 'Stop')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'volume_mute', { is_volume_muted: !muted })}>{muted ? text('homeAssistantControl.action.unmute', 'Unmute') : text('homeAssistantControl.action.mute', 'Mute')}</Button></div><label>{text('homeAssistantControl.field.volume', 'Volume')}<Slider vocabularyMode="factual"  min={0} max={1} step={0.01} value={volume} disabled={busy} onChange={(event) => void call(domain, 'volume_set', { volume_level: Number(event.currentTarget.value) })} /></label></> }
    if (['switch', 'input_boolean', 'automation'].includes(domain)) return <div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_on')}>{turnOn}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_off')}>{turnOff}</Button></div>
    if (domain === 'cover') { const position = numberAttr(selectedEntity, 'current_position', 0); return <><div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'open_cover')}>{text('homeAssistantControl.action.open', 'Open')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'stop_cover')}>{text('homeAssistantControl.action.stop', 'Stop')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'close_cover')}>{text('homeAssistantControl.action.close', 'Close')}</Button></div><label>{text('homeAssistantControl.field.position', 'Position')}<Slider vocabularyMode="factual"  min={0} max={100} value={position} disabled={busy} onChange={(event) => void call(domain, 'set_cover_position', { position: Number(event.currentTarget.value) })} /></label></> }
    if (domain === 'lock') return <div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'lock')}>{text('homeAssistantControl.action.lock', 'Lock')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'unlock')}>{text('homeAssistantControl.action.unlock', 'Unlock')}</Button></div>
    if (domain === 'climate') { const min = numberAttr(selectedEntity, 'min_temp', 7); const max = numberAttr(selectedEntity, 'max_temp', 35); const current = numberAttr(selectedEntity, 'temperature', min); return <label>{text('homeAssistantControl.field.targetTemperature', 'Target temperature')}<Slider vocabularyMode="factual"  min={min} max={max} step={0.5} defaultValue={current} disabled={busy} onChange={(event) => void call(domain, 'set_temperature', { temperature: Number(event.currentTarget.value) })} /><span>{current}°</span></label> }
    if (domain === 'vacuum') return <div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'start')}>{text('homeAssistantControl.action.startCleaning', 'Start cleaning')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'pause')}>{text('homeAssistantControl.action.pause', 'Pause')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'stop')}>{text('homeAssistantControl.action.stop', 'Stop')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'returnToBase')}>{text('homeAssistantControl.action.returnToBase', 'Return to base')}</Button></div>
    if (domain === 'alarm_control_panel') return <div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'arm_home')}>{text('homeAssistantControl.action.armHome', 'Arm home')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'arm_away')}>{text('homeAssistantControl.action.armAway', 'Arm away')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'disarm')}>{text('homeAssistantControl.action.disarm', 'Disarm')}</Button></div>
    if (domain === 'humidifier') { const humidity = numberAttr(selectedEntity, 'humidity', 0); const min = numberAttr(selectedEntity, 'min_humidity', 0); const max = numberAttr(selectedEntity, 'max_humidity', 100); return <><div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_on')}>{turnOn}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_off')}>{turnOff}</Button></div><label>{text('homeAssistantControl.field.humidity', 'Humidity')}<Slider vocabularyMode="factual"  min={min} max={max} value={humidity} disabled={busy} onChange={(event) => void call(domain, 'set_humidity', { humidity: Number(event.currentTarget.value) })} /></label></> }
    if (domain === 'water_heater') return <div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_on')}>{turnOn}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_off')}>{turnOff}</Button></div>
    if (domain === 'number' || domain === 'input_number') { const min = numberAttr(selectedEntity, 'min', 0); const max = numberAttr(selectedEntity, 'max', 100); return <label>{text('homeAssistantControl.field.value', 'Value')}<Input vocabularyMode="factual" type="number" min={min} max={max} step={numberAttr(selectedEntity, 'step', 1)} defaultValue={Number(selectedEntity.state)} disabled={busy} onBlur={(event) => void call(domain, 'set_value', { value: Number(event.currentTarget.value) })} /></label> }
    if (domain === 'select' || domain === 'input_select') { const options = Array.isArray(selectedEntity.attributes.options) ? selectedEntity.attributes.options.filter((value): value is string => typeof value === 'string').slice(0, 500) : []; return <label>{text('homeAssistantControl.field.option', 'Option')}<Select vocabularyMode="factual" defaultValue={selectedEntity.state} disabled={busy || options.length === 0} onChange={(event) => void call(domain, 'select_option', { option: event.currentTarget.value })}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</Select></label> }
    if (domain === 'button' || domain === 'input_button') return <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'press')}>{text('homeAssistantControl.action.press', 'Press')}</Button>
    if (domain === 'scene' || domain === 'script') return <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void call(domain, 'turn_on')}>{text('homeAssistantControl.action.activate', 'Activate')}</Button>
    return <p className="home-assistant-control__empty">{text('homeAssistantControl.entity.noRichProfile', 'No rich control profile is registered for this domain. Choose a verified service schema below.')}</p>
  }

  return <div className={`term-node home-assistant-control${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
    <NodeResizer minWidth={460} minHeight={480} isVisible={selected} color={data.color} />
    <div className="term-node__header" style={{ background: `${data.color}22` }}><MaterialSymbol name="hub" size={20} /><strong>{data.title || text('homeAssistantControl.title', 'Home Assistant control')}</strong><span className="term-node__spacer" /><span role="status" aria-live="polite">{busy ? text('homeAssistantControl.status.working', 'Working…') : message}</span></div>
    <div className="home-assistant-control__body">
      <section aria-labelledby={`${id}-connection`}><h3 id={`${id}-connection`}>{text('homeAssistantControl.connection.heading', 'Connection on this computer')}</h3>
        <div className="home-assistant-control__search"><label>{text('homeAssistantControl.connection.search', 'Search connections')}<Input vocabularyMode="factual" ref={connectionSearchRef} value={connectionSearch.value} onChange={(event) => connectionSearch.setValue(event.target.value)} /></label><AnchoredRegexBuilder search={connectionSearch} fieldRef={connectionSearchRef} label={text('homeAssistantControl.connection.regex', 'Regex for Home Assistant connections')} /></div>
        <label>{text('homeAssistantControl.connection.label', 'Connection')}<Select vocabularyMode="factual" value={connectionId} disabled={busy || filteredConnections.length === 0} onChange={async (event) => { const value = event.target.value; setConnectionId(value); await api.homeAssistantControl.bind(id, value || null); setEntities([]); setServices([]); setMessage(value ? text('homeAssistantControl.status.connectionBound', 'Connection bound locally. Discover entities when ready.') : text('homeAssistantControl.status.nodeUnbound', 'Node left unbound on this computer.')) }}><option value="">{text('homeAssistantControl.connection.unbound', 'Leave unbound')}</option>{filteredConnections.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.origin}</option>)}</Select></label>
        <div className="home-assistant-control__actions"><Button variant="outlined" size="small" vocabularyMode="factual" disabled={!connectionId || busy} title={!connectionId ? text('homeAssistantControl.connection.chooseFirst', 'Choose or configure a connection first.') : undefined} onClick={() => void discover()}>{text('homeAssistantControl.discover', 'Discover or retry')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" disabled={!connectionId || busy} onClick={() => void api.homeAssistantControl.bind(id, null).then(() => { setConnectionId(''); setEntities([]); setServices([]); setMessage(text('homeAssistantControl.status.nodeUnboundPortable', 'Node left unbound. Portable entity hints remain available for rebinding.')) })}>{text('homeAssistantControl.connection.unbound', 'Leave unbound')}</Button>{busy && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void api.homeAssistantControl.cancel(id)}>{text('homeAssistantControl.action.cancel', 'Cancel')}</Button>}</div>
        <details><summary>{text('homeAssistantControl.configure', 'Configure a connection')}</summary><label>{text('homeAssistantControl.connection.name', 'Name')}<Input vocabularyMode="factual" value={newConnection.label} onChange={(event) => setNewConnection({ ...newConnection, label: event.target.value })} /></label><label>{text('homeAssistantControl.connection.url', 'Home Assistant URL')}<Input vocabularyMode="factual" type="url" value={newConnection.baseUrl} placeholder={text('homeAssistantControl.connection.urlPlaceholder', 'https://homeassistant.example')} onChange={(event) => setNewConnection({ ...newConnection, baseUrl: event.target.value })} /></label><label>{text('homeAssistantControl.connection.token', 'Long-lived access token')}<Input vocabularyMode="factual" type="password" autoComplete="off" value={newConnection.token} onChange={(event) => setNewConnection({ ...newConnection, token: event.target.value })} /></label><p>{text('homeAssistantControl.connection.tokenBoundary', 'The token is sent directly to this computer’s credential boundary. It is never written into the project.')}</p><Button variant="outlined" size="small" vocabularyMode="factual" disabled={!newConnection.label.trim() || !newConnection.baseUrl.trim() || !newConnection.token || busy} onClick={async () => { try { const saved = await api.homeAssistantControl.configure(newConnection); await api.homeAssistantControl.bind(id, saved.id); setNewConnection({ label: '', baseUrl: '', token: '' }); await refreshConnections(); setMessage(text('homeAssistantControl.status.connectionConfigured', 'Connection configured and bound locally.')); } catch (error) { setMessage(error instanceof Error ? error.message : text('homeAssistantControl.status.connectionNotSaved', 'Connection was not saved.')) } }}>{text('homeAssistantControl.connection.saveAndBind', 'Save and bind')}</Button></details>
      </section>
      <section aria-labelledby={`${id}-entity`}><h3 id={`${id}-entity`}>{text('homeAssistantControl.entity.heading', 'Entity')}</h3><div className="home-assistant-control__search"><label>{text('homeAssistantControl.entity.search', 'Search entities')}<Input vocabularyMode="factual" ref={entitySearchRef} value={entitySearch.value} onChange={(event) => entitySearch.setValue(event.target.value)} /></label><AnchoredRegexBuilder search={entitySearch} fieldRef={entitySearchRef} label={text('homeAssistantControl.entity.regex', 'Regex for Home Assistant entities')} /></div><label>{text('homeAssistantControl.entity.heading', 'Entity')}<Select vocabularyMode="factual" value={config.entityHint ?? ''} disabled={!connectionId || filteredEntities.length === 0} onChange={(event) => { const entity = entities.find((item) => item.entityId === event.target.value); setConfig({ entityHint: event.target.value || null, domainHint: entity?.domain ?? null, serviceHint: null }) }}><option value="">{text('homeAssistantControl.entity.choose', 'Choose an entity')}</option>{filteredEntities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.friendlyName} · {entity.entityId} · {entity.state}</option>)}</Select></label>{domainControls()}</section>
      <section aria-labelledby={`${id}-fallback`}><h3 id={`${id}-fallback`}>{text('homeAssistantControl.fallback.heading', 'Verified schema fallback')}</h3><div className="home-assistant-control__search"><label>{text('homeAssistantControl.service.search', 'Search services')}<Input vocabularyMode="factual" ref={serviceSearchRef} value={serviceSearch.value} onChange={(event) => serviceSearch.setValue(event.target.value)} /></label><AnchoredRegexBuilder search={serviceSearch} fieldRef={serviceSearchRef} label={text('homeAssistantControl.service.regex', 'Regex for Home Assistant services')} /></div><label>{text('homeAssistantControl.service.label', 'Service')}<Select vocabularyMode="factual" value={config.serviceHint ?? ''} disabled={!selectedEntity || availableServices.length === 0} onChange={(event) => { setFallbackValues({}); setConfig({ serviceHint: event.target.value || null, controlMode: 'schema' }) }}><option value="">{text('homeAssistantControl.service.choose', 'Choose a service')}</option>{availableServices.map((service) => <option key={`${service.domain}.${service.service}`} value={`${service.domain}.${service.service}`}>{service.name} · {service.domain}.{service.service}</option>)}</Select></label>{selectedService?.fields.map((field) => { const { kind, options, config: selector } = selectorConfig(field); const value = fallbackValues[field.name] ?? ''; const setValue = (next: SchemaValue): void => setFallbackValues({ ...fallbackValues, [field.name]: stringValue(next) }); const fieldName = field.required ? text('homeAssistantControl.schema.requiredField', '{name} (required)', { name: field.name }) : field.name; const numericMin = typeof selector.min === 'number' ? selector.min : 0; const numericMax = typeof selector.max === 'number' ? selector.max : 100; const numericStep = typeof selector.step === 'number' && selector.step > 0 ? selector.step : 1; if (kind === 'boolean') return <label key={field.name} className="home-assistant-control__schema-field"><span>{fieldName}</span><Checkbox vocabularyMode="factual" checked={value === 'true'} disabled={busy} onChange={(event) => setValue(event.currentTarget.checked)} /><small>{field.description || text('homeAssistantControl.schema.booleanHint', 'Boolean value from the verified Home Assistant schema.')}</small></label>; if (kind === 'number') return <label key={field.name} className="home-assistant-control__schema-field"><span>{fieldName}</span><Slider vocabularyMode="factual"  min={numericMin} max={numericMax} step={numericStep} value={value || String(numericMin)} disabled={busy} onChange={(event) => setValue(Number(event.currentTarget.value))} /><Input vocabularyMode="factual" type="number" min={numericMin} max={numericMax} step={numericStep} value={value} disabled={busy} onChange={(event) => setValue(event.currentTarget.value)} /><small>{field.description || text('homeAssistantControl.schema.numberHint', 'Number from {min} to {max}.', { min: String(numericMin), max: String(numericMax) })}</small></label>; if (kind === 'select' && options.length > 0) return <label key={field.name} className="home-assistant-control__schema-field"><span>{fieldName}</span><Select vocabularyMode="factual" value={value} disabled={busy} onChange={(event) => setValue(event.currentTarget.value)}><option value="">{text('homeAssistantControl.schema.chooseValue', 'Choose a value')}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</Select><small>{field.description || text('homeAssistantControl.schema.selectHint', 'Choose one value from the verified Home Assistant schema.')}</small></label>; if (kind === 'entity' || kind === 'target') return <label key={field.name} className="home-assistant-control__schema-field"><span>{fieldName}</span><Select vocabularyMode="factual" value={value || selectedEntity.entityId} disabled={busy || entities.length === 0} onChange={(event) => setValue(event.currentTarget.value)}>{entities.filter((entity) => { const domains = Array.isArray(selector.domain) ? selector.domain.filter((item): item is string => typeof item === 'string') : []; return domains.length === 0 || domains.includes(entity.domain) }).slice(0, 1000).map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.friendlyName} · {entity.entityId}</option>)}</Select><small>{field.description || text('homeAssistantControl.schema.entityHint', 'Choose an entity from the verified local entity list.')}</small></label>; const inputType = kind === 'date' ? 'date' : kind === 'time' ? 'time' : kind === 'datetime' ? 'datetime-local' : 'text'; return <label key={field.name} className="home-assistant-control__schema-field"><span>{fieldName}</span>{kind === 'text' && selector.multiline === true ? <TextArea vocabularyMode="factual" value={value} disabled={busy} maxLength={4096} onChange={(event) => setValue(event.currentTarget.value)} /> : <Input vocabularyMode="factual" type={inputType} value={value} disabled={busy} maxLength={kind === 'text' ? 4096 : undefined} onChange={(event) => setValue(event.currentTarget.value)} />}<small>{field.description || text('homeAssistantControl.schema.valueHint', 'Value is validated by the selected Home Assistant service schema.')}</small></label> })}<Button variant="outlined" size="small" vocabularyMode="factual" disabled={!selectedEntity || !selectedService || busy || selectedService.fields.some((field) => field.required && !String(fallbackValues[field.name] ?? '').trim())} onClick={() => selectedService && void call(selectedService.domain, selectedService.service, fallbackValues)}>{text('homeAssistantControl.service.run', 'Run verified service')}</Button></section>
      <p className="home-assistant-control__omission">{text('homeAssistantControl.export.omission', 'Exports include portable entity, domain, service, layout, and relationship intent only. Credentials, URLs, local connection ids, caches, host identity, and runtime requests are omitted.')}</p>
    </div>
  </div>
}
