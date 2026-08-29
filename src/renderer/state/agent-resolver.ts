/** Renderer registration for custom-agent harness inheritance. */
import { setCustomAgentBaseResolver } from '@shared/agents/config'
import { useSettings } from './settings'

export function initAgentResolver(): void {
  setCustomAgentBaseResolver((id) =>
    useSettings.getState().settings.customAgents.find((agent) => agent.id === id)?.baseAgent
  )
}
