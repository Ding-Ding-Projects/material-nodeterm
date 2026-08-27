import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AWS_ENDPOINT_SERVICES,
  awsIdentityIntentFor,
  normalizeAwsIdentityBinding,
  planAwsIdentity,
  type AwsEndpointOverride,
  type AwsIdentityBinding,
  type AwsIdentityDiscovery,
  type AwsIdentityIntent,
  type AwsIdentityAction,
  type AwsIdentityOperation,
  type AwsProfileSummary
} from '@shared/aws-identity'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'

const EMPTY_DISCOVERY: AwsIdentityDiscovery = {
  state: 'unavailable',
  profiles: [],
  regions: [],
  reason: 'AWS profile discovery has not run yet.',
  scannedAt: 0
}
interface AwsIdentityManagerProps {
  binding?: AwsIdentityBinding
  intent?: AwsIdentityIntent
  onChange(binding: AwsIdentityBinding | undefined, intent: AwsIdentityIntent | undefined): void
}

function SearchableChoice({
  id,
  label,
  values,
  selected,
  render,
  onPick,
  empty
}: {
  id: string
  label: string
  values: readonly string[]
  selected: string | null
  render?: (value: string) => React.ReactNode
  onPick(value: string): void
  empty: string
}) {
  const search = useRegexSearchField()
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = useMemo(
    () => values.filter((value) => search.test(value)),
    [values, search.mode, search.query, search.pattern, search.flags]
  )
  return (
    <section className="aws-identity__picker" aria-labelledby={`${id}-label`}>
      <div className="aws-identity__picker-head">
        <strong id={`${id}-label`}>{label}</strong>
        <span>{filtered.length} shown</span>
      </div>
      <div className="aws-identity__search-row">
        <input
          ref={inputRef}
          className="aws-identity__input nodrag"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          aria-label={`Search ${label.toLowerCase()}`}
        />
        <AnchoredRegexBuilder search={search} fieldRef={inputRef} label={`Regex — ${label}`} />
      </div>
      {search.error && <p className="aws-identity__error">{search.error}</p>}
      <div className="aws-identity__choices" role="listbox" aria-label={label}>
        {filtered.length === 0 && <p className="aws-identity__empty">{empty}</p>}
        {filtered.map((value) => (
          <button
            key={value}
            type="button"
            role="option"
            aria-selected={selected === value}
            className={selected === value ? 'is-selected' : ''}
            onClick={() => onPick(value)}
          >
            {render?.(value) ?? value}
          </button>
        ))}
      </div>
    </section>
  )
}

function endpointUrl(value: string): string | null {
  if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const loopback = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !loopback) return null
  if (parsed.username || parsed.password || parsed.hash) return null
  return parsed.href
}

function profileDetail(profile: AwsProfileSummary): string {
  const parts = [profile.source]
  if (profile.identityCenterConfigured) parts.push('IAM Identity Center')
  if (profile.roleConfigured) parts.push('role')
  if (profile.mfaConfigured) parts.push('MFA')
  if (profile.region) parts.push(profile.region)
  return parts.join(' · ')
}

/**
 * Guided local identity binding for AWS service nodes. It never accepts access keys, secret keys,
 * session tokens or MFA codes. The AWS CLI reads those from its own local stores when a future
 * execution surface consumes the fixed argv preview produced by planAwsIdentity().
 */
