import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../../state/workspace'
import type {
  HomeAssistantApi,
  HomeAssistantEntity,
  HomeAssistantFieldKind,
  HomeAssistantFieldSchema,
  HomeAssistantInstance,
  HomeAssistantService,
  HomeAssistantServiceSchema,
  HomeAssistantSnapshot
} from '@shared/home-assistant'
import { homeAssistantServiceRisk, isHomeAssistantEntityId } from '@shared/home-assistant'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import { Button } from '../../ui/Button'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { useI18n } from '@renderer/lib/i18n'
import { openDestructiveGate } from '../../state/destructiveGate'

type Option = { value: string; label: string; disabled?: boolean; reason?: string }
type ControlEntity = HomeAssistantEntity & { entityId: string; domain: string; name: string; available: boolean; canRead?: boolean; permissionReason?: string }
type ControlCatalog = { revision: string; fetchedAt: number; complete: boolean; instances: HomeAssistantInstance[]; domains: Array<{ domain: string; name: string; services: HomeAssistantServiceSchema[] }>; entities: ControlEntity[]; warning?: string }

function useCopy(): (english: string, cantonese: string) => string {
  const { mode } = useI18n()
  return useCallback((english, cantonese) => mode === 'yue' ? cantonese : mode === 'bilingual' ? `${english} · ${cantonese}` : english, [mode])
}

function typedFields(service: HomeAssistantService): HomeAssistantFieldSchema[] {
  const fields = service.fields && typeof service.fields === 'object' ? service.fields : {}
  return Object.entries(fields).slice(0, 256).map(([name, raw]) => {
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const selector = value.selector && typeof value.selector === 'object' && !Array.isArray(value.selector) ? value.selector as Record<string, unknown> : {}
    const first = Object.entries(selector)[0]
    const kind: HomeAssistantFieldKind = first?.[0] === 'boolean' ? 'boolean' : first?.[0] === 'number' ? 'number' : first?.[0] === 'select' ? 'select' : first?.[0] === 'entity' ? 'entity' : first?.[0] === 'color' ? 'color' : first?.[0] === 'color_temp' ? 'duration' : first?.[0] === 'text' ? 'text' : 'unknown'
    const config = first?.[1] && typeof first[1] === 'object' && !Array.isArray(first[1]) ? first[1] as Record<string, unknown> : {}
    return { name, ...(typeof value.description === 'string' ? { description: value.description.slice(0, 512) } : {}), ...(value.required === true ? { required: true } : {}), selector: { kind, ...(typeof config.min === 'number' && Number.isFinite(config.min) ? { min: config.min } : {}), ...(typeof config.max === 'number' && Number.isFinite(config.max) ? { max: config.max } : {}), ...(typeof config.step === 'number' && Number.isFinite(config.step) ? { step: config.step } : {}), ...(Array.isArray(config.options) ? { options: config.options.slice(0, 256).flatMap((item) => typeof item === 'string' ? [{ value: item }] : []) } : {}) } }
  })
}

function toCatalog(instances: HomeAssistantInstance[], snapshot: HomeAssistantSnapshot): ControlCatalog {
  const canUse = snapshot.status.state === 'connected' && snapshot.status.hasToken
  const entities: ControlEntity[] = snapshot.entities.slice(0, 20_000).flatMap((entity) => {
    if (!isHomeAssistantEntityId(entity.entity_id) || typeof entity.state !== 'string') return []
    const [domain] = entity.entity_id.split('.')
    return [{ ...entity, entityId: entity.entity_id, domain, name: entity.attributes.friendly_name && typeof entity.attributes.friendly_name === 'string' ? entity.attributes.friendly_name : entity.entity_id, available: entity.state !== 'unavailable' && entity.state !== 'unknown', canRead: canUse, permissionReason: canUse ? undefined : 'The instance is not connected or its credential is unavailable.' }]
  })
  const domains = new Map<string, { domain: string; name: string; services: HomeAssistantServiceSchema[] }>()
  for (const service of snapshot.services.slice(0, 2_000)) {
    if (!/^[a-z0-9_]+$/u.test(service.domain) || !/^[a-z0-9_]+$/u.test(service.service)) continue
    const bucket = domains.get(service.domain) ?? { domain: service.domain, name: service.domain, services: [] }
    bucket.services.push({ ...service, risk: homeAssistantServiceRisk(service.service), typedFields: typedFields(service), canCall: canUse, permissionReason: canUse ? undefined : 'The instance is not connected or its credential is unavailable.' })
    domains.set(service.domain, bucket)
  }
  return { revision: `${snapshot.fetchedAt ?? Date.now()}:${snapshot.status.generation}`, fetchedAt: snapshot.fetchedAt ?? Date.now(), complete: snapshot.status.state === 'connected', instances, domains: [...domains.values()], entities }
}

