/**
 * Read-only Claude skill catalogue shared by the desktop and Server Edition shells.
 *
 * Discovery carries metadata only. A skill's SKILL.md is provider-authored input and may contain
 * credentials, paths, prompts, or other private material, so the catalogue never reads or returns
 * its contents.
 */
export type ClaudeSkillScopeKind =
  | 'local-system'
  | 'local-account'
  | 'remote-system'
  | 'remote-account'

export type ClaudeSkillState = 'available' | 'missing' | 'unavailable'

export interface ClaudeSkillEntry {
  name: string
  state: ClaudeSkillState
  reason?: string
}

export interface ClaudeSkillScope {
  id: string
  kind: ClaudeSkillScopeKind
  label: string
  location: string
  state: ClaudeSkillState
  reason?: string
  skills: ClaudeSkillEntry[]
}

export interface ClaudeSkillsResult {
  scopes: ClaudeSkillScope[]
  refreshedAt: number
}

export interface ClaudeSkillsApi {
  list(): Promise<ClaudeSkillsResult>
}

/** Skills installed by the product itself, retained as explicit missing entries when absent. */
export const NODETERM_CLAUDE_SKILLS = [
  'manage-nodeterm-canvas',
  'get-linked-context'
] as const

export type NodetermClaudeSkill = (typeof NODETERM_CLAUDE_SKILLS)[number]
