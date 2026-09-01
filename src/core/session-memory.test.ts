import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import {
  indexProcesses,
  rollupTree,
  parseProcessTable,
  parsePaneList,
  buildReport,
  collectSessionMemory,
  isNoServerError,
  type ProcEntry
} from './session-memory'

const P = (pid: number, ppid: number, rssKb: number): ProcEntry => ({ pid, ppid, rssKb })

describe('indexProcesses + rollupTree', () => {
  it('sums a pane pid and every descendant, splitting self from children', () => {
    // pane(100) -> claude(200) -> mcp(300), and claude also has mcp2(301)
    const { table, kids } = indexProcesses([
      P(100, 1, 1024),
      P(200, 100, 350 * 1024),
      P(300, 200, 30 * 1024),
      P(301, 200, 20 * 1024)
    ])
    const r = rollupTree(table, kids, 100)
    expect(r.selfMb).toBe(1)
    expect(r.childrenMb).toBe(400)
    expect(r.childCount).toBe(3)
    expect(r.totalMb).toBe(401)
  })

  it('returns zeros for a pid that is not in the table', () => {
    const { table, kids } = indexProcesses([P(100, 1, 1024)])
    expect(rollupTree(table, kids, 999)).toEqual({
      selfMb: 0,
      childrenMb: 0,
      childCount: 0,
      totalMb: 0
    })
  })

  it('does not loop forever on a cyclic ppid chain', () => {
    // A pid whose parent chain points back at it must not hang the sweep.
    const { table, kids } = indexProcesses([P(100, 200, 1024), P(200, 100, 1024)])
    const r = rollupTree(table, kids, 100)
    expect(r.totalMb).toBe(2)
    expect(r.childCount).toBe(1)
  })
})

describe('parseProcessTable', () => {
  it('parses ps output and skips the header and malformed lines', () => {
    const out = parseProcessTable(
      '  PID  PPID    RSS COMMAND\n' +
        '  100     1   1024 tmux\n' +
        'garbage line\n' +
        '  200   100 358400 claude\n'
    )
    expect(out).toEqual([
      { pid: 100, ppid: 1, rssKb: 1024 },
      { pid: 200, ppid: 100, rssKb: 358400 }
    ])
  })

  it('returns an empty array for empty input rather than throwing', () => {
    expect(parseProcessTable('')).toEqual([])
  })
})

describe('parsePaneList', () => {
  it('parses the pipe-delimited pane list and skips malformed lines', () => {
    // `nt-zero||sh` is the phantom case: an empty pid field parses as 0, which IS finite, so a
    // finite-only guard would emit a 0 MB row for a pid that cannot exist.
    expect(
      parsePaneList('nt-term-a|100|claude\nbroken\nnt-term-b|200|zsh\n|300|x\nnt-zero||sh\n')
    ).toEqual([
      { session: 'nt-term-a', panePid: 100, command: 'claude' },
      { session: 'nt-term-b', panePid: 200, command: 'zsh' }
    ])
  })
})

describe('buildReport', () => {
  it('rolls up each nt- session and sorts by total descending', () => {
    const r = buildReport(
      [
        { session: 'nt-small', panePid: 100, command: 'zsh' },
        { session: 'nt-big', panePid: 200, command: 'claude' }
      ],
      [
        P(100, 1, 40 * 1024),
        P(200, 1, 350 * 1024),
        P(201, 200, 50 * 1024)
      ],
      { availableMb: 1000, totalMb: 64000 }
    )
    expect(r.ok).toBe(true)
    expect(r.rows.map((x) => x.session)).toEqual(['nt-big', 'nt-small'])
    expect(r.rows[0]).toMatchObject({
      nodeId: 'big',
      totalMb: 400,
      selfMb: 350,
      childrenMb: 50,
      childCount: 1,
      command: 'claude'
    })
  })

  it('ignores sessions that are not nt- prefixed', () => {
    const r = buildReport(
      [{ session: 'my-own-tmux', panePid: 100, command: 'zsh' }],
      [P(100, 1, 40 * 1024)],
      null
    )
    expect(r.rows).toEqual([])
  })
})

