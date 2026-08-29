import { useEffect, useMemo, useRef, useState } from 'react'
import type { AwsAssumeRoleInput, AwsProfile, AwsProfileDraft, AwsRegionEndpoint } from '@shared/aws'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'

const ROWS = {
  profiles: {
    title: 'AWS profiles',
    keywords: ['aws', 'profile', 'credentials', 'region', 'endpoint', 'sso', 'role', 'mfa', 'identity']
  }
}
const ENTRIES = Object.values(ROWS)

function profileText(profile: AwsProfile): string {
  return [
    profile.name,
    profile.region ?? '',
    profile.sso.configured ? 'sso' : '',
    profile.role.configured ? 'role' : '',
    profile.credentialProcess.configured ? 'credential process' : ''
  ].join(' ')
}

function initialDraft(profile?: AwsProfile): AwsProfileDraft {
  return profile
    ? {
        name: profile.name,
        region: profile.region,
        ssoStartUrl: profile.sso.startUrl,
        ssoRegion: profile.sso.region,
        ssoSessionName: profile.sso.sessionName,
        ssoAuthMode: profile.sso.authMode,
        roleArn: profile.role.roleArn,
        sourceProfile: profile.role.sourceProfile,
        endpointOverride: profile.endpointOverride
      }
    : { name: '', output: 'json', ssoAuthMode: 'pkce' }
}

