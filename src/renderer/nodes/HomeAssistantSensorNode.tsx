import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  DEFAULT_HOME_ASSISTANT_SENSOR_CONFIG,
  HOME_ASSISTANT_DISPLAY_MODES,
  suggestedHomeAssistantDisplayMode,
  validateHomeAssistantSensorConfig,
  type HomeAssistantBindingStatus,
  type HomeAssistantDisplayMode,
  type HomeAssistantEntityBinding,
  type HomeAssistantEntityState,
  type HomeAssistantHistoryPoint,
  type HomeAssistantSensorSnapshot
} from '@shared/home-assistant-sensor'
import type { CanvasNode } from '../state/workspace'
import { useSession } from '../session/session'
import { openDestructiveGate } from '../state/destructiveGate'
import { notify } from '../state/notifications'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence, type DisplaySegment } from '../lib/personalVocabulary/ownedCopy'

const EMPTY_BINDING: HomeAssistantBindingStatus = { nodeId: '', state: 'unbound', instanceLabel: null, credentialStored: false, lastSuccessfulAt: null, reason: null }

type SensorTextPart = DisplaySegment
type SensorVocabularyMapper = (text: string) => string

/** Keep app-owned copy separate from provider and user facts at this node's text boundary. */
function mapSensorSentence(map: SensorVocabularyMapper, parts: readonly SensorTextPart[]): string {
  return mapOwnedSentence(map, parts)
}

function sensorCopy(map: SensorVocabularyMapper, text: string): string {
  return mapSensorSentence(map, [copy(text)])
}

function sensorFact(value: unknown): SensorTextPart {
  return fact(String(value))
}

function displayModeLabel(mode: HomeAssistantDisplayMode): string {
  return HOME_ASSISTANT_DISPLAY_MODES.find((candidate) => candidate.id === mode)?.label ?? mode
}

function resolvedMode(binding: HomeAssistantEntityBinding, entity: HomeAssistantEntityState): HomeAssistantDisplayMode {
  return binding.mode === 'auto' ? suggestedHomeAssistantDisplayMode(entity) : binding.mode
}

function Trend({ points, unit, map }: { points: HomeAssistantHistoryPoint[]; unit: string | null; map: SensorVocabularyMapper }): React.JSX.Element {
  const numeric = points.map((point) => point.numericValue).filter((value): value is number => value !== null)
  if (numeric.length < 2) return <p className="ha-sensor-node__muted">{sensorCopy(map, 'A trend appears after two numeric observations.')}</p>
  const low = Math.min(...numeric)
  const high = Math.max(...numeric)
  const spread = Math.max(1, high - low)
  const trendLabel = mapSensorSentence(map, [copy('Trend from '), sensorFact(low), sensorFact(unit ?? ''), copy(' to '), sensorFact(high), sensorFact(unit ?? ''), copy(' across '), sensorFact(numeric.length), copy(' observations')])
  return <div className="ha-sensor-node__trend" role="img" aria-label={trendLabel}>
    {numeric.slice(-48).map((value, index) => <span key={index} style={{ height: `${Math.max(8, ((value - low) / spread) * 92)}%` }} title={`${value}${unit ?? ''}`} />)}
  </div>
}