describe('collectSessionMemory', () => {
  const table = [P(100, 1, 40 * 1024), P(200, 1, 350 * 1024)]

  it('reports ok:false with no rows when the process table cannot be read', async () => {
    const r = await collectSessionMemory({
      tmuxBin: () => '/usr/bin/tmux',
      sockets: ['s1'],
      exec: async () => 'nt-a|100|claude\n',
      readTable: () => null,
      readMem: () => ({ availableMb: 1, totalMb: 2 })
    })
    // "could not look" must never render as "uses nothing".
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
    // The host total is still a real reading — the failure path must not throw it away.
    expect(r.mem).toEqual({ availableMb: 1, totalMb: 2 })
  })

  it('reports ok:true with no rows when tmux has no server (a real answer)', async () => {
    const r = await collectSessionMemory({
      tmuxBin: () => '/usr/bin/tmux',
      sockets: ['s1'],
      exec: async () => {
        throw new Error('no server running')
      },
      readTable: () => table,
      readMem: () => null
    })
    expect(r.ok).toBe(true)
    expect(r.rows).toEqual([])
  })

  it('reports ok:false when tmux is unavailable entirely', async () => {
    const r = await collectSessionMemory({ tmuxBin: () => null, readTable: () => table })
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
  })

  it('counts "no server" as an answer but a permission failure as a failure', () => {
    expect(isNoServerError('no server running on /tmp/tmux-0/node-terminal')).toBe(true)
    expect(isNoServerError('error connecting to /tmp/x (No such file or directory)')).toBe(true)
    // A socket dir we may not read says nothing about whether sessions exist there.
    expect(isNoServerError('error connecting to /tmp/x (Permission denied)')).toBe(false)
    expect(isNoServerError('killed: timeout')).toBe(false)
    // The regression the anchor exists for: stderr that merely CONTAINS the errno phrase. A tmux
    // client that cannot load a library fails this way on EVERY socket — same binary — so counting
    // it as an answer would print "no sessions" while the already-running server holds live ones.
    expect(
      isNoServerError(
        'Command failed: tmux -L node-terminal list-panes\ntmux: error while loading shared ' +
          'libraries: libtinfo.so.6: cannot open shared object file: No such file or directory'
      )
    ).toBe(false)
    // Same shape one layer out: a dead ssh ControlMaster, which this sweep may later run over.
    expect(isNoServerError('Control socket connect(/tmp/cm.sock): No such file or directory')).toBe(
      false
    )
  })

  it('reports ok:false when NO socket answered', async () => {
    // One socket erroring is normal (nobody used it). Every socket erroring means we never looked,
    // and "we never looked" must not render as "there are no sessions".
    const r = await collectSessionMemory({
      tmuxBin: () => '/usr/bin/tmux',
      sockets: ['s1', 's2'],
      exec: async () => {
        throw new Error('connect failed')
      },
      readTable: () => table,
      readMem: () => null
    })
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
  })

  it('merges panes from every socket and the first socket wins a duplicate session', async () => {
    const r = await collectSessionMemory({
      tmuxBin: () => '/usr/bin/tmux',
      sockets: ['s1', 's2'],
      exec: async (_bin, args) =>
        args[1] === 's1' ? 'nt-a|100|zsh\n' : 'nt-b|200|claude\nnt-a|999|claude\n',
      readTable: () => table,
      readMem: () => null
    })
    expect(r.rows.map((x) => x.session).sort()).toEqual(['nt-a', 'nt-b'])
    // s2 also reported nt-a, with a different pid and command: s1's entry must be the one kept.
    expect(r.rows.find((x) => x.session === 'nt-a')).toMatchObject({
      panePid: 100,
      command: 'zsh'
    })
  })

  it('routes the process-table fallback through the injected exec seam', async () => {
    // With no readTable injected the default /proc reader runs first; make it fail so the
    // fallback is reached on every platform.
    //
    // The fallback BINARY is platform-specific and the assertion says so explicitly rather than
    // inheriting whichever OS happens to run the suite: `/proc` and `ps` do not exist on Windows,
    // so win32 shells out to PowerShell instead (see WIN_PROCESS_TABLE_ARGS). Hard-coding `ps`
    // made this test assert the platform it ran on — green on Linux, red on Windows, for code
    // that is correct on both.
    const isWin = process.platform === 'win32'
    const fallbackBin = isWin ? 'powershell.exe' : 'ps'
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('/proc unreadable')
    })
    try {
      const calls: string[] = []
      const r = await collectSessionMemory({
        tmuxBin: () => '/usr/bin/tmux',
        sockets: ['s1'],
        exec: async (bin) => {
          calls.push(bin)
          if (bin === 'ps') return '  PID  PPID    RSS\n  100     1   1024\n'
          // Shaped exactly as `ConvertTo-Csv -NoTypeInformation` writes it: a header row, then
          // QUOTED fields, with WorkingSetSize in BYTES (the WMI/CIM convention) rather than the
          // kB `ps` reports. 1048576 B = 1024 kB = the same 1 MB the POSIX branch yields, so both
          // platforms assert the identical row.
          if (bin === 'powershell.exe')
            return '"ProcessId","ParentProcessId","WorkingSetSize"\n"100","1","1048576"\n'
          return 'nt-a|100|zsh\n'
        },
        readMem: () => null
      })
      // The fallback call must come THROUGH the seam, not around it — otherwise this path can
      // never be driven by a test and the file's "every exec is injectable" promise is false.
      expect(calls).toContain(fallbackBin)
      expect(r.ok).toBe(true)
      expect(r.rows[0]).toMatchObject({ session: 'nt-a', selfMb: 1 })
    } finally {
      spy.mockRestore()
    }
  })
})

import { parseMemInfoText, parsePsiMemory, readMemInfo } from './session-memory'

