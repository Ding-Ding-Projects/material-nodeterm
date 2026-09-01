import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  remoteSessionMemoryCommand,
  parseRemoteSessionMemory,
  fetchRemoteSessionMemory
} from './session-memory-remote'
import {
  environmentForPosixShell,
  posixShellScriptArgs,
  REAL_POSIX_SHELL,
  REAL_SHELL_TEST_TIMEOUT_MS
} from './testing/posix-shell'

const run = promisify(execFile)

/** One socket's fence inside the `##PANES` section: what the generated command prints per socket.
 *  Every fixture below goes through this, so a change to the fence breaks the tests loudly rather
 *  than leaving them asserting a shape the command no longer emits. */
const sock = (name: string, rc: number, body = ''): string =>
  `##SOCK ${name}\n${body}##SOCKRC ${rc}\n`

/** The two sockets answering "no server running" — the normal state of an idle host, and the
 *  baseline every "the panes are what matters" fixture wants. */
const bothIdle = (panes = ''): string =>
  sock('node-terminal', 0, panes) + sock('nodeterm-rmt', 1, 'no server running on /tmp/x\n')

describe('parseRemoteSessionMemory', () => {
  it('parses all three sections into a report', () => {
    const r = parseRemoteSessionMemory(
      '##MEM\nMemAvailable: 13500000 kB\nMemTotal: 65700000 kB\n' +
        '##PANES\n' +
        bothIdle('nt-term-a|100|claude\n') +
        '##PROCS\n100 1 1024\n200 100 358400\n'
    )
    expect(r.ok).toBe(true)
    expect(r.mem).toEqual({ availableMb: 13184, totalMb: 64160 })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ nodeId: 'term-a', selfMb: 1, childrenMb: 350 })
  })

  it('reports ok:false when the PROCS section is missing (the read was cut short)', () => {
    const r = parseRemoteSessionMemory('##MEM\n##PANES\n' + bothIdle('nt-term-a|100|claude\n'))
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
  })

  it('reports ok:true with no rows when the host has no nt- sessions', () => {
    const r = parseRemoteSessionMemory('##MEM\n##PANES\n' + bothIdle() + '##PROCS\n100 1 1024\n')
    expect(r.ok).toBe(true)
    expect(r.rows).toEqual([])
  })

  // The whole point of the per-socket fence. `{ tmux …; tmux …; } || true` with stderr discarded
  // produced a byte-identical stream for "this host has no tmux server" and "every tmux call on
  // this host failed", and the panel rendered the second as "No sessions are running here.".
  describe('a socket that FAILED is not a socket that answered "nothing"', () => {
    const procs = '##PROCS\n100 1 1024\n'

    it('accepts tmux saying there is no server (an ANSWER: the socket is simply unused)', () => {
      const r = parseRemoteSessionMemory(
        '##MEM\n##PANES\n' +
          sock('node-terminal', 1, 'no server running on /tmp/tmux-0/node-terminal\n') +
          sock('nodeterm-rmt', 1, 'error connecting to /tmp/tmux-0/nodeterm-rmt (No such file or directory)\n') +
          procs
      )
      expect(r.ok).toBe(true)
      expect(r.rows).toEqual([])
    })

    it('reports ok:false when EVERY socket failed for some other reason', () => {
      // A tmux client missing a shared library exits 127 on every socket — the same binary, so the
      // host's live sessions are untouched and very much still there.
      const linker =
        'tmux: error while loading shared libraries: libevent-2.1.so.7: cannot open shared object file: No such file or directory\n'
      const r = parseRemoteSessionMemory(
        '##MEM\n##PANES\n' +
          sock('node-terminal', 127, linker) +
          sock('nodeterm-rmt', 127, linker) +
          procs
      )
      expect(r.ok).toBe(false)
      expect(r.rows).toEqual([])
    })

    it('reports ok:true when only SOME sockets failed — one answer is enough', () => {
      const r = parseRemoteSessionMemory(
        '##MEM\n##PANES\n' +
          sock('node-terminal', 0, 'nt-term-a|100|claude\n') +
          sock('nodeterm-rmt', 13, 'error connecting to /tmp/tmux-1/nodeterm-rmt (Permission denied)\n') +
          '##PROCS\n100 1 1024\n'
      )
      expect(r.ok).toBe(true)
      expect(r.rows.map((x) => x.nodeId)).toEqual(['term-a'])
    })

    it('reports ok:false when a socket fence was never closed (the stream was cut mid-socket)', () => {
      const r = parseRemoteSessionMemory(
        '##MEM\n##PANES\n##SOCK node-terminal\nnt-term-a|100|claude\n' + procs
      )
      expect(r.ok).toBe(false)
      expect(r.rows).toEqual([])
    })

    // The fence is matched against the sockets we asked for and a numeric status, so a session
    // whose NAME or foreground command looks like a marker cannot open or close a block.
    it('cannot be fenced by pane data that looks like a marker', () => {
      // The fake opener sits AFTER a real pane and the fake closer INSIDE a real pane line, so a
      // loosened match (`startsWith('##SOCK ')`, or an unanchored `##SOCKRC`) drops one of the two
      // rows instead of merely renaming a command.
      const r = parseRemoteSessionMemory(
        '##MEM\n##PANES\n' +
          sock(
            'node-terminal',
            0,
            'nt-term-a|100|claude\n##SOCK not-a-socket\nnt-term-b|200|##SOCKRC 0\n'
          ) +
          sock('nodeterm-rmt', 1, 'no server running\n') +
          '##PROCS\n100 1 1024\n200 1 2048\n'
      )
      expect(r.ok).toBe(true)
      expect(r.rows.map((x) => x.nodeId).sort()).toEqual(['term-a', 'term-b'])
    })
  })

  // An ssh exec channel is not a clean pipe — a login shell's rc file can write to stdout ahead of
  // our first marker. Out-of-order markers must fail closed, not produce a confident empty report.
  // The stream below is a COMPLETE, healthy sweep with one stray `##PROCS` echoed ahead of it by a
  // login shell's rc file. Every part must stay realistic: the real PROCS tail still parses, so the
  // empty-table check does NOT catch this, and without the ordering guard the panes slice comes out
  // empty and the report is a confident `{ok:true, rows:[]}` over a host with live sessions.
  it('reports ok:false when the markers arrive out of order', () => {
    const r = parseRemoteSessionMemory(
      '##PROCS\n' +
        '##MEM\nMemAvailable: 1024 kB\nMemTotal: 2048 kB\n' +
        '##PANES\n' +
        bothIdle('nt-term-a|100|claude\n') +
        '##PROCS\n100 1 1024\n200 100 358400\n'
    )
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
  })

  // A marker string inside DATA is not a marker: only a whole line counts, and only the first one.
  it('is not confused by a marker appearing inside pane or process data', () => {
    const r = parseRemoteSessionMemory(
      '##MEM\nMemAvailable: 1024 kB\nMemTotal: 2048 kB\n' +
        '##PANES\n' +
        bothIdle('nt-term-b|300|##PROCS\n') +
        '##PROCS\n300 1 1024\n##PANES\n400 1 2048\n'
    )
    expect(r.ok).toBe(true)
    expect(r.mem).toEqual({ availableMb: 1, totalMb: 2 })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ nodeId: 'term-b', command: '##PROCS', selfMb: 1, totalMb: 1 })
  })

  // Both sockets are swept in ONE stream, and `list-panes -a` prints a line per PANE, so the same
  // session can appear several times. It is still one session, hence one row (the local leg's
  // `bySession` map makes the same promise).
  it('collapses a session reported by several panes into one row', () => {
    const r = parseRemoteSessionMemory(
      '##MEM\n##PANES\n' +
        sock('node-terminal', 0, 'nt-term-a|100|claude\n') +
        sock('nodeterm-rmt', 0, 'nt-term-a|300|bash\n') +
        '##PROCS\n100 1 1024\n300 1 2048\n'
    )
    expect(r.ok).toBe(true)
    // First socket in sweep order wins, exactly as the local leg's first-wins `bySession` does.
    expect(r.rows.map((x) => x.panePid)).toEqual([100])
  })
})

