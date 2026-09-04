// Pure helpers behind the "tmux not found" banner. A Linux host can install tmux through its
// package manager. A Windows host uses psmux when WinGet is available.
import { execCandidates } from './exec-path'

import { execCandidates } from './exec-path'

export interface TmuxInstallHint {
  command: string
  /** Button caption that tells the user exactly which tool will be installed. */
  label: string
}

/** Suggested one-shot install for a supported host, or null when no verified route exists. */
export function tmuxInstall(
  platform: NodeJS.Platform | string,
  hasCommand: (cmd: string) => boolean
): TmuxInstallHint | null {
  if (platform === 'linux') {
    const command = hasCommand('apt-get')
      ? 'sudo apt-get update && sudo apt-get install -y tmux'
      : hasCommand('dnf')
        ? 'sudo dnf install -y tmux'
        : hasCommand('yum')
          ? 'sudo yum install -y tmux'
          : hasCommand('pacman')
            ? 'sudo pacman -S --needed tmux'
            : hasCommand('zypper')
              ? 'sudo zypper install -y tmux'
              : hasCommand('apk')
                ? 'sudo apk add tmux'
                : null
    return command ? { command, label: 'Install tmux' } : null
  }
  if (platform === 'win32') {
    // psmux supplies the tmux command surface on Windows. Keep the install action pinned to the
    // exact WinGet id and source. Agreement flags make the terminal action non-interactive, so a
    // psmux install cannot sit forever behind a hidden prompt in the newly-created node.
    if (hasCommand('winget')) {
      return {
        command:
          'winget install --exact --id marlocarlo.psmux --source winget --accept-source-agreements --accept-package-agreements --silent',
        label: 'Install psmux'
      }
    }
  }

  return null
}

/** Extra executable directories a Linux GUI process may not inherit through PATH. */
const COMMON_BIN_DIRS = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

/**
 * Absolute Linux tmux locations walked by `findFixedTmux`. The list stays subprocess-free because
 * spawning a login shell on the main thread previously cost hundreds of milliseconds per lookup.
 */
export function tmuxCandidatePaths(home?: string | null, user?: string | null): string[] {
  const paths = [
    '/usr/bin/tmux',
    '/bin/tmux',
    '/run/current-system/sw/bin/tmux',
    '/home/linuxbrew/.linuxbrew/bin/tmux'
  ]
  if (home) paths.push(`${home}/.nix-profile/bin/tmux`)
  const name = user || (home ? home.slice(home.lastIndexOf('/') + 1) : '')
  if (name) paths.push(`/etc/profiles/per-user/${name}/bin/tmux`)
  return paths
}

/** First candidate that exists. One unreadable directory never hides a later valid binary. */
export function findFixedTmux(
  exists: (path: string) => boolean,
  home?: string | null,
  user?: string | null
): string | null {
  for (const candidate of tmuxCandidatePaths(home, user)) {
    try {
      if (exists(candidate)) return candidate
    } catch {
      // Keep looking after an unreadable candidate.
    }
  }
  return null
}

/** Is `name` on PATH or in the fixed Linux fallback directories? */
export function findCommand(
  name: string,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
  platform: NodeJS.Platform | string = process.platform
): boolean {
  const windows = platform === 'win32'
  const dirs = [
    ...(env.PATH ? env.PATH.split(windows ? ';' : ':') : []),
    ...(windows ? [] : COMMON_BIN_DIRS)
  ]
  const names = execCandidates(name, platform, env.PATHEXT)
  const separator = windows ? '\\' : '/'
  return dirs.some((directory) =>
    Boolean(directory) && names.some((candidate) => exists(`${directory}${separator}${candidate}`))
  )
}
