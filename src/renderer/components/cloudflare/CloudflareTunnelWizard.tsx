import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnchoredPopover } from '../../ui/AnchoredPopover'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { TextField } from '../../ui/md3/TextField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import {
  cloudflareTunnelLocalBinding,
  cloudflareTunnelPortableIntent,
  cloudflareTunnelPreview,
  validateCloudflareTunnelSelection,
  type CloudflareTunnelDiscovery,
  type CloudflareTunnelLocalBinding,
  type CloudflareTunnelPortableIntent,
  type CloudflareTunnelProgress,
  type CloudflareTunnelPreview,
  type CloudflareTunnelWizardSelection,
  type CloudflareTunnelWizardApi,
  type TunnelChoice
} from '@shared/cloudflare-tunnel-wizard'

interface ChoicePickerProps<T extends TunnelChoice> {
  id: string
  label: string
  items: readonly T[]
  value: string
  disabled?: boolean
  onChange: (id: string) => void
}

/** One picker owns one isolated search state and one anchored regex builder. */
function ChoicePicker<T extends TunnelChoice>({ id, label, items, value, disabled, onChange }: ChoicePickerProps<T>): React.JSX.Element {
  const search = useRegexSearchField()
  const fieldRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => items.filter((item) => search.test(`${item.label} ${item.detail ?? ''} ${item.reason ?? ''}`)), [items, search])
  return (
    <fieldset className="cloudflare-tunnel-wizard__picker" disabled={disabled}>
      <legend>{label}</legend>
      <div className="cloudflare-tunnel-wizard__search">
        <Input
          ref={fieldRef}
          id={`${id}-search`}
          type="search"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          placeholder={`Search ${label.toLocaleLowerCase()}`}
          aria-label={`Search ${label.toLocaleLowerCase()}`}
          aria-invalid={Boolean(search.error)}
        />
        <AnchoredRegexBuilder search={search} fieldRef={fieldRef} label={`Regex builder for ${label.toLocaleLowerCase()} search`} />
      </div>
      {search.error ? <p className="cloudflare-tunnel-wizard__error" role="alert">{search.error}</p> : null}
      <div className="cloudflare-tunnel-wizard__choices" role="listbox" aria-label={label}>
        {visible.length === 0 ? <p role="status">No {label.toLocaleLowerCase()} match this search.</p> : visible.map((item) => {
          const unavailable = item.state === 'unavailable'
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === value}
              aria-disabled={unavailable}
              disabled={unavailable}
              title={unavailable ? item.reason : item.detail}
              onClick={() => onChange(item.id)}
            >
              <span>{item.label}</span>
              {item.detail ? <small>{item.detail}</small> : null}
              {unavailable && item.reason ? <small>{item.reason}</small> : null}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export interface CloudflareTunnelWizardProps {
  api: CloudflareTunnelWizardApi
  nodeId: string
  onClose: () => void
  onPortableIntent?: (intent: CloudflareTunnelPortableIntent) => void
  onBound?: (binding: CloudflareTunnelLocalBinding) => void
}

function firstAvailable<T extends TunnelChoice>(items: readonly T[]): string {
  return items.find((item) => item.state !== 'unavailable')?.id ?? ''
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * One-click Tunnel setup. Discovery and mutation are injected by the trusted host boundary. This
 * component only sends opaque ids from the latest discovery snapshot and generated values from
 * the selected records, so it has no raw request, shell, command, token, or host-path control.
 */
export function CloudflareTunnelWizard({ api, nodeId, onClose, onPortableIntent, onBound }: CloudflareTunnelWizardProps): React.JSX.Element {
  const [discovery, setDiscovery] = useState<CloudflareTunnelDiscovery | null>(null)
  const [selection, setSelection] = useState<CloudflareTunnelWizardSelection>({ accountId: '', zoneId: '', hostname: '', hostId: '', containerId: '', networkId: '', portId: '', originId: '' })
  const [preview, setPreview] = useState<CloudflareTunnelPreview | null>(null)
  const [progress, setProgress] = useState<CloudflareTunnelProgress | null>(null)
  const [message, setMessage] = useState('Loading available accounts, zones, hosts, and origins.')
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setMessage('Discovering current accounts, zones, hosts, containers, networks, and ports.')
    try {
      const next = await api.discover()
      setDiscovery(next)
      const accountId = firstAvailable(next.accounts)
      const zoneId = firstAvailable(next.zones.filter((zone) => zone.accountId === accountId))
      const hostId = firstAvailable(next.hosts)
      const containerId = firstAvailable(next.containers.filter((container) => container.hostId === hostId))
      const networkId = firstAvailable(next.networks.filter((network) => network.hostId === hostId && (!network.containerId || network.containerId === containerId)))
      const portId = firstAvailable(next.ports.filter((port) => port.hostId === hostId && port.containerId === containerId))
      const originId = firstAvailable(next.origins.filter((origin) => origin.hostId === hostId && origin.containerId === containerId && origin.networkId === networkId && origin.portId === portId))
      const zone = next.zones.find((item) => item.id === zoneId)
      setSelection({ accountId, zoneId, hostname: zone?.name ?? '', hostId, containerId, networkId, portId, originId })
      setPreview(null)
      setMessage('Review the discovered destination, then choose Create tunnel.')
    } catch (cause) {
      setDiscovery(null)
      setMessage(`Discovery could not be completed: ${errorText(cause)} Refresh and try again.`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const zones = discovery?.zones.filter((zone) => zone.accountId === selection.accountId) ?? []
  const containers = discovery?.containers.filter((container) => container.hostId === selection.hostId) ?? []
  const networks = discovery?.networks.filter((network) => network.hostId === selection.hostId && (!network.containerId || network.containerId === selection.containerId)) ?? []
  const ports = discovery?.ports.filter((port) => port.hostId === selection.hostId && port.containerId === selection.containerId) ?? []
  const origins = discovery?.origins.filter((origin) => origin.hostId === selection.hostId && origin.containerId === selection.containerId && origin.networkId === selection.networkId && origin.portId === selection.portId) ?? []
  const validation = discovery ? validateCloudflareTunnelSelection(selection, discovery) : { ok: false as const, error: 'Wait for discovery to finish.' }
  const canPreview = validation.ok && !busy && !progress

  const chooseAccount = (accountId: string): void => {
    if (!discovery) return
    const zoneId = firstAvailable(discovery.zones.filter((zone) => zone.accountId === accountId))
    const zone = discovery.zones.find((item) => item.id === zoneId)
    setSelection((current) => ({ ...current, accountId, zoneId, hostname: zone?.name ?? '', containerId: '', networkId: '', portId: '', originId: '' }))
    setPreview(null)
  }
  const chooseZone = (zoneId: string): void => {
    const zone = zones.find((item) => item.id === zoneId)
    setSelection((current) => ({ ...current, zoneId, hostname: zone?.name ?? current.hostname }))
    setPreview(null)
  }
  const chooseHost = (hostId: string): void => setSelection((current) => ({ ...current, hostId, containerId: '', networkId: '', portId: '', originId: '' }))
  const chooseContainer = (containerId: string): void => setSelection((current) => ({ ...current, containerId, networkId: '', portId: '', originId: '' }))
  const chooseNetwork = (networkId: string): void => setSelection((current) => ({ ...current, networkId, originId: '' }))
  const choosePort = (portId: string): void => setSelection((current) => ({ ...current, portId, originId: '' }))

  const showPreview = (): void => {
    if (!discovery || !validation.ok) return
    try {
      const next = cloudflareTunnelPreview(validation.selection, discovery)
      setPreview(next)
      onPortableIntent?.(next.portable)
      setMessage('Preview ready. Create tunnel will perform only the listed external operations.')
    } catch (cause) {
      setPreview(null)
      setMessage(errorText(cause))
    }
  }

  const submit = async (): Promise<void> => {
    if (!discovery || !validation.ok || !preview || busy) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setProgress({ phase: 'preflight', progress: 0.05, message: 'Rechecking every selection against the latest discovery.' })
    setMessage('Creating the tunnel and hostname route. Credentials remain in local protected storage.')
    try {
      const result = await api.create(validation.selection, controller.signal, setProgress)
      if (!result.ok) {
        setProgress({ phase: 'failed', progress: 0, message: result.error })
        setMessage(`${result.error} The selected choices remain available for a retry.`)
        return
      }
      const bound = await api.bindLocal(validation.selection, nodeId)
      if (!bound.ok) {
        setProgress({ phase: 'failed', progress: 0, message: bound.error })
        setMessage(`The tunnel was created, but local binding was not saved: ${bound.error} Restore or bind again from this preview.`)
        return
      }
      const binding = result.binding ?? cloudflareTunnelLocalBinding(nodeId, validation.selection, discovery)
      onBound?.(binding)
      setProgress({ phase: 'completed', progress: 1, message: 'Tunnel created, route verified, and local binding saved.' })
      setMessage('Tunnel ready. The portable intent remains separate from this computer’s binding.')
    } catch (cause) {
      const messageText = controller.signal.aborted ? 'Creation cancelled. The prior local binding remains active.' : errorText(cause)
      setProgress({ phase: controller.signal.aborted ? 'cancelled' : 'failed', progress: 0, message: messageText })
      setMessage(`${messageText} Refresh and retry from the preview when ready.`)
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  const cancel = (): void => {
    if (controllerRef.current) {
      controllerRef.current.abort()
      setMessage('Cancellation requested. No later step may publish a new route.')
      return
    }
    onClose()
  }

  return (
    <div className="md3-dialog cloudflare-tunnel-wizard" role="dialog" aria-label="One-click Cloudflare Tunnel wizard" aria-busy={busy}>
      <header className="cloudflare-tunnel-wizard__header">
        <h2>One-click Tunnel</h2>
        <p>Choose discovered values for the account, zone, hostname, host, container, network, port, and origin. No shell or raw request is accepted.</p>
      </header>

      <section className="cloudflare-tunnel-wizard__form" aria-label="Tunnel destination choices">
        <ChoicePicker id="tunnel-account" label="Cloudflare account" items={discovery?.accounts ?? []} value={selection.accountId} disabled={!discovery || busy} onChange={chooseAccount} />
        <ChoicePicker id="tunnel-zone" label="Zone" items={zones} value={selection.zoneId} disabled={!selection.accountId || busy} onChange={chooseZone} />
        <TextField
          label="Hostname"
          value={selection.hostname}
          onChange={(event) => { setSelection((current) => ({ ...current, hostname: event.target.value })); setPreview(null) }}
          supportText={validation.ok ? 'The hostname must remain inside the selected zone.' : (selection.hostname ? validation.error : 'Choose a zone, then enter a hostname inside it.')}
          invalid={Boolean(selection.hostname) && !validation.ok && Boolean(selection.zoneId)}
          disabled={busy || !selection.zoneId}
        />
        <ChoicePicker id="tunnel-host" label="Origin host" items={discovery?.hosts ?? []} value={selection.hostId} disabled={!discovery || busy} onChange={chooseHost} />
        <ChoicePicker id="tunnel-container" label="Discovered container" items={containers} value={selection.containerId} disabled={!selection.hostId || busy} onChange={chooseContainer} />
        <ChoicePicker id="tunnel-network" label="Container network" items={networks} value={selection.networkId} disabled={!selection.containerId || busy} onChange={chooseNetwork} />
        <ChoicePicker id="tunnel-port" label="Origin port" items={ports} value={selection.portId} disabled={!selection.containerId || busy} onChange={choosePort} />
        <ChoicePicker id="tunnel-origin" label="Verified origin" items={origins} value={selection.originId} disabled={!selection.portId || busy} onChange={(originId) => { setSelection((current) => ({ ...current, originId })); setPreview(null) }} />
      </section>

      {discovery && !validation.ok ? <p className="cloudflare-tunnel-wizard__error" role="alert">{validation.error}</p> : null}
      {preview ? (
        <section className="cloudflare-tunnel-wizard__preview" aria-label="Tunnel operation preview">
          <h3>Review before creating</h3>
          <dl>
            <dt>Account</dt><dd>{preview.accountLabel}</dd>
            <dt>Zone</dt><dd>{preview.zoneName}</dd>
            <dt>Hostname</dt><dd>{preview.hostname}</dd>
            <dt>Origin</dt><dd>{preview.origin}</dd>
            <dt>Local binding</dt><dd>Protected local provider-account reference only</dd>
          </dl>
          <ul>{preview.externalSideEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
          <p>Portable export keeps hostname, zone name, protocol, port, and desired labels. Account ids, host ids, container ids, network ids, credentials, paths, and runtime state stay local.</p>
        </section>
      ) : null}

      {progress ? (
        <section className="cloudflare-tunnel-wizard__progress" aria-label="Tunnel creation progress" aria-live="polite">
          <strong>{progress.phase}</strong><span>{progress.message}</span>
          <progress max={1} value={progress.progress} />
          {(progress.phase === 'failed' || progress.phase === 'cancelled') && <Button type="button" onClick={() => { setProgress(null); setMessage('Preview retained. Correct the choices or retry the same verified selection.') }}>Return to preview</Button>}
        </section>
      ) : null}

      <p className="cloudflare-tunnel-wizard__message" role="status">{message}</p>
      <footer className="cloudflare-tunnel-wizard__actions">
        <Button type="button" onClick={cancel}>{busy ? 'Cancel operation' : 'Close'}</Button>
        {!preview ? <Button type="button" variant="primary" disabled={!canPreview} title={validation.ok ? 'Review the tunnel operation' : validation.error} onClick={showPreview}>Review tunnel</Button> : <Button type="button" variant="primary" disabled={busy || Boolean(progress && progress.phase === 'completed')} title={busy ? 'Tunnel creation is already running' : 'Create the reviewed tunnel'} onClick={() => void submit()}>{busy ? 'Creating tunnel…' : 'Create tunnel'}</Button>}
        {!discovery && !busy ? <Button type="button" onClick={() => void refresh()}>Refresh discovery</Button> : null}
      </footer>
    </div>
  )
}

export interface CloudflareTunnelWizardPopoverProps extends CloudflareTunnelWizardProps {
  open: boolean
  anchorRef: RefObject<HTMLElement>
}

export function CloudflareTunnelWizardPopover({ open, anchorRef, ...props }: CloudflareTunnelWizardPopoverProps): React.JSX.Element | null {
  return (
    <AnchoredPopover anchorRef={anchorRef} open={open} onClose={props.onClose} width={640} className="cloudflare-tunnel-wizard-popover">
      <CloudflareTunnelWizard {...props} />
    </AnchoredPopover>
  )
}
