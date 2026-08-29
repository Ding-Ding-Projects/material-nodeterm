import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CloudflareManagerTab, CloudflarePage, CloudflareZone, CloudflareDnsRecord, CloudflareRuleset, CloudflareRedirectRule, CloudflareCachePurgePreview, CloudflareAccount, CloudflareSslTlsSetting, CloudflareAnalytics, CloudflareSslTlsUpdateInput } from '@shared/cloudflare'
import { CLOUDFLARE_MANAGER_TABS } from '@shared/cloudflare'
import { useActiveSessionApi } from '../../session/session'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { ConfirmDialog } from '../ConfirmDialog'

export interface CloudflareManagerPanelProps { onClose: () => void }

const labels: Record<CloudflareManagerTab, string> = { accounts: 'Accounts', zones: 'Zones', dns: 'DNS records', 'ssl-tls': 'SSL/TLS', rulesets: 'Rulesets', redirects: 'Redirects', cache: 'Cache', analytics: 'Analytics' }

/** Guided Cloudflare surface. All mutations are typed API calls through the core bridge. The panel
 * intentionally has no URL, method, body, shell, or GraphQL editor. */
export function CloudflareManagerPanel({ onClose }: CloudflareManagerPanelProps): React.JSX.Element {
  const api = useActiveSessionApi().cloudflare
  const [tab, setTab] = useState<CloudflareManagerTab>('accounts')
  const [status, setStatus] = useState<string>('Checking Cloudflare…')
  const [permissionStatus, setPermissionStatus] = useState<string>('')
  const [token, setToken] = useState('')
  const [zones, setZones] = useState<CloudflarePage<CloudflareZone> | null>(null)
  const [accounts, setAccounts] = useState<CloudflarePage<CloudflareAccount> | null>(null)
  const [records, setRecords] = useState<CloudflarePage<CloudflareDnsRecord> | null>(null)
  const [rulesets, setRulesets] = useState<CloudflarePage<CloudflareRuleset> | null>(null)
  const [redirects, setRedirects] = useState<CloudflarePage<CloudflareRedirectRule> | null>(null)
  const [ssl, setSsl] = useState<CloudflareSslTlsSetting[]>([])
  const [analytics, setAnalytics] = useState<CloudflareAnalytics | null>(null)
  const [since, setSince] = useState('2026-08-25')
  const [until, setUntil] = useState('2026-08-26')
  const [dnsType, setDnsType] = useState<'A' | 'AAAA' | 'CNAME' | 'TXT'>('A')
  const [dnsName, setDnsName] = useState('')
  const [dnsContent, setDnsContent] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ kind: 'dns' | 'ruleset' | 'redirect'; id: string } | null>(null)
  const [cachePreview, setCachePreview] = useState<CloudflareCachePurgePreview | null>(null)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const filteredRecords = useMemo(() => records?.items.filter((r) => search.test(`${r.type} ${r.name} ${r.content}`)) ?? [], [records, search])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const current = await api.status()
      setStatus(current.error ? current.error.message : current.authenticated ? `Connected, ${current.accountCount ?? 0} accounts discovered.` : 'Add an API token to connect.')
      if (current.authenticated) {
        const permissions = await api.permissions(); setPermissionStatus(permissions.valid ? `Token verification: ${permissions.status ?? 'active'}. Write scopes are checked by each operation.` : 'Token verification is not active.')
        const [accountPage, page] = await Promise.all([api.accounts(), api.zones()]); setAccounts(accountPage); setZones(page)
        const first = page.items[0]
        if (first) { setZoneId((old) => old || first.id); const id = zoneId || first.id; const [dns, rs, rr, tls] = await Promise.all([api.dnsRecords(id, 1), api.rulesets(id, 1), api.redirectRules(id, 1), api.sslTlsSettings(id)]); setRecords(dns); setRulesets(rs); setRedirects(rr); setSsl(tls) }
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Cloudflare could not be loaded.') } finally { setBusy(false) }
  }
  useEffect(() => { void api.tokenStatus().then((s) => setStatus(s.present ? 'Token saved locally. Checking Cloudflare…' : 'Add an API token to connect.')).then(refresh) }, [api])

  const save = async (): Promise<void> => { if (!token.trim()) return; setBusy(true); try { await api.saveToken(token.trim()); setToken(''); await refresh() } catch (error) { setStatus(error instanceof Error ? error.message : 'Token could not be saved.') } finally { setBusy(false) } }
  const loadZone = async (value: string): Promise<void> => { setZoneId(value); if (!value) return; setBusy(true); try { const [dns, rs, rr, tls] = await Promise.all([api.dnsRecords(value), api.rulesets(value), api.redirectRules(value), api.sslTlsSettings(value)]); setRecords(dns); setRulesets(rs); setRedirects(rr); setSsl(tls) } catch (error) { setStatus(error instanceof Error ? error.message : 'Zone data could not be loaded.') } finally { setBusy(false) } }
  const loadAnalytics = async (): Promise<void> => { if (!zoneId) return; setBusy(true); try { setAnalytics(await api.analytics(zoneId, since, until)) } catch (error) { setStatus(error instanceof Error ? error.message : 'Analytics could not be loaded.') } finally { setBusy(false) } }
  const createDns = async (): Promise<void> => { if (!zoneId || !dnsName.trim() || !dnsContent.trim()) return; setBusy(true); try { await api.createDnsRecord(zoneId, { type: dnsType, name: dnsName.trim(), content: dnsContent.trim() }); setDnsName(''); setDnsContent(''); await loadZone(zoneId) } catch (error) { setStatus(error instanceof Error ? error.message : 'DNS record could not be created.') } finally { setBusy(false) } }
  const remove = async (): Promise<void> => { if (!preview) return; setBusy(true); try { if (preview.kind === 'dns') { const p = await api.previewDeleteDnsRecord(zoneId, preview.id); await api.deleteDnsRecord(zoneId, preview.id, p) } if (preview.kind === 'ruleset') { const p = await api.previewDeleteRuleset(zoneId, preview.id); await api.deleteRuleset(zoneId, preview.id, p) } if (preview.kind === 'redirect') { const p = await api.previewDeleteRedirectRule(zoneId, preview.id); await api.deleteRedirectRule(zoneId, preview.id, p) } setPreview(null); await loadZone(zoneId) } catch (error) { setStatus(error instanceof Error ? error.message : 'Deletion failed.') } finally { setBusy(false) } }
  const purge = async (): Promise<void> => { if (!cachePreview) return; setBusy(true); try { await api.purgeCache(cachePreview); setCachePreview(null); setStatus('Cache purge submitted.') } catch (error) { setStatus(error instanceof Error ? error.message : 'Cache purge failed.') } finally { setBusy(false) } }

  return createPortal(<div className="drawer-overlay md3-cloudflare" onClick={onClose}><aside className="drawer" role="dialog" aria-label="Cloudflare manager" onClick={(e) => e.stopPropagation()}>
    <div className="drawer__head"><h2>Cloudflare manager</h2><button type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="drawer__body">
      <p role="status">{status}</p>{permissionStatus && <p>{permissionStatus}</p>}
      <section aria-label="Cloudflare API token"><label>API token<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Enter a token, never a URL" autoComplete="off" /></label><button type="button" onClick={() => void save()} disabled={busy || !token.trim()}>Save token locally</button><p>Token stays in the local credential vault. It is never stored in the project file or sent through the renderer.</p></section>
      <div className="om-tabs" role="tablist">{CLOUDFLARE_MANAGER_TABS.map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{labels[value]}</button>)}</div>
      <label>Zone<select value={zoneId} onChange={(e) => void loadZone(e.target.value)}><option value="">Choose a discovered zone</option>{zones?.items.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.status})</option>)}</select></label>
      <div className="cloudflare-search"><input ref={searchRef} value={search.value} onChange={(e) => search.setValue(e.target.value)} placeholder={`Search ${labels[tab].toLowerCase()}`} aria-label={`Search ${labels[tab]}`} /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label={`Regex for ${labels[tab]} search`} /></div>
      {tab === 'accounts' && <><button type="button" onClick={() => void refresh()} disabled={busy}>Refresh discovered accounts</button><ul>{accounts?.items.map((a) => <li key={a.id}>{a.name} · {a.type ?? 'account'}</li>)}</ul></>}
      {tab === 'zones' && <ul>{zones?.items.map((z) => <li key={z.id}>{z.name} · {z.status} · {z.plan ?? 'plan unknown'}</li>)}</ul>}
      {tab === 'dns' && <><fieldset><legend>Add DNS record</legend><select value={dnsType} onChange={(e) => setDnsType(e.target.value as typeof dnsType)}><option value="A">A</option><option value="AAAA">AAAA</option><option value="CNAME">CNAME</option><option value="TXT">TXT</option></select><input value={dnsName} onChange={(e) => setDnsName(e.target.value)} placeholder="Name" /><input value={dnsContent} onChange={(e) => setDnsContent(e.target.value)} placeholder="Content" /><button type="button" disabled={busy || !zoneId || !dnsName.trim() || !dnsContent.trim()} onClick={() => void createDns()}>Create record</button></fieldset><ul>{filteredRecords.map((r) => <li key={r.id}>{r.type} {r.name} → {r.content}<button type="button" onClick={() => setPreview({ kind: 'dns', id: r.id })}>Delete preview</button></li>)}</ul></>}
      {tab === 'ssl-tls' && <ul>{ssl.filter((s) => search.test(`${s.id} ${s.value}`)).map((s) => <li key={s.id}><label>{s.id}<select value={s.value} disabled={!s.editable} onChange={async (e) => { try { const next = await api.updateSslTlsSetting(zoneId, { settingId: s.id as CloudflareSslTlsUpdateInput['settingId'], value: e.target.value }); setSsl((old) => old.map((x) => x.id === s.id ? next : x)) } catch (error) { setStatus(error instanceof Error ? error.message : 'SSL/TLS update failed.') } }}><option value={s.value}>{s.value}</option><option value="on">on</option><option value="off">off</option></select></label></li>)}</ul>}
      {tab === 'rulesets' && <ul>{rulesets?.items.filter((r) => search.test(`${r.name} ${r.phase}`)).map((r) => <li key={r.id}>{r.name} · {r.phase}<button type="button" onClick={() => setPreview({ kind: 'ruleset', id: r.id })}>Delete preview</button></li>)}</ul>}
      {tab === 'redirects' && <ul>{redirects?.items.filter((r) => search.test(`${r.expression} ${r.target}`)).map((r) => <li key={r.id}>{r.target} ({r.statusCode})<button type="button" onClick={() => setPreview({ kind: 'redirect', id: r.id })}>Delete preview</button></li>)}</ul>}
      {tab === 'cache' && <button type="button" disabled={!zoneId || busy} onClick={async () => { const p = await api.previewPurgeCache({ zoneId, scope: 'everything' }); setCachePreview(p); setStatus(p.summary) }}>Preview purge all cache</button>}
      {tab === 'analytics' && <><label>From<input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label><label>Until<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label><button type="button" disabled={!zoneId || busy || !since || !until} onClick={() => void loadAnalytics()}>Load analytics</button><p>{analytics ? `${analytics.points.length} points${analytics.truncated ? ' (response bounded)' : ''}` : 'Choose a zone and bounded dates.'}</p></>}
      <button type="button" onClick={onClose}>Close manager</button>
    </div>
    {preview && preview.id !== '__cache__' && <ConfirmDialog message={`Delete ${preview.kind} ${preview.id}? Review the exact affected item before confirming.`} onConfirm={() => void remove()} onCancel={() => setPreview(null)} />}
    {cachePreview && <ConfirmDialog message={cachePreview.summary} onConfirm={() => void purge()} onCancel={() => setCachePreview(null)} />}
  </aside></div>, document.body)
}
