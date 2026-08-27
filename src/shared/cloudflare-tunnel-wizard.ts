/**
 * Guided Cloudflare Tunnel wizard contracts.
 *
 * The renderer receives bounded discovery summaries and sends one closed selection object. It
 * never receives a token, host path, container command, raw API request, or shell fragment. The
 * portable projection below is deliberately smaller than the local selection so an exported
 * project can be reopened on another computer without leaking machine identity or credentials.
 */

export const CLOUDFLARE_TUNNEL_WIZARD_FEATURE = 'cloudflare-tunnel-wizard' as const
export const CLOUDFLARE_TUNNEL_INTENT_VERSION = 1 as const

export type TunnelChoiceState = 'available' | 'unavailable' | 'stale'

export interface TunnelChoice {
  id: string
  label: string
  detail?: string
  state?: TunnelChoiceState
  reason?: string
}

export interface TunnelAccountChoice extends TunnelChoice {
  externalAccountId?: string
}

export interface TunnelZoneChoice extends TunnelChoice {
  name: string
  accountId: string
}

export interface TunnelHostChoice extends TunnelChoice {
  kind: 'local' | 'ssh' | 'server'
}

export interface TunnelContainerChoice extends TunnelChoice {
  hostId: string
  image?: string
  state?: TunnelChoiceState
}

export interface TunnelNetworkChoice extends TunnelChoice {
  hostId: string
  containerId?: string
  driver?: string
}

export interface TunnelPortChoice extends TunnelChoice {
  hostId: string
  containerId: string
  port: number
  protocol: 'http' | 'https'
  published?: boolean
}

export interface TunnelOriginChoice extends TunnelChoice {
  hostId: string
  containerId: string
  networkId: string
  portId: string
  protocol: 'http' | 'https'
  origin: string
}

export interface CloudflareTunnelDiscovery {
  accounts: TunnelAccountChoice[]
  zones: TunnelZoneChoice[]
  hosts: TunnelHostChoice[]
  containers: TunnelContainerChoice[]
  networks: TunnelNetworkChoice[]
  ports: TunnelPortChoice[]
  origins: TunnelOriginChoice[]
  capturedAt: number
}

export interface CloudflareTunnelWizardSelection {
  accountId: string
  zoneId: string
  hostname: string
  hostId: string
  containerId: string
  networkId: string
  portId: string
  originId: string
}

/** Safe project-side intent. All ids in this object are labels or desired values, never live ids. */
export interface CloudflareTunnelPortableIntent {
  schemaVersion: typeof CLOUDFLARE_TUNNEL_INTENT_VERSION
  featureId: typeof CLOUDFLARE_TUNNEL_WIZARD_FEATURE
  hostname: string
  zoneName: string
  originProtocol: 'http' | 'https'
  originPort: number
  desiredHostKind: TunnelHostChoice['kind']
  desiredContainerLabel: string
  desiredNetworkLabel: string
  relationshipIds: string[]
}

export interface CloudflareTunnelPreview {
  operation: 'create-tunnel-and-route-hostname'
  accountLabel: string
  zoneName: string
  hostname: string
  hostLabel: string
  containerLabel: string
  networkLabel: string
  port: number
  protocol: 'http' | 'https'
  origin: string
  credentialBinding: 'local-provider-account'
  externalSideEffects: string[]
  portable: CloudflareTunnelPortableIntent
}

export type CloudflareTunnelProgressPhase =
  | 'preflight'
  | 'preview'
  | 'creating'
  | 'routing'
  | 'verifying'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface CloudflareTunnelProgress {
  phase: CloudflareTunnelProgressPhase
  progress: number
  message: string
  jobId?: string
}

export interface CloudflareTunnelLocalBinding {
  bindingVersion: 1
  nodeId: string
  provider: 'cloudflare'
  accountRef: string
  credentialKey: string
  hostname: string
  lastVerifiedAt: number
}

export interface CloudflareTunnelWizardApi {
  discover(): Promise<CloudflareTunnelDiscovery>
  create(
    selection: CloudflareTunnelWizardSelection,
    signal: AbortSignal,
    onProgress: (progress: CloudflareTunnelProgress) => void
  ): Promise<{ ok: true; binding: CloudflareTunnelLocalBinding } | { ok: false; error: string }>
  bindLocal(selection: CloudflareTunnelWizardSelection, nodeId: string): Promise<{ ok: true } | { ok: false; error: string }>
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const CONTROL = /[\u0000-\u001f\u007f]/

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value)
}

