import type { RemoteLoginHelp } from '../../shared/types'

/**
 * What to call "Remote Login", and what its fix-it control should say, on the platform the reader
 * is actually looking at.
 *
 * On Windows the capability is the OpenSSH Server optional feature plus its `sshd` service. On
 * Linux it is the ssh service.
 */
export interface RemoteLoginCopy {
  /** The subject of the sentence — what is off. Rendered as-is, so it names the real thing. */
  what: string
  /** The label of the control that opens the place to turn it on. */
  button: string
}

export type HelpPlatform = 'win32' | 'linux'

/**
 * Derived from the platform for COPY only. The route itself is never guessed here — it comes from
 * what the main-process handler returns (`RemoteLoginHelp`), because a control rendered from a
 * guess is how a previous version shipped a button over a handler that was a silent
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
  return { what: 'The ssh service', button: 'Open settings' }
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
 * the desktop capability gate did.
 */
export function showsCommandInstead(help: RemoteLoginHelp | null): boolean {
  return help?.opened === 'none' && typeof help.command === 'string' && help.command.length > 0
}

/** Narrow `navigator.platform` and the user agent to the two supported copy cases. */
export function detectHelpPlatform(nav: { platform?: string; userAgent?: string }): HelpPlatform {
  const probe = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`
  if (/Win/i.test(probe)) return 'win32'
  return 'linux'
}
