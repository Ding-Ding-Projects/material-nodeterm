import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { HOME_ASSISTANT_SENSOR_MODES, defaultHomeAssistantSensorConfig, type HomeAssistantApi, type HomeAssistantEntitySummary, type HomeAssistantSensorConfig, type HomeAssistantSensorSnapshot } from '@shared/home-assistant'
import type { CanvasNode } from '@renderer/state/workspace'
import { validateHomeAssistantConnection } from '@shared/home-assistant'
import { useI18n } from '@renderer/lib/i18n'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'

interface Props { nodeId: string; data: CanvasNode['data'] }

export function HomeAssistantSensorPanel({ nodeId, data }: Props): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const { ts } = useI18n()
  const vocab = useVocabularyMapper()
  const copy = (id: string, fallback: string): string => vocab(ts(id, fallback))
  const connection = data.serviceConnection
  const api = window.nodeTerminal.homeAssistant as HomeAssistantApi
  const [credentialKey] = useState(() => connection?.credentialKey ?? crypto.randomUUID())
  const [endpoint, setEndpoint] = useState(connection?.endpoint ?? '')
  const configured = data.homeAssistantSensor ?? defaultHomeAssistantSensorConfig()
  const [config, setConfig] = useState<HomeAssistantSensorConfig>(configured)
  const [entities, setEntities] = useState<HomeAssistantEntitySummary[]>([])
  const [snapshot, setSnapshot] = useState<HomeAssistantSensorSnapshot | null>(null)
  const [token, setToken] = useState('')
  const [tokenStored, setTokenStored] = useState(false)
  const [tokenRevision, setTokenRevision] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'connected' | 'offline' | 'error'>('idle')
  const [error, setError] = useState('')
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const modeSearch = useRegexSearchField({ mode: 'text' })
  const modeSearchRef = useRef<HTMLInputElement>(null)

  const saveConfig = (next: HomeAssistantSensorConfig): void => {
    setConfig(next)
    updateNodeData(nodeId, { homeAssistantSensor: next })
  }

  useEffect(() => {
    if (!connection) return
    let active = true
    setStatus('loading')
    const key = connection.credentialKey ?? credentialKey
    if (!connection.credentialKey) updateNodeData(nodeId, { serviceConnection: { endpoint: connection.endpoint, credentialKey: key } })
    void api.tokenStatus(key).then((present) => {
      if (active) setTokenStored(present)
    }).catch(() => active && setStatus('error'))
    void api.listEntities({ ...connection, credentialKey: key }).then((list) => {
      if (!active) return
      setEntities(list)
      setStatus('connected')
      setError('')
    }).catch((reason: unknown) => {
      if (!active) return
      setStatus('error')
      setError(reason instanceof Error ? reason.message : 'Could not load Home Assistant entities.')
    })
    return () => { active = false }
  }, [api, connection?.endpoint, connection?.credentialKey, credentialKey, nodeId, updateNodeData])

  useEffect(() => {
    if (!connection || !config.entityId || !connection.credentialKey || !tokenStored) return
    let active = true
    setStatus('loading')
    void api.watch(nodeId, connection, config).then((initial) => {
      if (active) { setSnapshot(initial); setStatus(initial.offline ? 'offline' : 'connected'); setError('') }
    }).catch((reason: unknown) => {
      if (active) { setStatus('error'); setError(reason instanceof Error ? reason.message : 'Could not watch this sensor.') }
    })
    const unsubscribe = api.onUpdate((update) => {
      if (active && update.nodeId === nodeId) {
        setSnapshot(update.snapshot)
        setStatus(update.snapshot.offline ? 'offline' : 'connected')
      }
    })
    return () => {
      active = false
      unsubscribe()
      void api.unwatch(nodeId)
    }
  }, [api, connection, config, nodeId, tokenRevision, tokenStored])

  useEffect(() => {
    if (!snapshot?.lastUpdated) return
    const timer = window.setInterval(() => {
      setSnapshot((current) => {
        if (!current?.lastUpdated) return current
        const stale = Date.now() - Date.parse(current.lastUpdated) > config.staleAfterMs
        return stale === current.stale ? current : { ...current, stale }
      })
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [snapshot?.lastUpdated, snapshot?.stale, config.staleAfterMs])

  const visibleEntities = useMemo(() => entities.filter((entity) => search.test(`${entity.friendlyName} ${entity.entityId} ${entity.domain}`)), [entities, search])
  const modeMatches = (entry: (typeof HOME_ASSISTANT_SENSOR_MODES)[number]): boolean => modeSearch.test(`${entry.label} ${entry.description} ${entry.mode} ${copy(`homeAssistant.mode.${entry.mode}`, entry.label)}`)
  const setAndRead = (patch: Partial<HomeAssistantSensorConfig>): void => saveConfig({ ...config, ...patch })
  const saveToken = async (): Promise<void> => {
    if (!connection) return
    const key = connection.credentialKey ?? credentialKey
    try {
      await api.setToken(key, token || null)
      setToken('')
      setError('')
      const stored = await api.tokenStatus(key)
      setTokenStored(stored)
      if (stored) {
        try { setEntities(await api.listEntities({ ...connection, credentialKey: key })) }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'The entity catalogue could not be reloaded.') }
      }
      setTokenRevision((revision) => revision + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The access token could not be stored.') }
  }

  const clearToken = async (): Promise<void> => {
    if (!connection) return
    const key = connection.credentialKey ?? credentialKey
    try {
      await api.setToken(key, null)
      setToken('')
      setTokenStored(await api.tokenStatus(key))
      setEntities([])
      setTokenRevision((revision) => revision + 1)
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The access token could not be cleared.') }
  }

  if (!connection) return <div className="homeassistant-sensor-panel"><label className="service-node__field" htmlFor={`${nodeId}-ha-endpoint`}><span className="service-node__field-label">{copy('homeAssistant.address', 'Home Assistant address')}</span><input id={`${nodeId}-ha-endpoint`} className="service-node__input nodrag" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} onBlur={() => { const value = endpoint.trim(); const parsed = validateHomeAssistantConnection({ endpoint: value, credentialKey }); if (parsed) updateNodeData(nodeId, { serviceConnection: parsed }) }} placeholder="https://homeassistant.example.com:8123" aria-describedby={`${nodeId}-ha-endpoint-note`} /></label><p id={`${nodeId}-ha-endpoint-note`} className="service-node__note">{copy('homeAssistant.addressNote', 'Use HTTPS for a Home Assistant address. Credentials stay local and importing this node never connects.')}</p></div>
  return (
    <div className="homeassistant-sensor-panel" aria-label={copy('service.homeAssistantSensor', 'Home Assistant sensor display')}>
      <div className="homeassistant-sensor-panel__status" role="status">
        <strong>{status === 'connected' ? '● Connected' : status === 'offline' ? '○ Offline' : status === 'loading' ? '… Connecting' : status === 'error' ? '× Unavailable' : 'Not configured'}</strong>
        {snapshot?.stale && <span>Stale: no fresh update within the configured window.</span>}
        {error && <span>{error}</span>}
      </div>
      <div className="homeassistant-sensor-panel__token">
        <label htmlFor={`${nodeId}-ha-token`}>{copy('homeAssistant.accessToken', 'Access token')}</label>
        <input id={`${nodeId}-ha-token`} className="service-node__input nodrag" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={tokenStored ? 'Stored token, enter to replace' : 'Paste a Home Assistant token'} aria-describedby={`${nodeId}-ha-token-note`} />
        <button type="button" className="service-node__local-btn nodrag" disabled={!token} onClick={() => void saveToken()}>{copy('homeAssistant.saveToken', 'Save token')}</button>
        <button type="button" className="service-node__local-btn nodrag" disabled={!tokenStored} onClick={() => void clearToken()}>{copy('homeAssistant.clearToken', 'Clear token')}</button>
        <small id={`${nodeId}-ha-token-note`}>The token stays in the operating-system credential store and is never written to the shared canvas file.</small>
      </div>
      <label className="service-node__field" htmlFor={`${nodeId}-ha-entity`}>
        <span className="service-node__field-label">{copy('homeAssistant.entity', 'Entity')}</span>
        <div className="homeassistant-sensor-panel__picker">
          <input ref={searchRef} className="service-node__input nodrag" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Search entities" aria-label="Search Home Assistant entities" />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex — Home Assistant entities" />
          <select id={`${nodeId}-ha-entity`} className="service-node__input nodrag" value={config.entityId} onChange={(event) => setAndRead({ entityId: event.target.value })} aria-label="Home Assistant entity">
            <option value="">Choose an entity</option>
            {search.active && visibleEntities.length === 0 && <option value="" disabled>No matching entities</option>}
            {visibleEntities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.friendlyName} · {entity.entityId}</option>)}
          </select>
        </div>
      </label>
      <label className="service-node__field" htmlFor={`${nodeId}-ha-mode`}>
        <span className="service-node__field-label">{copy('homeAssistant.display', 'Display')}</span>
        <div className="homeassistant-sensor-panel__picker">
          <input ref={modeSearchRef} className="service-node__input nodrag" value={modeSearch.value} onChange={(event) => modeSearch.setValue(event.target.value)} placeholder="Search display modes" aria-label="Search Home Assistant display modes" />
          <AnchoredRegexBuilder search={modeSearch} fieldRef={modeSearchRef} label="Regex — Home Assistant display modes" />
          <select id={`${nodeId}-ha-mode`} className="service-node__input nodrag" value={config.mode} onChange={(event) => setAndRead({ mode: event.target.value as HomeAssistantSensorConfig['mode'] })}>
            {modeSearch.active && HOME_ASSISTANT_SENSOR_MODES.every((entry) => !modeMatches(entry)) && <option value={config.mode} disabled>No matching display modes</option>}
            {HOME_ASSISTANT_SENSOR_MODES.filter(modeMatches).map((entry) => <option key={entry.mode} value={entry.mode}>{copy(`homeAssistant.mode.${entry.mode}`, entry.label)}</option>)}
          </select>
        </div>
      </label>
      {(config.mode === 'trend' || config.mode === 'gauge') && <div className="homeassistant-sensor-panel__settings"><label>History hours<input className="service-node__input nodrag" type="number" min={1} max={168} value={config.historyHours} onChange={(event) => setAndRead({ historyHours: Number(event.target.value) })} /></label><label>History points<input className="service-node__input nodrag" type="number" min={1} max={500} value={config.historyLimit} onChange={(event) => setAndRead({ historyLimit: Number(event.target.value) })} /></label>{config.mode === 'gauge' && <><label>Gauge minimum<input className="service-node__input nodrag" type="number" value={config.gaugeMin ?? ''} onChange={(event) => setAndRead({ gaugeMin: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label>Gauge maximum<input className="service-node__input nodrag" type="number" value={config.gaugeMax ?? ''} onChange={(event) => setAndRead({ gaugeMax: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></>}</div>}
      {snapshot && <div className={`homeassistant-sensor-panel__value${snapshot.stale ? ' is-stale' : ''}`} aria-live="polite"><span className="homeassistant-sensor-panel__reading">{snapshot.displayValue}{snapshot.unit ? ` ${snapshot.unit}` : ''}</span><span className="homeassistant-sensor-panel__meta">Status: {snapshot.status}</span>{config.mode === 'gauge' && (snapshot.gauge ? <div className="homeassistant-sensor-panel__gauge" role="progressbar" aria-label="Sensor gauge" aria-valuemin={snapshot.gauge.min} aria-valuemax={snapshot.gauge.max} aria-valuenow={snapshot.gauge.value}><span style={{ width: `${Math.max(0, Math.min(100, ((snapshot.gauge.value - snapshot.gauge.min) / (snapshot.gauge.max - snapshot.gauge.min)) * 100))}%` }} /></div> : <p className="service-node__note">Gauge unavailable: configure minimum, maximum, and a unit, or provide them on the entity.</p>)}{snapshot.deviceClass && <span className="homeassistant-sensor-panel__meta">Device class: {snapshot.deviceClass}</span>}{snapshot.lastUpdated && <span className="homeassistant-sensor-panel__meta">Updated: {snapshot.lastUpdated}</span>}{config.mode === 'trend' && (snapshot.trendRange ? <table className="homeassistant-sensor-panel__history" tabIndex={0} aria-label="Sensor trend history"><thead><tr><th scope="col">Time</th><th scope="col">Value</th></tr></thead><tbody>{snapshot.history.map((point) => <tr key={`${point.at}-${point.state}`} tabIndex={0}><td>{new Date(point.at).toLocaleString()}</td><td>{point.value === null ? 'Unavailable' : point.value}</td></tr>)}</tbody></table> : <p className="service-node__note">Trend unavailable: no bounded numeric history is available.</p>)}{(config.mode === 'attributes' || config.mode === 'weather' || config.mode === 'calendar' || config.mode === 'event') && <dl className="homeassistant-sensor-panel__attributes">{Object.entries(snapshot.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>}{snapshot.event && <dl className="homeassistant-sensor-panel__attributes"><dt>Event type</dt><dd>{snapshot.event.eventType ?? 'Unavailable'}</dd><dt>Event time</dt><dd>{snapshot.event.timeFired ?? 'Unavailable'}</dd>{snapshot.event.data && <><dt>Event data</dt><dd>{JSON.stringify(snapshot.event.data)}</dd></>}</dl>}{snapshot.weather && <dl className="homeassistant-sensor-panel__attributes"><dt>Temperature</dt><dd>{snapshot.weather.temperature ?? 'Unavailable'}</dd><dt>Humidity</dt><dd>{snapshot.weather.humidity ?? 'Unavailable'}</dd><dt>Pressure</dt><dd>{snapshot.weather.pressure ?? 'Unavailable'}</dd><dt>Wind speed</dt><dd>{snapshot.weather.windSpeed ?? 'Unavailable'}</dd><dt>Forecast points</dt><dd>{snapshot.weather.forecast ? snapshot.weather.forecast.length : 'Unavailable'}</dd></dl>}{snapshot.calendar && <dl className="homeassistant-sensor-panel__attributes"><dt>Event</dt><dd>{snapshot.calendar.message ?? 'Unavailable'}</dd><dt>Starts</dt><dd>{snapshot.calendar.startTime ?? 'Unavailable'}</dd><dt>Ends</dt><dd>{snapshot.calendar.endTime ?? 'Unavailable'}</dd><dt>Location</dt><dd>{snapshot.calendar.location ?? 'Unavailable'}</dd></dl>}</div>}
      {snapshot && <p className="homeassistant-sensor-panel__meta">Timestamp: {snapshot.timestampStatus}</p>}
      {snapshot?.calendar && <p className="homeassistant-sensor-panel__meta">All day: {snapshot.calendar.allDay === undefined ? 'Unavailable' : snapshot.calendar.allDay ? 'Yes' : 'No'}</p>}
      {!config.entityId && <p className="service-node__note">Choose an entity to start its live display. Importing this project never connects or changes Home Assistant; Configure is always explicit.</p>}
    </div>
  )
}
