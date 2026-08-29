import type { SshConnection } from '@shared/ssh'
import type { AgentLaunchIntent } from '@shared/types'
import type { ModalSpawn } from './ModalTerminal'

/** Execution fields a kanban card's second terminal view needs to co-attach to the same node. */
export interface ModalSpawnNodeData {
  shell?: string
  terminalProfileId?: string
  respawnNonce?: number
  cwd?: string
  agentId?: string
  agentLaunchIntent?: AgentLaunchIntent
  agentSessionId?: string
  accountId?: string
  ssh?: SshConnection
  sshRemoteTmux?: boolean
}

/** Pure mapping kept outside Canvas so profile persistence into the modal is behavior-tested. */
export function modalSpawnFromNodeData(data: ModalSpawnNodeData): ModalSpawn {
  return {
    shell: data.shell,
    terminalProfileId: data.terminalProfileId,
    respawnNonce: data.respawnNonce,
    cwd: data.cwd,
    agentId: data.agentId,
    agentLaunchIntent: data.agentLaunchIntent,
    agentSessionId: data.agentSessionId,
    accountId: data.accountId,
    ssh: data.ssh,
    sshRemoteTmux: !!data.sshRemoteTmux
  }
}
