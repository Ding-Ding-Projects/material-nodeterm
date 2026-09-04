import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { AwsProfileManager } from './aws-profile-manager'
import type { AwsLegacyIdentityManagerApi } from '../../shared/aws'

/** Register the AWS identity manager on the shared core seam. The registrar is intentionally
 *  small: all parsing, validation, child-process allowlisting, stdin handling, and machine-local
 *  persistence live in AwsProfileManager and therefore behave identically in Desktop and Server
 *  Edition shells.
 *
 *  Sibling of `register-ipc.ts`, which is owned by the unrelated AWS OPERATIONS lineage
 *  (catalog/inventory/execute). The two lineages share the `aws:` channel prefix but no key and
 *  no channel string; keeping the registrars separate keeps that boundary visible. */
export function registerAwsProfileManagerIpc(core: CorePlatform): { manager: AwsLegacyIdentityManagerApi } {
  const manager = new AwsProfileManager(core.userDataDir)
  core.handle(IPC.awsProfiles, () => manager.profiles())
  core.handle(IPC.awsSaveProfile, (draft) => manager.saveProfile(draft))
  core.handle(IPC.awsRemoveProfile, (name: string) => manager.removeProfile(name))
  core.handle(IPC.awsRefresh, () => manager.refresh())
  core.handle(IPC.awsSsoLogin, (name: string, mode?: 'pkce' | 'device-code') => manager.ssoLogin(name, mode))
  core.handle(IPC.awsAssumeRole, (input) => manager.assumeRole(input))
  core.handle(IPC.awsCallerIdentity, (name: string) => manager.callerIdentity(name))
  core.handle(IPC.awsPermissions, (name: string, actions: string[]) => manager.permissions(name, actions))
  core.handle(IPC.awsRegions, (name?: string) => manager.regions(name))
  core.handle(IPC.awsSetEndpoint, (region: string, endpoint: string | null) => manager.setEndpoint(region, endpoint))
  core.handle(IPC.awsClearMachineCache, () => manager.clearMachineCache())
  core.handle(IPC.awsTrustCredentialProcess, (name: string) => manager.trustCredentialProcess(name))
  return { manager }
}
