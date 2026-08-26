// Installed-distribution enumeration: `wsl --list --verbose`, cross-referenced against the
// ownership ledger so a caller can tell nodeterm's own distributions from a user's pre-existing
// ones (docker-desktop, a personal Ubuntu, whatever else is already on the machine) without ever
// guessing from the name.

import type { WslRuntime } from './runtime'
import { parseWslVerboseList, type WslDistribution } from './list'
import type { WslOwnershipStore } from './ownership'
import { detectWsl } from './install'

export interface WslInstalledDistribution extends WslDistribution {
  /** True only when the ownership ledger has a valid record for this exact name. A distribution
   *  this app did not create is `owned: false` even if its name looks like something nodeterm
   *  would have chosen; ownership is never inferred from a name. */
  owned: boolean
}

/**
 * `ok:false` is not the same fact as "no distributions are installed". A failed read (wsl.exe
 * missing, the command errored, output that could not be parsed) must never be reported as an
 * empty, healthy list, exactly as this codebase already requires of every other "read the machine
 * state" surface (see the root CLAUDE.md "Session memory" section: `ok:false` is not `ok:true`
 * with no rows).
 */
export type WslEnumerationResult =
  | { ok: true; installed: WslInstalledDistribution[] }
  | { ok: false; error: string; wslInstalled: boolean }

export async function listInstalledWslDistributions(
  runtime: WslRuntime,
  ownership: WslOwnershipStore
): Promise<WslEnumerationResult> {
  const availability = await detectWsl(runtime)
  if (!availability.installed) {
    return {
      ok: false,
      error: 'WSL is not installed on this machine, so no distributions can be listed.',
      wslInstalled: false
    }
  }

  const result = await runtime.execFile(availability.wslExePath, ['--list', '--verbose'])
  if (result.error || result.exitCode !== 0) {
    return {
      ok: false,
      error: 'wsl.exe --list --verbose failed to run, so distributions could not be listed.',
      wslInstalled: true
    }
  }

  let parsed: WslDistribution[]
  try {
    parsed = parseWslVerboseList(result.stdout)
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `wsl.exe returned distribution data that could not be parsed: ${error.message}`
          : 'wsl.exe returned distribution data that could not be parsed.',
      wslInstalled: true
    }
  }

  const installed: WslInstalledDistribution[] = []
  for (const distribution of parsed) {
    installed.push({ ...distribution, owned: await ownership.isOwned(distribution.name) })
  }
  return { ok: true, installed }
}

/** True when `name` (case-insensitive) already appears in `installed`, whoever owns it. Used by
 *  create's collision check, which must refuse a name clash against every existing distribution
 *  on the machine, not only nodeterm's own ones. */
export function wslNameCollides(installed: readonly { name: string }[], name: string): boolean {
  const folded = name.toLocaleLowerCase('en-US')
  return installed.some((d) => d.name.toLocaleLowerCase('en-US') === folded)
}
