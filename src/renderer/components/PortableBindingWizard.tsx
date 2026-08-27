import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import type { PortableBindingState } from '../../shared/types'
import type { PortableBindingAction } from '../../shared/types'
import type { ProviderAccountSummary, ProviderDescriptor, ProviderResourceSummary } from '../../shared/provider-services'

const bindingActionLabel = (action: PortableBindingAction): string => ({
  configure: 'Configure this node',
  rebind: 'Rebind to a local resource',
  adopt: 'Adopt an existing resource',
  deploy: 'Deploy a new resource',
  'locate-asset': 'Locate an asset',
  'leave-unbound': 'Leave unbound'
}[action])

interface PortableBindingWizardProps {
  nodeId: string
  featureId: string
  displayLabel: string
  anchorRef: RefObject<HTMLElement | null>
  hasMissingAssets?: boolean
  onClose: () => void
}

/**
 * Destination binding is deliberately a guided, anchored surface. Import never opens it or
 * invokes an action. The wizard presents every route with its disabled reason and only writes an
 * opaque local binding after the user explicitly chooses Configure, Rebind, or Adopt.
 */
export function PortableBindingWizard({ nodeId, featureId, displayLabel, anchorRef, hasMissingAssets, onClose }: PortableBindingWizardProps): React.JSX.Element {
  const [states, setStates] = useState<PortableBindingState[]>([])
  const [selected, setSelected] = useState<PortableBindingAction | null>(null)
  const [providers, setProviders] = useState<ProviderDescriptor[]>([])
  const [accounts, setAccounts] = useState<ProviderAccountSummary[]>([])
  const [resources, setResources] = useState<ProviderResourceSummary[]>([])
  const [accountId, setAccountId] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [assetPath, setAssetPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Choose how this node should connect on this computer.')
  const fieldRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()
  const accountFieldRef = useRef<HTMLInputElement>(null)
  const accountSearch = useRegexSearchField()
  const resourceFieldRef = useRef<HTMLInputElement>(null)
  const resourceSearch = useRegexSearchField()

  useEffect(() => {
    let active = true
    void Promise.all([
      window.nodeTerminal.workspace.portableBindings.state({ nodeId, featureId, displayLabel, hasMissingAssets }),
      window.nodeTerminal.providerServices.catalog(),
      window.nodeTerminal.providerServices.accounts()
    ]).then(([nextStates, nextProviders, nextAccounts]) => {
      if (active) { setStates(nextStates); setProviders(nextProviders); setAccounts(nextAccounts) }
    }).catch(() => {
      if (active) setMessage('Binding choices could not be loaded. The project remains unbound.')
    })
    return () => { active = false }
  }, [nodeId, featureId, displayLabel, hasMissingAssets])

  const visible = useMemo(() => states.filter((state) => search.test(`${bindingActionLabel(state.action)} ${state.reason ?? ''}`)), [states, search])
  const visibleAccounts = useMemo(() => accounts.filter((account) => accountSearch.test(`${account.providerLabel} ${account.displayName} ${account.externalAccountId} ${account.reason ?? ''}`)), [accounts, accountSearch])
  const visibleResources = useMemo(() => resources.filter((resource) => resourceSearch.test(`${resource.label} ${resource.kind} ${resource.reason ?? ''}`)), [resources, resourceSearch])
  const chosen = states.find((state) => state.action === selected)
  const isProviderBinding = selected === 'configure' || selected === 'rebind' || selected === 'adopt'
  const canSubmit = Boolean(chosen?.enabled && selected && (
    selected === 'leave-unbound' ||
    (selected === 'locate-asset' && assetPath) ||
    (isProviderBinding && accountId && resourceId)
  )) && !busy

  useEffect(() => {
    if (!accountId) { setResources([]); setResourceId(''); return }
    let active = true
    void window.nodeTerminal.providerServices.resources(accountId, featureId).then((next) => {
      if (active) { setResources(next); setResourceId('') }
    }).catch(() => { if (active) setMessage('Resources could not be loaded for that account.') })
    return () => { active = false }
  }, [accountId, featureId])

  const connectProvider = async (provider: ProviderDescriptor): Promise<void> => {
    if (provider.availability !== 'available' || busy) return
    setBusy(true)
    const result = await window.nodeTerminal.providerServices.beginOAuth(provider.id)
    setBusy(false)
    if (result.status !== 'ready' || !result.authorizationUrl) { setMessage(result.reason ?? 'Provider sign-in is unavailable.'); return }
    window.nodeTerminal.shell.openExternal(result.authorizationUrl)
    setMessage(`Complete ${provider.label} consent in the browser. The one-time callback expires at ${new Date(result.expiresAt!).toLocaleTimeString()}.`)
  }

  const submit = async (): Promise<void> => {
    if (!selected || !canSubmit) return
    setBusy(true)
    setMessage('Saving the local binding choice. No provider, process, or deployment is started by this action.')
    const result = await window.nodeTerminal.workspace.portableBindings.apply({
      nodeId,
      action: selected,
      featureId,
      ...(isProviderBinding ? { providerAccountId: accountId, resourceId } : {}),
      ...(selected === 'locate-asset' ? { resourceId: assetPath } : {})
    })
    setBusy(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    setMessage(result.state === 'bound' ? 'Local binding saved. Imported project content remains unchanged.' : 'The project is left unbound on this computer.')
    onClose()
  }

  return (
    <div className="md3-dialog md3-portable-binding-wizard" role="dialog" aria-label={`Binding options for ${displayLabel}`}>
      <div className="md3-dialog__header">
        <h2>Connect {displayLabel}</h2>
        <p>Portable project intent is separate from this computer&apos;s local binding.</p>
      </div>
      <div className="md3-search-row">
        <Input ref={fieldRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Search binding choices" aria-label="Search binding choices" />
        <AnchoredRegexBuilder search={search} fieldRef={fieldRef} label="Regex for binding choices" />
      </div>
      {search.error && <p role="alert">{search.error}</p>}
      <div className="md3-portable-binding-actions" role="listbox" aria-label="Binding choices">
        {visible.map((state) => (
          <button
            key={state.action}
            type="button"
            role="option"
            aria-selected={state.action === selected}
            disabled={!state.enabled || busy}
            title={state.enabled ? bindingActionLabel(state.action) : state.reason}
            onClick={() => setSelected(state.action)}
          >
            <span>{bindingActionLabel(state.action)}</span>
            {!state.enabled && <small>{state.reason}</small>}
          </button>
        ))}
      </div>
      {isProviderBinding && (
        <div className="md3-portable-binding-form">
          <h3>Connected account</h3>
          <div className="md3-search-row">
            <Input ref={accountFieldRef} value={accountSearch.value} onChange={(event) => accountSearch.setValue(event.target.value)} placeholder="Search connected accounts" aria-label="Search connected provider accounts" />
            <AnchoredRegexBuilder search={accountSearch} fieldRef={accountFieldRef} label="Regex for connected provider accounts" />
          </div>
          {accountSearch.error && <p role="alert">{accountSearch.error}</p>}
          <div role="listbox" aria-label="Connected provider accounts" className="md3-portable-binding-actions">
            {visibleAccounts.map((account) => <button key={account.id} type="button" role="option" aria-selected={accountId === account.id} disabled={busy || account.state !== 'connected'} title={account.reason ?? account.displayName} onClick={() => setAccountId(account.id)}><span>{account.providerLabel}: {account.displayName}</span>{account.state !== 'connected' && <small>{account.reason ?? 'This account needs attention.'}</small>}</button>)}
            {visibleAccounts.length === 0 && <p>No connected account matches. Choose an available provider below.</p>}
          </div>
          <h3>Connect a provider</h3>
          <div role="list" className="md3-portable-binding-actions">
            {providers.map((provider) => <button key={provider.id} type="button" disabled={busy || provider.availability !== 'available'} title={provider.reason ?? `Connect ${provider.label}`} onClick={() => void connectProvider(provider)}><span>{provider.label}</span>{provider.reason && <small>{provider.reason}</small>}</button>)}
          </div>
          <h3>Verified local resource</h3>
          <div className="md3-search-row">
            <Input ref={resourceFieldRef} value={resourceSearch.value} onChange={(event) => resourceSearch.setValue(event.target.value)} placeholder="Search provider resources" aria-label="Search provider resources" disabled={!accountId} />
            <AnchoredRegexBuilder search={resourceSearch} fieldRef={resourceFieldRef} label="Regex for provider resources" />
          </div>
          {resourceSearch.error && <p role="alert">{resourceSearch.error}</p>}
          <div role="listbox" aria-label="Verified provider resources" className="md3-portable-binding-actions">
            {visibleResources.map((resource) => <button key={resource.id} type="button" role="option" aria-selected={resourceId === resource.id} disabled={busy || !resource.available} title={resource.reason ?? resource.label} onClick={() => setResourceId(resource.id)}><span>{resource.label}</span><small>{resource.kind}{resource.reason ? `: ${resource.reason}` : ''}</small></button>)}
            {accountId && visibleResources.length === 0 && <p>The selected adapter reported no compatible resources.</p>}
          </div>
          <p>Credential values, OAuth state, provider sessions, and machine identity stay in private application data. Only opaque account and resource references enter the local binding.</p>
        </div>
      )}
      {selected === 'locate-asset' && <div className="md3-portable-binding-form"><p>Choose the missing asset from this computer. The absolute path remains local and is omitted from exports.</p><Button type="button" onClick={() => void window.nodeTerminal.dialog.selectFile().then((picked) => { if (picked) setAssetPath(picked) })}>Browse for asset…</Button>{assetPath && <p aria-live="polite">Asset selected.</p>}</div>}
      <p aria-live="polite">{message}</p>
      <div className="md3-dialog__actions">
        <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" onClick={() => void submit()} disabled={!canSubmit}>{selected ? bindingActionLabel(selected) : 'Choose an action'}</Button>
      </div>
    </div>
  )
}

export function PortableBindingWizardPopover(props: PortableBindingWizardProps & { open: boolean }): React.JSX.Element | null {
  const { open, ...wizardProps } = props
  return (
    <AnchoredPopover anchorRef={props.anchorRef as RefObject<HTMLElement>} open={open} onClose={props.onClose} width={560} className="md3-portable-binding-popover">
      <PortableBindingWizard {...wizardProps} />
    </AnchoredPopover>
  )
}
