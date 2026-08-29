/** Core-bound handlers for model discovery and write-only gateway credentials. The environment
 * snapshot is registered by the desktop shell directly because exposing it through the shared
 * platform handler would disclose host variables to a relay peer. */
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import {
  modelGatewayRoutes,
  parseGatewayModels,
  resolveModelGatewayApiKey,
  type GatewayModel,
  type ModelDiscoveryResult,
  type ModelGatewaySettings
} from '../shared/agents/model-gateway'
interface ModelGatewayCredentialService {
  readForHost(): string | null
  status(): { hasStoredKey: boolean; storage: 'encrypted' | 'unavailable' }
  save(key: string): Promise<{ hasStoredKey: boolean; storage: 'encrypted' | 'unavailable' }>
  clear(): Promise<{ hasStoredKey: boolean; storage: 'encrypted' | 'unavailable' }>
}

const DISCOVERY_TIMEOUT_MS = 10_000
const DISCOVERY_MAX_BYTES = 512 * 1024

async function boundedResponseText(response: Response): Promise<string | null> {
  const announced = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(announced) && announced > DISCOVERY_MAX_BYTES) return null
  if (!response.body) {
    const value = await response.text()
    return Buffer.byteLength(value, 'utf8') <= DISCOVERY_MAX_BYTES ? value : null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > DISCOVERY_MAX_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function discoverModels(
  settings: ModelGatewaySettings,
  saved: ModelGatewaySettings | undefined,
  credentials: ModelGatewayCredentialService | undefined,
  onModels?: (baseUrl: string, models: GatewayModel[]) => void
): Promise<ModelDiscoveryResult> {
  const routes = modelGatewayRoutes(settings?.baseUrl ?? '')
  if (!routes) return { models: [], error: 'Enter a valid HTTP(S) gateway URL.' }
  const field = settings?.apiKey ?? ''
  const reference = field.includes('${')
  const sameGateway = !!settings?.baseUrl && settings.baseUrl === saved?.baseUrl
  if (reference && !sameGateway) {
    return { models: [], error: 'Save the gateway URL before using a stored or environment key.' }
  }
  const resolved = resolveModelGatewayApiKey(
    field,
    sameGateway ? process.env : {},
    sameGateway ? credentials?.readForHost() ?? null : null
  )
  if (resolved.invalidReference) return { models: [], error: 'The gateway environment reference is invalid.' }
  if (resolved.missing.length) return { models: [], error: 'The gateway environment key is unset.' }
  if (resolved.storedSecretMissing) return { models: [], error: 'Save a gateway API key first.' }
  if (!resolved.value) return { models: [], error: 'Enter an API key.' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const response = await fetch(routes.discovery, {
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${resolved.value}`,
        'x-bf-vk': resolved.value,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    if (!response.ok) return { models: [], error: `Model discovery failed (HTTP ${response.status}).` }
    let payload: unknown
    try {
      const body = await boundedResponseText(response)
      if (body === null) return { models: [], error: 'Model discovery response exceeded its size limit.' }
      payload = JSON.parse(body)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return { models: [], error: 'Model discovery returned invalid JSON.' }
    }
    const models = parseGatewayModels(payload)
    // Replace the spawn-time cache even when the response is empty, so changing a gateway cannot
    // leave limits from an older refresh attached to a later launch.
    onModels?.(settings.baseUrl, models)
    return models.length ? { models } : { models: [], error: 'The gateway returned no usable models.' }
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error && error.name === 'AbortError' ? 'Model discovery timed out.' : 'Model discovery failed.'
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Register safe, core-routed model gateway operations for Desktop and Server Edition. */
export function registerAgentEnvIpc(
  getSavedGateway: () => ModelGatewaySettings | undefined,
  credentials?: ModelGatewayCredentialService,
  onModels?: (baseUrl: string, models: ModelDiscoveryResult['models']) => void
): void {
  platform().handle(IPC.agentDiscoverModels, async (settings: ModelGatewaySettings) => {
    return discoverModels(settings, getSavedGateway(), credentials, onModels)
  })
  platform().handle(IPC.agentGatewayCredentialStatus, () =>
    credentials?.status() ?? { hasStoredKey: false, storage: 'unavailable' as const }
  )
  // Do not register write handlers on Server Edition. An unhandled method is safer than a
  // handler that accepts a browser-entered key and rejects it only after the secret reached the
  // server process. Desktop registers both operations because it supplies protected storage.
  if (credentials) {
    platform().handle(IPC.agentSaveGatewayCredential, (key: string) => credentials.save(key))
    platform().handle(IPC.agentClearGatewayCredential, () => credentials.clear())
  }
}
