import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  OAuthCallbackHandle,
  ProviderAccountsSnapshot,
  ProviderBlueprint,
  ProviderId,
  ProviderProfile
} from '@shared/provider-accounts'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { Button } from '@renderer/ui/Button'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import { useProjects } from '../../../state/projects'

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'xai', label: 'xAI' },
  { id: 'moonshot', label: 'Moonshot' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'opencode', label: 'opencode' },
  { id: 'custom', label: 'Custom provider' }
]

const ROW = {
  profiles: {
    title: 'Provider profiles',
    keywords: ['provider', 'profile', 'account', 'oauth', 'api key', 'cookie', 'permissions', 'expiry', 'select']
  },
  bindings: {
    title: 'Project bindings',
    keywords: ['binding', 'blueprint', 'project', 'node', 'local', 'portable', 'rebind']
  }
}

function statusText(profile: ProviderProfile): string {
  if (profile.status === 'ready') return profile.expiresAt ? `Ready · expires ${new Date(profile.expiresAt).toLocaleString()}` : 'Ready · no expiry reported'
  if (profile.status === 'expired') return 'Expired · set a fresh credential'
  if (profile.status === 'revoked') return 'Revoked · sign in again'
  if (profile.status === 'error') return 'Unavailable · inspect the provider configuration'
  return 'Needs sign-in · choose OAuth or set a credential'
}