function Picker({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean }): React.JSX.Element {
  const search = useRegexSearchField()
  const copy = useCopy()
  const fieldRef = useRef<HTMLInputElement>(null)
  const filtered = options.filter((option) => search.test(`${option.label} ${option.value}`))
  const id = `ha-picker-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  return <div className="homeassistant-node__picker"><label className="homeassistant-node__label" htmlFor={id}>{label}</label><div className="homeassistant-node__search-row"><Input ref={fieldRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={copy(`Search ${label.toLowerCase()}`, `搜尋${label}`)} aria-label={copy(`${label} search`, `${label}搜尋`)} disabled={disabled} /><AnchoredRegexBuilder search={search} fieldRef={fieldRef} label={copy(`Regex for ${label} search`, `${label}正則搜尋`)} /></div><Select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label={label}><option value="">{filtered.length ? copy(`Choose ${label.toLowerCase()}`, `選擇${label}`) : copy('No matching choices', '冇符合選項')}</option>{filtered.map((option) => <option key={option.value} value={option.value} disabled={option.disabled} title={option.reason}>{option.label}{option.disabled && option.reason ? ` (${option.reason})` : ''}</option>)}</Select>{search.error && <span className="homeassistant-node__hint">{search.error}</span>}</div>
}

function ServiceField({ field, value, entities, onChange }: { field: HomeAssistantFieldSchema; value: unknown; entities: ControlEntity[]; onChange: (value: unknown) => void }): React.JSX.Element {
  const selector = field.selector
  if (selector?.kind === 'boolean') return <label className="homeassistant-node__field"><span className="homeassistant-node__label">{field.name}{field.required ? ' *' : ''}</span><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} aria-label={field.name} /></label>
  if (selector?.kind === 'number' || selector?.kind === 'duration') return <label className="homeassistant-node__field"><span className="homeassistant-node__label">{field.name}{field.required ? ' *' : ''}</span><Input type="number" value={typeof value === 'number' ? value : ''} min={selector.min} max={selector.max} step={selector.step ?? 'any'} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} aria-label={field.name} /></label>
  if (selector?.kind === 'select' || selector?.kind === 'entity') {
    const options = selector.kind === 'entity' ? entities.map((entity) => ({ value: entity.entityId, label: `${entity.name} · ${entity.entityId}`, disabled: entity.canRead === false, reason: entity.permissionReason })) : (selector.options ?? []).map((option) => ({ value: option.value, label: option.label ?? option.value }))
    if (selector.multiple) return <label className="homeassistant-node__field"><span className="homeassistant-node__label">{field.name}{field.required ? ' *' : ''}</span><Picker label={field.name} value={Array.isArray(value) ? value[0] as string ?? '' : ''} options={options} onChange={(next) => onChange([next])} /></label>
    return <Picker label={field.name} value={typeof value === 'string' ? value : ''} options={options} onChange={onChange} />
  }
  return <label className="homeassistant-node__field"><span className="homeassistant-node__label">{field.name}{field.required ? ' *' : ''}</span>{field.description && <span className="homeassistant-node__hint">{field.description}</span>}<Input type={selector?.kind === 'color' ? 'color' : 'text'} value={typeof value === 'string' ? value : ''} placeholder={selector?.kind === 'unknown' ? 'Schema fallback value' : undefined} onChange={(event) => onChange(event.target.value)} aria-label={field.name} /></label>
}

function HomeAssistantControlSurface({ id, data }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData } = useReactFlow(); const copy = useCopy(); const api = (window as unknown as { nodeTerminal?: { homeAssistant?: HomeAssistantApi } }).nodeTerminal?.homeAssistant
  const [instances, setInstances] = useState<HomeAssistantInstance[]>([]); const [catalog, setCatalog] = useState<ControlCatalog | null>(null); const [snapshot, setSnapshot] = useState<HomeAssistantSnapshot | null>(null)
  const [selectedInstance, setSelectedInstance] = useState(data.homeAssistantBinding?.instanceId ?? ''); const [selectedEntity, setSelectedEntity] = useState(data.homeAssistantBinding?.entityId ?? ''); const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>(data.homeAssistantBinding?.entityId ? [data.homeAssistantBinding.entityId] : []); const [domain, setDomain] = useState(data.homeAssistantIntent?.domain ?? ''); const [service, setService] = useState(data.homeAssistantIntent?.service ?? ''); const [values, setValues] = useState<Record<string, unknown>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [confirming, setConfirming] = useState(false)
  const operationGeneration = useRef(0)
  const selectedService = catalog?.domains.find((item) => item.domain === domain)?.services.find((item) => item.service === service); const selectedInstanceRecord = instances.find((item) => item.id === selectedInstance); const selectedEntityRecord = catalog?.entities.find((item) => item.entityId === selectedEntity)
  const load = useCallback(async (): Promise<void> => { if (!api) { setError(copy('Home Assistant controls are unavailable on this host.', '呢部主機未提供 Home Assistant 控制。')); return } const generation = ++operationGeneration.current; setBusy(true); setError(null); try { const nextInstances = await api.list(); if (generation !== operationGeneration.current) return; setInstances(nextInstances); const instance = nextInstances.find((item) => item.id === selectedInstance) ?? nextInstances[0]; if (!instance) { setCatalog(null); setSnapshot(null); return } setSelectedInstance(instance.id); const next = await api.refresh(instance.id); if (generation !== operationGeneration.current) return; setSnapshot(next); setCatalog(toCatalog(nextInstances, next)); const entity = next.entities.find((item) => item.entity_id === selectedEntity) ?? next.entities[0]; if (entity) { setSelectedEntity(entity.entity_id); setSelectedEntityIds([entity.entity_id]); updateNodeData(id, { homeAssistantBinding: { instanceId: instance.id, entityId: entity.entity_id } }) } setNotice(next.status.state === 'connected' ? copy(`Loaded ${next.services.length} services and ${next.entities.length} entities.`, `載入咗 ${next.services.length} 個服務同 ${next.entities.length} 個實體。`) : next.status.detail ?? copy('Catalog is not connected.', '目錄未連線。')) } catch (cause) { if (generation === operationGeneration.current) setError(cause instanceof Error ? cause.message : copy('Home Assistant refresh failed.', 'Home Assistant 更新失敗。')) } finally { if (generation === operationGeneration.current) setBusy(false) } }, [api, copy, id, selectedEntity, selectedInstance, updateNodeData])
  useEffect(() => {
    void load()
    if (!api) return () => undefined
    const unsubscribe = api.onUpdate((next) => {
      setSnapshot((current) => current && current.instance.id !== next.instance.id ? current : next)
      setCatalog((current) => current ? toCatalog(current.instances, next) : current)
    })
    return () => { operationGeneration.current += 1; unsubscribe() }
    // The client subscription belongs to this node instance. Reloads are driven by explicit
    // actions and host events, not by every selected picker value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id])
  useEffect(() => {
    if (!selectedInstance) return
    let cancelled = false
    void api.snapshot(selectedInstance).then((next) => {
      if (!cancelled && next) { setSnapshot(next); setCatalog(toCatalog(instances, next)) }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [api, instances, selectedInstance])
  const refresh = async (): Promise<void> => { if (!api || !selectedInstance || busy) return; setBusy(true); try { const next = await api.refresh(selectedInstance); setSnapshot(next); setCatalog(toCatalog(instances, next)) } catch (cause) { setError(cause instanceof Error ? cause.message : copy('Refresh failed.', '更新失敗。')) } finally { setBusy(false) } }
  const preview = selectedService && selectedEntityIds.length > 0 && selectedInstanceRecord && selectedEntityRecord?.canRead !== false && selectedEntityIds.every((entityId) => catalog?.entities.some((item) => item.entityId === entityId && item.canRead !== false)) ? { instanceId: selectedInstance, domain, service, entityIds: selectedEntityIds, data: values } : null
  const call = async (): Promise<void> => { if (!api || !preview || !selectedService || selectedService.canCall === false) return; setBusy(true); try { const result = await api.call({ ...preview, ...(selectedService.risk === 'destructive' ? { confirmation: { kind: 'super-confirmation' as const, approved: true as const } } : {}) }); if (!result.ok) { setError(result.error); return } setNotice(result.message ?? copy('Home Assistant accepted the call.', 'Home Assistant 接受咗服務呼叫。')); setConfirming(false); if (selectedInstance) { const next = await api.refresh(selectedInstance); setSnapshot(next); setCatalog(toCatalog(instances, next)) } } catch (cause) { setError(cause instanceof Error ? cause.message : copy('Service call failed.', '服務呼叫失敗。')) } finally { setBusy(false) } }
  const beginCall = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (!preview || !selectedService) return
    if (selectedService.risk === 'destructive') {
      const rect = event.currentTarget.getBoundingClientRect()
      openDestructiveGate({
        title: `Call destructive Home Assistant service ${preview.domain}.${preview.service}`,
        description: `This changes ${preview.entityIds.join(', ')} and may be irreversible. Review the exact target and payload before authorizing.`,
        affected: preview.entityIds,
        confirmLabel: 'Authorize service call',
        anchor: { x: rect.left, y: rect.bottom },
        restoreFocusEl: event.currentTarget,
        onConfirm: () => { void call() }
      })
      return
    }
    setConfirming(true)
  }
  useEffect(() => { if (!confirming) return; const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setConfirming(false) } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [confirming])
  return <div className="homeassistant-node__body nodrag nowheel"><div className="homeassistant-node__section"><div className="homeassistant-node__section-title">{copy('Home Assistant connection', 'Home Assistant 連線')}</div><p className="homeassistant-node__hint">{copy('Instances, credentials and live state stay on this computer. Only safe service intent travels with the project.', '實體、憑證同即時狀態留喺呢部電腦，專案只會帶住安全嘅服務意圖。')}</p><Button type="button" variant="primary" onClick={() => void load()} disabled={busy}>{busy ? copy('Refreshing…', '更新緊…') : copy('Discover instances and controls', '搜尋實體同控制項')}</Button></div>{catalog && <div className="homeassistant-node__section"><div className="homeassistant-node__section-title">{copy('Discovered controls', '已搜尋控制項')}</div><Picker label="Instance" value={selectedInstance} options={instances.map((item) => ({ value: item.id, label: `${item.label} · ${item.baseUrl}`, disabled: !item.enabled, reason: !item.enabled ? 'disabled' : undefined }))} onChange={(value) => { setSelectedInstance(value); setSelectedEntity(''); setSelectedEntityIds([]); const instance = instances.find((item) => item.id === value); updateNodeData(id, { serviceConnection: instance ? { endpoint: instance.baseUrl } : undefined, homeAssistantBinding: { instanceId: value } }) }} /><Picker label="Entity" value={selectedEntity} options={catalog.entities.map((item) => ({ value: item.entityId, label: `${item.name} · ${item.entityId}`, disabled: item.canRead === false, reason: item.permissionReason }))} onChange={(value) => { setSelectedEntity(value); setSelectedEntityIds(value ? [value] : []); updateNodeData(id, { homeAssistantBinding: { instanceId: selectedInstance, entityId: value } }) }} /><div className="homeassistant-node__bulk"><span className="homeassistant-node__label">{copy(`${selectedEntityIds.length} entities selected`, `${selectedEntityIds.length} 個實體已選擇`)}</span><Button type="button" onClick={() => setSelectedEntityIds(catalog.entities.filter((item) => item.canRead !== false).slice(0, 256).map((item) => item.entityId))}>{copy('Select all readable', '選擇全部可讀實體')}</Button><Button type="button" onClick={() => setSelectedEntityIds([])} disabled={selectedEntityIds.length === 0}>{copy('Clear selection', '清除選擇')}</Button></div><Picker label="Domain" value={domain} options={catalog.domains.map((item) => ({ value: item.domain, label: `${item.name} · ${item.domain}` }))} onChange={(value) => { setDomain(value); setService(''); updateNodeData(id, { homeAssistantIntent: { domain: value } }) }} /><Picker label="Service" value={service} options={(catalog.domains.find((item) => item.domain === domain)?.services ?? []).map((item) => ({ value: item.service, label: `${item.name} · ${item.service}`, disabled: item.canCall === false, reason: item.permissionReason }))} onChange={(value) => { setService(value); updateNodeData(id, { homeAssistantIntent: { domain, service: value } }) }} disabled={!domain} />}{selectedService && <div className="homeassistant-node__schema"><strong>{selectedService.name}</strong>{selectedService.canCall === false && <p className="homeassistant-node__warning">{selectedService.permissionReason ?? copy('This service is read-only for the current credential.', '呢個服務對目前憑證係唯讀。')}</p>}{selectedService.typedFields.map((field) => <ServiceField key={field.name} field={field} value={values[field.name]} entities={catalog.entities} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />)}<Button type="button" variant="primary" onClick={beginCall} disabled={!preview || selectedService.canCall === false || selectedEntityRecord?.canRead === false || busy}>{copy(selectedService.risk === 'destructive' ? 'Authorize destructive service call' : 'Review service call', selectedService.risk === 'destructive' ? '授權破壞性服務呼叫' : '檢查服務呼叫')}</Button></div>}{selectedEntityRecord && <div className="homeassistant-node__state" aria-live="polite"><strong>{copy('Live state', '即時狀態')}</strong><span>{snapshot?.entities.find((item) => item.entity_id === selectedEntity)?.state ?? copy('Not read yet', '未讀取')}</span><Button type="button" onClick={() => void refresh()} disabled={busy}>{copy('Refresh state', '重新讀取狀態')}</Button></div>}</div>}{!catalog && <p className="homeassistant-node__empty">{copy('No catalog loaded. Discover this host to receive its real domains, services, entities and permissions.', '未載入目錄，請搜尋呢部主機取得真實網域、服務、實體同權限。')}</p>}{error && <p className="homeassistant-node__error" role="alert">{error}</p>}{notice && <p className="homeassistant-node__notice" role="status">{notice}</p>}{confirming && preview && <div className="homeassistant-node__confirmation" role="dialog" aria-modal="true" aria-label={copy('Review Home Assistant service call', '檢查 Home Assistant 服務呼叫')}><strong>{copy('Review service call', '檢查服務呼叫')}</strong><p>{copy(`Home Assistant will call ${preview.domain}.${preview.service} for ${preview.entityIds.join(', ')}.`, `Home Assistant 會對 ${preview.entityIds.join('、')} 呼叫 ${preview.domain}.${preview.service}。`)}</p><pre>{JSON.stringify(preview.data, null, 2)}</pre><div className="homeassistant-node__actions"><Button type="button" onClick={() => setConfirming(false)}>{copy('Cancel', '取消')}</Button><Button type="button" variant="primary" onClick={() => void call()} disabled={busy}>{copy('Confirm and call', '確認並呼叫')}</Button></div></div>}</div>
}

export function HomeAssistantControlPanel({ id, data }: NodeProps<CanvasNode>): React.JSX.Element {
  const api = window.nodeTerminal.homeAssistant
  const copy = useCopy()
  const [label, setLabel] = useState('Home Assistant')
  const [baseUrl, setBaseUrl] = useState('https://homeassistant.local:8123')
  const [token, setToken] = useState('')
  const [creating, setCreating] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [instances, setInstances] = useState<HomeAssistantInstance[]>([])
  useEffect(() => { void api.list().then(setInstances).catch(() => setInstances([])) }, [api])
  const create = async (): Promise<void> => {
    if (!label.trim() || !baseUrl.trim() || !token.trim() || creating) return
    setCreating(true); setSetupError(null)
    try {
      const instance = await api.create({ label: label.trim(), baseUrl: baseUrl.trim(), token: token.trim() })
      setToken('')
      await api.connect(instance.id)
    } catch (cause) {
      setSetupError(cause instanceof Error ? cause.message : copy('Could not configure Home Assistant.', '未能設定 Home Assistant。'))
    } finally { setCreating(false) }
  }
  return <>
    <div className="homeassistant-node__section homeassistant-node__setup">
      <div className="homeassistant-node__section-title">{copy('Configure an instance', '設定 Home Assistant 實體')}</div>
      <p className="homeassistant-node__hint">{copy('Add or edit an instance here. The token is written directly to the host vault and is never kept in the node.', '喺呢度加入或編輯實體。Token 直接寫入主機憑證保管庫，唔會留喺節點。')}</p>
      <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={copy('Instance name', '實體名稱')} aria-label={copy('Instance name', '實體名稱')} />
      <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://homeassistant.example" aria-label="Home Assistant URL" />
      <Input value={token} onChange={(event) => setToken(event.target.value)} type="password" placeholder={copy('Access token', '存取 Token')} aria-label={copy('Access token', '存取 Token')} />
      <Button type="button" variant="primary" onClick={() => void create()} disabled={creating || !label.trim() || !baseUrl.trim() || !token.trim()}>{creating ? copy('Saving…', '儲存緊…') : copy('Add instance and connect', '加入實體並連線')}</Button>
      {setupError && <p className="homeassistant-node__error" role="alert">{setupError}</p>}
      {instances.length > 0 && <div className="homeassistant-node__token-actions"><span className="homeassistant-node__label">{copy('Credential actions', '憑證操作')}</span>{instances.map((instance) => <Button key={instance.id} type="button" onClick={() => void api.setToken(instance.id, null).then(() => setSetupError(null)).catch((cause) => setSetupError(cause instanceof Error ? cause.message : copy('Could not clear the credential.', '未能清除憑證。')))}>{copy(`Clear token for ${instance.label}`, `清除 ${instance.label} Token`)}</Button>)}</div>}
    </div>
    <HomeAssistantControlSurface id={id} data={data} type="homeassistant" selected={false} />
  </>
}

export default HomeAssistantControlPanel
