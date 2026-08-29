// Kids mode must actually GOVERN the permission mode a session launches with.
//
// The policy had unit tests from the moment it was written, and they all passed while the policy
// was called from nowhere. That is the shape this repo names explicitly: a thoroughly tested pure
// half beside a half that is never invoked. These tests pin the live resolver that branded
// `ActiveAgentLaunchPlan`s consume; permissionMode.funnel.test.ts pins every launch surface.

import { describe, expect, it, beforeEach, vi } from 'vitest'

import { ALL_PERMISSION_MODES } from '@shared/agents/config'
import { activePermissionMode } from './permissionMode'
import { useKidsMode } from './kidsMode'
import { useSettings } from './settings'
import { useProjects } from './projects'

function setMode(mode: string): void {
  useSettings.setState((s) => ({ settings: { ...s.settings, claudePermissionMode: mode } }) as never)
}

beforeEach(() => {
  useKidsMode.setState({ enabled: false })
  // No active project, so the global setting is what resolves — the project-override path has its
  // own coverage and is not what these tests are about.
  useProjects.setState({ activeProjectId: '' } as never)
  vi.restoreAllMocks()
})

describe('kids mode governs the launch mode', () => {
  it('refuses bypassPermissions when kids mode is ON', () => {
    setMode('bypassPermissions')
    expect(activePermissionMode('claude'), 'off: the user setting stands').toBe('bypassPermissions')

    useKidsMode.setState({ enabled: true })
    expect(activePermissionMode('claude'), 'on: refused down to manual').toBe('manual')
  })

  it('refuses acceptEdits when kids mode is ON', () => {
    setMode('acceptEdits')
    useKidsMode.setState({ enabled: true })
    expect(activePermissionMode('claude')).toBe('manual')
  })

  it('leaves the allowed modes alone', () => {
    useKidsMode.setState({ enabled: true })
    for (const m of ['manual', 'plan']) {
      setMode(m)
      expect(activePermissionMode('claude'), `${m} should pass through`).toBe(m)
    }
  })

  it('applies to EVERY agent, not just claude', () => {
    // Unlike claude's CLI-version gate, this is a property of the MODE rather than of which CLI
    // implements it: "may act without asking" is the same risk whoever runs it.
    setMode('bypassPermissions')
    useKidsMode.setState({ enabled: true })
    for (const agent of ['claude', 'grok', 'gemini', 'codex'] as const) {
      expect(activePermissionMode(agent), `${agent} must be gated too`).toBe('manual')
    }
  })

  it('changes nothing at all while kids mode is off', () => {
    for (const m of ALL_PERMISSION_MODES) {
      setMode(m)
      const off = activePermissionMode('claude')
      // `auto` may be degraded by the CLI-version gate, which is a separate concern; assert only
      // that kids mode itself is not the thing narrowing anything here.
      if (m !== 'auto') expect(off, `${m} untouched`).toBe(m)
    }
  })

  it('narrows, never widens', () => {
    // The ordering guarantee: kids mode runs LAST, so it can only ever tighten what the earlier
    // gates produced. Nothing it does may turn a refused mode back into a permissive one.
    useKidsMode.setState({ enabled: true })
    const permissive = new Set(['bypassPermissions', 'acceptEdits'])
    for (const m of ALL_PERMISSION_MODES) {
      setMode(m)
      expect(permissive.has(activePermissionMode('claude')), `${m} must not resolve permissive`).toBe(false)
    }
  })
})