export function AwsIdentityManager({ binding: inputBinding, intent, onChange }: AwsIdentityManagerProps) {
  const [discovery, setDiscovery] = useState<AwsIdentityDiscovery>(EMPTY_DISCOVERY)
  const [loading, setLoading] = useState(false)
  const [endpointService, setEndpointService] = useState<string>('sts')
  const [endpointDraft, setEndpointDraft] = useState('')
  const [endpointError, setEndpointError] = useState<string | null>(null)
  const [operation, setOperation] = useState<AwsIdentityOperation | null>(null)
  const endpointSearch = useRegexSearchField()
  const endpointSearchRef = useRef<HTMLInputElement>(null)
  const binding = normalizeAwsIdentityBinding(inputBinding)
  const profileMap = useMemo(() => new Map(discovery.profiles.map((profile) => [profile.name, profile])), [discovery.profiles])
  const plan = useMemo(() => planAwsIdentity(discovery, binding), [discovery, binding])
  const visibleEndpoints = useMemo(
    () => binding?.endpoints.filter((endpoint) => endpointSearch.test(`${endpoint.service} ${endpoint.url}`)) ?? [],
    [binding, endpointSearch.mode, endpointSearch.query, endpointSearch.pattern, endpointSearch.flags]
  )

  const refresh = async () => {
    setLoading(true)
    try {
      setDiscovery(await window.nodeTerminal.awsIdentity.discover())
    } catch {
      setDiscovery({
        ...EMPTY_DISCOVERY,
        reason: 'AWS profile discovery could not reach the local core service. Nothing was changed.',
        scannedAt: Date.now()
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => window.nodeTerminal.awsIdentity.onOperation((next) => setOperation(next)), [])

  const saveBinding = (next: AwsIdentityBinding | undefined) => {
    if (!next) {
      onChange(undefined, intent)
      return
    }
    const normalized = normalizeAwsIdentityBinding(next)
    if (!normalized) return
    const profile = profileMap.get(normalized.profileName)
    onChange(normalized, profile ? awsIdentityIntentFor(profile, normalized) : intent)
  }

  const updateIntent = (changes: Partial<AwsIdentityIntent>) => {
    const profile = plan.profile
    const current: AwsIdentityIntent = intent ?? {
      schemaVersion: 1,
      mode: profile?.mode ?? 'profile',
      preferredRegion: binding?.region ?? profile?.region ?? null,
      requireMfa: profile?.mfaConfigured ?? false,
      requireRole: profile?.roleConfigured ?? false,
      endpointServices: binding?.endpoints.map((endpoint) => endpoint.service).sort() ?? []
    }
    onChange(binding ?? undefined, { ...current, ...changes })
  }

  const chooseProfile = (profileName: string) => {
    const profile = profileMap.get(profileName)
    if (!profile) return
    const next: AwsIdentityBinding = {
      schemaVersion: 1,
      profileName,
      region: binding?.region ?? profile.region,
      endpoints: binding?.endpoints ?? [],
      verifiedAt: Date.now()
    }
    onChange(next, awsIdentityIntentFor(profile, next))
  }

  const chooseRegion = (region: string) => {
    if (!binding) return
    saveBinding({ ...binding, region, verifiedAt: Date.now() })
  }

  const addEndpoint = () => {
    if (!binding) return
    const url = endpointUrl(endpointDraft.trim())
    if (!url) {
      setEndpointError('Use an HTTPS endpoint, or loopback HTTP, with no embedded username, password, or fragment.')
      return
    }
    const next: AwsEndpointOverride[] = [
      ...binding.endpoints.filter((endpoint) => endpoint.service !== endpointService),
      { service: endpointService, url }
    ].sort((left, right) => left.service.localeCompare(right.service))
    setEndpointDraft('')
    setEndpointError(null)
    saveBinding({ ...binding, endpoints: next, verifiedAt: Date.now() })
  }

  const startAction = async (action: AwsIdentityAction): Promise<void> => {
    if (!binding || plan.state !== 'ready') return
    try {
      const next = await window.nodeTerminal.awsIdentity.start(action, binding.profileName, binding)
      setOperation(next)
    } catch {
      setOperation({
        operationId: `unavailable-${Date.now()}`,
        action,
        state: 'failed',
        message: 'The host-owned AWS identity action is unavailable. Nothing was changed.',
        startedAt: null,
        completedAt: Date.now(),
        identity: null
      })
    }
  }

  return (
    <div className="aws-identity nodrag" aria-label="AWS identity manager">
      <header className="aws-identity__summary">
        <div>
          <h3>AWS identity</h3>
          <p>Profiles and non-secret settings stay on this computer. Credentials and sessions remain in AWS local stores.</p>
        </div>
        <button type="button" disabled={loading} title={loading ? 'A profile scan is already running.' : undefined} onClick={() => void refresh()}>
          {loading ? 'Scanning…' : 'Rescan profiles'}
        </button>
      </header>

      {discovery.reason && <p className={`aws-identity__notice is-${discovery.state}`}>{discovery.reason}</p>}

      <SearchableChoice
        id="aws-profile"
        label="Local profiles"
        values={discovery.profiles.map((profile) => profile.name)}
        selected={binding?.profileName ?? null}
        onPick={chooseProfile}
        empty={discovery.profiles.length === 0 ? 'No profiles are available on this computer.' : 'No profile matches this search.'}
        render={(name) => {
          const profile = profileMap.get(name)
          return (
            <span className="aws-identity__choice-copy">
              <strong>{name}</strong>
              <small>{profile ? profileDetail(profile) : 'Local profile'}</small>
            </span>
          )
        }}
      />

      {binding && (
        <>
          <SearchableChoice
            id="aws-region"
            label="Regions"
            values={discovery.regions}
            selected={binding.region ?? plan.profile?.region ?? null}
            onPick={chooseRegion}
            empty="No region matches this search."
          />

          <section className="aws-identity__facts" aria-label="Selected profile capabilities">
            <h4>Identity behavior</h4>
            <dl>
              <div><dt>Mode</dt><dd>{plan.profile?.identityCenterConfigured ? 'IAM Identity Center' : plan.profile?.roleConfigured ? 'Assume role profile' : 'Shared profile'}</dd></div>
              <div><dt>Role assumption</dt><dd>{plan.profile?.roleConfigured ? 'Configured by the selected profile' : 'Not configured'}</dd></div>
              <div><dt>MFA</dt><dd>{plan.profile?.mfaConfigured ? 'The AWS CLI will prompt when required' : 'Not configured by this profile'}</dd></div>
              <div><dt>Region</dt><dd>{plan.region ?? 'AWS default resolution'}</dd></div>
              <div><dt>Portable reopen</dt><dd>Rebind to a local profile. Provider identity never travels with the project.</dd></div>
            </dl>
            {plan.profile?.identityCenterConfigured && (
              <div className="aws-identity__subsection">
                <h5>IAM Identity Center</h5>
                <p>
                  {plan.profile.ssoStartUrl ? `Start URL: ${plan.profile.ssoStartUrl}` : 'This profile has an IAM Identity Center configuration.'}
                  {' '}The sign-in session remains in AWS local storage and never enters the canvas.
                </p>
                {plan.signInArgs && <code>{['aws', ...plan.signInArgs].join(' ')}</code>}
              </div>
            )}
            {plan.profile?.roleConfigured && (
              <div className="aws-identity__subsection">
                <h5>Role assumption</h5>
                <p>
                  The selected profile resolves its role through the AWS CLI
                  {plan.profile.sourceProfile ? ` from source profile “${plan.profile.sourceProfile}”.` : '.'}
                  {' '}Role credentials are never copied into project data.
                </p>
                {plan.roleArgs && <code>{['aws', ...plan.roleArgs].join(' ')}</code>}
              </div>
            )}
            <fieldset className="aws-identity__requirements">
              <legend>Portable identity requirements</legend>
              <label title={plan.profile?.mfaConfigured ? undefined : 'Enable MFA in the selected profile before requiring it here.'}>
                <input
                  type="checkbox"
                  checked={intent?.requireMfa ?? plan.mfaRequired}
                  disabled={!plan.profile?.mfaConfigured}
                  onChange={(event) => updateIntent({ requireMfa: event.target.checked })}
                />
                Require MFA when the profile asks for it
              </label>
              <label title={plan.profile?.roleConfigured ? undefined : 'Choose a profile with role_arn before requiring role assumption.'}>
                <input
                  type="checkbox"
                  checked={intent?.requireRole ?? !!plan.roleArgs}
                  disabled={!plan.profile?.roleConfigured}
                  onChange={(event) => updateIntent({ requireRole: event.target.checked })}
                />
                Require role assumption for this node
              </label>
            </fieldset>
            <div className="aws-identity__actions" aria-label="AWS identity actions">
              <button
                type="button"
                disabled={operation?.state === 'queued' || operation?.state === 'running' || plan.state !== 'ready'}
                title={plan.state !== 'ready' ? (plan.reason ?? 'Choose a valid AWS profile first.') : 'Verify the selected profile without returning session credentials.'}
                onClick={() => void startAction('verify')}
              >
                Verify identity
              </button>
              {plan.signInArgs && (
                <button
                  type="button"
                  disabled={operation?.state === 'queued' || operation?.state === 'running'}
                  title="Run the fixed AWS IAM Identity Center sign-in action. Session data stays in AWS local storage."
                  onClick={() => void startAction('sso-login')}
                >
                  Sign in with IAM Identity Center
                </button>
              )}
              {plan.roleArgs && (
                <button
                  type="button"
                  disabled={operation?.state === 'queued' || operation?.state === 'running'}
                  title="Verify the selected role profile through caller identity. Temporary credentials are never returned."
                  onClick={() => void startAction('assume-role')}
                >
                  Verify assumed role
                </button>
              )}
              {operation && (
                <div className={`aws-identity__operation is-${operation.state}`} role="status" aria-live="polite">
                  <span>{operation.message}</span>
                  {(operation.state === 'queued' || operation.state === 'running') && (
                    <button type="button" onClick={() => void window.nodeTerminal.awsIdentity.cancel(operation.operationId)}>Cancel</button>
                  )}
                  {operation.identity && (
                    <small>
                      {operation.identity.accountId ? `Account ${operation.identity.accountId}` : 'Account unavailable'}
                      {operation.identity.arn ? ` · ${operation.identity.arn}` : ''}
                      {operation.identity.expiresAt ? ` · expires ${new Date(operation.identity.expiresAt).toISOString()}` : ''}
                    </small>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="aws-identity__endpoint-editor" aria-label="Custom AWS endpoints">
            <h4>Custom endpoints</h4>
            <p>Overrides are local and service-scoped. Use them for approved emulators, proxies, or private endpoints.</p>
            <SearchableChoice
              id="aws-endpoint-service"
              label="AWS services"
              values={AWS_ENDPOINT_SERVICES}
              selected={endpointService}
              onPick={setEndpointService}
              empty="No service matches this search."
            />
            <div className="aws-identity__endpoint-row">
              <label>
                <span>Endpoint URL for {endpointService}</span>
                <input
                  className="aws-identity__input nodrag"
                  value={endpointDraft}
                  onChange={(event) => {
                    setEndpointDraft(event.target.value)
                    setEndpointError(null)
                  }}
                  placeholder="https://service.example.com"
                  aria-invalid={endpointError !== null}
                />
              </label>
              <button type="button" disabled={endpointDraft.trim().length === 0} title={endpointDraft.trim().length === 0 ? 'Enter an endpoint URL first.' : undefined} onClick={addEndpoint}>
                Save endpoint
              </button>
            </div>
            {endpointError && <p className="aws-identity__error">{endpointError}</p>}
            <div className="aws-identity__search-row">
              <input
                ref={endpointSearchRef}
                className="aws-identity__input nodrag"
                value={endpointSearch.value}
                onChange={(event) => endpointSearch.setValue(event.target.value)}
                placeholder="Search saved endpoints…"
                aria-label="Search saved endpoints"
              />
              <AnchoredRegexBuilder search={endpointSearch} fieldRef={endpointSearchRef} label="Regex — saved endpoints" />
            </div>
            <div className="aws-identity__endpoint-list">
              {binding.endpoints.length === 0 && <p className="aws-identity__empty">No custom endpoints. AWS standard endpoints will be used.</p>}
              {binding.endpoints.length > 0 && visibleEndpoints.length === 0 && <p className="aws-identity__empty">No saved endpoint matches this search.</p>}
              {visibleEndpoints.map((endpoint) => (
                <div key={endpoint.service}>
                  <span><strong>{endpoint.service}</strong><small>{endpoint.url}</small></span>
                  <button type="button" onClick={() => saveBinding({ ...binding, endpoints: binding.endpoints.filter((candidate) => candidate.service !== endpoint.service), verifiedAt: Date.now() })}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className={`aws-identity__plan is-${plan.state}`} aria-label="AWS execution identity preview">
            <h4>Execution identity preview</h4>
            {plan.reason ? <p>{plan.reason}</p> : (
              <>
                <p>Future AWS service nodes will use profile <strong>{plan.profile?.name}</strong> and let the AWS CLI read credentials and prompt for MFA itself.</p>
                <code>{['aws', ...plan.callerIdentityArgs].join(' ')}</code>
              </>
            )}
          </section>

          <button type="button" className="aws-identity__unbind" onClick={() => onChange(undefined, intent)}>
            Leave unbound on this computer
          </button>
        </>
      )}
    </div>
  )
}
