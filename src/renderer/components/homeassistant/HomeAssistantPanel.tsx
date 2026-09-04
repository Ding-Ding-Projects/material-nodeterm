import { useEffect, useMemo, useRef, useState } from 'react'
import type { HomeAssistantInstance, HomeAssistantSnapshot } from '@shared/home-assistant'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'
import { DestructiveConfirmGate } from '../DestructiveConfirmGate'
import { Button, Checkbox } from '../../ui/md3'
import { Input } from '../../ui/Input'

function shortState(snapshot: HomeAssistantSnapshot | null): string {
  if (!snapshot) return 'Not configured'
  if (snapshot.status.state === 'auth-error') return snapshot.status.detail || 'Authentication required'
  if (snapshot.status.state === 'connected' && snapshot.status.dataState === 'live') return `Connected · ${snapshot.entities.length} entities`
  if (snapshot.status.dataState === 'stale') return `Stale snapshot · ${snapshot.entities.length} entities`
  if (snapshot.status.state === 'reconnecting') return 'Reconnecting'
  return snapshot.status.detail || snapshot.status.state
}

/** Real Home Assistant controls for a service node. The panel keeps instance records and tokens
 * in the host process, then renders only status and registry data here. Every list entry is
 * keyboard selectable, and entity search owns its own anchored full regex builder. */
