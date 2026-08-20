import type { RemoteLoginHelp } from '../../shared/types'

/**
 * What to call "Remote Login", and what its fix-it control should say, on the platform the reader
 * is actually looking at.
 *
 * "Remote Login" is macOS's name for the setting. On Windows the same capability is the OpenSSH
 * Server optional feature plus its `sshd` service, and on Linux it is the ssh service — so a
 * sentence that says "Remote Login" to a Windows reader names something their machine does not
 * have, and sends them looking for a switch that is not there under that name.
 */
export interface RemoteLoginCopy {
  /** The subject of the sentence — what is off. Rendered as-is, so it names the real thing. */
  what: string
  /** The label of the control that opens the place to turn it on. */
  button: string
}

export type HelpPlatform = 'darwin' | 'win32' | 'linux'

/**
 * Derived from the platform for COPY only. The route itself is never guessed here — it comes from
 * what the main-process handler returns (`RemoteLoginHelp`), because a control rendered from a
 * guess is how the previous version shipped a mac-only button over a handler that was a silent
 * no-op everywhere else.
 */
export function remoteLoginCopyFor(platform: HelpPlatform): RemoteLoginCopy {
  if (platform === 'win32') {
    return {
      what: 'OpenSSH Server',
      button: 'Open Windows Settings'
    }
  }
  if (platform === 'linux') {
    return {
      what: 'The ssh service',
      button: 'Open settings'
    }
  }
  return {
    what: 'Remote Login',
    button: 'Open System Settings'
  }
}

/**
 * Should the surface offer a BUTTON, or print a command?
 *
 * A button is right only when the handler actually opened something. `opened: 'none'` means this
 * platform has no settings surface worth opening — Linux has no URL that is right across desktops
 * — and the honest answer there is the command itself, selectable, rather than a control that
 * opens the wrong thing or nothing at all.
 *
 * A result we do not have yet (the handler has not answered) still offers the button: pressing it
 * is what asks the question, and refusing to render it would strand the reader exactly as the old
 * mac-only gate did.
 */
export function showsCommandInstead(help: RemoteLoginHelp | null): boolean {
  return help?.opened === 'none' && typeof help.command === 'string' && help.command.length > 0
}

/** Narrow `navigator.platform`/UA to the three cases the copy distinguishes. */
export function detectHelpPlatform(nav: { platform?: string; userAgent?: string }): HelpPlatform {
  const probe = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`
  if (/Mac/i.test(probe)) return 'darwin'
  if (/Win/i.test(probe)) return 'win32'
  return 'linux'
}
