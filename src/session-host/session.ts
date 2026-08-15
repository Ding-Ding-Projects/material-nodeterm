import type { Socket } from 'net'
import * as pty from 'node-pty'
import { TerminalEmulator } from './terminal-emulator'
import type { SessionHostSpawnOptions } from './protocol'

/**
 * One persisted session, owned by the host process for as long as it lives — this is the
 * Windows-and-anywhere-else-tmux-is-missing analogue of a tmux session: it survives every
 * connecting client detaching, and outlives the app that spawned it.
 */
export class HostSession {
  readonly name: string
  readonly proc: pty.IPty
  readonly term: TerminalEmulator
  /** Sockets currently receiving `data`/`exit` push frames for this session — the same "N
   *  subscribers, one underlying process" shape `pty-manager.ts` already implements for tmux
   *  co-attach, one level further down the stack. */
  readonly subscribers = new Set<Socket>()
  readonly createdAt = Date.now()
  /** Set once, by whichever path (natural pty exit or an explicit `killSession`) ends this
   *  session first — guards against double-dispose/double-broadcast when both could race. */
  exited = false

  constructor(name: string, spawn: SessionHostSpawnOptions, scrollback: number) {
    this.name = name
    this.proc = pty.spawn(spawn.shell, spawn.args, {
      name: 'xterm-256color',
      cols: Math.max(1, spawn.cols),
      rows: Math.max(1, spawn.rows),
      cwd: spawn.cwd,
      env: spawn.env
    })
    this.term = new TerminalEmulator({ cols: spawn.cols, rows: spawn.rows, scrollback })
  }

  dispose(): void {
    this.term.dispose()
  }
}
