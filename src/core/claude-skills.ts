import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { accountConfigDir } from './claude-accounts-core'
import { platform } from './platform'
import {
  NODETERM_CLAUDE_SKILLS,
  type ClaudeSkillEntry,
  type ClaudeSkillScope,
  type ClaudeSkillScopeKind,
  type ClaudeSkillsResult
} from '../shared/claude-skills'

export type { ClaudeSkillScope } from '../shared/claude-skills'

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

interface LocalScopeInput {
  id: string
  kind: Extract<ClaudeSkillScopeKind, 'local-system' | 'local-account'>
  label: string
  location: string
  configDir: string
}

function reasonOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    return 'Claude config directory is not present on this computer.'
  }
  return 'Claude config directory could not be read on this computer.'
}

function unavailableEntries(): ClaudeSkillEntry[] {
  return NODETERM_CLAUDE_SKILLS.map((name) => ({
    name,
    state: 'unavailable' as const,
    reason: 'The Claude config scope is unavailable.'
  }))
}

/** Discover one config directory without reading provider-authored skill content. */
export async function discoverClaudeSkillScope(input: LocalScopeInput): Promise<ClaudeSkillScope> {
  try {
    const configStat = await fs.stat(input.configDir)
    if (!configStat.isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
  } catch (error) {
    return {
      id: input.id,
      kind: input.kind,
      label: input.label,
      location: input.location,
      state: 'unavailable',
      reason: reasonOf(error),
      skills: unavailableEntries()
    }
  }

  const skillsDir = path.join(input.configDir, 'skills')
  try {
    const stats = await fs.stat(skillsDir)
    if (!stats.isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
  } catch (error) {
    const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
    return {
      id: input.id,
      kind: input.kind,
      label: input.label,
      location: input.location,
      state: missing ? 'missing' : 'unavailable',
      reason: missing
        ? 'No Claude skills directory is present in this config scope.'
        : 'Claude skills directory could not be read in this config scope.',
      skills: NODETERM_CLAUDE_SKILLS.map((name) => ({
        name,
        state: missing ? ('missing' as const) : ('unavailable' as const),
        reason: missing
          ? 'This skill has not been installed in this config scope.'
          : 'The skills directory is unavailable.'
      }))
    }
  }

  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true })
  } catch {
    return {
      id: input.id,
      kind: input.kind,
      label: input.label,
      location: input.location,
      state: 'unavailable',
      reason: 'Claude skills directory could not be enumerated.',
      skills: unavailableEntries()
    }
  }

  const skills = new Map<string, ClaudeSkillEntry>(
    NODETERM_CLAUDE_SKILLS.map((name) => [name, {
      name,
      state: 'missing',
      reason: 'This skill has not been installed in this config scope.'
    }])
  )
  for (const entry of entries) {
    if (!entry.isDirectory() || !SKILL_NAME.test(entry.name)) continue
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')
    try {
      const stat = await fs.stat(skillFile)
      if (!stat.isFile()) continue
      skills.set(entry.name, { name: entry.name, state: 'available' })
    } catch {
      skills.set(entry.name, {
        name: entry.name,
        state: 'unavailable',
        reason: 'The skill folder exists, but its SKILL.md could not be read.'
      })
    }
  }

  const values = [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
  const state = values.some((skill) => skill.state === 'available')
    ? 'available'
    : values.some((skill) => skill.state === 'unavailable')
      ? 'unavailable'
      : 'missing'
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    location: input.location,
    state,
    reason:
      state === 'missing'
        ? 'This config scope has no readable Claude skills.'
        : state === 'unavailable'
          ? 'One or more Claude skills could not be read.'
          : undefined,
    skills: values
  }
}

/** Discover the local system scope plus every non-pending managed account scope. */
export async function discoverLocalClaudeSkills(accountIds: readonly string[] = []): Promise<ClaudeSkillsResult> {
  const home = os.homedir()
  const userData = platform().userDataDir
  const inputs: LocalScopeInput[] = [{
    id: 'local-system',
    kind: 'local-system',
    label: 'Local Claude',
    location: '~/.claude',
    configDir: path.join(home, '.claude')
  }]
  for (const accountId of accountIds) {
    try {
      inputs.push({
        id: `local-account:${accountId}`,
        kind: 'local-account',
        label: `Local Claude account · ${accountId}`,
        location: `~/.nodeterm/claude-accounts/${accountId}`,
        configDir: accountConfigDir(userData, accountId)
      })
    } catch {
      // Hand-edited account ids are not a path. Do not echo them into diagnostics or logs.
    }
  }
  const scopes = await Promise.all(inputs.map((input) => discoverClaudeSkillScope(input)))
  return { scopes, refreshedAt: Date.now() }
}

/** Parse the line-oriented response used by the SSH scope reader. */
export function parseRemoteClaudeSkillsOutput(output: string): {
  state: ClaudeSkillScope['state']
  reason?: string
  names: string[]
} {
  const [header = '', ...lines] = output.split(/\r?\n/)
  if (header === 'MISSING') return { state: 'missing', reason: 'No Claude skills directory is present on this host.', names: [] }
  if (header !== 'OK') return { state: 'unavailable', reason: 'Claude skills could not be read on this host.', names: [] }
  const names = [...new Set(lines.filter((name) => SKILL_NAME.test(name)))].sort((a, b) => a.localeCompare(b))
  return {
    state: names.length ? 'available' : 'missing',
    reason: names.length ? undefined : 'This config scope has no readable Claude skills.',
    names
  }
}

export function remoteClaudeSkillEntries(parsed: ReturnType<typeof parseRemoteClaudeSkillsOutput>): ClaudeSkillEntry[] {
  const names = new Set(parsed.names)
  const all = new Set([...NODETERM_CLAUDE_SKILLS, ...parsed.names])
  return [...all].sort((a, b) => a.localeCompare(b)).map((name) =>
    names.has(name)
      ? { name, state: 'available' as const }
      : { name, state: parsed.state === 'unavailable' ? ('unavailable' as const) : ('missing' as const), reason: parsed.reason }
  )
}