/** A verbatim excerpt of the production host's /proc/meminfo, 2026-08-15 (62.7 GB, swap 74% spent). */
const MEMINFO = `MemTotal:       65697400 kB
MemFree:         4154020 kB
MemAvailable:   13804628 kB
Buffers:          412300 kB
Cached:          9216440 kB
SwapCached:       501232 kB
SwapTotal:       8388604 kB
SwapFree:        2192260 kB
Dirty:               736 kB
`

const PSI = `some avg10=0.00 avg60=1.25 avg300=0.18 total=29288181130
full avg10=0.00 avg60=0.75 avg300=0.15 total=25621111809
`

describe('parseMemInfoText', () => {
  it('reads the required pair and the optional swap pair from ONE snapshot', () => {
    expect(parseMemInfoText(MEMINFO)).toEqual({
      availableMb: 13481,
      totalMb: 64158,
      swapTotalMb: 8192,
      swapFreeMb: 2141
    })
  })

  it('MemAvailable/MemTotal are required — a /proc we do not understand yields NO reading', () => {
    // Not a partial object: a reading missing its primary field would be a number the watermark
    // could still compare against, which is the "wrong number presented as a fact" failure.
    expect(parseMemInfoText(MEMINFO.replace(/MemAvailable:.*\n/, ''))).toBeNull()
    expect(parseMemInfoText(MEMINFO.replace(/MemTotal:.*\n/, ''))).toBeNull()
    expect(parseMemInfoText('garbage')).toBeNull()
  })

  it('swap is OMITTED, not zeroed, when the kernel does not report it', () => {
    // The distinction the swap term depends on: `undefined` means "did not measure" and disables
    // the term, whereas `0` would read as "swap totally exhausted" and could only ever reap MORE.
    const noSwap = parseMemInfoText(MEMINFO.replace(/SwapTotal:.*\n/, '').replace(/SwapFree:.*\n/, ''))
    expect(noSwap).toEqual({ availableMb: 13481, totalMb: 64158 })
    expect(noSwap).not.toHaveProperty('swapTotalMb')
    expect(noSwap).not.toHaveProperty('swapFreeMb')
  })

  it('half a swap reading is no swap reading (a free without a total cannot be a ratio)', () => {
    const half = parseMemInfoText(MEMINFO.replace(/SwapTotal:.*\n/, ''))
    expect(half).not.toHaveProperty('swapFreeMb')
  })

  it('a swapless host reports a real zero TOTAL, which every consumer guard turns off', () => {
    const off = parseMemInfoText(MEMINFO.replace(/SwapTotal:.*/, 'SwapTotal:             0 kB').replace(/SwapFree:.*/, 'SwapFree:              0 kB'))
    expect(off).toMatchObject({ swapTotalMb: 0, swapFreeMb: 0 })
  })
})

describe('parsePsiMemory', () => {
  it('reads avg60 from both lines', () => {
    expect(parsePsiMemory(PSI)).toEqual({ psiSomeAvg60: 1.25, psiFullAvg60: 0.75 })
  })

  it('takes avg60 specifically — not avg10 and not avg300', () => {
    // The cadence argument: the reaper sweeps every 10 minutes, so avg10 is noise and avg300 stays
    // elevated through a recovery. Distinct values in every column make a mix-up visible.
    const distinct = 'some avg10=11.00 avg60=22.00 avg300=33.00 total=1\nfull avg10=44.00 avg60=55.00 avg300=66.00 total=2\n'
    expect(parsePsiMemory(distinct)).toEqual({ psiSomeAvg60: 22, psiFullAvg60: 55 })
  })

  it('does not confuse the some line for the full line', () => {
    expect(parsePsiMemory('some avg10=0.00 avg60=9.00 avg300=0.00 total=1\n')).toEqual({ psiSomeAvg60: 9 })
  })

  it('an unreadable or absent PSI file yields NO figures, never zeros', () => {
    expect(parsePsiMemory('')).toEqual({})
    expect(parsePsiMemory('garbage')).toEqual({})
    expect(parsePsiMemory('some avg10=0.00 avg300=0.18 total=1\n')).toEqual({})
  })
})

describe('readMemInfo on this Linux host (integration)', () => {
  const onLinux = it.skipIf(process.platform !== 'linux')

  onLinux('carries swap alongside the available/total pair', () => {
    const m = readMemInfo()
    expect(m).not.toBeNull()
    expect(m!.totalMb).toBeGreaterThan(0)
    // Swap is not guaranteed configured, but if the kernel reports a total it must report a free.
    if (m!.swapTotalMb !== undefined) {
      expect(m!.swapFreeMb).toBeDefined()
      expect(m!.swapFreeMb!).toBeLessThanOrEqual(m!.swapTotalMb!)
    }
  })

  onLinux('PSI is optional and never breaks the reading', () => {
    const m = readMemInfo()
    expect(m).not.toBeNull()
    if (m!.psiFullAvg60 !== undefined) expect(m!.psiFullAvg60).toBeGreaterThanOrEqual(0)
  })
})
