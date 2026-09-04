/**
 * Orchestrates the private-first hosted-service handoff without knowing how Cloudflare is
 * authenticated or how a connector is started. The provider adapter is intentionally injected by
 * the future Cloudflare manager, so this core module cannot receive or persist a token by accident.
 */
import {
  handoffStatusFor,
  validateHostedServiceTunnelBinding,
  verifyHostedServiceHealth,
  type HostedServiceOrigin,
  type HostedServiceTunnelBinding,
  type HostedServiceTunnelHandoffInput,
  type HostedServiceTunnelState,
  type HostedServiceTunnelStatus,
  type LocalHealthProbe
} from '../shared/hosted-service-tunnel'

export interface HostedServiceTunnelProvider {
  handoff(input: HostedServiceTunnelHandoffInput): Promise<{ ok: true; binding: HostedServiceTunnelBinding } | { ok: false; error: string }>
  rollback(binding: HostedServiceTunnelBinding): Promise<{ ok: true } | { ok: false; error: string }>
}

export interface HostedServiceTunnelCoordinatorOptions {
  provider?: HostedServiceTunnelProvider
  now?: () => string
  onStatus?: (status: HostedServiceTunnelStatus) => void
}

export class HostedServiceTunnelCoordinator {
  private status: HostedServiceTunnelStatus = handoffStatusFor('unbound')
  private binding: HostedServiceTunnelBinding | undefined
  private readonly provider?: HostedServiceTunnelProvider
  private readonly now: () => string
  private readonly onStatus?: (status: HostedServiceTunnelStatus) => void
  private verifiedOrigin?: string
  private verifiedAt?: number

  constructor(options: HostedServiceTunnelCoordinatorOptions = {}) {
    this.provider = options.provider
    this.now = options.now ?? (() => new Date().toISOString())
    this.onStatus = options.onStatus
  }

  getStatus(): HostedServiceTunnelStatus {
    return this.status
  }

  getBinding(): HostedServiceTunnelBinding | undefined {
    return this.binding
  }

  private setStatus(status: HostedServiceTunnelStatus): HostedServiceTunnelStatus {
    this.status = status
    this.onStatus?.(status)
    return status
  }

  async verifyLocalHealth(origin: HostedServiceOrigin, probe: LocalHealthProbe, timeoutMs?: number): Promise<HostedServiceTunnelStatus> {
    this.setStatus(handoffStatusFor('checking-local-health', origin))
    const result = await verifyHostedServiceHealth(origin, probe, timeoutMs)
    if (result.state === 'ready') {
      this.verifiedOrigin = JSON.stringify(origin)
      this.verifiedAt = Date.parse(result.checkedAt ?? this.now())
    } else {
      this.verifiedOrigin = undefined
      this.verifiedAt = undefined
    }
    return this.setStatus(result)
  }

  async handoff(input: HostedServiceTunnelHandoffInput): Promise<HostedServiceTunnelStatus> {
    const nowMs = Date.parse(this.now())
    const verificationFresh = this.verifiedOrigin === JSON.stringify(input.origin) && this.verifiedAt !== undefined && Number.isFinite(nowMs) && nowMs - this.verifiedAt >= 0 && nowMs - this.verifiedAt <= 60_000
    if (this.status.state !== 'ready' || !verificationFresh) {
      return this.setStatus(handoffStatusFor('failed', input.origin, input.hostname, 'Local health must be verified immediately before handoff.', 'health-failed'))
    }
    if (!this.provider) {
      return this.setStatus(handoffStatusFor('failed', input.origin, input.hostname, 'The Cloudflare manager is unavailable, so no provider mutation was attempted.', 'handoff-failed'))
    }
    this.setStatus(handoffStatusFor('handing-off', input.origin, input.hostname))
    const result = await this.provider.handoff(input)
    if (!result.ok) return this.setStatus(handoffStatusFor('failed', input.origin, input.hostname, result.error, 'handoff-failed'))
    const safeBinding = validateHostedServiceTunnelBinding(result.binding)
    if (!safeBinding) return this.setStatus(handoffStatusFor('failed', input.origin, input.hostname, 'The provider returned an invalid handoff binding. The local service remains unchanged.', 'handoff-failed'))
    this.binding = safeBinding
    return this.setStatus({ ...handoffStatusFor('connected', safeBinding.origin, safeBinding.hostname), checkedAt: safeBinding.updatedAt })
  }

  async rollback(): Promise<HostedServiceTunnelStatus> {
    const binding = this.binding
    if (!binding) return this.setStatus(handoffStatusFor('rolled-back', undefined, undefined, 'There is no local Cloudflare handoff binding to roll back.'))
    if (!this.provider) return this.setStatus(handoffStatusFor('failed', binding.origin, binding.hostname, 'The Cloudflare manager is unavailable, so the binding was kept.', 'handoff-failed'))
    const result = await this.provider.rollback(binding)
    if (!result.ok) return this.setStatus(handoffStatusFor('failed', binding.origin, binding.hostname, result.error, 'handoff-failed'))
    this.binding = undefined
    this.verifiedOrigin = undefined
    this.verifiedAt = undefined
    return this.setStatus(handoffStatusFor('rolled-back', binding.origin, binding.hostname))
  }

  /** The UI can persist this local snapshot beside serviceConnection without serializing secrets. */
  toLocalBinding(): HostedServiceTunnelBinding | undefined {
    if (!this.binding) return undefined
    return { ...this.binding, state: this.status.state as HostedServiceTunnelState, updatedAt: this.now() }
  }
}
