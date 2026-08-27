import type { NamedTerminalProfile } from '@shared/types'

export const NAMED_TERMINAL_PROFILE_ID_PREFIX = 'named:'
export const NAMED_TERMINAL_PROFILE_NAME_MAX = 120
export const NAMED_TERMINAL_PROFILE_CWD_MAX = 4096
export const NAMED_TERMINAL_PROFILE_COMMAND_MAX = 8192

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u

export interface NamedTerminalProfileDraft {
  name: string
  cwd: string
  startupCommand: string
}

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  if (!result || result.length > max || CONTROL_CHARS.test(result)) return undefined
  return result
}

export function isNamedTerminalProfileId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(NAMED_TERMINAL_PROFILE_ID_PREFIX) &&
    value.length > NAMED_TERMINAL_PROFILE_ID_PREFIX.length &&
    value.length <= 160 &&
    !CONTROL_CHARS.test(value)
  )
}

/** Keep hand-edited settings fail-closed and bounded before they reach a creation surface. */
export function normalizeNamedTerminalProfiles(value: unknown): NamedTerminalProfile[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: NamedTerminalProfile[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    const id = isNamedTerminalProfileId(record.id) ? record.id : undefined
    const name = clean(record.name, NAMED_TERMINAL_PROFILE_NAME_MAX)
    const cwd = clean(record.cwd, NAMED_TERMINAL_PROFILE_CWD_MAX)
    const startupCommand =
      typeof record.startupCommand === 'string' &&
      record.startupCommand.length <= NAMED_TERMINAL_PROFILE_COMMAND_MAX &&
      !CONTROL_CHARS.test(record.startupCommand)
        ? record.startupCommand
        : undefined
    if (!id || !name || !cwd || startupCommand === undefined || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name, cwd, startupCommand })
  }
  return result
}

export function createNamedTerminalProfile(draft: NamedTerminalProfileDraft): NamedTerminalProfile | null {
  const name = clean(draft.name, NAMED_TERMINAL_PROFILE_NAME_MAX)
  const cwd = clean(draft.cwd, NAMED_TERMINAL_PROFILE_CWD_MAX)
  const startupCommand = draft.startupCommand.trim()
  if (
    !name ||
    !cwd ||
    startupCommand.length > NAMED_TERMINAL_PROFILE_COMMAND_MAX ||
    CONTROL_CHARS.test(startupCommand)
  ) {
    return null
  }
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: `${NAMED_TERMINAL_PROFILE_ID_PREFIX}${uuid}`,
    name,
    cwd,
    startupCommand
  }
}

export function namedTerminalProfileForId(
  id: string | null | undefined,
  profiles: readonly NamedTerminalProfile[]
): NamedTerminalProfile | undefined {
  if (!isNamedTerminalProfileId(id)) return undefined
  return profiles.find((profile) => profile.id === id)
}

export function namedTerminalProfileLabel(
  id: string | null | undefined,
  profiles: readonly NamedTerminalProfile[],
  unavailable = 'Unavailable named profile'
): string {
  return namedTerminalProfileForId(id, profiles)?.name ?? unavailable
}
