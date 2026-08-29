import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import type { PortableBindingState } from '../../shared/types'
import type { PortableBindingAction } from '../../shared/types'

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
  const [identity, setIdentity] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Choose how this node should connect on this computer.')
  const fieldRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()

  useEffect(() => {
    let active = true
    void window.nodeTerminal.workspace.portableBindings.state({ nodeId, featureId, displayLabel, hasMissingAssets }).then((next) => {
      if (active) setStates(next)
    }).catch(() => {
      if (active) setMessage('Binding choices could not be loaded. The project remains unbound.')
    })
    return () => { active = false }
  }, [nodeId, featureId, displayLabel, hasMissingAssets])

  const visible = useMemo(() => states.filter((state) => search.test(`${bindingActionLabel(state.action)} ${state.reason ?? ''}`)), [states, search])
  const chosen = states.find((state) => state.action === selected)
  const canSubmit = Boolean(chosen?.enabled && selected && (selected === 'leave-unbound' || (identity.trim() && reference.trim()))) && !busy

  const submit = async (): Promise<void> => {
    if (!selected || !canSubmit) return
    setBusy(true)
    setMessage('Saving the local binding choice. No provider, process, or deployment is started by this action.')
    const result = await window.nodeTerminal.workspace.portableBindings.apply({
      nodeId,
      action: selected,
      ...(selected !== 'leave-unbound' ? {
        providerOrHostIdentity: identity.trim(),
        localResourceReferences: { resource: reference.trim() },
        credentialKeys: []
      } : {})
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
      {selected && selected !== 'leave-unbound' && (
        <div className="md3-portable-binding-form">
          <label>Local provider or host identity <Input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
          <label>Verified local resource reference <Input value={reference} readOnly aria-describedby="portable-binding-resource-help" /></label>
          <Button type="button" onClick={() => void window.nodeTerminal.dialog.selectFile().then((picked) => { if (picked) setReference(picked) })}>Browse for local resource…</Button>
          <p id="portable-binding-resource-help">Choose an existing local file. The host verifies it again before saving this binding.</p>
          <p>Credentials remain in the operating-system vault. This form accepts only an opaque local reference, never a credential value.</p>
        </div>
      )}
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
