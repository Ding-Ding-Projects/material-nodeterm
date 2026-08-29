/**
 * The read-only Claude skill catalogue shared by the desktop and Server Edition shells.
 *
 * The catalogue deliberately carries metadata only. A skill's SKILL.md is provider-authored
 * input and may contain credentials, paths, prompts, or other private material, so the discovery
 * boundary never reads or returns its contents. The UI can tell a user exactly which config scope
 * contains a skill without turning the skill browser into a secret viewer.
 */

export type ClaudeSkillScopeKind =
  | 'local-system'
  | 'local-account'
  | 'remote-system'
  | 'remote-account'

export type ClaudeSkillState = 'available' | 'missing' | 'unavailable'

export interface ClaudeSkillEntry {
  /** Stable scope-local folder name. This is not a path and is safe to render or search. */
  name: string
  state: ClaudeSkillState
  /** A short diagnosis, never the contents of SKILL.md or a credential-bearing path. */
  reason?: string
}

export interface ClaudeSkillScope {
  /** Stable in-memory id, suitable for React keys and local filtering. */
  id: string
  kind: ClaudeSkillScopeKind
  /** User-facing label, for example "Local Claude" or "Remote Claude · build host". */
  label: string
  /** A relative display location. Absolute paths stay in the trusted shell. */
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
  /** Discover all local scopes and connected remote Claude scopes. */
  list(): Promise<ClaudeSkillsResult>
}

/** Skills installed by nodeterm itself. They remain visible as explicit missing entries when a
 * config scope has not received them, rather than disappearing from the catalogue. */
export const NODETERM_CLAUDE_SKILLS = [
  'manage-nodeterm-canvas',
  'get-linked-context'
] as const

export type NodetermClaudeSkill = (typeof NODETERM_CLAUDE_SKILLS)[number]

