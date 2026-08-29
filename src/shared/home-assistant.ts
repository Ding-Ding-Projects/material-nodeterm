/** Shared Home Assistant client contracts.
 *
 * Instance configuration and bindings are machine-local. They are deliberately separate from the
 * portable project projection: an endpoint identifies one installation on this computer, while a
 * project file must remain safe to move. Access tokens never appear in these values or cross the
 * renderer boundary.
 */

export const HOME_ASSISTANT_SCHEMA_VERSION = 1 as const
export const HOME_ASSISTANT_MAX_INSTANCES = 32
export const HOME_ASSISTANT_MAX_ENTITIES = 20_000
export const HOME_ASSISTANT_MAX_ENTITY_REGISTRY = 20_000
export const HOME_ASSISTANT_MAX_SERVICES = 2_000
export const HOME_ASSISTANT_MAX_DEVICES = 10_000
export const HOME_ASSISTANT_MAX_AREAS = 2_000
export const HOME_ASSISTANT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
export const HOME_ASSISTANT_REQUEST_TIMEOUT_MS = 8_000
export const HOME_ASSISTANT_WS_TIMEOUT_MS = 8_000

export type HomeAssistantConnectionState =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'
  | 'auth-error'
  | 'invalid'
  | 'error'

export interface HomeAssistantInstance {
  id: string
  label: string
  baseUrl: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface HomeAssistantBinding {
  id: string
  nodeId: string
  instanceId: string
  entityId: string
  createdAt: number
}

export interface HomeAssistantConnectionStatus {
  instanceId: string
  state: HomeAssistantConnectionState
  /** Whether the registry/state payload is live, retained from an older connection, or unknown. */
  dataState: 'unknown' | 'live' | 'stale'
  detail: string | null
  lastConnectedAt: number | null
  lastSyncAt: number | null
  reconnectAttempt: number
  generation: number
  hasToken: boolean
}

export interface HomeAssistantEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
  last_updated?: string
  context?: { id?: string; parent_id?: string | null; user_id?: string | null }
}

export interface HomeAssistantEntityRegistryEntry {
  entity_id: string
  unique_id: string
  platform: string | null
  device_id: string | null
  area_id: string | null
  disabled_by: string | null
  hidden_by: string | null
  name: string | null
}

export interface HomeAssistantService {
  domain: string
  service: string
  name: string
  description: string
  fields: Record<string, unknown>
}

export interface HomeAssistantDevice {
  id: string
  name: string
  name_by_user: string | null
  manufacturer: string | null
  model: string | null
  area_id: string | null
  config_entries: string[]
  identifiers: Array<[string, string]>
}

export interface HomeAssistantArea {
  id: string
  name: string
  aliases: string[]
  picture: string | null
}

export interface HomeAssistantSnapshot {
  instance: HomeAssistantInstance
  status: HomeAssistantConnectionStatus
  entities: HomeAssistantEntity[]
  entityRegistry: HomeAssistantEntityRegistryEntry[]
  services: HomeAssistantService[]
  devices: HomeAssistantDevice[]
  areas: HomeAssistantArea[]
  bindings: HomeAssistantBinding[]
  fetchedAt: number | null
}

export interface HomeAssistantCreateInput {
  label: string
  baseUrl: string
  enabled?: boolean
  token?: string
}

export interface HomeAssistantUpdateInput {
  id: string
  label?: string
  baseUrl?: string
  enabled?: boolean
}

export interface HomeAssistantApi {
  list(): Promise<HomeAssistantInstance[]>
  create(input: HomeAssistantCreateInput): Promise<HomeAssistantInstance>
  update(input: HomeAssistantUpdateInput): Promise<HomeAssistantInstance | null>
  remove(id: string): Promise<void>
  status(id: string): Promise<HomeAssistantConnectionStatus | null>
  snapshot(id: string): Promise<HomeAssistantSnapshot | null>
  refresh(id: string): Promise<HomeAssistantSnapshot>
  connect(id: string): Promise<HomeAssistantConnectionStatus>
  disconnect(id: string): Promise<void>
  setToken(id: string, token: string | null): Promise<void>
  tokenStatus(): Promise<Record<string, boolean>>
  listBindings(id?: string): Promise<HomeAssistantBinding[]>
  bind(input: { nodeId: string; instanceId: string; entityId: string }): Promise<HomeAssistantBinding>
  unbind(id: string): Promise<void>
  onUpdate(listener: (snapshot: HomeAssistantSnapshot) => void): () => void
}

export function isHomeAssistantEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && /^[a-z0-9_]+\.[a-z0-9_]+$/u.test(value)
}

export function isHomeAssistantInstanceId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
}

export function isHomeAssistantBindingId(value: unknown): value is string {
  return isHomeAssistantInstanceId(value)
}
