import { useMemo, useRef, useState } from 'react'
import type { DebugBrowserIntent, DebugBrowserProfile, DebugBrowserProxyKind } from '@shared/browser-debug-sessions'
import { normalizeDebugBrowserIntent, normalizeDebugBrowserProfile } from '@shared/browser-debug-sessions'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { TextField } from '../ui/md3/TextField'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { Input } from '../ui/Input'
import { Checkbox } from '../ui/md3/Checkbox'

const PROXY_KINDS: Array<{ value: DebugBrowserProxyKind; label: string }> = [
  { value: 'direct', label: 'Direct connection' },
  { value: 'http', label: 'HTTP proxy' },
  { value: 'socks5', label: 'SOCKS5 proxy' }
]
const CERTIFICATE_MODES = [
  { value: 'reject-invalid', label: 'Reject invalid certificates' },
  { value: 'system', label: 'Use system certificate store' },
  { value: 'custom', label: 'Use a selected local certificate' }
] as const

interface BrowserDebugSessionPickerProps {
  profiles: DebugBrowserProfile[] | undefined
  selectedId?: string
  targetUrl?: string
  onSelect: (id: string) => void
  onStart: (intent: DebugBrowserIntent) => void
  onCreate: (profile: DebugBrowserProfile) => void
  onRemove: (id: string) => void
}

/**
 * Guided picker for debugging sessions. It intentionally has no password or certificate-path
 * fields: those values are entered through host-owned vault and file-picker flows, then referenced
 * locally. The two search fields are independent and each has its own anchored regex builder.
 */
