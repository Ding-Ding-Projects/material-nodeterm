/** Portable intent for one Home Assistant control node. Connection ids, URLs, bearer tokens,
 * discovered entities and request state are machine-local and deliberately absent. */
export interface HomeAssistantControlConfig {
  entityHint: string | null
  domainHint: string | null
  serviceHint: string | null
  controlMode: 'automatic' | 'domain' | 'schema'
}

export const DEFAULT_HOME_ASSISTANT_CONTROL_CONFIG: HomeAssistantControlConfig = {
  entityHint: null,
  domainHint: null,
  serviceHint: null,
  controlMode: 'automatic'
}

export function validateHomeAssistantControlConfig(value: unknown): HomeAssistantControlConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_HOME_ASSISTANT_CONTROL_CONFIG }
  const input = value as Record<string, unknown>
  const boundedHint = (candidate: unknown, max: number): string | null =>
    typeof candidate === 'string' && candidate.length > 0 && candidate.length <= max && !/[\r\n\0]/u.test(candidate)
      ? candidate
      : null
  const controlMode = input.controlMode === 'domain' || input.controlMode === 'schema' ? input.controlMode : 'automatic'
  return {
    entityHint: boundedHint(input.entityHint, 255),
    domainHint: boundedHint(input.domainHint, 64),
    serviceHint: boundedHint(input.serviceHint, 160),
    controlMode
  }
}

export interface HomeAssistantConnectionSummary {
  id: string
  label: string
  origin: string
  tokenStored: boolean
}

export interface HomeAssistantConnectionInput {
  id?: string
  label: string
  baseUrl: string
  token?: string
}

export interface HomeAssistantEntity {
  entityId: string
  domain: string
  state: string
  friendlyName: string
  attributes: Record<string, unknown>
}

export interface HomeAssistantServiceField {
  name: string
  description: string
  required: boolean
  selector: Record<string, unknown> | null
}

export interface HomeAssistantServiceSchema {
  domain: string
  service: string
  name: string
  description: string
  fields: HomeAssistantServiceField[]
}

export interface HomeAssistantControlStatus {
  state: 'unbound' | 'ready' | 'unavailable'
  connection: HomeAssistantConnectionSummary | null
  reason: string | null
}

export interface HomeAssistantCallInput {
  nodeId: string
  domain: string
  service: string
  entityId: string
  data: Record<string, string | number | boolean | null>
}

export interface HomeAssistantCallResult {
  ok: boolean
  message: string
}

export interface HomeAssistantControlApi {
  connections(): Promise<HomeAssistantConnectionSummary[]>
  configure(input: HomeAssistantConnectionInput): Promise<HomeAssistantConnectionSummary>
  bind(nodeId: string, connectionId: string | null): Promise<HomeAssistantControlStatus>
  status(nodeId: string): Promise<HomeAssistantControlStatus>
  entities(nodeId: string): Promise<HomeAssistantEntity[]>
  services(nodeId: string): Promise<HomeAssistantServiceSchema[]>
  call(input: HomeAssistantCallInput): Promise<HomeAssistantCallResult>
  cancel(nodeId: string): Promise<void>
}

const ENTITY_ID_RE = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/
const SERVICE_RE = /^[a-z_][a-z0-9_]*$/

export function validHomeAssistantEntityId(value: string): boolean {
  return typeof value === 'string' && value.length <= 255 && ENTITY_ID_RE.test(value)
}

export function validHomeAssistantServiceName(value: string): boolean {
  return typeof value === 'string' && value.length <= 64 && SERVICE_RE.test(value)
}
