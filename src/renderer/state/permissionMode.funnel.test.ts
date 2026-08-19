// Every production agent launch obtains a branded launch plan from the live permission funnel.
//
// This exercises the decision that command builders actually consume. The closed surface inventory
// makes a new launch path a test case by construction, and the command assertions discriminate the
// raw permissive value from Kids mode's manual result in each agent's own CLI dialect.

import { beforeEach, describe, expect, it } from 'vitest'
// Source-level coverage also ensures no renderer launch path reads around the funnel.
// This is the assumption the whole kids-mode permission gate rests on. The gate lives inside that
// one function, so a launch site that reads `settings.claudePermissionMode` directly — or a
// project's `defaultPermissionMode` — would build its command from the ungated value and silently
// bypass the mode entirely. Nothing else would notice: the resolver's own tests would still pass,
// because the resolver is still correct; it just would not be the thing being asked.
//
// A source-level check, deliberately. The alternative is rendering Canvas (~9,500 lines, very
// large mount surface) once per launch site, which costs far more than it proves — and would
// still only cover the sites a test author thought to exercise, whereas this covers every one
// that exists.
//
// This is NOT control-flow analysis. A raw read in dead code is still refused (fail closed), while
// a resolver call hidden in dead code could still contribute to the Canvas call-count floor. The
// behavioral tests in permissionMode.kids.test.ts prove that the resolver itself narrows a live
// bypass/accept-edits setting; this scan's narrower promise is that no source file can read around
// that resolver without appearing as a new, reviewable exception.

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const RENDERER = join(__dirname, '..')

/** Every .ts/.tsx under src/renderer, excluding tests and this file's own subject. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules') sources(p, out)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

const FILES = sources(RENDERER)

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

/**
 * Files allowed to mention the raw setting, with the reason each is not a launch.
 *
 * Keys are renderer-relative POSIX paths even on Windows. Keeping one canonical spelling makes
 * the comparison portable; exact membership prevents `nested/components/ProjectSwitcher.tsx` from
 * inheriting ProjectSwitcher's exception merely because its path has the same suffix.
 */
const ALLOWED = new Map<string, string>([
  // Settings UI: edits the value rather than launching anything with it.
  ['components/settings/sections/AgentsSection.tsx', 'the settings control that edits the value'],
  // The project switcher's per-project actions panel shows the current global default beside the
  // per-project override (formerly TabBar.tsx's tab caret menu — same duty, new file).
  [
    'components/ProjectSwitcher.tsx',
    'displays the global default in the override menu; launches nothing'
  ]
])

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function rendererRelativePath(file: string): string {
  return normalizeRelativePath(relative(RENDERER, file))
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readsRawPermissionMode(source: string): boolean {
  return /\bclaudePermissionMode\b/.test(withoutComments(source))
}

function isAllowedRawConsumer(path: string): boolean {
  return ALLOWED.has(normalizeRelativePath(path))
}

function rawConsumers(files: string[]): string[] {
  return files
    .filter((file) => readsRawPermissionMode(readFileSync(file, 'utf8')))
    .map(rendererRelativePath)
}

describe('every launch resolves its permission mode through the one funnel', () => {
  it('no file outside the allow-list reads settings.claudePermissionMode', () => {
    const offenders = rawConsumers(FILES).filter((path) => !isAllowedRawConsumer(path))
    expect(
      offenders,
      'these read the raw setting instead of activePermissionMode(), which bypasses the kids-mode gate'
    ).toEqual([])
  })

  it('keeps every allow-list entry live and justified', () => {
    const consumers = new Set(rawConsumers(FILES))
    expect(
      [...ALLOWED.keys()].filter((path) => !consumers.has(path)),
      'a stale exception can silently excuse a future unrelated file at that path'
    ).toEqual([])
  })

  it('normalizes slash dialects but does not suffix-match a lookalike path', () => {
    expect(isAllowedRawConsumer('components/ProjectSwitcher.tsx')).toBe(true)
    expect(isAllowedRawConsumer('components\\ProjectSwitcher.tsx')).toBe(true)
    expect(isAllowedRawConsumer('nested/components/ProjectSwitcher.tsx')).toBe(false)
    expect(isAllowedRawConsumer('components/ProjectSwitcher.tsx.backup')).toBe(false)
  })

  it('ignores comments but fails closed on a raw read even in obvious dead code', () => {
    expect(readsRawPermissionMode('// settings.claudePermissionMode')).toBe(false)
    expect(readsRawPermissionMode('/* settings.claudePermissionMode */')).toBe(false)
    expect(
      readsRawPermissionMode(
        'const endpoint = "https://example.invalid" // settings.claudePermissionMode'
      )
    ).toBe(false)
    expect(readsRawPermissionMode('if (false) settings.claudePermissionMode')).toBe(true)
  })

  it('the resolver is the only place the kids gate is applied, and it IS applied', () => {
    const resolver = withoutComments(
      readFileSync(join(RENDERER, 'state', 'permissionMode.ts'), 'utf8')
    )
    expect(resolver).toMatch(/gateKidsPermissionMode\(/)
    // Last, so it can only narrow what the earlier gates produced — never re-widen.
    const body = /export function activePermissionMode[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    expect(body, 'the kids gate must be on the RETURNED value').toMatch(
      /return gateKidsPermissionMode\(/
    )
  })

  it('Canvas builds agent commands from the resolver, at every site', () => {
    const canvas = withoutComments(readFileSync(join(RENDERER, 'canvas', 'Canvas.tsx'), 'utf8'))
    // A launch site may obtain the decision either directly (`activePermissionMode`) or through
    // the branded launch-plan funnel (`activeAgentLaunchPlan` / `ensureActiveAgentLaunchPlan`) —
    // command builders and `createAgentNode` consume that proof rather than a raw mode. Counting
    // only the direct form went stale the moment most call sites moved to the branded plan.
    const calls = (
      canvas.match(/\b(?:activePermissionMode|activeAgentLaunchPlan|ensureActiveAgentLaunchPlan)\(/g) ||
      []
    ).length
    // Ten at the time of writing. A floor rather than an exact count: adding a launch site is
    // normal, removing them all silently is what this guards.
    expect(calls, 'Canvas should resolve the mode at each launch site').toBeGreaterThanOrEqual(5)
    // And every withPermissionMode call must take a resolved mode, never a literal.
    const literalMode =
      /withPermissionMode\([^)]*,\s*'(bypassPermissions|acceptEdits|auto|plan|manual)'\s*\)/.exec(
        canvas
      )
    expect(literalMode?.[0], 'a hardcoded mode would skip both gates').toBeUndefined()
  })
})
