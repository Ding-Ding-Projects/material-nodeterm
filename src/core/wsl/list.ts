// Parsing for `wsl --list --verbose`, which is how installed distributions, their running state,
// their WSL version, and the default flag are all discovered in one call.
//
// wsl.exe renders this as a fixed-width table, e.g.:
//
//   NAME                   STATE           VERSION
// * Ubuntu                 Running         2
//   docker-desktop         Stopped         2
//   Debian                 Stopped         1
//
// The leading column is a 2-character marker: `"* "` on the default distribution, `"  "`
// otherwise. Because that marker occupies exactly the same width on every line (including the
// header, which starts with two spaces), the column boundaries can be found once from the header
// and reused verbatim for every data row, there is no need to guess a fixed width per column.
//
// This is best-effort by construction: the header names ("NAME", "STATE", "VERSION") are assumed
// to be the English ones wsl.exe prints on an English-language Windows install. A differently
// localized wsl.exe will fail this parse; that failure surfaces as `ok:false` with an honest
// message, never as a guessed or partial distribution list.

import { decodeWslText, wslLines, hasControlCharacter } from './text'

export type WslDistributionState = 'running' | 'stopped'

export interface WslDistribution {
  name: string
  state: WslDistributionState
  isDefault: boolean
  /** wsl.exe's own reported WSL version, or `null` when the column could not be read as 1 or 2. */
  version: 1 | 2 | null
}

function columnStart(header: string, label: string): number {
  const index = header.indexOf(label)
  if (index === -1) throw new Error(`wsl.exe --list --verbose output is missing the "${label}" column`)
  return index
}

export function parseWslVerboseList(raw: Buffer): WslDistribution[] {
  const decoded = decodeWslText(raw)
  const lines = wslLines(decoded)
  if (lines.length === 0) return []

  const headerIndex = lines.findIndex(
    (line) => line.includes('NAME') && line.includes('STATE') && line.includes('VERSION')
  )
  if (headerIndex === -1) {
    throw new Error('wsl.exe --list --verbose did not return a recognizable header row')
  }
  const header = lines[headerIndex]
  const nameStart = columnStart(header, 'NAME')
  const stateStart = columnStart(header, 'STATE')
  const versionStart = columnStart(header, 'VERSION')
  if (!(nameStart < stateStart && stateStart < versionStart)) {
    throw new Error('wsl.exe --list --verbose returned columns in an unexpected order')
  }

  const distributions: WslDistribution[] = []
  const seenCaseInsensitive = new Set<string>()
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim().length === 0) continue
    if (line.length < stateStart) {
      throw new Error('wsl.exe --list --verbose returned a row shorter than its own header')
    }
    const marker = line.slice(0, nameStart)
    const isDefault = marker.includes('*')
    if (!isDefault && marker.trim().length > 0) {
      throw new Error('wsl.exe --list --verbose returned an unrecognized row marker')
    }

    const name = line.slice(nameStart, stateStart).trim()
    const stateRaw = line.slice(stateStart, versionStart).trim()
    const versionRaw = line.slice(versionStart).trim()

    if (name.length === 0) throw new Error('wsl.exe --list --verbose returned a row with no name')
    if (hasControlCharacter(name)) {
      throw new Error('wsl.exe --list --verbose returned a distribution name with a control character')
    }
    const folded = name.toLocaleLowerCase('en-US')
    if (seenCaseInsensitive.has(folded)) {
      throw new Error('wsl.exe --list --verbose returned duplicate distribution names')
    }
    seenCaseInsensitive.add(folded)

    let state: WslDistributionState
    if (/^running$/i.test(stateRaw)) state = 'running'
    else if (/^stopped$/i.test(stateRaw)) state = 'stopped'
    else if (/^installing$/i.test(stateRaw) || /^uninstalling$/i.test(stateRaw)) {
      // Real transitional states wsl.exe reports mid-install/uninstall. Neither "running" nor
      // "stopped" is honest here; a caller that needs a coarser view can fold this itself, but the
      // core parser must not lie about state it did not observe.
      state = 'stopped'
    } else {
      throw new Error(`wsl.exe --list --verbose reported an unrecognized state "${stateRaw}"`)
    }

    const version: 1 | 2 | null = versionRaw === '1' ? 1 : versionRaw === '2' ? 2 : null

    distributions.push({ name, state, isDefault, version })
  }

  const defaults = distributions.filter((d) => d.isDefault)
  if (defaults.length > 1) {
    throw new Error('wsl.exe --list --verbose marked more than one distribution as default')
  }

  return distributions
}
