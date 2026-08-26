// Per-distribution memory, so a caller can say WHICH distribution is making the machine lag
// rather than only that "WSL" in aggregate is using memory.
//
// WSL2 distributions run inside a shared lightweight Hyper-V VM; there is no Windows-side handle
// that cleanly attributes a slice of that VM's memory to one distribution. What each RUNNING
// distribution can report is its own guest-side view: `/proc/meminfo`, read from inside it. That
// view is real and useful (it is exactly what `free -h` inside the distribution would show), but
// it is a guest-reported figure, not a host-attributed one, and this module says so rather than
// implying more precision than it has.
//
// A STOPPED distribution has nothing to read: there is no guest kernel running to ask. That is
// not a failure, exactly as the root CLAUDE.md "Session memory" section requires elsewhere in
// this app: `ok:false` is reserved for "we tried to measure and could not," never reused to mean
// "there was nothing running to measure." A stopped distribution's row simply reports zero usage
// with `measured: false` and no error.

import type { WslRuntime } from './runtime'
import { decodeWslText } from './text'
import type { WslInstalledDistribution } from './enumerate'

export interface WslDistributionMemory {
  name: string
  state: 'running' | 'stopped'
  owned: boolean
  /** True only when guest memory data was actually read. False for a stopped distribution (there
   *  is nothing to read) and for a running one whose read failed. */
  measured: boolean
  totalKb?: number
  availableKb?: number
  usedKb?: number
  error?: string
}

/**
 * `ok:false` here means the report as a WHOLE could not be produced, for example because WSL is
 * unavailable. It is distinct from an individual row's `measured: false`, which means only that
 * one distribution's guest memory could not be read while every other row in the same report may
 * still be good. A caller must never fold a failed report into an empty, healthy-looking list.
 */
export type WslMemoryReport =
  | { ok: true; rows: WslDistributionMemory[] }
  | { ok: false; error: string }

function parseMeminfoField(text: string, field: string): number | undefined {
  const match = new RegExp(`^${field}:\\s*(\\d+)\\s*kB`, 'm').exec(text)
  return match ? Number(match[1]) : undefined
}

async function readGuestMemory(
  runtime: WslRuntime,
  wslExePath: string,
  name: string
): Promise<{ totalKb?: number; availableKb?: number; error?: string }> {
  const result = await runtime.execFile(wslExePath, ['-d', name, '--', 'cat', '/proc/meminfo'])
  if (result.error || result.exitCode !== 0) {
    return { error: `Could not read memory usage inside "${name}".` }
  }
  let text: string
  try {
    text = decodeWslText(result.stdout)
  } catch {
    return { error: `Memory data from "${name}" could not be decoded.` }
  }
  const totalKb = parseMeminfoField(text, 'MemTotal')
  const availableKb = parseMeminfoField(text, 'MemAvailable')
  if (totalKb === undefined) {
    return { error: `"${name}" did not report a recognizable MemTotal value.` }
  }
  return { totalKb, availableKb }
}

export async function readWslDistributionMemory(
  runtime: WslRuntime,
  wslExePath: string | null,
  distributions: readonly WslInstalledDistribution[]
): Promise<WslMemoryReport> {
  if (!wslExePath) {
    return { ok: false, error: 'WSL is not installed on this machine.' }
  }

  const rows: WslDistributionMemory[] = []
  for (const distribution of distributions) {
    if (distribution.state !== 'running') {
      rows.push({ name: distribution.name, state: distribution.state, owned: distribution.owned, measured: false })
      continue
    }

    const guest = await readGuestMemory(runtime, wslExePath, distribution.name)
    if (guest.error || guest.totalKb === undefined) {
      rows.push({
        name: distribution.name,
        state: distribution.state,
        owned: distribution.owned,
        measured: false,
        error: guest.error ?? `Could not read memory usage inside "${distribution.name}".`
      })
      continue
    }

    const usedKb =
      guest.availableKb === undefined ? undefined : Math.max(0, guest.totalKb - guest.availableKb)
    rows.push({
      name: distribution.name,
      state: distribution.state,
      owned: distribution.owned,
      measured: true,
      totalKb: guest.totalKb,
      ...(guest.availableKb === undefined ? {} : { availableKb: guest.availableKb }),
      ...(usedKb === undefined ? {} : { usedKb })
    })
  }

  return { ok: true, rows }
}
