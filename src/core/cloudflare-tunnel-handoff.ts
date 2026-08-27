/**
 * Core coordinator for a hosted-service Cloudflare Tunnel handoff.
 *
 * The coordinator owns the ordering guarantee: it verifies the selected loopback origin first,
 * requires a separate exposure confirmation, and only then calls the provider adapter. The adapter
 * receives an opaque credential key, never a credential value. Import and project serialization do
 * not call this coordinator.
 */

import { randomUUID } from 'node:crypto'
import {
  canStartCloudflareHandoff,
  validateCloudflareTunnelHandoffRequest,
  validateCloudflareTunnelIntent,
  validateHostedServiceOrigin,
  type CloudflareAccountSummary,
  type CloudflareTunnelHandoffApi,
  type CloudflareTunnelHandoffProgress,
  type CloudflareTunnelHandoffRequest,
  type CloudflareTunnelHandoffResult,
  type CloudflareTunnelHandoffStage,
  type CloudflareTunnelHandoffState,
  type CloudflareTunnelIntent,
  type CloudflareTunnelCapabilities,
  type CloudflareZoneSummary,
  type HostedServiceHealth,
  type HostedServiceOrigin
} from '../shared/cloudflare-tunnel-handoff'
import { LocalNodeBindingStore, validateLocalNodeBinding } from './portable-bindings'

const HEALTH_DEADLINE_MS = 10_000
const PROVIDER_DEADLINE_MS = 30_000

export interface CloudflareTunnelCreated {
  accountId: string
  zoneId: string
  tunnelId: string
  connectorId: string
}

export interface CloudflareTunnelProviderAdapter {
  capabilities(): Promise<CloudflareTunnelCapabilities>
  accounts(): Promise<CloudflareAccountSummary[]>
  zones(accountId: string): Promise<CloudflareZoneSummary[]>
  /** Core-only lookup. The opaque key is read from the protected vault and never exposed to UI. */
  credentialKey(accountId: string): Promise<string | null>
  createTunnel(input: {
    accountId: string
    zoneId: string
    intent: CloudflareTunnelIntent
    origin: HostedServiceOrigin
    credentialKey: string
    signal: AbortSignal
  }): Promise<CloudflareTunnelCreated>
  startConnector(input: {
    tunnelId: string
    connectorId: string
    credentialKey: string
    signal: AbortSignal
  }): Promise<'running' | 'unhealthy' | 'unknown'>
  verifyExternal(input: {
    hostnameHint: string
    pathPrefix: string
    signal: AbortSignal
  }): Promise<{ reachable: boolean; reason: string | null }>
}

export interface LocalHostedServiceResolver {
  origins(nodeId: string): Promise<HostedServiceOrigin[]>
  checkHealth(origin: HostedServiceOrigin, signal: AbortSignal): Promise<{ ok: boolean; latencyMs?: number; reason?: string }>
}

interface PendingOperation {
  controller: AbortController
}

function withDeadline<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abortFromParent = (): void => controller.abort()
  if (parent) {
    if (parent.aborted) controller.abort()
    else parent.addEventListener('abort', abortFromParent, { once: true })
  }
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort()
      const error = new Error('The operation timed out.')
      error.name = 'TimeoutError'
      reject(error)
    }, timeoutMs)
    void task(controller.signal).then(resolve, reject).finally(() => {
      clearTimeout(timeout)
      parent?.removeEventListener('abort', abortFromParent)
    })
  })
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cancelled(signal: AbortSignal): boolean {
  return signal.aborted
}

function healthResult(originId: string, state: HostedServiceHealth['state'], reason: string | null, latencyMs: number | null, checkedAt: number | null = Date.now()): HostedServiceHealth {
  return { originId, state, checkedAt, latencyMs, reason }
}

function initialState(nodeId: string, intent: CloudflareTunnelIntent, originId: string): CloudflareTunnelHandoffState {
  return {
    nodeId,
    localHealth: healthResult(originId, 'unknown', null, null, null),
    selectedOriginId: originId,
    intent,
    external: 'not-started',
    tunnelId: null,
    connectorState: 'not-started',
    reason: null
  }
}