export function HomeAssistantPanel({ nodeId }: { nodeId: string }): React.JSX.Element {
  const api = window.nodeTerminal.homeAssistant
  const [instances, setInstances] = useState<HomeAssistantInstance[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<HomeAssistantSnapshot | null>(null)
  const [label, setLabel] = useState('Home Assistant')
  const [url, setUrl] = useState('https://homeassistant.local:8123')
  const [enabled, setEnabled] = useState(true)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenStatuses, setTokenStatuses] = useState<Record<string, boolean>>({})
  const [confirmAction, setConfirmAction] = useState<'remove' | 'clear-token' | null>(null)
  const text = useLocalizedVocabularyText()
  const entitySearch = useRegexSearchField({ mode: 'text' })
  const serviceSearch = useRegexSearchField({ mode: 'text' })
  const deviceSearch = useRegexSearchField({ mode: 'text' })
  const areaSearch = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const serviceSearchRef = useRef<HTMLInputElement>(null)
  const deviceSearchRef = useRef<HTMLInputElement>(null)
  const areaSearchRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    try {
      const next = await api.list()
      setInstances(next)
      try {
        setTokenStatuses(await api.tokenStatus())
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : text('homeAssistant.tokenStatusFailed', 'Home Assistant credential status is unavailable.'))
      }
      const id = selectedId && next.some((item) => item.id === selectedId) ? selectedId : next[0]?.id ?? null
      setSelectedId(id)
      if (id) setSnapshot(await api.snapshot(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Home Assistant instances could not be read.')
    }
  }

  useEffect(() => {
    void load()
    return api.onUpdate((next) => {
      setSnapshot((current) => current && current.instance.id === next.instance.id ? next : current)
    })
    // The subscription is intentionally one per node, not one per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const choose = async (id: string): Promise<void> => {
    setSelectedId(id)
    setError(null)
    const instance = instances.find((item) => item.id === id)
    if (instance) {
      setLabel(instance.label)
      setUrl(instance.baseUrl)
      setEnabled(instance.enabled)
    }
    setSnapshot(await api.snapshot(id))
  }

  const create = async (): Promise<void> => {
    if (!label.trim() || !url.trim() || !token.trim()) {
      setError('Enter a label, an HTTPS or loopback URL, and an access token.')
      return
    }
    setBusy(true); setError(null)
    try {
      const instance = await api.create({ label: label.trim(), baseUrl: url.trim(), token: token.trim() })
      setToken('')
      setInstances(await api.list())
      setSelectedId(instance.id)
      setEnabled(instance.enabled)
      setSnapshot(await api.refresh(instance.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Home Assistant instance could not be created.')
    } finally { setBusy(false) }
  }

  const refresh = async (): Promise<void> => {
    if (!selectedId) return
    setBusy(true); setError(null)
    try { setSnapshot(await api.refresh(selectedId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Home Assistant refresh failed.') }
    finally { setBusy(false) }
  }

  const disconnectSelected = async (): Promise<void> => {
    if (!selectedId) return
    try {
      await api.disconnect(selectedId)
      setSnapshot(await api.snapshot(selectedId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.disconnectFailed', 'The Home Assistant connection could not be stopped.'))
    }
  }

  const selected = selectedId ? instances.find((item) => item.id === selectedId) ?? null : null

  const updateSelected = async (): Promise<void> => {
    if (!selected) return
    setBusy(true); setError(null)
    try {
      const next = await api.update({ id: selected.id, label: label.trim(), baseUrl: url.trim(), enabled })
      if (next) {
        setInstances((current) => current.map((item) => item.id === next.id ? next : item))
        setSnapshot(await api.snapshot(next.id))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.updateFailed', 'Home Assistant instance could not be updated.'))
    } finally { setBusy(false) }
  }

  const replaceToken = async (): Promise<void> => {
    if (!selectedId || !token.trim()) return
    setBusy(true); setError(null)
    try {
      await api.setToken(selectedId, token.trim())
      setToken('')
      setTokenStatuses(await api.tokenStatus())
      setSnapshot(await api.snapshot(selectedId))
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.tokenSaveFailed', 'The Home Assistant access token could not be saved.'))
    } finally { setBusy(false) }
  }

  const clearToken = async (): Promise<void> => {
    if (!selectedId) return
    setBusy(true); setError(null)
    try {
      await api.setToken(selectedId, null)
      setTokenStatuses(await api.tokenStatus())
      setSnapshot(await api.snapshot(selectedId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.tokenClearFailed', 'The Home Assistant access token could not be cleared.'))
    } finally { setBusy(false) }
  }

  const removeSelected = async (): Promise<void> => {
    if (!selectedId) return
    setBusy(true); setError(null)
    try {
      await api.remove(selectedId)
      const next = await api.list()
      setInstances(next)
      const nextId = next[0]?.id ?? null
      setSelectedId(nextId)
      setSnapshot(nextId ? await api.snapshot(nextId) : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.removeFailed', 'The Home Assistant instance could not be removed.'))
    } finally { setBusy(false) }
  }

  const bindEntity = async (entityId: string): Promise<void> => {
    if (!selectedId) return
    try {
      await api.bind({ nodeId, instanceId: selectedId, entityId })
      setSnapshot(await api.snapshot(selectedId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.bindFailed', 'The entity could not be bound to this node.'))
    }
  }

  const unbindEntity = async (bindingId: string): Promise<void> => {
    try {
      await api.unbind(bindingId)
      if (selectedId) setSnapshot(await api.snapshot(selectedId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('homeAssistant.unbindFailed', 'The entity binding could not be removed.'))
    }
  }

  const entities = useMemo(() => (snapshot?.entities ?? []).filter((item) => entitySearch.test(`${item.entity_id} ${item.state} ${String(item.attributes.friendly_name ?? '')}`)), [snapshot?.entities, entitySearch])
  const services = useMemo(() => (snapshot?.services ?? []).filter((item) => serviceSearch.test(`${item.domain}.${item.service} ${item.name} ${item.description}`)), [snapshot?.services, serviceSearch])
  const devices = useMemo(() => (snapshot?.devices ?? []).filter((item) => deviceSearch.test(`${item.id} ${item.name} ${item.name_by_user ?? ''} ${item.manufacturer ?? ''} ${item.model ?? ''}`)), [snapshot?.devices, deviceSearch])
  const areas = useMemo(() => (snapshot?.areas ?? []).filter((item) => areaSearch.test(`${item.id} ${item.name} ${item.aliases.join(' ')}`)), [snapshot?.areas, areaSearch])

  return (
    <div className="service-node__body homeassistant-panel">
      <p className="service-node__state" aria-live="polite">{shortState(snapshot)}</p>
      {error && <p className="service-node__note homeassistant-panel__error" role="alert">{error}</p>}

      <Button variant="outlined" className="mc-button nodrag" onClick={() => { setSelectedId(null); setSnapshot(null); setLabel('Home Assistant'); setUrl('https://homeassistant.local:8123'); setEnabled(true); setToken(''); setError(null) }}>{text('homeAssistant.addInstance', 'Add instance')}</Button>
      <ul className="homeassistant-panel__instances" aria-label={text('homeAssistant.instances', 'Home Assistant instances')}>
        {instances.length === 0 && <li><p className="service-node__note">{text('homeAssistant.noInstances', 'No instance is configured on this machine yet.')}</p></li>}
        {instances.map((instance) => (
          <li key={instance.id}><Button variant="text" id={instance.id} className={`homeassistant-panel__instance nodrag${selectedId === instance.id ? ' is-selected' : ''}`} onClick={() => void choose(instance.id)} aria-pressed={selectedId === instance.id}>
            <span>{instance.label}</span><small>{instance.enabled ? instance.baseUrl : text('homeAssistant.disabled', 'Disabled')}</small>
          </Button></li>
        ))}
      </ul>

      {!selectedId && (
        <form className="homeassistant-panel__form" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <label className="service-node__field"><span className="service-node__field-label">Instance name</span><Input className="service-node__input nodrag" value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Home Assistant instance name" /></label>
          <label className="service-node__field"><span className="service-node__field-label">HTTPS or loopback URL</span><Input className="service-node__input nodrag" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Home Assistant URL" placeholder="https://homeassistant.example" /></label>
          <label className="service-node__field"><span className="service-node__field-label">Access token</span><Input className="service-node__input nodrag" type="password" value={token} onChange={(event) => setToken(event.target.value)} aria-label="Home Assistant access token" /></label>
          <Button type="submit" variant="filled" className="mc-button mc-button--primary nodrag" disabled={busy} title={busy ? text('homeAssistant.waiting', 'Waiting for the Home Assistant instance.') : undefined}>{text('homeAssistant.connect', 'Connect instance')}</Button>
          <p className="service-node__note">URLs must use HTTPS. Plain HTTP is accepted only for localhost, 127.0.0.1, or ::1. The token is stored in the host credential vault and is never written to the project file.</p>
        </form>
      )}

      {selectedId && snapshot && (
        <>
          <div className="mc-row"><Button variant="filled" className="mc-button mc-button--primary nodrag" disabled={busy} onClick={() => void refresh()}>{text('homeAssistant.refresh', 'Refresh registries')}</Button><Button variant="outlined" className="mc-button nodrag" disabled={busy} onClick={() => void disconnectSelected()}>{text('homeAssistant.disconnect', 'Disconnect')}</Button><Button variant="outlined" className="mc-button nodrag" disabled={busy} onClick={() => void updateSelected()}>{text('homeAssistant.saveInstance', 'Save instance')}</Button><Button variant="outlined" danger className="mc-button mc-button--danger nodrag" disabled={busy} onClick={() => setConfirmAction('remove')}>{text('homeAssistant.removeInstance', 'Remove instance')}</Button></div>
          <div className="homeassistant-panel__form">
            <label className="service-node__field"><span className="service-node__field-label">Instance name</span><Input className="service-node__input nodrag" value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Home Assistant instance name" /></label>
            <label className="service-node__field"><span className="service-node__field-label">HTTPS or loopback URL</span><Input className="service-node__input nodrag" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Home Assistant URL" /></label>
            <label className="service-node__field"><span className="service-node__field-label">Enabled</span><Checkbox className="nodrag" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} aria-label="Enable Home Assistant instance" /></label>
            <label className="service-node__field"><span className="service-node__field-label">Replace access token</span><Input className="service-node__input nodrag" type="password" value={token} onChange={(event) => setToken(event.target.value)} aria-label="Replace Home Assistant access token" /></label>
            <div className="mc-row"><Button variant="outlined" className="mc-button nodrag" disabled={busy || !token.trim()} onClick={() => void replaceToken()}>{text('homeAssistant.replaceToken', 'Replace token')}</Button><Button variant="outlined" className="mc-button nodrag" disabled={busy || !tokenStatuses[selectedId]} onClick={() => setConfirmAction('clear-token')}>{text('homeAssistant.clearToken', 'Clear token')}</Button></div>
          </div>
          <label className="homeassistant-panel__search"><span className="service-node__field-label">Search entities</span><div className="homeassistant-panel__search-row"><Input ref={searchRef} className="service-node__input nodrag" value={entitySearch.value} onChange={(event) => entitySearch.setValue(event.target.value)} aria-label="Search Home Assistant entities" placeholder="entity id, name, domain or state" /><AnchoredRegexBuilder search={entitySearch} fieldRef={searchRef} label="Regex for Home Assistant entities" /></div></label>
          {entitySearch.error && <p className="service-node__note homeassistant-panel__error">{entitySearch.error}</p>}
          <div className="homeassistant-panel__counts" aria-live="polite">{entities.length} shown · {snapshot.entityRegistry.length} registered entities · {snapshot.services.length} services · {snapshot.devices.length} devices · {snapshot.areas.length} areas</div>
          <ul className="homeassistant-panel__entities" aria-label="Home Assistant entities">
            {entities.length === 0 && <li><p className="service-node__note">No entities match this search.</p></li>}
            {entities.slice(0, 100).map((item) => <li key={item.entity_id}><Button variant="text" className="homeassistant-panel__entity nodrag" onClick={() => void bindEntity(item.entity_id)}><span>{item.entity_id}</span><strong>{item.state}</strong></Button></li>)}
          </ul>
          <label className="homeassistant-panel__search"><span className="service-node__field-label">Search services</span><div className="homeassistant-panel__search-row"><Input ref={serviceSearchRef} className="service-node__input nodrag" value={serviceSearch.value} onChange={(event) => serviceSearch.setValue(event.target.value)} aria-label="Search Home Assistant services" placeholder="domain.service or description" /><AnchoredRegexBuilder search={serviceSearch} fieldRef={serviceSearchRef} label="Regex for Home Assistant services" /></div></label>
          <ul className="homeassistant-panel__entities" aria-label="Home Assistant services">{services.length === 0 ? <li><p className="service-node__note">No services match this search.</p></li> : services.slice(0, 100).map((item) => <li key={`${item.domain}.${item.service}`}><Button variant="text" className="homeassistant-panel__entity nodrag" onClick={() => setError(`${item.domain}.${item.service}: ${item.description || item.name}`)}><span>{item.domain}.{item.service}</span><small>{item.name || item.description}</small></Button></li>)}</ul>
          <label className="homeassistant-panel__search"><span className="service-node__field-label">Search devices</span><div className="homeassistant-panel__search-row"><Input ref={deviceSearchRef} className="service-node__input nodrag" value={deviceSearch.value} onChange={(event) => deviceSearch.setValue(event.target.value)} aria-label="Search Home Assistant devices" placeholder="device name or id" /><AnchoredRegexBuilder search={deviceSearch} fieldRef={deviceSearchRef} label="Regex for Home Assistant devices" /></div></label>
          <ul className="homeassistant-panel__entities" aria-label="Home Assistant devices">{devices.length === 0 ? <li><p className="service-node__note">No devices match this search.</p></li> : devices.slice(0, 100).map((item) => <li key={item.id}><Button variant="text" className="homeassistant-panel__entity nodrag" onClick={() => setError(`${item.name_by_user || item.name}: ${item.id}`)}><span>{item.name_by_user || item.name}</span><small>{item.id}</small></Button></li>)}</ul>
          <label className="homeassistant-panel__search"><span className="service-node__field-label">Search areas</span><div className="homeassistant-panel__search-row"><Input ref={areaSearchRef} className="service-node__input nodrag" value={areaSearch.value} onChange={(event) => areaSearch.setValue(event.target.value)} aria-label="Search Home Assistant areas" placeholder="area name or id" /><AnchoredRegexBuilder search={areaSearch} fieldRef={areaSearchRef} label="Regex for Home Assistant areas" /></div></label>
          <ul className="homeassistant-panel__entities" aria-label="Home Assistant areas">{areas.length === 0 ? <li><p className="service-node__note">No areas match this search.</p></li> : areas.slice(0, 100).map((item) => <li key={item.id}><Button variant="text" className="homeassistant-panel__entity nodrag" onClick={() => setError(`${item.name}: ${item.id}`)}><span>{item.name}</span><small>{item.id}</small></Button></li>)}</ul>
          <ul className="homeassistant-panel__entities" aria-label="Bound Home Assistant entities">{snapshot.bindings.length === 0 ? <li><p className="service-node__note">No entity is bound to this canvas node.</p></li> : snapshot.bindings.filter((binding) => binding.nodeId === nodeId).map((binding) => <li key={binding.id}><span className="homeassistant-panel__entity"><span>{binding.entityId}</span><Button variant="outlined" className="mc-button nodrag" onClick={() => void unbindEntity(binding.id)}>Unbind</Button></span></li>)}</ul>
          <p className="service-node__note">Click an entity to bind this canvas node. Bindings, endpoint settings, and tokens stay on this machine; only the selected node's portable intent travels with a project.</p>
        </>
      )}
      {confirmAction && selected && (
        <DestructiveConfirmGate
          title={text(confirmAction === 'remove' ? 'homeAssistant.confirmRemoveTitle' : 'homeAssistant.confirmClearTokenTitle', confirmAction === 'remove' ? 'Remove Home Assistant instance' : 'Clear Home Assistant access token')}
          description={text(confirmAction === 'remove' ? 'homeAssistant.confirmRemoveDescription' : 'homeAssistant.confirmClearTokenDescription', confirmAction === 'remove' ? 'This removes the instance, its bindings, and its stored access token from this machine.' : 'This clears the stored access token and disconnects this instance.')}
          affected={[selected.label, ...(confirmAction === 'remove' ? (snapshot?.bindings ?? []).filter((binding) => binding.instanceId === selected.id).map((binding) => binding.entityId) : [])]}
          confirmLabel={text(confirmAction === 'remove' ? 'homeAssistant.remove' : 'homeAssistant.clear', confirmAction === 'remove' ? 'Remove' : 'Clear')}
          onConfirm={() => {
            const action = confirmAction
            setConfirmAction(null)
            if (action === 'remove') void removeSelected()
            else void clearToken()
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
