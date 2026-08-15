// Wire protocol between the standalone session-host process and its Node clients (today: the
// desktop main process — see src/core/session-host-client.ts). Newline-delimited JSON over a
// local named pipe (Windows) or unix domain socket (POSIX/WSL/etc).
//
// This module is pure TypeScript with no Electron/Node-native imports so it can be bundled into
// BOTH the standalone host process (out/session-host/host.cjs, built with esbuild — see
// scripts nothing, just the `host:build` npm script) and the Electron main process bundle
// (electron-vite). See docs/windows-session-host.md for the architecture this implements.

/** Bumped whenever a request/response/event SHAPE changes. Carried in the host's state file so a
 *  client can in principle refuse to talk to an incompatible host — not enforced yet (this is the
 *  first version), but the field exists from day one so it never has to be added under pressure. */
export const SESSION_HOST_PROTOCOL_VERSION = 1

/** Exactly what node-pty needs to spawn — passed on `attach` so the host never has to compute cwd
 *  resolution, PATH, hook env, etc. itself. The CLIENT (pty-manager.ts, which already resolves all
 *  of this for the tmux/plain-shell paths) is the one source of truth for that logic. */
export interface SessionHostSpawnOptions {
  cwd: string
  shell: string
  args: string[]
  env: Record<string, string>
  cols: number
  rows: number
}

/** Client → host requests. Every request carries a monotonic `id`; the host echoes it on the
 *  matching response so replies can be correlated over one shared, long-lived connection — the
 *  same idiom `ControlModeClient` uses for tmux control-mode, minus the positional-FIFO fragility
 *  (JSON here carries its own id, so an out-of-order reply is still recoverable). */
export type SessionHostRequest =
  | { id: number; cmd: 'hello'; token: string }
  | {
      id: number
      cmd: 'attach'
      name: string
      spawn: SessionHostSpawnOptions
      /** Cap on both the emulator's live scrollback buffer and how much `capture`'s `full: true`
       *  returns — mirrors `settings.tmuxScrollback` / tmux's own `history-limit`. */
      scrollback: number
    }
  | { id: number; cmd: 'hasSession'; name: string }
  | { id: number; cmd: 'write'; name: string; data: string }
  | { id: number; cmd: 'resize'; name: string; cols: number; rows: number }
  | { id: number; cmd: 'pause'; name: string }
  | { id: number; cmd: 'resume'; name: string }
  | { id: number; cmd: 'sendKeys'; name: string; text: string; enter: boolean }
  | { id: number; cmd: 'paneCommand'; name: string }
  | { id: number; cmd: 'capture'; name: string; full: boolean }
  | { id: number; cmd: 'killSession'; name: string }
  | { id: number; cmd: 'detach'; name: string }
  | { id: number; cmd: 'listSessions' }
  | { id: number; cmd: 'ping' }

/** Host → client response to a request, correlated by `id`. */
export type SessionHostResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string }

/** Host → client PUSH frames — not correlated to any request id; delivered for as long as this
 *  connection is a subscriber of `name` (see `attach` / `detach`). */
export type SessionHostEvent =
  | { type: 'data'; name: string; data: string }
  | { type: 'exit'; name: string; exitCode: number }

export type SessionHostFrame = SessionHostResponse | SessionHostEvent

/**
 * `SessionHostRequest` minus `id`, DISTRIBUTED over the union rather than collapsed by a plain
 * `Omit<SessionHostRequest, 'id'>` — a bare `Omit` on a discriminated union only keeps properties
 * common to every member (here, just `cmd`), silently dropping every command-specific field like
 * `name`/`data`/`token`. The client builds requests against this type before assigning a real id.
 */
export type SessionHostRequestBody = SessionHostRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

export function isEventFrame(f: SessionHostFrame): f is SessionHostEvent {
  return (f as SessionHostEvent).type === 'data' || (f as SessionHostEvent).type === 'exit'
}

/** Result payload shapes, `result` on a successful response — documented here rather than typed
 *  as a discriminated union on `SessionHostResponse` itself, so the response type stays simple to
 *  parse off the wire; callers cast `result` to the shape their own command implies. */
export interface AttachResult {
  /** True when no session existed for this name and one was spawned just now — a cold start
   *  (first open, or a fresh host after the previous one died / the machine rebooted). False =
   *  warm reattach to a session that was already running (in THIS host process, which may have
   *  outlived several app restarts already). */
  fresh: boolean
  /**
   * The reconstructed screen — an xterm.js `SerializeAddon` dump (colors/attributes, private-mode
   * restore, alt-buffer switch and cursor placement all included — see terminal-emulator.ts).
   * Present only when `fresh` is false and the session has painted anything since it started;
   * absent (never an empty string) otherwise, mirroring `PtyCreateResult.screen`'s own contract
   * ("guaranteed non-empty when present").
   */
  screen?: string
}
export interface HasSessionResult {
  exists: boolean
}
export interface PaneCommandResult {
  command: string | null
}
export interface CaptureResult {
  text: string
}
export interface ListSessionsResult {
  names: string[]
}

/**
 * Splits a byte stream on `\n` into complete JSON lines, buffering a line that arrived split
 * across TCP/pipe chunks — the whole reason a delimiter-based framing needs a stateful parser
 * instead of `JSON.parse(chunk)`. Shared by both ends so the framing rule is written exactly once.
 */
export class LineFramer {
  private buf = ''
  /** Feed a raw chunk; returns every complete frame it now contains, in arrival order. A
   *  malformed line is DROPPED rather than thrown — one corrupt frame must never wedge every
   *  frame that follows it on the same connection. */
  push<T>(chunk: string): T[] {
    this.buf += chunk
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    const out: T[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        out.push(JSON.parse(trimmed) as T)
      } catch {
        // one corrupt line — drop it and keep reading the rest of the stream
      }
    }
    return out
  }
}

export function encodeFrame(frame: unknown): string {
  return JSON.stringify(frame) + '\n'
}
