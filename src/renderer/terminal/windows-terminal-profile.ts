import type { SessionSource } from '../session/session'

export interface WindowsTerminalProfileSpawnContext {
  /** The renderer is running on Windows. Kept injectable so every exclusion is unit-testable. */
  windows: boolean
  /** The optional desktop-only profile bridge exists. Server Edition deliberately omits it. */
  desktopProfilesAvailable: boolean
  /** Relay/server sessions must resolve their own program on their own core. */
  source: SessionSource
  /** A legacy node-selected executable always keeps its existing behavior. */
  shell?: string
  /** Both local `ssh` terminals and SSH-project terminals are outside local profile selection. */
  ssh: boolean
  /** Machine-local profile snapshotted on this node, when one was explicitly chosen. */
  terminalProfileId?: string
  /** Current machine default, used only for legacy nodes with no snapshot. */
  defaultTerminalProfileId?: string
}

/**
 * Select the trusted Windows profile id that may cross the renderer → core PTY boundary.
 *
 * The executable and argv never live here. This helper only decides whether the optional stable
 * id belongs on a create request; the trusted core resolves it immediately before spawning. A
 * malformed id is intentionally forwarded rather than replaced with the default so core
 * validation fails closed and the node can surface the real reason.
 */
export function windowsTerminalProfileId({
  windows,
  desktopProfilesAvailable,
  source,
  shell,
  ssh,
  terminalProfileId,
  defaultTerminalProfileId
}: WindowsTerminalProfileSpawnContext): string | undefined {
  if (!windows || !desktopProfilesAvailable || source !== 'local' || ssh) return undefined
  // Presence, not truthiness: even a hand-edited empty legacy value belongs to the old executable
  // path and must not silently turn into a different profile.
  if (shell !== undefined) return undefined

  // An explicit per-node choice always wins.
  if (terminalProfileId !== undefined) return terminalProfileId

  // A machine default that is still the SHIPPED default is not a choice anybody made, and must
  // not be read as one. Returning it here put every ordinary Windows terminal — including a
  // freshly created node nobody had configured — through profile resolution and the new session
  // host, instead of the direct spawn that had always served them. Typing then reached nothing:
  // the client's `write()` is fire-and-forget and swallows a failed delivery, so a broken round
  // trip looks exactly like a terminal that renders a cursor and ignores the keyboard.
  //
  // So the default only travels once the user has actually moved it off 'auto'. That keeps the
  // profile path fully live for anyone who opts in, and keeps the untouched majority on the path
  // that was already working.
  if (defaultTerminalProfileId !== undefined && defaultTerminalProfileId !== 'auto') {
    return defaultTerminalProfileId
  }
  return undefined
}

/** Stable fallback labels for the node header; detection details stay private to the core. */
export function windowsTerminalProfileLabel(
  profileId: string | undefined,
  fallbacks: Partial<{ automatic: string; custom: string; unknown: string }> = {}
): string | null {
  if (profileId === undefined) return null
  switch (profileId) {
    case 'auto':
      return fallbacks.automatic ?? 'Automatic'
    case 'pwsh':
      return 'PowerShell 7'
    case 'windows-powershell':
      return 'Windows PowerShell'
    case 'cmd':
      return 'Command Prompt'
    case 'git-bash':
      return 'Git Bash'
    case 'custom':
      return fallbacks.custom ?? 'Custom shell'
  }

  const match = /^wsl:([^\u0000-\u001f\u007f]{1,128})$/u.exec(profileId)
  return match ? `WSL — ${match[1]}` : fallbacks.unknown ?? 'Unknown profile'
}
