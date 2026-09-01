import { useMemo, useRef, useState } from 'react'
import {
  KIOSK_PWA_PERMISSIONS,
  KIOSK_PWA_SCHEMA_VERSION,
  normalizeKioskPwaUrl,
  type KioskPwaAppCandidate,
  type KioskPwaMode,
  type KioskPwaPermission,
  type PortableKioskPwaIntent
} from '@shared/kiosk-pwa'
import { Dialog } from '../ui/md3/Dialog'
import { Button } from '../ui/md3/Button'
import { Checkbox } from '../ui/md3/Checkbox'
import { ListRow } from '../ui/md3/ListRow'
import { SegmentedButton } from '../ui/md3/SegmentedButton'
import { TextField } from '../ui/md3/TextField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

export interface KioskPwaSetupDialogProps {
  open: boolean
  onClose: () => void
  /** Candidates come from the host's actual installed-app inventory, never from a sample list. */
  apps: readonly KioskPwaAppCandidate[]
  initialMode?: KioskPwaMode
  onSubmit: (intent: PortableKioskPwaIntent) => void
}

const PERMISSION_LABELS: Record<KioskPwaPermission, string> = {
  notifications: 'Notifications',
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
  'clipboard-read': 'Read clipboard'
}

function candidateText(candidate: KioskPwaAppCandidate): string {
  return `${candidate.name} ${candidate.appId} ${candidate.startUrl}`
}

/** Guided kiosk/PWA setup. It never asks for a command, executable, profile path, or credential. */
export function KioskPwaSetupDialog({ open, onClose, apps, initialMode = 'kiosk', onSubmit }: KioskPwaSetupDialogProps): React.JSX.Element | null {
  const vocab = useVocabularyMapper()
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<KioskPwaMode>(initialMode)
  const [targetKind, setTargetKind] = useState<'url' | 'app'>('url')
  const [displayName, setDisplayName] = useState('')
  const [url, setUrl] = useState('')
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>()
  const [permissions, setPermissions] = useState<KioskPwaPermission[]>([])
  const [error, setError] = useState('')

  const visibleApps = useMemo(() => {
    const installed = apps.filter((app) => app.installed)
    if (!search.query) return installed
    return installed.filter((app) => (search.mode === 'regex' ? search.test(candidateText(app)) : candidateText(app).toLocaleLowerCase().includes(search.query.toLocaleLowerCase())))
  }, [apps, search.mode, search.pattern, search.flags, search.query, search.test])

  const submit = (): void => {
    const name = displayName.trim()
    if (!name) {
      setError('Enter a display name before opening the session.')
      return
    }
    if (mode === 'pwa' && targetKind !== 'app') {
      setError('PWA mode requires an installed app selected from the list.')
      return
    }
    let target: PortableKioskPwaIntent['target']
    if (targetKind === 'url') {
      const safe = normalizeKioskPwaUrl(url)
      if (!safe) {
        setError('Use an HTTPS address, or HTTP on localhost for development.')
        return
      }
      target = { kind: 'url', url: safe }
    } else {
      const app = visibleApps.find((candidate) => candidate.appId === selectedAppId)
      const safe = app ? normalizeKioskPwaUrl(app.startUrl) : undefined
      if (!app || !safe) {
        setError('Choose an installed app with a verified secure start address.')
        return
      }
      target = { kind: 'app', appId: app.appId, startUrl: safe, name: app.name }
    }
    setError('')
    onSubmit({
      schemaVersion: KIOSK_PWA_SCHEMA_VERSION,
      mode,
      target,
      displayName: name,
      requestedPermissions: [...permissions]
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="New kiosk or PWA session" className="kiosk-pwa-setup-dialog">
      <p className="kiosk-pwa-setup-dialog__intro">Choose a secure web address or an installed app. Credentials, profile data, and host paths stay on this computer.</p>
      <SegmentedButton
        className="kiosk-pwa-setup-dialog__modes"
        ariaLabel="Session mode"
        value={mode}
        options={[{ value: 'kiosk', label: 'Kiosk' }, { value: 'pwa', label: 'PWA' }]}
        onChange={setMode}
      />
      <TextField label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} supportText="This label is portable. Runtime handles and profile state are local." />
      <SegmentedButton
        className="kiosk-pwa-setup-dialog__target-kind"
        ariaLabel="Session target"
        value={targetKind}
        options={[
          { value: 'url', label: 'Secure URL' },
          { value: 'app', label: 'Installed app', disabled: mode === 'pwa' && apps.filter((app) => app.installed).length === 0 }
        ]}
        onChange={setTargetKind}
      />
      {mode === 'pwa' && apps.filter((app) => app.installed).length === 0 && (
        <p className="kiosk-pwa-setup-dialog__availability" role="status">No installed apps are available on this computer.</p>
      )}
      {targetKind === 'url' ? (
        <TextField label="HTTPS address" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.invalid" supportText="HTTPS is required. HTTP is accepted only for localhost development." />
      ) : (
        <div className="kiosk-pwa-setup-dialog__apps" role="group" aria-label={vocab('Installed app choices')}>
          <TextField
            ref={searchRef}
            label="Search installed apps"
            value={search.value}
            onChange={(event) => search.setValue(event.target.value)}
            trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Open regex builder for installed app search" />}
            supportText={search.error ?? `${visibleApps.length} installed app${visibleApps.length === 1 ? '' : 's'} shown`}
            invalid={!!search.error}
          />
          <div className="kiosk-pwa-setup-dialog__app-list" role="listbox" aria-label={vocab('Installed apps')}>
            {visibleApps.map((app) => (
              <ListRow key={app.appId} role="option" aria-selected={selectedAppId === app.appId} className={selectedAppId === app.appId ? 'is-selected' : ''} label={app.name} sub={app.startUrl} vocabularyMode="factual" onClick={() => setSelectedAppId(app.appId)} />
            ))}
            {visibleApps.length === 0 && <div role="status">No installed apps are available for this search.</div>}
          </div>
        </div>
      )}
      <fieldset className="kiosk-pwa-setup-dialog__permissions">
        <legend>Permissions, all denied until selected</legend>
        {KIOSK_PWA_PERMISSIONS.map((permission) => (
          <label key={permission}>
            <Checkbox checked={permissions.includes(permission)} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} />
            {PERMISSION_LABELS[permission]}
          </label>
        ))}
      </fieldset>
      {error && <div className="kiosk-pwa-setup-dialog__error" role="alert">{error}</div>}
      <div className="kiosk-pwa-setup-dialog__availability" role="status">A missing app inventory or blocked host reports unavailable. Nothing launches until you confirm.</div>
      <div className="mdx-dialog__actions">
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>Create session</Button>
      </div>
    </Dialog>
  )
}
