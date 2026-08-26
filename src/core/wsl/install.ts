// Detecting whether WSL itself is present, and the explicit, user-initiated action to install it.
//
// `wsl --install` (with no distribution argument) is Microsoft's own "set up WSL on this machine"
// command. It needs administrator rights, and on a machine that has never had the Windows
// Subsystem for Linux feature enabled it also needs a REBOOT before anything else in this package
// can do useful work. Both of those are surprising enough, and consequential enough, that this
// module never runs it implicitly: detection is read-only and side-effect-free, and the install
// action is a distinct function a caller invokes only after telling the user what it requires.

import type { WslRuntime } from './runtime'
import { WSL_INSTALL_TIMEOUT_MS } from './runtime'

export type WslAvailability =
  | { installed: true; wslExePath: string }
  | { installed: false; reason: 'wsl-exe-not-found' }
  | { installed: false; reason: 'command-failed'; detail?: string }

/**
 * Finding `wsl.exe` is necessary but not sufficient: the executable ships inside modern Windows
 * even when the WSL feature itself has never been turned on, and calling any subcommand on that
 * unconfigured install fails. `--status` is the cheapest command that actually exercises the
 * feature rather than merely the binary's presence, so a caller that reads `installed: true` back
 * from this function can trust that `--list`/`--terminate`/etc. have a real chance of working.
 */
export async function detectWsl(runtime: WslRuntime): Promise<WslAvailability> {
  const wslExePath = await runtime.findWslExecutable()
  if (!wslExePath) return { installed: false, reason: 'wsl-exe-not-found' }

  const status = await runtime.execFile(wslExePath, ['--status'])
  if (status.error || status.exitCode !== 0) {
    return {
      installed: false,
      reason: 'command-failed',
      detail: 'wsl.exe --status did not succeed, so the WSL feature is not usable yet.'
    }
  }
  return { installed: true, wslExePath }
}

export interface WslInstallOutcome {
  ok: boolean
  /** True when the machine needs a reboot before WSL can be used, regardless of whether this
   *  specific command succeeded. Microsoft's own installer reports this rather than nodeterm
   *  guessing it, but a caller should assume it is likely true on first install. */
  requiresReboot: boolean
  error?: string
}

/**
 * Runs `wsl --install`. This is Microsoft's own feature-enablement flow: it requires
 * administrator rights (a non-elevated process will simply fail; this function does not attempt
 * to elevate itself, since that decision belongs to the shell hosting this package) and, on a
 * machine that has never had WSL enabled, ends with a required reboot before `wsl.exe` becomes
 * usable at all.
 *
 * Callers must:
 *   1. Tell the user, BEFORE calling this, that the action needs administrator rights and will
 *      likely require a reboot.
 *   2. Never call this automatically or silently, only in direct response to an explicit user
 *      action that has already seen that disclosure.
 *   3. Re-run `detectWsl` afterward rather than trusting this function's own success return: a
 *      successful install command can still leave the machine unusable until it reboots, and a
 *      failed one can still have made partial progress.
 */
export async function installWsl(runtime: WslRuntime): Promise<WslInstallOutcome> {
  const wslExePath = await runtime.findWslExecutable()
  if (!wslExePath) {
    return {
      ok: false,
      requiresReboot: false,
      error: 'wsl.exe could not be found, so WSL cannot be installed from here.'
    }
  }

  const result = await runtime.execFile(wslExePath, ['--install', '--no-launch'], {
    timeoutMs: WSL_INSTALL_TIMEOUT_MS
  })
  if (result.error || result.exitCode !== 0) {
    return {
      ok: false,
      // A failed run may still have partially enabled the Windows feature and left a reboot
      // pending. Reporting `false` here would tell a caller it is safe to skip the reboot
      // disclosure on retry, which is not a safe assumption to make from a nonzero exit alone.
      requiresReboot: true,
      error: 'wsl.exe --install did not complete successfully. A reboot may still be required.'
    }
  }
  return { ok: true, requiresReboot: true }
}
