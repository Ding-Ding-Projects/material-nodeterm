import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import { DockerHostManager, type DockerCredentialVault } from './manager'
import type { DockerHostApi } from '../../shared/docker-host'

export interface RegisterDockerHostIpcDeps {
  credentialVault?: DockerCredentialVault
  manager?: DockerHostManager
}

/** Register the typed Docker host control plane on either shell's CorePlatform. */
export function registerDockerHostIpc(platform: CorePlatform, deps: RegisterDockerHostIpcDeps = {}): { manager: DockerHostManager } {
  const manager = deps.manager ?? new DockerHostManager({ userDataDir: platform.userDataDir, credentialVault: deps.credentialVault })
  platform.handle(IPC.dockerHostList, () => manager.listHosts())
  platform.handle(IPC.dockerHostSave, (input: Parameters<DockerHostApi['saveHost']>[0]) => manager.saveHost(input))
  platform.handle(IPC.dockerHostRemove, (id: string, confirmed?: boolean) => manager.removeHost(id, confirmed))
  platform.handle(IPC.dockerHostVerify, (id: string) => manager.verify(id))
  platform.handle(IPC.dockerHostContexts, (id: string) => manager.listContexts(id))
  platform.handle(IPC.dockerHostInventory, (id: string) => manager.inventory(id))
  platform.handle(IPC.dockerHostContainers, (id: string) => manager.listContainers(id))
  platform.handle(IPC.dockerHostImages, (id: string) => manager.listImages(id))
  platform.handle(IPC.dockerHostVolumes, (id: string) => manager.listVolumes(id))
  platform.handle(IPC.dockerHostNetworks, (id: string) => manager.listNetworks(id))
  platform.handle(IPC.dockerHostComposeList, (id: string, profile) => manager.listCompose(id, profile))
  platform.handle(IPC.dockerHostContainerStart, (id: string, containerId: string) => manager.startContainer(id, containerId))
  platform.handle(IPC.dockerHostContainerStop, (id: string, containerId: string, timeout?: number) => manager.stopContainer(id, containerId, timeout))
  platform.handle(IPC.dockerHostContainerRestart, (id: string, containerId: string, timeout?: number) => manager.restartContainer(id, containerId, timeout))
  platform.handle(IPC.dockerHostContainerPause, (id: string, containerId: string) => manager.pauseContainer(id, containerId))
  platform.handle(IPC.dockerHostContainerUnpause, (id: string, containerId: string) => manager.unpauseContainer(id, containerId))
  platform.handle(IPC.dockerHostStats, (id: string, containerIds?: string[]) => manager.stats(id, containerIds))
  platform.handle(IPC.dockerHostLogs, (id: string, options) => manager.logs(id, options))
  platform.handle(IPC.dockerHostExec, (id: string, request) => manager.exec(id, request))
  platform.handle(IPC.dockerHostPreviewDestructive, (input) => manager.previewDestructive(input))
  platform.handle(IPC.dockerHostRemoveContainers, (id: string, ids: string[], confirmed: boolean) => manager.removeContainers(id, ids, confirmed))
  platform.handle(IPC.dockerHostRemoveImages, (id: string, ids: string[], confirmed: boolean) => manager.removeImages(id, ids, confirmed))
  platform.handle(IPC.dockerHostRemoveVolumes, (id: string, ids: string[], confirmed: boolean) => manager.removeVolumes(id, ids, confirmed))
  platform.handle(IPC.dockerHostRemoveNetworks, (id: string, ids: string[], confirmed: boolean) => manager.removeNetworks(id, ids, confirmed))
  platform.handle(IPC.dockerHostComposeUp, (id: string, profile, services?: string[]) => manager.composeUp(id, profile, services))
  platform.handle(IPC.dockerHostComposeDown, (id: string, profile, confirmed: boolean) => manager.composeDown(id, profile, confirmed))
  return { manager }
}
