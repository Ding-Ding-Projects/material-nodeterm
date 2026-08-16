// Every production agent launch obtains a branded launch plan from the live permission funnel.
//
// This exercises the decision that command builders actually consume. The closed surface inventory
// makes a new launch path a test case by construction, and the command assertions discriminate the
// raw permissive value from Kids mode's manual result in each agent's own CLI dialect.

import { beforeEach, describe, expect, it } from 'vitest'

import type { AgentPermissionMode } from '@shared/agents/config'
import {
  AGENT_LAUNCH_SURFACES,
  activeAgentLaunchPlan,
  commandForAgentLaunch
} from './permissionMode'
import { useKidsMode } from './kidsMode'
import { useProjects } from './projects'
import { useSettings } from './settings'

type PermissionCapableAgent = 'claude' | 'grok' | 'gemini' | 'codex'

const AGENT_COMMANDS = {
  claude: { base: 'claude', manual: 'claude' },
  grok: { base: 'grok', manual: 'grok' },
  gemini: { base: 'gemini', manual: 'gemini' },
  codex: { base: 'codex', manual: 'codex --ask-for-approval untrusted' }
} as const satisfies Record<PermissionCapableAgent, { base: string; manual: string }>

function setMode(mode: AgentPermissionMode): void {
  useSettings.setState((state) => ({
    settings: { ...state.settings, claudePermissionMode: mode },
    base: { ...state.base, claudePermissionMode: mode }
  }))
}

beforeEach(() => {
  useKidsMode.setState({ enabled: false })
  // No active project: the global setting is the input under test. Project overrides are covered
  // by the resolver's focused tests and flow through this same launch-plan decision.
  useProjects.setState({ activeProjectId: '' } as never)
})

describe('the branded launch-plan funnel', () => {
  for (const rawMode of ['bypassPermissions', 'acceptEdits'] as const) {
    it(`narrows ${rawMode} to manual CLI arguments on every launch surface`, () => {
      setMode(rawMode)
      useKidsMode.setState({ enabled: true })

      for (const surface of AGENT_LAUNCH_SURFACES) {
        for (const [agentId, commands] of Object.entries(AGENT_COMMANDS) as Array<
          [PermissionCapableAgent, { base: string; manual: string }]
        >) {
          const plan = activeAgentLaunchPlan(surface, agentId)
          expect(plan, `${surface}/${agentId} must carry the gated decision`).toMatchObject({
            surface,
            agentId,
            mode: 'manual'
          })
          expect(
            commandForAgentLaunch(commands.base, plan),
            `${surface}/${agentId} must emit that agent's manual arguments`
          ).toBe(commands.manual)
        }
      }
    })
  }

  it('has a discriminating fixture: the same surfaces emit the permissive arguments without Kids', () => {
    const expectedByMode = {
      bypassPermissions: {
        claude: 'claude --permission-mode bypassPermissions',
        grok: 'grok --permission-mode bypassPermissions',
        gemini: 'gemini --approval-mode yolo',
        codex: 'codex --ask-for-approval never'
      },
      acceptEdits: {
        claude: 'claude --permission-mode acceptEdits',
        grok: 'grok --permission-mode acceptEdits',
        gemini: 'gemini --approval-mode auto_edit',
        codex: 'codex'
      }
    } as const

    for (const rawMode of ['bypassPermissions', 'acceptEdits'] as const) {
      setMode(rawMode)
      for (const surface of AGENT_LAUNCH_SURFACES) {
        for (const [agentId, commands] of Object.entries(AGENT_COMMANDS) as Array<
          [keyof typeof AGENT_COMMANDS, { base: string }]
        >) {
          const plan = activeAgentLaunchPlan(surface, agentId)
          expect(plan.mode, `${surface}/${agentId}`).toBe(rawMode)
          expect(commandForAgentLaunch(commands.base, plan), `${surface}/${agentId}`).toBe(
            expectedByMode[rawMode][agentId]
          )
        }
      }
    }
  })

  it('freezes the proof so a caller cannot replace the resolved mode after launch planning', () => {
    setMode('bypassPermissions')
    useKidsMode.setState({ enabled: true })
    const plan = activeAgentLaunchPlan('canvas-new-agent', 'claude')

    expect(Object.isFrozen(plan)).toBe(true)
    expect(() => Object.assign(plan, { mode: 'bypassPermissions' })).toThrow()
    expect(commandForAgentLaunch('claude', plan)).toBe('claude')
  })
})