describe('fetchRemoteSessionMemory', () => {
  it('reports ok:false when the command could not run (a dead master says nothing)', async () => {
    const r = await fetchRemoteSessionMemory('p1', async () => null)
    expect(r.ok).toBe(false)
  })

  it('reports ok:false when the runner throws', async () => {
    const r = await fetchRemoteSessionMemory('p1', async () => {
      throw new Error('master down')
    })
    expect(r.ok).toBe(false)
  })
})

// The command is generated shell that no compiler checks. Run it through the repository's real
// POSIX-shell adapter: /bin/sh on POSIX and Git Bash on Windows. The fixture directory contains
// spaces, exercising the native-path → shell-path quoting boundary as part of every case.
describe('remoteSessionMemoryCommand under a real POSIX shell', { timeout: REAL_SHELL_TEST_TIMEOUT_MS }, () => {
  let dir: string
  // Every temp dir is registered here and removed in afterAll, so a FAILING assertion cannot leak
  // one into tmpdir (an inline rmSync after the expects never runs when an expect throws).
  const temps: string[] = []

  const fakeHost = (prefix: string, files: Record<string, string>): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    temps.push(d)
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(d, name), body)
      fs.chmodSync(path.join(d, name), 0o755)
    }
    return d
  }

  // Fixed host tools keep the generated shell semantics real while making the host facts portable:
  // Git Bash's ps dialect differs from GNU/BSD ps, and Windows has no /proc/meminfo. The command
  // must still invoke tmux/cat/grep/ps and parse their real pipe/status/quoting behavior.
  const FAKE_TMUX =
    '#!/bin/sh\nfor a in "$@"; do [ "$a" = "list-panes" ] && { echo "nt-term-a|100|claude"; exit 0; }; done\nexit 1\n'
  const FAKE_PS = '#!/bin/sh\nprintf "100 1 1024\\n200 100 358400\\n"\n'
  const FAKE_CAT =
    '#!/bin/sh\nprintf "MemAvailable: 13500000 kB\\nMemTotal: 65700000 kB\\n"\n'

  let scriptNumber = 0
  const runGenerated = async (fixtureBin: string): Promise<string> => {
    const script = path.join(fixtureBin, `generated-${++scriptNumber}.sh`)
    fs.writeFileSync(script, `#!/bin/sh\n${remoteSessionMemoryCommand()}\n`, 'utf8')
    fs.chmodSync(script, 0o755)
    const { stdout } = await run(
      REAL_POSIX_SHELL,
      posixShellScriptArgs(script, [], fixtureBin),
      {
        env: environmentForPosixShell(),
        encoding: 'utf8',
        timeout: REAL_SHELL_TEST_TIMEOUT_MS
      }
    )
    return String(stdout)
  }

  beforeAll(() => {
    dir = fakeHost('sessmem host ', { tmux: FAKE_TMUX, ps: FAKE_PS, cat: FAKE_CAT })
  })

  afterAll(() => {
    for (const d of temps) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('produces a parseable report on a host with a tmux server', async () => {
    const stdout = await runGenerated(dir)
    const r = parseRemoteSessionMemory(stdout)
    expect(r.ok).toBe(true)
    expect(r.rows.map((x) => x.nodeId)).toEqual(['term-a'])
    expect(r.rows[0]).toMatchObject({ selfMb: 1, childrenMb: 350, totalMb: 351 })
    expect(r.mem).toEqual({ availableMb: 13184, totalMb: 64160 })
  })

  // A host with no /proc/meminfo, as on remote systems that do not expose Linux procfs. Deliberately NO
  // free/vm_stat/sysctl
  // fallback: the sweep still answers with rows, and `mem` is null = "no signal", never a zero.
  //
  // COVERAGE LIMIT: the `cat` stub is what creates that condition on Linux. On a host that has no
  // /proc/meminfo to begin with the stub changes nothing, so that run observes the
  // NATIVE shape rather than a simulated one — the end state asserted is identical on both, but
  // only the Linux run proves the stub-induced failure path. Making it strictly meaningful on
  // non-Linux host would need a `mem`-producing fallback, which is deliberately not implemented.
  it('still reports rows with mem:null when /proc/meminfo is unreadable', async () => {
    // Stub `cat` so reading /proc/meminfo fails the way it does off Linux.
    const noproc = fakeHost('sessmem no mem ', {
      tmux: FAKE_TMUX,
      ps: FAKE_PS,
      cat: '#!/bin/sh\nexit 1\n'
    })
    const stdout = await runGenerated(noproc)
    const r = parseRemoteSessionMemory(stdout)
    expect(r.ok).toBe(true)
    expect(r.mem).toBeNull()
    expect(r.rows.map((x) => x.nodeId)).toEqual(['term-a'])
  })

  // tmux's OWN words for "there is no server on this socket", on stderr with a non-zero status.
  // A blanket `exit 1` would pass this test while proving nothing: it cannot tell "no server" from
  // "tmux is broken", which are the two cases the fence exists to separate.
  it('exits 0 and reports no rows when tmux says no server is running', async () => {
    const empty = fakeHost('sessmem no tmux ', {
      tmux: '#!/bin/sh\necho "no server running on /tmp/tmux-0/default" >&2\nexit 1\n',
      ps: FAKE_PS,
      cat: FAKE_CAT
    })
    const stdout = await runGenerated(empty)
    const r = parseRemoteSessionMemory(stdout)
    // A clean miss is an ANSWER: the sweep ran, the host simply has nothing.
    expect(r.ok).toBe(true)
    expect(r.rows).toEqual([])
  })

  // The failure this whole fence was added for, end to end through the real shell: a tmux client
  // that cannot start exits 127 on EVERY socket while the host's sessions keep running. Under the
  // old command (stderr to /dev/null, status dropped) this stream was byte-identical to the one
  // above and the panel said "No sessions are running here." over thirty live sessions.
  it('reports ok:false when the tmux client itself is broken on every socket', async () => {
    const broken = fakeHost('sessmem broken tmux ', {
      tmux:
        '#!/bin/sh\necho "tmux: error while loading shared libraries: libevent-2.1.so.7: ' +
        'cannot open shared object file: No such file or directory" >&2\nexit 127\n',
      ps: FAKE_PS,
      cat: FAKE_CAT
    })
    const stdout = await runGenerated(broken)
    // The shell still exits 0 and still prints all three markers plus a real process table — which
    // is exactly why the panes section had to carry a per-socket STATUS to tell the two apart.
    expect(stdout).toContain('##MEM')
    expect(stdout).toContain('##PANES')
    expect(stdout).toContain('##PROCS')
    const r = parseRemoteSessionMemory(stdout)
    expect(r.ok).toBe(false)
    expect(r.rows).toEqual([])
  })
})