export function ProviderAccountsSection({ isActive, projectId, blueprints = [] }: { isActive: boolean; projectId: string | null; blueprints?: ProviderBlueprint[] }): React.JSX.Element | null {
  const [state, setState] = useState<ProviderAccountsSnapshot | null>(null)
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [label, setLabel] = useState('')
  const [accountLabel, setAccountLabel] = useState('')
  const [authKind, setAuthKind] = useState<'oauth' | 'api-key' | 'cookie' | 'external'>('oauth')
  const [credential, setCredential] = useState('')
  const [permissions, setPermissions] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [redirectUri, setRedirectUri] = useState('http://127.0.0.1:0/oauth/callback')
  const [callback, setCallback] = useState<OAuthCallbackHandle | null>(null)
  const [callbackValue, setCallbackValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setProjectProviderBlueprints = useProjects((store) => store.setProjectProviderBlueprints)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    void window.nodeTerminal.providerAccounts.snapshot().then(setState).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Could not read provider profiles.')
    })
  }

  useEffect(() => {
    if (!isActive) return
    refresh()
    return window.nodeTerminal.providerAccounts.onChanged(setState)
  }, [isActive])

  const profiles = useMemo(() => {
    if (!state) return []
    return state.profiles.filter((profile) => {
      const haystack = `${profile.label} ${profile.provider} ${profile.accountLabel ?? ''} ${profile.status} ${profile.permissions.join(' ')}`
      return search.active ? search.test(haystack) : true
    })
  }, [search.active, search.test, state])

  const create = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const profile = await window.nodeTerminal.providerAccounts.createProfile({
        provider,
        label: label.trim() || `${PROVIDERS.find((item) => item.id === provider)?.label ?? 'Provider'} account`,
        accountLabel: accountLabel.trim() || undefined,
        authKind,
        scopes: permissions.split(/[\s,]+/).filter(Boolean)
      })
      if (credential.trim()) await window.nodeTerminal.providerAccounts.setCredential({
        profileId: profile.id,
        value: credential,
        permissions: permissions.split(/[\s,]+/).filter(Boolean),
        expiresAt: expiresAt ? Date.parse(expiresAt) : undefined
      })
      setLabel('')
      setAccountLabel('')
      setCredential('')
      setExpiresAt('')
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the profile.')
    } finally {
      setBusy(false)
    }
  }

  const startOAuth = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const result = await window.nodeTerminal.providerAccounts.startOAuth({
        provider,
        label: label.trim() || `${PROVIDERS.find((item) => item.id === provider)?.label ?? 'Provider'} account`,
        accountLabel: accountLabel.trim() || undefined,
        scopes: permissions.split(/[\s,]+/).filter(Boolean),
        authUrl,
        redirectUri
      })
      setCallback(result.handle)
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start OAuth sign-in.')
    } finally {
      setBusy(false)
    }
  }

  const completeOAuth = async (): Promise<void> => {
    if (!callback) return
    setError(null)
    setBusy(true)
    try {
      const result = await window.nodeTerminal.providerAccounts.completeOAuth({
        callbackId: callback.id,
        state: callback.state,
        value: callbackValue,
        permissions: permissions.split(/[\s,]+/).filter(Boolean),
        expiresAt: expiresAt ? Date.parse(expiresAt) : undefined,
        accountLabel: accountLabel.trim() || undefined
      })
      if (!result) throw new Error('The callback was rejected, expired, or already consumed.')
      setCallback(null)
      setCallbackValue('')
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete OAuth sign-in.')
    } finally {
      setBusy(false)
    }
  }

  const bindSelected = async (profile: ProviderProfile): Promise<void> => {
    if (!projectId || !blueprints[0]) {
      setError('Open a project with a provider blueprint before binding a local profile.')
      return
    }
    try {
      await window.nodeTerminal.providerAccounts.bind({
        projectId,
        blueprintId: blueprints[0].id,
        profileId: profile.id,
        credentialRefId: profile.credential?.id,
        selected: true
      })
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not bind the profile.')
    }
  }

  const addBlueprint = (): void => {
    if (!projectId) return
    const next: ProviderBlueprint = {
      version: 1,
      id: `${provider}-blueprint-${Date.now().toString(36)}`,
      provider,
      label: label.trim() || `${PROVIDERS.find((item) => item.id === provider)?.label ?? 'Provider'} blueprint`,
      ...(accountLabel.trim() ? { accountLabel: accountLabel.trim() } : {}),
      authKind,
      ...(permissions.trim() ? { scopes: permissions.split(/[\s,]+/).filter(Boolean) } : {}),
      ...(authUrl.trim() ? { endpoint: authUrl.trim() } : {})
    }
    const existing = blueprints.some((item) => item.id === next.id) ? blueprints : [...blueprints, next]
    setProjectProviderBlueprints(projectId, existing)
  }

  if (!isActive) return null
  return (
    <SettingsSection id="provider-accounts" title="Provider accounts" description="Keep named provider profiles on this machine. Project blueprints travel with the project, while credentials stay behind opaque operating-system vault references." isActive={isActive} searchEntries={[ROW.profiles, ROW.bindings]}>
      <SearchableRow {...ROW.profiles}>
        <div className="space-y-4">
          <FieldRow label="Find profiles" description="Plain text is the default. Enable regex only when you deliberately need it." control={<div className="relative flex max-w-xl items-center gap-2"><Input ref={searchRef} value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Search provider profiles" aria-label="Search provider profiles" /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex — provider profiles" /></div>} />
          <FieldRow label="Provider" description="Choose from known providers, or use Custom provider for an explicitly configured endpoint." control={<Select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId)}>{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>} />
          <FieldRow label="Profile name" description="A display label only. It is not a credential." control={<Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Work account" />} />
          <FieldRow label="Account label" description="Optional provider account or tenant name." control={<Input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} placeholder="Team or tenant" />} />
          <FieldRow label="Authentication" description="Credentials are accepted only for local storage and never read back into the interface." control={<Select value={authKind} onChange={(event) => setAuthKind(event.target.value as typeof authKind)}><option value="oauth">OAuth callback</option><option value="api-key">API key</option><option value="cookie">Cookie</option><option value="external">External sign-in</option></Select>} />
          <FieldRow label="Permissions" description="Space or comma-separated permission names, copied as metadata only." control={<Input value={permissions} onChange={(event) => setPermissions(event.target.value)} placeholder="read write" />} />
          <FieldRow label="Credential value" description="Write-only input. The value is sealed locally and is never returned, displayed, exported, or logged." control={<Input type="password" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="Paste only when you are ready to save" />} />
          <FieldRow label="Expiry" description="Optional local expiry timestamp. An expired profile stays listed and asks for re-authentication." control={<Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />} />
          <div className="flex flex-wrap gap-2"><Button onClick={() => void create()} disabled={busy}>{busy ? 'Saving…' : 'Create local profile'}</Button><Button variant="ghost" onClick={addBlueprint} disabled={!projectId}>Add portable blueprint</Button><Button variant="ghost" onClick={() => void startOAuth()} disabled={busy || authKind !== 'oauth' || !authUrl.trim()}>Start OAuth sign-in</Button></div>
          {authKind === 'oauth' && <div className="grid max-w-xl gap-2"><Input value={authUrl} onChange={(event) => setAuthUrl(event.target.value)} placeholder="https://provider.example/authorize" aria-label="OAuth authorization URL" /><Input value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} placeholder="http://127.0.0.1:port/callback" aria-label="OAuth redirect URI" /></div>}
          {callback && <div className="rounded-lg border border-outline/30 bg-surface-container-high p-3"><p className="text-sm font-medium">OAuth callback pending</p><p className="text-xs text-text-muted">Complete the provider sign-in, then enter the callback value here. The state is single-use and expires at {new Date(callback.expiresAt).toLocaleString()}.</p><Input type="password" autoComplete="off" value={callbackValue} onChange={(event) => setCallbackValue(event.target.value)} placeholder="Callback credential value" aria-label="OAuth callback credential value" /><div className="mt-2 flex gap-2"><Button onClick={() => void completeOAuth()} disabled={busy || !callbackValue}>Complete callback</Button><Button variant="ghost" onClick={() => { void window.nodeTerminal.providerAccounts.cancelOAuth(callback.id); setCallback(null) }}>Cancel</Button></div></div>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="space-y-2" aria-live="polite">{profiles.length === 0 ? <p className="text-sm text-text-muted">No provider profiles match this search.</p> : profiles.map((profile) => <div key={profile.id} className="rounded-lg border border-outline/30 bg-surface-container-low p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{profile.label}</p><p className="text-xs text-text-muted">{profile.provider}{profile.accountLabel ? ` · ${profile.accountLabel}` : ''} · {statusText(profile)}</p></div><div className="flex flex-wrap gap-2"><Button variant={state?.selectedProfileId === profile.id ? 'primary' : 'ghost'} onClick={() => void window.nodeTerminal.providerAccounts.selectProfile(profile.id)}>{state?.selectedProfileId === profile.id ? 'Selected' : 'Select'}</Button><Button variant="ghost" onClick={() => void bindSelected(profile)} disabled={!projectId || !blueprints.length} title={!projectId ? 'Open a project first.' : !blueprints.length ? 'Add a provider blueprint to this project first.' : undefined}>Bind to project</Button><Button variant="ghost" onClick={() => void window.nodeTerminal.providerAccounts.clearCredential(profile.id)}>Clear credential</Button><Button variant="ghost" onClick={() => void window.nodeTerminal.providerAccounts.removeProfile(profile.id)}>Remove</Button></div></div><p className="mt-2 text-xs text-text-muted">Permissions: {profile.permissions.length ? profile.permissions.join(', ') : 'none recorded'} · Vault reference: {profile.credential ? profile.credential.id : 'not configured'}</p></div>)}</div>
        </div>
      </SearchableRow>
      <SearchableRow {...ROW.bindings}><div className="space-y-2"><p className="text-sm text-text-muted">Bindings are machine-local pointers. Portable blueprints remain in project content and never include credential values, vault bytes, paths, process state, or host identities.</p>{!projectId ? <p className="text-sm text-text-muted">Open a project to see its local bindings.</p> : state?.bindings.filter((binding) => binding.projectId === projectId).map((binding) => <div key={binding.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline/30 p-3"><span className="text-sm">{binding.blueprintId}{binding.nodeId ? ` · node ${binding.nodeId}` : ''}{binding.selected ? ' · selected' : ''}</span><Button variant="ghost" onClick={() => void window.nodeTerminal.providerAccounts.unbind(binding.id)}>Unbind</Button></div>)}</div></SearchableRow>
    </SettingsSection>
  )
}