function choice<T extends TunnelChoice>(items: readonly T[], id: string, label: string): T | undefined {
  const item = items.find((candidate) => candidate.id === id)
  return item && item.state !== 'unavailable' ? item : undefined
}

function normalizeHostname(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** Validate one complete selection against the exact discovery snapshot that populated the UI. */
export function validateCloudflareTunnelSelection(
  selection: CloudflareTunnelWizardSelection,
  discovery: CloudflareTunnelDiscovery
): { ok: true; selection: CloudflareTunnelWizardSelection } | { ok: false; error: string } {
  if (!selection || typeof selection !== 'object') return { ok: false, error: 'Choose every tunnel destination before continuing.' }
  if (!validId(selection.accountId) || !choice(discovery.accounts, selection.accountId, 'account')) return { ok: false, error: 'Choose an available Cloudflare account.' }
  const zone = choice(discovery.zones, selection.zoneId, 'zone')
  if (!zone || zone.accountId !== selection.accountId || !text(zone.name, 253)) return { ok: false, error: 'Choose a zone belonging to the selected account.' }
  const hostname = normalizeHostname(selection.hostname)
  if (!HOSTNAME.test(hostname) || !(hostname === zone.name.toLocaleLowerCase() || hostname.endsWith(`.${zone.name.toLocaleLowerCase()}`))) {
    return { ok: false, error: 'Enter a valid hostname inside the selected zone.' }
  }
  const host = choice(discovery.hosts, selection.hostId, 'host')
  if (!host) return { ok: false, error: 'Choose an available host.' }
  const container = choice(discovery.containers, selection.containerId, 'container')
  if (!container || container.hostId !== host.id) return { ok: false, error: 'Choose a discovered container on the selected host.' }
  const network = choice(discovery.networks, selection.networkId, 'network')
  if (!network || network.hostId !== host.id || (network.containerId !== undefined && network.containerId !== container.id)) return { ok: false, error: 'Choose a discovered network attached to the container.' }
  const port = choice(discovery.ports, selection.portId, 'port')
  if (!port || port.hostId !== host.id || port.containerId !== container.id || !Number.isInteger(port.port) || port.port < 1 || port.port > 65535) return { ok: false, error: 'Choose a discovered container port.' }
  const origin = choice(discovery.origins, selection.originId, 'origin')
  if (!origin || origin.hostId !== host.id || origin.containerId !== container.id || origin.networkId !== network.id || origin.portId !== port.id || !/^https?:\/\/[^\s]{1,512}$/.test(origin.origin)) return { ok: false, error: 'Choose the verified origin generated from the selected host, network, and port.' }
  return { ok: true, selection: { ...selection, hostname } }
}

/** Create portable intent from the selected discovery labels, never from live machine ids. */
export function cloudflareTunnelPortableIntent(
  selection: CloudflareTunnelWizardSelection,
  discovery: CloudflareTunnelDiscovery,
  relationshipIds: readonly string[] = []
): CloudflareTunnelPortableIntent {
  const checked = validateCloudflareTunnelSelection(selection, discovery)
  if (!checked.ok) throw new Error(checked.error)
  const zone = discovery.zones.find((item) => item.id === checked.selection.zoneId)!
  const host = discovery.hosts.find((item) => item.id === checked.selection.hostId)!
  const container = discovery.containers.find((item) => item.id === checked.selection.containerId)!
  const network = discovery.networks.find((item) => item.id === checked.selection.networkId)!
  const port = discovery.ports.find((item) => item.id === checked.selection.portId)!
  return {
    schemaVersion: CLOUDFLARE_TUNNEL_INTENT_VERSION,
    featureId: CLOUDFLARE_TUNNEL_WIZARD_FEATURE,
    hostname: checked.selection.hostname,
    zoneName: zone.name.toLocaleLowerCase(),
    originProtocol: port.protocol,
    originPort: port.port,
    desiredHostKind: host.kind,
    desiredContainerLabel: container.label,
    desiredNetworkLabel: network.label,
    relationshipIds: relationshipIds.filter((id) => validId(id)).slice(0, 256)
  }
}

export function cloudflareTunnelPreview(
  selection: CloudflareTunnelWizardSelection,
  discovery: CloudflareTunnelDiscovery,
  relationshipIds: readonly string[] = []
): CloudflareTunnelPreview {
  const checked = validateCloudflareTunnelSelection(selection, discovery)
  if (!checked.ok) throw new Error(checked.error)
  const account = discovery.accounts.find((item) => item.id === checked.selection.accountId)!
  const zone = discovery.zones.find((item) => item.id === checked.selection.zoneId)!
  const host = discovery.hosts.find((item) => item.id === checked.selection.hostId)!
  const container = discovery.containers.find((item) => item.id === checked.selection.containerId)!
  const network = discovery.networks.find((item) => item.id === checked.selection.networkId)!
  const port = discovery.ports.find((item) => item.id === checked.selection.portId)!
  const origin = discovery.origins.find((item) => item.id === checked.selection.originId)!
  return {
    operation: 'create-tunnel-and-route-hostname',
    accountLabel: account.label,
    zoneName: zone.name,
    hostname: checked.selection.hostname,
    hostLabel: host.label,
    containerLabel: container.label,
    networkLabel: network.label,
    port: port.port,
    protocol: port.protocol,
    origin: origin.origin,
    credentialBinding: 'local-provider-account',
    externalSideEffects: ['Create one Cloudflare Tunnel', 'Create or adopt the selected hostname route', 'Verify the selected local origin'],
    portable: cloudflareTunnelPortableIntent(checked.selection, discovery, relationshipIds)
  }
}

/**
 * Validate the portable part before it is handed to schema 3. This rejects local ids and secret
 * shaped keys, making accidental widening visible at the boundary rather than during export.
 */
export function validateCloudflareTunnelPortableIntent(value: unknown): CloudflareTunnelPortableIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tunnel portable intent is invalid.')
  const item = value as Record<string, unknown>
  const keys = Object.keys(item).sort().join(',')
  if (keys !== 'desiredContainerLabel,desiredHostKind,desiredNetworkLabel,featureId,hostname,originPort,originProtocol,relationshipIds,schemaVersion,zoneName') throw new Error('Tunnel portable intent contains an unknown field.')
  if (item.schemaVersion !== 1 || item.featureId !== CLOUDFLARE_TUNNEL_WIZARD_FEATURE) throw new Error('Tunnel portable intent version is unsupported.')
  if (!text(item.hostname, 253) || !HOSTNAME.test(item.hostname)) throw new Error('Tunnel portable hostname is invalid.')
  if (!text(item.zoneName, 253) || !HOSTNAME.test(`x.${item.zoneName}`)) throw new Error('Tunnel portable zone is invalid.')
  if (item.originProtocol !== 'http' && item.originProtocol !== 'https') throw new Error('Tunnel portable origin protocol is invalid.')
  if (typeof item.originPort !== 'number' || !Number.isInteger(item.originPort) || item.originPort < 1 || item.originPort > 65535) throw new Error('Tunnel portable origin port is invalid.')
  if (!['local', 'ssh', 'server'].includes(String(item.desiredHostKind)) || !text(item.desiredContainerLabel, 512) || !text(item.desiredNetworkLabel, 512)) throw new Error('Tunnel portable destination intent is invalid.')
  if (!Array.isArray(item.relationshipIds) || item.relationshipIds.length > 256 || item.relationshipIds.some((id) => !validId(id))) throw new Error('Tunnel portable relationships are invalid.')
  return {
    schemaVersion: 1,
    featureId: CLOUDFLARE_TUNNEL_WIZARD_FEATURE,
    hostname: item.hostname,
    zoneName: item.zoneName,
    originProtocol: item.originProtocol,
    originPort: item.originPort,
    desiredHostKind: item.desiredHostKind as TunnelHostChoice['kind'],
    desiredContainerLabel: item.desiredContainerLabel,
    desiredNetworkLabel: item.desiredNetworkLabel,
    relationshipIds: [...item.relationshipIds]
  }
}

/** Binding carries only a provider account reference and a stable vault key, never credential bytes. */
export function cloudflareTunnelLocalBinding(
  nodeId: string,
  selection: CloudflareTunnelWizardSelection,
  discovery: CloudflareTunnelDiscovery,
  now = Date.now()
): CloudflareTunnelLocalBinding {
  const preview = cloudflareTunnelPreview(selection, discovery)
  if (!validId(nodeId)) throw new Error('Tunnel node id is invalid.')
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Tunnel verification time is invalid.')
  return {
    bindingVersion: 1,
    nodeId,
    provider: 'cloudflare',
    accountRef: selection.accountId,
    credentialKey: `provider-account:${selection.accountId}`,
    hostname: preview.hostname,
    lastVerifiedAt: now
  }
}
