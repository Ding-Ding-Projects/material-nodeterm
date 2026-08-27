import { IPC } from '../../shared/ipc'
import type { CorePlatform } from '../platform'
import type { VirtualMachineToolStatus } from '../../shared/virtual-machine'
import { VirtualMachineManager } from './manager'

/** Registers the Linux ISO VM lifecycle on both desktop and Server Edition shells. */
export function registerVirtualMachineIpc(platform: CorePlatform): { manager: VirtualMachineManager } {
  const manager = new VirtualMachineManager(platform)
  platform.handle(IPC.virtualMachineTools, (): Promise<VirtualMachineToolStatus> => manager.tools())
  platform.handle(IPC.virtualMachineStatus, (id: string) => manager.status(id))
  platform.handle(IPC.virtualMachineConfigure, (id: string, config: unknown, local: unknown) => manager.configure(id, config as never, local as never))
  platform.handle(IPC.virtualMachineCreateDisk, (id: string, folder: string) => manager.createDisk(id, folder))
  platform.handle(IPC.virtualMachineStart, (id: string) => manager.start(id))
  platform.handle(IPC.virtualMachineStop, (id: string) => manager.stop(id))
  platform.handle(IPC.virtualMachineSnapshot, (id: string, name: string) => manager.snapshot(id, name))
  platform.handle(IPC.virtualMachineRestore, (id: string, name: string) => manager.restore(id, name))
  platform.handle(IPC.virtualMachineOpenDisplay, (id: string) => manager.openDisplay(id))
  platform.handle(IPC.virtualMachineReset, (id: string) => manager.reset(id))
  manager.onEvent((event) => platform.broadcast(IPC.virtualMachineEvent, event))
  return { manager }
}