export function AwsSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const [profiles, setProfiles] = useState<AwsProfile[]>([])
  const [regions, setRegions] = useState<AwsRegionEndpoint[]>([])
  const [draft, setDraft] = useState<AwsProfileDraft | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [roleInput, setRoleInput] = useState<AwsAssumeRoleInput | null>(null)
  const [endpointInput, setEndpointInput] = useState<{ region: string; endpoint: string } | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  const load = async (): Promise<void> => {
    setBusy(true)
    try {
      setProfiles(await window.nodeTerminal.aws.refresh())
      setStatus('Profiles refreshed from the local AWS configuration boundary.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'AWS profiles could not be read.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (isActive) void load()
  }, [isActive])

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => search.test(profileText(profile))),
    [profiles, search]
  )

  const save = async (): Promise<void> => {
    if (!draft || !draft.name.trim()) return
    setBusy(true)
    try {
      setProfiles(await window.nodeTerminal.aws.saveProfile(draft))
      setDraft(null)
      setStatus('AWS profile metadata saved locally. Credentials and provider sessions were not stored here.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'AWS profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const inspect = async (profile: AwsProfile): Promise<void> => {
    setBusy(true)
    try {
      const identity = await window.nodeTerminal.aws.callerIdentity(profile.name)
      setStatus(identity.phase === 'ready'
        ? `Caller identity: account ${identity.account ?? 'unknown'}, ${identity.arn ?? 'ARN unavailable'}. Checked ${new Date(identity.checkedAt).toLocaleString()}.`
        : identity.detail ?? 'Caller identity is unavailable.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Caller identity could not be checked.')
    } finally {
      setBusy(false)
    }
  }

  const checkPermissions = async (profile: AwsProfile): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.nodeTerminal.aws.permissions(profile.name, [
        'sts:GetCallerIdentity',
        's3:ListAllMyBuckets',
        'iam:ListRoles'
      ])
      setPermissionStatus(`${profile.name}: ${result.map((item) => `${item.action} = ${item.decision}`).join(' · ')}`)
    } catch (error) {
      setPermissionStatus(error instanceof Error ? error.message : 'Permission checks could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const login = async (profile: AwsProfile, mode: 'pkce' | 'device-code'): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.nodeTerminal.aws.ssoLogin(profile.name, mode)
      setStatus(result.detail ?? `AWS SSO ${result.phase}.`)
      if (result.phase === 'ready') setProfiles(await window.nodeTerminal.aws.refresh())
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'AWS SSO login failed.')
    } finally {
      setBusy(false)
    }
  }

  const loadRegions = async (profile?: string): Promise<void> => {
    try {
      setRegions(await window.nodeTerminal.aws.regions(profile))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'AWS regions could not be listed.')
    }
  }

  const assume = async (): Promise<void> => {
    if (!roleInput) return
    setBusy(true)
    try {
      const result = await window.nodeTerminal.aws.assumeRole(roleInput)
      setStatus(result.detail ?? `Role session ${result.phase}. Expiry: ${result.expiresAt ?? 'not reported'}.`)
      setRoleInput(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Role assumption failed.')
    } finally {
      // Do not retain a one-time MFA value in React state after the operation has settled.
      setRoleInput((current) => current ? { ...current, mfaCode: null } : null)
      setBusy(false)
    }
  }

  const saveEndpoint = async (): Promise<void> => {
    if (!endpointInput) return
    setBusy(true)
    try {
      setRegions(await window.nodeTerminal.aws.setEndpoint(endpointInput.region, endpointInput.endpoint || null))
      setStatus(endpointInput.endpoint ? `HTTPS endpoint override saved for ${endpointInput.region}.` : `Endpoint override cleared for ${endpointInput.region}.`)
      setEndpointInput(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Endpoint override could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      id="aws"
      title="AWS identity"
      description="Manage named AWS profiles, SSO login, role sessions, MFA, caller identity, permissions, regions, and endpoint overrides without putting credentials in project files."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.profiles}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex min-w-[280px] flex-1 items-center gap-1">
              <Input
                ref={searchRef}
                aria-label="Search AWS profiles"
                placeholder="Search profiles, SSO, roles, or regions"
                value={search.value}
                onChange={(event) => search.setValue(event.target.value)}
              />
              <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex — AWS profile search" />
            </div>
            <Button onClick={() => void load()} disabled={busy}>Refresh profiles</Button>
            <Button variant="ghost" onClick={() => setDraft(initialDraft())}>Add profile</Button>
          </div>
          {search.error ? <p role="alert" className="text-xs text-[color:var(--warn)]">{search.error}</p> : null}
          {visibleProfiles.length === 0 ? <p className="text-sm text-text-muted">No matching AWS profiles were found. Add profile metadata or refresh the local AWS files.</p> : null}
          {visibleProfiles.map((profile) => (
            <article key={profile.name} className="rounded-xl border border-outline/30 bg-surface-container-high p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{profile.name}</h3>
                  <p className="text-xs text-text-muted">
                    {profile.region ?? 'No default region'} · {profile.sso.configured ? `SSO ${profile.sso.authMode ?? 'not selected'}` : profile.role.configured ? 'Role profile' : profile.staticCredentialsConfigured ? 'Static credentials configured' : 'Metadata only'}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {profile.credentialProcess.configured ? `credential_process: ${profile.credentialProcess.executableName ?? 'unknown'}${profile.credentialProcess.trusted ? ' · trusted' : ' · review required'}` : 'No credential process configured'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void inspect(profile)}>Caller identity</Button>
                  <Button onClick={() => void checkPermissions(profile)}>Check permissions</Button>
                  {profile.sso.configured ? <><Button onClick={() => void login(profile, 'pkce')}>SSO with PKCE</Button><Button onClick={() => void login(profile, 'device-code')}>SSO device code</Button></> : null}
                  {profile.role.configured ? <Button onClick={() => setRoleInput({ profileName: profile.name, roleArn: profile.role.roleArn ?? '', sessionName: `${profile.name}-session`, mfaSerial: null, mfaCode: null })}>Assume role</Button> : null}
                  {profile.credentialProcess.configured && !profile.credentialProcess.trusted ? <Button onClick={async () => { const next = await window.nodeTerminal.aws.trustCredentialProcess(profile.name); if (next) setProfiles((current) => current.map((item) => item.name === next.name ? next : item)); }}>Trust process</Button> : null}
                  <Button variant="ghost" onClick={() => setDraft(initialDraft(profile))}>Edit metadata</Button>
                  <Button variant="ghost" danger onClick={async () => { await window.nodeTerminal.aws.removeProfile(profile.name); setProfiles((current) => current.filter((item) => item.name !== profile.name)); }}>Remove</Button>
                </div>
              </div>
            </article>
          ))}
          {roleInput ? (
            <div className="space-y-3 rounded-xl border border-primary/40 bg-surface-container p-4">
              <h3 className="font-semibold">Assume an AWS role</h3>
              <p className="text-xs text-text-muted">The role session is temporary. The MFA value is written once to protected stdin and is discarded after the request. It is never stored, logged, or sent in argv.</p>
              <FieldRow label="Profile" control={<Input value={roleInput.profileName} readOnly />} />
              <FieldRow label="Role ARN" control={<Input value={roleInput.roleArn} onChange={(e) => setRoleInput({ ...roleInput, roleArn: e.target.value })} />} />
              <FieldRow label="Session name" control={<Input value={roleInput.sessionName} onChange={(e) => setRoleInput({ ...roleInput, sessionName: e.target.value })} />} />
              <FieldRow label="MFA serial" description="Optional device ARN or serial number. It is not saved in the profile overlay." control={<Input value={roleInput.mfaSerial ?? ''} onChange={(e) => setRoleInput({ ...roleInput, mfaSerial: e.target.value || null })} />} />
              <FieldRow label="MFA code" description="One-time value, sent through protected stdin and cleared after this request." control={<Input type="password" autoComplete="one-time-code" value={roleInput.mfaCode ?? ''} onChange={(e) => setRoleInput({ ...roleInput, mfaCode: e.target.value || null })} />} />
              <div className="flex gap-2"><Button variant="primary" onClick={() => void assume()} disabled={busy || !roleInput.roleArn || !roleInput.sessionName}>Start role session</Button><Button variant="ghost" onClick={() => setRoleInput(null)}>Cancel</Button></div>
            </div>
          ) : null}
          {draft ? (
            <div className="space-y-3 rounded-xl border border-primary/40 bg-surface-container p-4">
              <h3 className="font-semibold">Profile metadata</h3>
              <p className="text-xs text-text-muted">This form never accepts or stores access keys, secret keys, SSO tokens, role credentials, or MFA values. MFA is accepted once through protected stdin when a role session starts.</p>
              <FieldRow label="Profile name" description="A stable AWS profile label. Existing AWS files remain untouched." control={<Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />} />
              <FieldRow label="Default region" control={<Input list="aws-regions" value={draft.region ?? ''} placeholder="us-east-1" onChange={(e) => setDraft({ ...draft, region: e.target.value })} />} />
              <datalist id="aws-regions">{regions.map((region) => <option key={region.region} value={region.region}>{region.endpoint}</option>)}</datalist>
              <FieldRow label="SSO start URL" description="HTTPS only. PKCE is the default; device code is available for headless sign-in." control={<Input value={draft.ssoStartUrl ?? ''} onChange={(e) => setDraft({ ...draft, ssoStartUrl: e.target.value })} />} />
              <FieldRow label="SSO region" control={<Input list="aws-regions" value={draft.ssoRegion ?? ''} placeholder="us-east-1" onChange={(e) => setDraft({ ...draft, ssoRegion: e.target.value })} />} />
              <FieldRow label="Role ARN" description="Optional role metadata for a guided assume-role request." control={<Input value={draft.roleArn ?? ''} placeholder="arn:aws:iam::123456789012:role/ReadOnly" onChange={(e) => setDraft({ ...draft, roleArn: e.target.value })} />} />
              <FieldRow label="Source profile" control={<Input value={draft.sourceProfile ?? ''} onChange={(e) => setDraft({ ...draft, sourceProfile: e.target.value })} />} />
              <FieldRow label="Endpoint override" description="Optional private service endpoint. Must be an HTTPS URL and is machine-local." control={<Input value={draft.endpointOverride ?? ''} placeholder="https://service.us-east-1.amazonaws.com" onChange={(e) => setDraft({ ...draft, endpointOverride: e.target.value })} />} />
              <div className="flex gap-2"><Button variant="primary" onClick={() => void save()} disabled={busy || !draft.name.trim()}>Save metadata</Button><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void loadRegions()} disabled={busy}>List available regions</Button>
            <Button variant="ghost" onClick={async () => { await window.nodeTerminal.aws.clearMachineCache(); setStatus('nodeterm AWS manager metadata and endpoint cache cleared. AWS CLI provider state was not changed.') }}>Clear manager cache</Button>
            {regions.length > 0 ? <span className="self-center text-xs text-text-muted">{regions.length} regions listed; endpoint overrides remain machine-local.</span> : null}
          </div>
          {regions.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-outline/30 bg-surface-container-high p-3">
              <h3 className="text-sm font-semibold">Service endpoints</h3>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {regions.map((region) => (
                  <div key={region.region} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>{region.region} · {region.endpoint}</span>
                    <Button variant="ghost" onClick={() => setEndpointInput({ region: region.region, endpoint: region.configured ? region.endpoint : '' })}>Edit endpoint</Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {endpointInput ? (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-outline/30 bg-surface-container p-3">
              <FieldRow label={`HTTPS endpoint for ${endpointInput.region}`} description="Leave blank to clear the machine-local override." control={<Input className="w-96" value={endpointInput.endpoint} onChange={(e) => setEndpointInput({ ...endpointInput, endpoint: e.target.value })} />} />
              <Button variant="primary" onClick={() => void saveEndpoint()} disabled={busy}>Save endpoint</Button>
              <Button variant="ghost" onClick={() => setEndpointInput(null)}>Cancel</Button>
            </div>
          ) : null}
          {status ? <p role="status" className="rounded-lg bg-surface-container-high p-3 text-xs text-text-muted">{status}</p> : null}
          {permissionStatus ? <p role="status" className="rounded-lg bg-surface-container-high p-3 text-xs text-text-muted">{permissionStatus}</p> : null}
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