export class CloudflareTunnelHandoffService implements CloudflareTunnelHandoffApi {
  private readonly pending = new Map<string, PendingOperation>()
  private readonly listeners = new Set<(progress: CloudflareTunnelHandoffProgress) => void>()

  constructor(
    private readonly bindings: LocalNodeBindingStore,
    private readonly local: LocalHostedServiceResolver,
    private readonly provider: CloudflareTunnelProviderAdapter
  ) {}

  async origins(nodeId: string): Promise<HostedServiceOrigin[]> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(nodeId)) return []
    const origins = await this.local.origins(nodeId)
    return origins.map((origin) => validateHostedServiceOrigin(origin))
  }

  async health(nodeId: string, originId: string): Promise<HostedServiceHealth> {
    const origin = (await this.origins(nodeId)).find((candidate) => candidate.id === originId)
    if (!origin) return healthResult(originId, 'unavailable', 'The selected local origin is no longer available.', null)
    try {
      const result = await withDeadline((signal) => this.local.checkHealth(origin, signal), HEALTH_DEADLINE_MS)
      return result.ok
        ? healthResult(origin.id, 'healthy', null, typeof result.latencyMs === 'number' ? result.latencyMs : null)
        : healthResult(origin.id, 'unhealthy', result.reason ?? 'The local service did not report healthy.', typeof result.latencyMs === 'number' ? result.latencyMs : null)
    } catch (error) {
      return healthResult(origin.id, 'unavailable', error instanceof Error && error.name === 'AbortError' ? 'Local health verification timed out.' : messageFor(error), null)
    }
  }

  async accounts(): Promise<CloudflareAccountSummary[]> {
    return (await this.provider.accounts()).map((account) => ({ ...account }))
  }

  async capabilities(): Promise<CloudflareTunnelCapabilities> {
    return { ...(await this.provider.capabilities()) }
  }

  async zones(accountId: string): Promise<CloudflareZoneSummary[]> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(accountId)) return []
    return (await this.provider.zones(accountId)).map((zone) => ({ ...zone }))
  }

  async handoff(rawRequest: CloudflareTunnelHandoffRequest): Promise<CloudflareTunnelHandoffResult> {
    const operationId = randomUUID()
    const controller = new AbortController()
    this.pending.set(operationId, { controller })
    let request: CloudflareTunnelHandoffRequest
    try {
      request = validateCloudflareTunnelHandoffRequest(rawRequest)
    } catch (error) {
      this.pending.delete(operationId)
      return this.failedResult(rawRequest, messageFor(error), 'failed')
    }
    const intent = validateCloudflareTunnelIntent(request.intent)
    let state = initialState(request.nodeId, intent, request.originId)
    let storedBinding: CloudflareTunnelHandoffResult['binding'] = null
    const emit = (stage: CloudflareTunnelHandoffStage, progress: number, message: string): void => {
      const event = { operationId, stage, progress, message }
      for (const listener of this.listeners) listener(event)
    }
    try {
      emit('checking-local-health', 0.08, 'Checking the selected local service before any external change.')
      const origin = (await this.origins(request.nodeId)).find((candidate) => candidate.id === request.originId)
      if (!origin) {
        state = { ...state, localHealth: healthResult(request.originId, 'unavailable', 'The selected local origin is no longer available.', null), reason: 'Choose a currently discovered local origin.' }
        emit('local-health-failed', 0, state.reason)
        return { ok: false, state, binding: null, error: state.reason }
      }
      const health = await this.health(request.nodeId, request.originId)
      state = { ...state, localHealth: health }
      if (health.state !== 'healthy') {
        state = { ...state, reason: health.reason ?? 'Verify the local service health before exposing it.' }
        emit('local-health-failed', 0, state.reason)
        return { ok: false, state, binding: null, error: state.reason }
      }
      const eligibility = canStartCloudflareHandoff(health, origin, intent, request)
      if (!eligibility.ok && !request.confirmExternalExposure) {
        state = { ...state, external: 'awaiting-confirmation', reason: eligibility.reason }
        emit('awaiting-exposure-confirmation', 0.25, eligibility.reason)
        return { ok: false, state, binding: null, error: eligibility.reason }
      }
      if (!eligibility.ok) {
        state = { ...state, reason: eligibility.reason }
        emit('failed', 0, eligibility.reason)
        return { ok: false, state, binding: null, error: eligibility.reason }
      }
      if (cancelled(controller.signal)) return this.cancelledResult(state, emit)

      emit('validating-provider-binding', 0.3, 'Validating the selected Cloudflare account and zone.')
      const capabilities = await withDeadline((signal) => this.provider.capabilities(), PROVIDER_DEADLINE_MS, controller.signal)
      if (!capabilities.available || !capabilities.canCreateTunnel || !capabilities.canStartConnector || !capabilities.canVerifyExternal) {
        const reason = capabilities.reason ?? 'The local Cloudflare Tunnel adapter is unavailable for this handoff.'
        state = { ...state, reason }
        emit('failed', 0, reason)
        return { ok: false, state, binding: null, error: reason }
      }
      const [accounts, zones] = await Promise.all([
        withDeadline((signal) => this.provider.accounts(), PROVIDER_DEADLINE_MS, controller.signal),
        withDeadline((signal) => this.provider.zones(request.accountId), PROVIDER_DEADLINE_MS, controller.signal)
      ])
      const account = accounts.find((candidate) => candidate.id === request.accountId && candidate.available)
      const zone = zones.find((candidate) => candidate.id === request.zoneId && candidate.accountId === request.accountId && candidate.available)
      if (!account || !zone) {
        const reason = 'The selected Cloudflare account or zone is unavailable. Refresh the guided choices and retry.'
        state = { ...state, reason }
        emit('failed', 0, reason)
        return { ok: false, state, binding: null, error: reason }
      }
      const credentialKey = await this.provider.credentialKey(account.id)
      if (!credentialKey) {
        const reason = 'The selected Cloudflare account has no usable local credential. Configure consent on this computer and retry.'
        state = { ...state, reason }
        emit('failed', 0, reason)
        return { ok: false, state, binding: null, error: reason }
      }
      if (cancelled(controller.signal)) return this.cancelledResult(state, emit)

      emit('creating-tunnel', 0.5, 'Creating the tunnel route after local health and exposure confirmation.')
      const created = await withDeadline(
        (signal) => this.provider.createTunnel({ accountId: account.id, zoneId: zone.id, intent, origin, credentialKey, signal }),
        PROVIDER_DEADLINE_MS,
        controller.signal
      )
      state = { ...state, external: 'creating', tunnelId: created.tunnelId, connectorState: 'starting' }
      // Persist the provider references before starting the connector. A connector start can fail
      // after the provider has created the tunnel, and losing the references would leave an
      // externally-created route with no recoverable local binding.
      const binding = validateLocalNodeBinding({
        nodeId: request.nodeId,
        bindingVersion: 1,
        providerOrHostIdentity: account.id,
        localResourceReferences: {
          zoneId: zone.id,
          tunnelId: created.tunnelId,
          connectorId: created.connectorId,
          originId: origin.id,
          externalState: 'not-verified'
        },
        credentialKeys: [credentialKey],
        lastVerifiedAt: health.checkedAt ?? Date.now()
      })
      const snapshot = await this.bindings.snapshot()
      try { await this.bindings.apply(request.nodeId, binding) } catch (error) { await this.bindings.restore(snapshot); throw error }
      storedBinding = { accountId: account.id, zoneId: zone.id, tunnelId: created.tunnelId, connectorId: created.connectorId }
      if (cancelled(controller.signal)) return this.cancelledResult(state, emit, storedBinding)

      emit('starting-connector', 0.68, 'Starting the connector with the protected local credential reference.')
      const connectorState = await withDeadline(
        (signal) => this.provider.startConnector({ tunnelId: created.tunnelId, connectorId: created.connectorId, credentialKey, signal }),
        PROVIDER_DEADLINE_MS,
        controller.signal
      )
      state = { ...state, connectorState }
      if (connectorState !== 'running') {
        const reason = 'The tunnel was created, but connector health is not verified. External reachability was not checked.'
        state = { ...state, external: 'connector-unverified', reason }
        emit('partial', 0.78, reason)
        return { ok: false, state, binding: storedBinding, error: reason }
      }

      emit('verifying-external-reachability', 0.86, 'Checking the public hostname without treating DNS or connector state as local health.')
      const external = await withDeadline(
        (signal) => this.provider.verifyExternal({ hostnameHint: intent.hostnameHint, pathPrefix: intent.pathPrefix, signal }),
        PROVIDER_DEADLINE_MS,
        controller.signal
      )
      if (external.reachable) {
        state = { ...state, external: 'reachable', reason: null }
        await this.updateExternalState(request.nodeId, 'reachable')
        emit('completed', 1, 'The healthy local service is reachable through the confirmed Cloudflare Tunnel route.')
        return { ok: true, state, binding: storedBinding, error: null }
      }
      state = { ...state, external: 'unreachable', reason: external.reason ?? 'The tunnel and connector were created, but external reachability is not verified.' }
      await this.updateExternalState(request.nodeId, 'unreachable')
      emit('partial', 0.9, state.reason)
      return { ok: false, state, binding: storedBinding, error: state.reason }
    } catch (error) {
      if (cancelled(controller.signal)) return this.cancelledResult(state, emit, storedBinding)
      const reason = messageFor(error)
      state = { ...state, external: state.tunnelId ? state.external : 'not-started', reason }
      emit('failed', 0, reason)
      return { ok: false, state, binding: storedBinding, error: reason }
    } finally {
      this.pending.delete(operationId)
    }
  }

  cancel(operationId: string): void {
    this.pending.get(operationId)?.controller.abort()
  }

  onProgress(listener: (progress: CloudflareTunnelHandoffProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private failedResult(raw: CloudflareTunnelHandoffRequest, reason: string, stage: CloudflareTunnelHandoffStage): CloudflareTunnelHandoffResult {
    const fallbackIntent = raw?.intent && typeof raw.intent === 'object'
      ? raw.intent as CloudflareTunnelIntent
      : { schemaVersion: 1, featureId: 'cloudflare-tunnel-handoff', serviceId: 'unknown', originId: 'unknown', hostnameHint: 'invalid.example', pathPrefix: '/', exposure: 'explicit-after-local-health', bindMode: 'private-origin' }
    const state = initialState(typeof raw?.nodeId === 'string' ? raw.nodeId : 'unknown', fallbackIntent, typeof raw?.originId === 'string' ? raw.originId : 'unknown')
    return { ok: false, state: { ...state, reason, external: stage === 'awaiting-exposure-confirmation' ? 'awaiting-confirmation' : 'not-started' }, binding: null, error: reason }
  }

  private cancelledResult(state: CloudflareTunnelHandoffState, emit: (stage: CloudflareTunnelHandoffStage, progress: number, message: string) => void, binding: CloudflareTunnelHandoffResult['binding'] = null): CloudflareTunnelHandoffResult {
    const next = { ...state, reason: 'The Cloudflare Tunnel handoff was cancelled; the last valid local binding remains unchanged.' }
    emit('cancelled', state.tunnelId ? 0.7 : 0, next.reason)
    return { ok: false, state: next, binding, error: next.reason }
  }

  private async updateExternalState(nodeId: string, externalState: 'reachable' | 'unreachable'): Promise<void> {
    try {
      const current = await this.bindings.load()
      const stored = current[nodeId]
      if (!stored) return
      await this.bindings.apply(nodeId, validateLocalNodeBinding({
        ...stored,
        localResourceReferences: { ...stored.localResourceReferences, externalState }
      }))
    } catch {
      // The provider result remains truthful in the return value. A stale local binding is safer
      // than overwriting it with an unvalidated shape, and the next explicit retry can reconcile it.
    }
  }
}
