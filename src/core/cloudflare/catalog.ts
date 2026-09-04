import type { CloudflareManagerTab } from '../../shared/cloudflare'

/** Hand-written manager catalog used by the panel and future command-palette integration. Keeping
 * the list explicit makes a missing Cloudflare surface visible instead of letting discovery hide
 * a dropped operation. */
export interface CloudflareCatalogEntry {
  id: string
  tab: CloudflareManagerTab
  label: string
  readOnly: boolean
  destructive: boolean
  availability: 'token-required' | 'zone-required' | 'always'
}

export const CLOUDFLARE_CATALOG: readonly CloudflareCatalogEntry[] = [
  { id: 'cloudflare.accounts', tab: 'accounts', label: 'Accounts', readOnly: true, destructive: false, availability: 'token-required' },
  { id: 'cloudflare.zones', tab: 'zones', label: 'Zones', readOnly: true, destructive: false, availability: 'token-required' },
  { id: 'cloudflare.dns', tab: 'dns', label: 'DNS records', readOnly: false, destructive: true, availability: 'zone-required' },
  { id: 'cloudflare.ssl-tls', tab: 'ssl-tls', label: 'SSL/TLS settings', readOnly: false, destructive: false, availability: 'zone-required' },
  { id: 'cloudflare.rulesets', tab: 'rulesets', label: 'Rulesets', readOnly: false, destructive: true, availability: 'zone-required' },
  { id: 'cloudflare.redirects', tab: 'redirects', label: 'Redirect rules', readOnly: false, destructive: true, availability: 'zone-required' },
  { id: 'cloudflare.cache', tab: 'cache', label: 'Cache purge', readOnly: false, destructive: true, availability: 'zone-required' },
  { id: 'cloudflare.analytics', tab: 'analytics', label: 'Analytics', readOnly: true, destructive: false, availability: 'zone-required' }
]