export function BrowserDebugSessionPicker({ profiles, selectedId, targetUrl = '', onSelect, onStart, onCreate, onRemove }: BrowserDebugSessionPickerProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const profileSearch = useRegexSearchField()
  const profileSearchRef = useRef<HTMLInputElement>(null)
  const proxySearch = useRegexSearchField()
  const proxySearchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState(targetUrl)
  const [proxyKind, setProxyKind] = useState<DebugBrowserProxyKind>('direct')
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState('')
  const [requiresAuthentication, setRequiresAuthentication] = useState(false)
  const [certificateMode, setCertificateMode] = useState<DebugBrowserIntent['certificateMode']>('reject-invalid')
  const [isolation, setIsolation] = useState<DebugBrowserIntent['isolation']>('ephemeral')
  const [error, setError] = useState<string | null>(null)
  const current = profiles?.find((profile) => profile.id === selectedId)
  const visibleProfiles = useMemo(
    () => (profiles ?? []).filter((profile) => profileSearch.test(`${profile.name} ${profile.id} ${profile.proxy.kind}`)),
    [profiles, profileSearch.mode, profileSearch.query, profileSearch.pattern, profileSearch.flags]
  )
  const visibleProxyKinds = useMemo(
    () => PROXY_KINDS.filter((kind) => proxySearch.test(kind.label)),
    [proxySearch.mode, proxySearch.query, proxySearch.pattern, proxySearch.flags]
  )

  const makeIntent = (): DebugBrowserIntent | null => {
    const candidate = normalizeDebugBrowserIntent({
      profileId: current?.id ?? selectedId ?? 'debug-default',
      targetUrl: url.trim(),
      isolation,
      proxy: {
        kind: proxyKind,
        ...(proxyKind === 'direct' ? {} : { host: proxyHost.trim(), port: Number(proxyPort) }),
        requiresAuthentication
      },
      certificateMode,
      debuggingEnabled: true
    })
    if (!candidate) {
      setError(vocab('Choose a valid HTTP or HTTPS target and a complete proxy configuration.'))
      return null
    }
    setError(null)
    return candidate
  }

  const commitCreate = (): void => {
    const profile = normalizeDebugBrowserProfile({
      id: `debug-${Date.now().toString(36)}`,
      name: name.trim(),
      color: '#6750A4',
      isolation,
      proxy: { kind: proxyKind, ...(proxyKind === 'direct' ? {} : { host: proxyHost.trim(), port: Number(proxyPort) }), requiresAuthentication },
      certificateMode
    })
    if (!profile) {
      setError(vocab('Give the debugging profile a name and complete its proxy fields.'))
      return
    }
    onCreate(profile)
    setCreating(false)
    setName('')
    setError(null)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="browser-profile-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={vocab('Debugging browser sessions')}
        title={vocab('Open an isolated debugging browser session')}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">◌</span>
        <span>{current?.name ?? vocab('Debug browser')}</span>
      </button>
      <AnchoredPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={440}>
        <section className="md3-popover-card" role="dialog" aria-label={vocab('Debugging browser session setup')}>
          <h3>{vocab('Isolated debugging browser')}</h3>
          <p>{vocab('Choose a named profile, proxy, certificate policy, and target. This session never silently becomes an ordinary browser.')}</p>
          <label>
            {vocab('Search debugging profiles')}
            <span className="menu-filter__row">
              <Input ref={profileSearchRef} type="search" value={profileSearch.value} onChange={(event) => profileSearch.setValue(event.target.value)} placeholder="Plain text filter" aria-label="Filter debugging profiles" />
              <AnchoredRegexBuilder search={profileSearch} fieldRef={profileSearchRef} label={vocab('Regex for debugging profiles')} />
            </span>
          </label>
          {profileSearch.error ? <p role="alert">{profileSearch.error}</p> : null}
          <label>
            {vocab('Profile')}
            <Select value={selectedId ?? ''} onChange={(event) => onSelect(event.target.value)} aria-label={vocab('Debugging browser profile')}>
              <option value="">{vocab('Choose a profile')}</option>
              {visibleProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.proxy.kind} · {profile.isolation}</option>)}
            </Select>
          </label>
          <label>
            {vocab('Target URL')}
            <TextField label={vocab('Target URL')} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.test" />
          </label>
          <fieldset>
            <legend>{vocab('Proxy')}</legend>
            <span className="menu-filter__row">
              <Input ref={proxySearchRef} type="search" value={proxySearch.value} onChange={(event) => proxySearch.setValue(event.target.value)} placeholder="Filter proxy choices" aria-label={vocab('Search proxy choices')} />
              <AnchoredRegexBuilder search={proxySearch} fieldRef={proxySearchRef} label={vocab('Regex for proxy choices')} />
            </span>
            <Select value={proxyKind} onChange={(event) => setProxyKind(event.target.value as DebugBrowserProxyKind)} aria-label={vocab('Proxy type')}>
              {visibleProxyKinds.map((kind) => <option key={kind.value} value={kind.value}>{vocab(kind.label)}</option>)}
            </Select>
            {proxyKind !== 'direct' ? <>
              <TextField label={vocab('Proxy host')} value={proxyHost} onChange={(event) => setProxyHost(event.target.value)} />
              <TextField label={vocab('Proxy port')} type="number" min={1} max={65535} value={proxyPort} onChange={(event) => setProxyPort(event.target.value)} />
              <label><Checkbox checked={requiresAuthentication} onChange={(event) => setRequiresAuthentication(event.target.checked)} /> {vocab('Proxy requires a local vault credential')}</label>
              <p>{vocab('The credential is stored and resolved only by the host. It is never written to the project or sent to the renderer.')}</p>
            </> : null}
          </fieldset>
          <label>{vocab('Certificate policy')}<Select value={certificateMode} onChange={(event) => setCertificateMode(event.target.value as DebugBrowserIntent['certificateMode'])} aria-label={vocab('Certificate policy')}>{CERTIFICATE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{vocab(mode.label)}</option>)}</Select></label>
          {certificateMode === 'custom' ? <p>{vocab('Bind a local certificate through the host file picker before starting. The path stays on this computer.')}</p> : null}
          <label>{vocab('Session lifetime')}<Select value={isolation} onChange={(event) => setIsolation(event.target.value as DebugBrowserIntent['isolation'])} aria-label={vocab('Session lifetime')}><option value="ephemeral">{vocab('Ephemeral, discard on stop')}</option><option value="persistent">{vocab('Persistent, keep this profile')}</option></Select></label>
          {error ? <p role="alert">{error}</p> : null}
          <div className="flex gap-2">
            <Button onClick={() => { const intent = makeIntent(); if (intent) onStart(intent) }}>{vocab('Start isolated session')}</Button>
            <Button variant="ghost" onClick={() => setCreating(true)}>{vocab('New profile')}</Button>
            {selectedId ? <Button variant="ghost" onClick={() => onRemove(selectedId)}>{vocab('Remove profile')}</Button> : null}
          </div>
          {creating ? <div className="mt-3"><TextField label={vocab('New profile name')} value={name} onChange={(event) => setName(event.target.value)} autoFocus /><Button onClick={commitCreate}>{vocab('Save profile')}</Button></div> : null}
          <p role="status">{vocab('If the browser, proxy, or certificate is unavailable, the session remains in recovery and does not fall back to ordinary browsing.')}</p>
        </section>
      </AnchoredPopover>
    </>
  )
}
