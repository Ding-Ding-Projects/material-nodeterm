import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { CloudflareTunnelRuntime, CloudflareTunnelApi, CloudflareTunnelPlan } from '../../shared/cloudflare-tunnel'
import { createCloudflareTunnelService } from './tunnel-service'

/** Shared cloudflare:* RPC registration. The desktop supplies a structured Docker runtime;
 * Server Edition keeps the Cloudflare API and typed plan available but reports no host runtime. */
export function registerCloudflareTunnelIpc(
  platform: CorePlatform,
  runtime?: CloudflareTunnelRuntime
): { service: CloudflareTunnelApi } {
  const service = createCloudflareTunnelService(runtime)
  platform.handle(IPC.cloudflareTokenStatus, () => service.tokenStatus())
  platform.handle(IPC.cloudflareSetToken, (token: string | null) => service.setToken(token))
  platform.handle(IPC.cloudflareAccounts, () => service.accounts())
  platform.handle(IPC.cloudflareZones, (accountId: string) => service.zones(accountId))
  platform.handle(IPC.cloudflareTargets, () => service.targets())
  platform.handle(IPC.cloudflarePreflight, (plan: CloudflareTunnelPlan) => service.preflight(plan))
  platform.handle(IPC.cloudflareApply, (plan: CloudflareTunnelPlan) => service.apply(plan))
  platform.handle(IPC.cloudflareRollback, () => service.rollback())
  platform.handle(IPC.cloudflareStatus, () => service.status())
  return { service }
}

