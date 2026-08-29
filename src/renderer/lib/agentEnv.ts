/** Boot-time environment snapshot used for custom-agent preview and command assembly. */
let cached: Record<string, string> = {}
let ready = false

export function agentEnvSnapshot(): Record<string, string> {
  return cached
}

export async function refreshAgentEnv(): Promise<void> {
  try {
    cached = await window.nodeTerminal.agent.envSnapshot()
  } catch {
    cached = {}
  }
  ready = true
}

export function agentEnvReady(): boolean {
  return ready
}

export function setAgentEnvForTests(env: Record<string, string>): void {
  cached = env
  ready = true
}