function EntityValue({ entity, binding, points, map }: { entity: HomeAssistantEntityState; binding: HomeAssistantEntityBinding; points: HomeAssistantHistoryPoint[]; map: SensorVocabularyMapper }): React.JSX.Element {
  const mode = resolvedMode(binding, entity)
  const numeric = Number(entity.state)
  if (mode === 'binary') return <p className={`ha-sensor-node__binary ha-sensor-node__binary--${entity.state === 'on' ? 'on' : 'off'}`}><span aria-hidden="true" />{entity.state === 'on' ? sensorCopy(map, 'On or active') : entity.state === 'off' ? sensorCopy(map, 'Off or inactive') : entity.state}</p>
  if (mode === 'enum') return <div><strong className="ha-sensor-node__value">{entity.state}</strong><p className="ha-sensor-node__muted">{mapSensorSentence(map, [copy('Options: '), entity.options.length ? sensorFact(entity.options.join(', ')) : copy('No option catalog was supplied.')])}</p></div>
  if (mode === 'gauge') {
    const min = binding.min ?? 0
    const max = binding.max ?? 100
    const value = Number.isFinite(numeric) ? numeric : min
    return <div><meter min={min} max={max} value={Math.min(max, Math.max(min, value))}>{value}</meter><p className="ha-sensor-node__value">{entity.state}{entity.unit ? ` ${entity.unit}` : ''}</p><p className="ha-sensor-node__muted">{mapSensorSentence(map, [copy('Reviewed range: '), sensorFact(min), copy(' to '), sensorFact(max)])}</p></div>
  }
  if (mode === 'trend') return <><Trend points={points} unit={entity.unit} map={map} /><p className="ha-sensor-node__value">{entity.state}{entity.unit ? ` ${entity.unit}` : ''}</p></>
  if (mode === 'event') return <><p className="ha-sensor-node__value">{entity.state}</p><p className="ha-sensor-node__muted">{mapSensorSentence(map, [copy('Event type: '), entity.attributes.event_type == null ? copy('not supplied') : sensorFact(entity.attributes.event_type)])}</p></>
  if (mode === 'weather') return <><p className="ha-sensor-node__value">{entity.state}</p><dl><dt>{sensorCopy(map, 'Temperature')}</dt><dd>{entity.attributes.temperature == null ? sensorCopy(map, 'not supplied') : entity.attributes.temperature}</dd><dt>{sensorCopy(map, 'Humidity')}</dt><dd>{entity.attributes.humidity == null ? sensorCopy(map, 'not supplied') : entity.attributes.humidity}</dd></dl></>
  if (mode === 'calendar') return <><p className="ha-sensor-node__value">{entity.state}</p><dl><dt>{sensorCopy(map, 'Message')}</dt><dd>{entity.attributes.message == null ? sensorCopy(map, 'No active event') : entity.attributes.message}</dd><dt>{sensorCopy(map, 'Starts')}</dt><dd>{entity.attributes.start_time == null ? sensorCopy(map, 'not supplied') : entity.attributes.start_time}</dd><dt>{sensorCopy(map, 'Ends')}</dt><dd>{entity.attributes.end_time == null ? sensorCopy(map, 'not supplied') : entity.attributes.end_time}</dd></dl></>
  if (mode === 'attributes') {
    const keys = binding.attributeKeys.length ? binding.attributeKeys : Object.keys(entity.attributes).slice(0, 8)
    return <dl>{keys.map((key) => <div key={key}><dt>{key}</dt><dd>{entity.attributes[key] == null ? sensorCopy(map, 'not supplied') : entity.attributes[key]}</dd></div>)}</dl>
  }
  return <p className="ha-sensor-node__value">{entity.state}{entity.unit ? ` ${entity.unit}` : ''}</p>
}

