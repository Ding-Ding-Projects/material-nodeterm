// The online catalog: `wsl --list --online`, which is Microsoft's own list of every distribution
// that `wsl --install -d <name>` can fetch. This machine's real answer already includes more than
// a short hand-picked shortlist (Ubuntu variants, Debian, kali-linux, openSUSE, Oracle Linux,
// SUSE, and more), so the parser returns whatever the command actually reports rather than
// filtering it down to a curated subset.
//
// wsl.exe renders this as a two-column table, e.g.:
//
//   The following is a list of valid distributions that can be installed using 'wsl.exe --install <Distro>'.
//
//   NAME                                   FRIENDLY NAME
//   Ubuntu                                 Ubuntu
//   Debian                                 Debian GNU/Linux
//   kali-linux                             Kali Linux Rolling
//
// As with the installed-distribution table, the header's column start offsets are read once and
// reused for every data row.

import { decodeWslText, wslLines, hasControlCharacter } from './text'
import type { WslRuntime } from './runtime'
import { detectWsl } from './install'

export interface WslOnlineDistribution {
  /** The exact machine name to pass as `wsl --install -d <name>`. */
  name: string
  /** Microsoft's human-readable label for the same distribution. */
  friendlyName: string
}

export function parseWslOnlineList(raw: Buffer): WslOnlineDistribution[] {
  const decoded = decodeWslText(raw)
  const lines = wslLines(decoded)
  if (lines.length === 0) return []

  const headerIndex = lines.findIndex(
    (line) => line.trim().startsWith('NAME') && line.includes('FRIENDLY NAME')
  )
  if (headerIndex === -1) {
    throw new Error('wsl.exe --list --online did not return a recognizable header row')
  }
  const header = lines[headerIndex]
  const nameStart = header.indexOf('NAME')
  const friendlyStart = header.indexOf('FRIENDLY NAME')
  if (nameStart === -1 || friendlyStart === -1 || friendlyStart <= nameStart) {
    throw new Error('wsl.exe --list --online returned an unexpected header shape')
  }

  const available: WslOnlineDistribution[] = []
  const seenCaseInsensitive = new Set<string>()
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim().length === 0) continue
    if (line.length < friendlyStart) {
      throw new Error('wsl.exe --list --online returned a row shorter than its own header')
    }
    const name = line.slice(nameStart, friendlyStart).trim()
    const friendlyName = line.slice(friendlyStart).trim()

    if (name.length === 0) continue
    if (hasControlCharacter(name) || hasControlCharacter(friendlyName)) {
      throw new Error('wsl.exe --list --online returned a row with a control character')
    }
    const folded = name.toLocaleLowerCase('en-US')
    if (seenCaseInsensitive.has(folded)) continue
    seenCaseInsensitive.add(folded)

    available.push({ name, friendlyName: friendlyName || name })
  }

  return available
}

export type WslCatalogResult =
  | { ok: true; available: WslOnlineDistribution[] }
  | { ok: false; error: string }

export async function listAvailableWslDistributions(runtime: WslRuntime): Promise<WslCatalogResult> {
  const availability = await detectWsl(runtime)
  if (!availability.installed) {
    return { ok: false, error: 'WSL is not installed on this machine, so the online catalog is unavailable.' }
  }

  const result = await runtime.execFile(availability.wslExePath, ['--list', '--online'])
  if (result.error || result.exitCode !== 0) {
    return {
      ok: false,
      error: 'wsl.exe --list --online failed to run, so the catalog of installable distributions could not be fetched.'
    }
  }

  try {
    return { ok: true, available: parseWslOnlineList(result.stdout) }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `wsl.exe returned catalog data that could not be parsed: ${error.message}`
          : 'wsl.exe returned catalog data that could not be parsed.'
    }
  }
}
