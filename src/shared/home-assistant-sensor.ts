/**
 * Portable Home Assistant sensor-display intent and machine-local API contracts.
 *
 * Only entity ids and presentation preferences belong in a shared project. Instance URLs,
 * credentials, provider sessions, observed values, and history stay behind the core boundary.
 */

export type HomeAssistantDisplayMode =
  | 'auto'
  | 'value'
  | 'binary'
  | 'enum'
  | 'gauge'
  | 'trend'
  | 'event'
  | 'weather'
  | 'calendar'
  | 'attributes'

export interface HomeAssistantEntityBinding {
  entityId: string
  mode: HomeAssistantDisplayMode
  label: string | null
  min: number | null
  max: number | null
  attributeKeys: string[]
}

export interface HomeAssistantSensorConfig {
  entities: HomeAssistantEntityBinding[]
  refreshSeconds: number
  historyLimit: number
  showLastChanged: boolean
}

export interface HomeAssistantBindingStatus {
  nodeId: string
  state: 'unbound' | 'ready' | 'unavailable'
  instanceLabel: string | null
  credentialStored: boolean
  lastSuccessfulAt: number | null
  reason: string | null
}

export interface HomeAssistantEntityState {
  entityId: string
  domain: string
  friendlyName: string
  state: string
  unit: string | null
  deviceClass: string | null
  stateClass: string | null
  options: string[]
  attributes: Record<string, string | number | boolean | null>
  lastChanged: string
  lastUpdated: string
}

export interface HomeAssistantHistoryPoint {
  entityId: string
  state: string
  numericValue: number | null
  observedAt: number
}

export interface HomeAssistantSensorSnapshot {
  nodeId: string
  fetchedAt: number
  complete: boolean
  partial: boolean
  /** True when these entities came from the last successful local observation, not this request. */
  stale: boolean
  entities: HomeAssistantEntityState[]
  history: HomeAssistantHistoryPoint[]
  missingEntityIds: string[]
  reason: string | null
}

export interface HomeAssistantConfigureInput {
  nodeId: string
  baseUrl: string
  token: string
  instanceLabel?: string
}

export interface HomeAssistantSensorApi {
  binding(nodeId: string): Promise<HomeAssistantBindingStatus>
  configure(input: HomeAssistantConfigureInput): Promise<HomeAssistantBindingStatus>
  leaveUnbound(nodeId: string): Promise<HomeAssistantBindingStatus>
  discover(nodeId: string): Promise<HomeAssistantEntityState[]>
  refresh(nodeId: string, config: HomeAssistantSensorConfig): Promise<HomeAssistantSensorSnapshot>
}

export const HOME_ASSISTANT_DISPLAY_MODES: readonly { id: HomeAssistantDisplayMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automatic', hint: 'Choose from the entity domain and metadata.' },
  { id: 'value', label: 'Value', hint: 'Show the current value and unit.' },
  { id: 'binary', label: 'Binary state', hint: 'Show an explicit on/off or active/inactive state.' },
  { id: 'enum', label: 'Enum', hint: 'Show the current option and the declared option list.' },
  { id: 'gauge', label: 'Gauge', hint: 'Plot a numeric value against a reviewed minimum and maximum.' },
  { id: 'trend', label: 'Trend', hint: 'Show bounded observed history without inventing missing samples.' },
  { id: 'event', label: 'Event', hint: 'Show event type and event attributes.' },
  { id: 'weather', label: 'Weather', hint: 'Show weather condition and forecast-related attributes.' },
  { id: 'calendar', label: 'Calendar', hint: 'Show calendar state and event attributes.' },
  { id: 'attributes', label: 'Attributes', hint: 'Show only explicitly selected attributes.' }
] as const

export const DEFAULT_HOME_ASSISTANT_SENSOR_CONFIG: HomeAssistantSensorConfig = {
  entities: [],
  refreshSeconds: 30,
  historyLimit: 60,
  showLastChanged: true
}

const ENTITY_RE = /^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_]*$/
const MODES = new Set<HomeAssistantDisplayMode>(HOME_ASSISTANT_DISPLAY_MODES.map((mode) => mode.id))

export function isHomeAssistantNodeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{1,120}$/.test(value)
}

export function isHomeAssistantEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && ENTITY_RE.test(value)
}

function cleanAttributeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(key)))].slice(0, 24)
}

export function validateHomeAssistantSensorConfig(value: unknown): HomeAssistantSensorConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_HOME_ASSISTANT_SENSOR_CONFIG, entities: [] }
  const raw = value as Partial<HomeAssistantSensorConfig>
  const entities = Array.isArray(raw.entities)
    ? raw.entities.flatMap((item): HomeAssistantEntityBinding[] => {
        if (!item || typeof item !== 'object') return []
        const candidate = item as Partial<HomeAssistantEntityBinding>
        if (!isHomeAssistantEntityId(candidate.entityId)) return []
        const mode = MODES.has(candidate.mode as HomeAssistantDisplayMode) ? candidate.mode as HomeAssistantDisplayMode : 'auto'
        const min = typeof candidate.min === 'number' && Number.isFinite(candidate.min) ? candidate.min : null
        const max = typeof candidate.max === 'number' && Number.isFinite(candidate.max) ? candidate.max : null
        return [{
          entityId: candidate.entityId,
          mode,
          label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim().slice(0, 120) : null,
          min: min !== null && max !== null && min < max ? min : null,
          max: min !== null && max !== null && min < max ? max : null,
          attributeKeys: cleanAttributeKeys(candidate.attributeKeys)
        }]
      }).slice(0, 48)
    : []
  return {
    entities: [...new Map(entities.map((entity) => [entity.entityId, entity])).values()],
    refreshSeconds: Math.min(3600, Math.max(10, Math.round(Number(raw.refreshSeconds) || 30))),
    historyLimit: Math.min(720, Math.max(2, Math.round(Number(raw.historyLimit) || 60))),
    showLastChanged: raw.showLastChanged !== false
  }
}

export function suggestedHomeAssistantDisplayMode(entity: HomeAssistantEntityState): HomeAssistantDisplayMode {
  if (entity.domain === 'binary_sensor' || entity.domain === 'input_boolean' || entity.domain === 'switch') return 'binary'
  if (entity.domain === 'event') return 'event'
  if (entity.domain === 'weather') return 'weather'
  if (entity.domain === 'calendar') return 'calendar'
  if (entity.options.length > 0 || entity.deviceClass === 'enum') return 'enum'
  if (entity.state !== '' && Number.isFinite(Number(entity.state))) return 'gauge'
  return 'value'
}