export default function HomeAssistantSensorNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { api } = useSession()
  const { updateNodeData } = useReactFlow()
  const vocab = useVocabularyMapper()
  const config = useMemo(
    () => validateHomeAssistantSensorConfig(data.homeAssistantSensorConfig ?? DEFAULT_HOME_ASSISTANT_SENSOR_CONFIG),
    [data.homeAssistantSensorConfig]
  )
  const [binding, setBinding] = useState<HomeAssistantBindingStatus>({ ...EMPTY_BINDING, nodeId: id })
  const [catalog, setCatalog] = useState<HomeAssistantEntityState[]>([])
  const [snapshot, setSnapshot] = useState<HomeAssistantSensorSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [instanceLabel, setInstanceLabel] = useState('')
  const [token, setToken] = useState('')
  const entitySearch = useRegexSearchField()
  const entitySearchRef = useRef<HTMLInputElement>(null)
  const modeSearch = useRegexSearchField()
  const modeSearchRef = useRef<HTMLInputElement>(null)

  const setConfig = useCallback((patch: Partial<typeof config>) => updateNodeData(id, { homeAssistantSensorConfig: { ...config, ...patch } }), [config, id, updateNodeData])
  const report = useCallback((kind: 'info' | 'success' | 'warning' | 'error', title: readonly SensorTextPart[], body: readonly SensorTextPart[]) => {
    notify({ kind, title: mapSensorSentence(vocab, title), body: mapSensorSentence(vocab, body) })
  }, [vocab])

  useEffect(() => {
    let active = true
    void api.homeAssistantSensor.binding(id).then((next) => { if (active) setBinding(next) }).catch(() => { if (active) setBinding({ ...EMPTY_BINDING, nodeId: id, state: 'unavailable', reason: 'The local binding could not be read.' }) })
    return () => { active = false }
  }, [api.homeAssistantSensor, id])

  const discover = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const entities = await api.homeAssistantSensor.discover(id)
      setCatalog(entities)
      report('success', [copy('Home Assistant entities loaded')], [sensorFact(entities.length), copy(' entities are available for this node.')])
    } catch (error) { report('error', [copy('Entity discovery failed')], [error instanceof Error ? sensorFact(error.message) : copy('The entity catalog could not be read.')]) }
    finally { setBusy(false) }
  }, [api.homeAssistantSensor, id, report])

  const refresh = useCallback(async (): Promise<void> => {
    if (config.entities.length === 0) return
    setBusy(true)
    try {
      const next = await api.homeAssistantSensor.refresh(id, config)
      setSnapshot(next)
      const title = next.stale ? [copy('Home Assistant is offline')] : next.partial ? [copy('Home Assistant refresh is partial')] : [copy('Home Assistant sensors refreshed')]
      const body = next.stale
        ? [next.reason == null ? copy('The live instance could not be reached.') : sensorFact(next.reason), copy(' Showing the last successful observation.')]
        : next.reason == null ? [sensorFact(next.entities.length), copy(' selected entities were observed.')] : [sensorFact(next.reason)]
      report(next.stale ? 'warning' : next.partial ? 'info' : 'success', title, body)
    } catch (error) { report('error', [copy('Home Assistant refresh failed')], [error instanceof Error ? sensorFact(error.message) : copy('The last observed values remain on screen.')]) }
    finally { setBusy(false) }
  }, [api.homeAssistantSensor, config, id, report])

  useEffect(() => {
    if (binding.state !== 'ready' || config.entities.length === 0) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), config.refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [binding.state, config.entities.length, config.refreshSeconds, refresh])

  const configure = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await api.homeAssistantSensor.configure({ nodeId: id, baseUrl, token, instanceLabel })
      setToken('')
      setBinding(next)
      setConfigureOpen(false)
      report('success', [copy('Home Assistant binding verified')], [next.instanceLabel == null ? copy('The instance') : sensorFact(next.instanceLabel), copy(' is bound only on this computer.')])
      await discover()
    } catch (error) { report('error', [copy('Home Assistant binding was not saved')], [error instanceof Error ? sensorFact(error.message) : copy('The connection could not be verified.')]) }
    finally { setBusy(false) }
  }

  const selectEntity = (entity: HomeAssistantEntityState, checked: boolean): void => {
    const entities = checked
      ? [...config.entities, { entityId: entity.entityId, mode: 'auto' as const, label: null, min: null, max: null, attributeKeys: [] }]
      : config.entities.filter((entry) => entry.entityId !== entity.entityId)
    setConfig({ entities })
  }
  const updateEntity = (entityId: string, patch: Partial<HomeAssistantEntityBinding>): void => setConfig({ entities: config.entities.map((entry) => entry.entityId === entityId ? { ...entry, ...patch } : entry) })
  const visibleCatalog = useMemo(() => catalog.filter((entity) => entitySearch.test(`${entity.entityId} ${entity.friendlyName} ${entity.domain} ${entity.deviceClass ?? ''}`)), [catalog, entitySearch])
  const selectedEntities = useMemo(() => config.entities.map((entry) => ({ entry, entity: snapshot?.entities.find((entity) => entity.entityId === entry.entityId) ?? catalog.find((entity) => entity.entityId === entry.entityId) })).filter((item): item is { entry: HomeAssistantEntityBinding; entity: HomeAssistantEntityState } => !!item.entity), [catalog, config.entities, snapshot])

  const exportSnapshot = async (): Promise<void> => {
    const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), config, snapshot, omitted: ['access credentials', 'instance URL', 'provider session', 'local paths', 'host identity', 'runtime cache'] }
    await api.export.saveText('home-assistant-sensors.json', JSON.stringify(payload, null, 2), 'application/json')
    report('success', [copy('Sensor export saved')], [copy('The portable display intent and visible observations were exported. Credentials, instance URL, paths, and machine identity were omitted.')])
  }

  const displayTitle = data.title || sensorCopy(vocab, 'Home Assistant sensors')
  const bindingStatus = busy
    ? sensorCopy(vocab, 'Working…')
    : binding.state === 'ready'
      ? mapSensorSentence(vocab, [copy('Bound: '), sensorFact(binding.instanceLabel ?? '')])
      : binding.state === 'unavailable' ? sensorCopy(vocab, 'Binding unavailable') : sensorCopy(vocab, 'Unbound')

  return <div className={`term-node ha-sensor-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }} aria-busy={busy}>
    <NodeResizer minWidth={460} minHeight={380} isVisible={selected} color={data.color} />
    <div className="term-node__header" style={{ background: `${data.color}22` }}><span aria-hidden="true">⌂</span><strong>{displayTitle}</strong><span className="term-node__spacer" /><span role="status">{bindingStatus}</span></div>
    <div className="ha-sensor-node__body">
      <section aria-labelledby={`${id}-binding-heading`}><h3 id={`${id}-binding-heading`}>{sensorCopy(vocab, 'Instance binding')}</h3><p>{binding.reason ?? sensorCopy(vocab, 'The instance URL and credential stay only on this computer.')}</p>
        <div className="ha-sensor-node__actions"><button type="button" onClick={() => setConfigureOpen(true)}>{sensorCopy(vocab, binding.state === 'ready' ? 'Rebind…' : 'Configure…')}</button><button type="button" onClick={() => setConfigureOpen(true)}>{sensorCopy(vocab, 'Adopt…')}</button><button type="button" disabled title={sensorCopy(vocab, 'Sensor display nodes do not deploy Home Assistant. Use an installed instance.')}>{sensorCopy(vocab, 'Deploy…')}</button><button type="button" disabled title={sensorCopy(vocab, 'This integration uses a network instance and has no local asset to locate.')}>{sensorCopy(vocab, 'Locate Asset…')}</button><button type="button" disabled={binding.state === 'unbound'} onClick={(event) => { const target = event.currentTarget; const rect = target.getBoundingClientRect(); openDestructiveGate({ title: sensorCopy(vocab, 'Leave this Home Assistant node unbound'), description: sensorCopy(vocab, 'Remove the machine-local instance URL, sealed credential, cache, and observed history for this node.'), affected: [binding.instanceLabel ?? id], confirmLabel: sensorCopy(vocab, 'Leave unbound'), anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: target, onConfirm: () => { void api.homeAssistantSensor.leaveUnbound(id).then((next) => { setBinding(next); setCatalog([]); setSnapshot(null); report('success', [copy('Home Assistant binding removed')], [copy('This node is unbound on this computer. Shared entity and display intent remains available for a later rebind.')]) }).catch((error) => report('error', [copy('Binding removal failed')], [error instanceof Error ? sensorFact(error.message) : copy('The local binding may still exist.')])) } }) }}>{sensorCopy(vocab, 'Leave Unbound…')}</button></div>
        {configureOpen && <div className="ha-sensor-node__configure" role="region" aria-label={sensorCopy(vocab, 'Configure Home Assistant instance')}><label>{sensorCopy(vocab, 'Instance label')}<input value={instanceLabel} onChange={(event) => setInstanceLabel(event.target.value)} maxLength={120} placeholder={sensorCopy(vocab, 'Home')} /></label><label>{sensorCopy(vocab, 'Base URL')}<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} inputMode="url" placeholder={sensorCopy(vocab, 'https://homeassistant.example.com')} /></label><label>{sensorCopy(vocab, 'Long-lived access credential')}<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label><p>{sensorCopy(vocab, 'Nothing is saved until the URL and credential are verified. The credential is never shown again, exported, logged, or added to the project.')}</p><div className="ha-sensor-node__actions"><button type="button" onClick={() => { setConfigureOpen(false); setToken('') }}>{sensorCopy(vocab, 'Cancel')}</button><button type="button" onClick={() => void configure()} disabled={busy || !baseUrl.trim() || !token}>{sensorCopy(vocab, 'Verify and bind')}</button></div></div>}
      </section>
      <section aria-labelledby={`${id}-entities-heading`}><h3 id={`${id}-entities-heading`}>{sensorCopy(vocab, 'Entities')}</h3><div className="ha-sensor-node__search"><input ref={entitySearchRef} value={entitySearch.value} onChange={(event) => entitySearch.setValue(event.target.value)} placeholder={sensorCopy(vocab, 'Search entities with plain text')} aria-label={sensorCopy(vocab, 'Search Home Assistant entities')} /><AnchoredRegexBuilder search={entitySearch} fieldRef={entitySearchRef} label={sensorCopy(vocab, 'Regex for Home Assistant entities')} /><button type="button" disabled={binding.state !== 'ready' || busy} onClick={() => void discover()}>{sensorCopy(vocab, 'Load entities')}</button></div>
        {catalog.length === 0 ? <p className="ha-sensor-node__empty">{sensorCopy(vocab, 'No catalog loaded. Bind an instance, then load its real entity list.')}</p> : <div className="ha-sensor-node__catalog" role="list" aria-label={sensorCopy(vocab, 'Home Assistant entity picker')}>{visibleCatalog.map((entity) => <label key={entity.entityId} role="listitem"><input type="checkbox" checked={config.entities.some((entry) => entry.entityId === entity.entityId)} onChange={(event) => selectEntity(entity, event.target.checked)} /><span><strong>{entity.friendlyName}</strong><small>{entity.entityId} · {entity.state}{entity.unit ? ` ${entity.unit}` : ''}</small></span></label>)}</div>}
      </section>
      <section aria-labelledby={`${id}-display-heading`}><h3 id={`${id}-display-heading`}>{sensorCopy(vocab, 'Display and bounded history')}</h3><div className="ha-sensor-node__settings"><label>{sensorCopy(vocab, 'Refresh interval (seconds)')}<input type="number" min={10} max={3600} value={config.refreshSeconds} onChange={(event) => setConfig({ refreshSeconds: Number(event.target.value) })} /></label><label>{sensorCopy(vocab, 'History points per entity')}<input type="number" min={2} max={720} value={config.historyLimit} onChange={(event) => setConfig({ historyLimit: Number(event.target.value) })} /></label><label><input type="checkbox" checked={config.showLastChanged} onChange={(event) => setConfig({ showLastChanged: event.target.checked })} /> {sensorCopy(vocab, 'Show last changed')}</label></div>
        <div className="ha-sensor-node__search"><input ref={modeSearchRef} value={modeSearch.value} onChange={(event) => modeSearch.setValue(event.target.value)} placeholder={sensorCopy(vocab, 'Filter display modes')} aria-label={sensorCopy(vocab, 'Filter Home Assistant display modes')} /><AnchoredRegexBuilder search={modeSearch} fieldRef={modeSearchRef} label={sensorCopy(vocab, 'Regex for Home Assistant display modes')} /></div>
        <div className="ha-sensor-node__cards">{selectedEntities.length === 0 ? <p className="ha-sensor-node__empty">{sensorCopy(vocab, 'Choose at least one entity from the real catalog.')}</p> : selectedEntities.map(({ entry, entity }) => <article key={entity.entityId}><header><div><strong>{entry.label || entity.friendlyName}</strong><small>{entity.entityId} · {sensorCopy(vocab, displayModeLabel(resolvedMode(entry, entity)))}</small></div><button type="button" onClick={() => selectEntity(entity, false)} aria-label={mapSensorSentence(vocab, [copy('Remove '), sensorFact(entity.friendlyName), copy(' from this display')])}>{sensorCopy(vocab, 'Remove')}</button></header><EntityValue entity={entity} binding={entry} points={(snapshot?.history ?? []).filter((point) => point.entityId === entity.entityId)} map={vocab} />{config.showLastChanged && <p className="ha-sensor-node__muted">{mapSensorSentence(vocab, [copy('Changed '), sensorFact(entity.lastChanged)])}</p>}<details><summary>{sensorCopy(vocab, 'Display options')}</summary><div className="ha-sensor-node__mode-grid">{HOME_ASSISTANT_DISPLAY_MODES.filter((mode) => modeSearch.test(`${mode.label} ${mode.hint}`)).map((mode) => <button key={mode.id} type="button" aria-pressed={entry.mode === mode.id} title={sensorCopy(vocab, mode.hint)} onClick={() => updateEntity(entity.entityId, { mode: mode.id })}>{sensorCopy(vocab, mode.label)}</button>)}</div>{resolvedMode(entry, entity) === 'gauge' && <div className="ha-sensor-node__settings"><label>{sensorCopy(vocab, 'Minimum')}<input type="number" value={entry.min ?? 0} onChange={(event) => updateEntity(entity.entityId, { min: Number(event.target.value) })} /></label><label>{sensorCopy(vocab, 'Maximum')}<input type="number" value={entry.max ?? 100} onChange={(event) => updateEntity(entity.entityId, { max: Number(event.target.value) })} /></label></div>}{resolvedMode(entry, entity) === 'attributes' && <fieldset><legend>{sensorCopy(vocab, 'Attributes to show')}</legend>{Object.keys(entity.attributes).map((key) => <label key={key}><input type="checkbox" checked={entry.attributeKeys.includes(key)} onChange={(event) => updateEntity(entity.entityId, { attributeKeys: event.target.checked ? [...entry.attributeKeys, key] : entry.attributeKeys.filter((candidate) => candidate !== key) })} /> {key}</label>)}</fieldset>}</details></article>)}</div>
        <div className="ha-sensor-node__actions"><button type="button" disabled={binding.state !== 'ready' || busy || config.entities.length === 0} onClick={() => void refresh()}>{sensorCopy(vocab, 'Refresh now')}</button><button type="button" disabled={!snapshot} onClick={() => void exportSnapshot()}>{sensorCopy(vocab, 'Export visible data')}</button></div>{snapshot && <p role="status">{snapshot.stale ? mapSensorSentence(vocab, [copy('Showing the last successful observation from '), sensorFact(snapshot.fetchedAt), copy('. ')]) : mapSensorSentence(vocab, [copy('Observed '), sensorFact(snapshot.entities.length), copy(' selected entities at '), sensorFact(snapshot.fetchedAt), copy('. ')])}{snapshot.stale ? sensorCopy(vocab, 'Refresh to try the live instance again.') : snapshot.complete ? sensorCopy(vocab, 'The selected set was complete.') : snapshot.reason ?? ''}</p>}
      </section>
    </div>
  </div>
}
