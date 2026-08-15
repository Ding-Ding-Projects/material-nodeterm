// The Electron-main-side client for the session host: one long-lived connection per app process,
// auto-spawning the host on first use (session-host-launcher.ts) and reconnecting transparently
// if the connection drops while the host itself keeps running (a client disconnect is NEVER a
// reason to think a session died — see docs/windows-session-host.md).
//
// src/core is Electron-free (see no-electron.test.ts); this file imports only `net`/`fs`/`crypto`
// and the pure protocol/paths modules under src/session-host — no `electron`, no `../main/*`.

import fs from 'fs'
import net from 'net'
import { sessionHostPaths } from '../session-host/paths'
import {
  LineFramer,
  encodeFrame,
  type SessionHostRequest,
  type SessionHostRequestBody,
  type SessionHostFrame,
  type SessionHostSpawnOptions,
  type AttachResult,
  type HasSessionResult,
  type PaneCommandResult,
  type CaptureResult,
  type ListSessionsResult
} from '../session-host/protocol'
import { resolveSessionHostScript, spawnSessionHost } from './session-host-launcher'

export interface SessionSubscriber {
  onData(data: string): void
  onExit(exitCode: number): void
}

type PendingEntry = { resolve: (v: { ok: true; result?: unknown }) => void; reject: (e: Error) => void }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Everything a live client needs to know about ONE connection attempt. Recreated on every
 * (re)connect; `SessionHostClient` itself outlives any single socket.
 */
export class SessionHostClient {
  private socket: net.Socket | null = null
  private framer = new LineFramer()
  private nextId = 1
  private pending = new Map<number, PendingEntry>()
  /** Local (in-process) subscribers per session name — the client-side half of co-attach. Several
   *  `SessionHostPty` instances (e.g. the canvas node AND the relay host's detached pty for the
   *  same node) may each hold one entry here; the LAST one leaving is what tells the host `detach`. */
  private subs = new Map<string, Set<SessionSubscriber>>()
  /** What to replay if the connection drops and comes back — spawn options are cheap to keep and
   *  this is the only way a reconnect can re-attach without the caller doing anything. */
  private attachMemory = new Map<string, { spawn: SessionHostSpawnOptions; scrollback: number }>()
  private connecting: Promise<void> | null = null
  private everConnected = false

  constructor(
    private readonly deps: {
      userDataDir: string
      resourcesPath?: string | null
      repoRoot?: string | null
    }
  ) {}

  /** Is a real, tested backend selectable on this machine at all? Session-host has no external
   *  binary dependency (unlike tmux), so this is really "was the bundle built" — false only in a
   *  dev checkout that never ran `npm run host:build` / `npm run build`. */
  bundleAvailable(): boolean {
    return (
      resolveSessionHostScript({
        resourcesPath: this.deps.resourcesPath,
        repoRoot: this.deps.repoRoot
      }) !== null
    )
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    if (this.connecting) return this.connecting
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    const wasConnectedBefore = this.everConnected
    if (await this.tryConnectOnce()) {
      if (wasConnectedBefore) void this.replayAttachesAfterReconnect()
      return
    }
    const script = resolveSessionHostScript({
      resourcesPath: this.deps.resourcesPath,
      repoRoot: this.deps.repoRoot
    })
    if (!script) {
      throw new Error(
        'session-host bundle not found (out/session-host/host.cjs is missing — run `npm run host:build`, ' +
          'or `npm run build` which now runs it too)'
      )
    }
    spawnSessionHost(script, this.deps.userDataDir)
    // Bounded poll for the freshly-spawned host to bind and write its token — startup is a
    // `net.createServer().listen()` plus two small file writes, so this is generous, not tuned.
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(150)
      if (await this.tryConnectOnce()) {
        if (wasConnectedBefore) void this.replayAttachesAfterReconnect()
        return
      }
    }
    throw new Error('session-host did not come up in time')
  }

  private tryConnectOnce(): Promise<boolean> {
    return new Promise((resolve) => {
      const paths = sessionHostPaths(this.deps.userDataDir)
      let token: string
      try {
        token = fs.readFileSync(paths.tokenPath, 'utf8').trim()
      } catch {
        resolve(false)
        return
      }
      if (!token) {
        resolve(false)
        return
      }
      let settled = false
      const socket = net.connect(paths.endpoint)
      socket.unref?.() // never keep the app process alive on our account
      const framer = new LineFramer()
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.removeAllListeners('data')
        if (!ok) {
          try {
            socket.destroy()
          } catch {
            /* already gone */
          }
        }
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), 2000)
      socket.once('error', () => finish(false))
      socket.once('connect', () => {
        socket.write(encodeFrame({ id: this.nextId++, cmd: 'hello', token }))
      })
      socket.on('data', (chunk: Buffer) => {
        for (const frame of framer.push<{ id: number; ok?: boolean }>(chunk.toString('utf8'))) {
          if (frame.ok === true) {
            this.attachSocket(socket)
            finish(true)
            return
          }
          finish(false)
          return
        }
      })
    })
  }

  private attachSocket(socket: net.Socket): void {
    this.socket = socket
    this.everConnected = true
    this.framer = new LineFramer()
    socket.removeAllListeners('data')
    socket.on('data', (chunk: Buffer) => {
      for (const frame of this.framer.push<SessionHostFrame>(chunk.toString('utf8'))) {
        this.handleFrame(frame)
      }
    })
    const onDrop = (): void => {
      if (this.socket !== socket) return
      this.socket = null
      const err = new Error('session-host connection lost')
      for (const [, entry] of this.pending) entry.reject(err)
      this.pending.clear()
      // Sessions live in the HOST, not here — a dropped connection does NOT mean a session died.
      // We do nothing further; the next request re-connects lazily (ensureConnected), and a
      // successful reconnect replays attaches (see doConnect). Only a reconnect that never
      // succeeds leaves the caller's next request to fail honestly.
    }
    socket.once('close', onDrop)
    socket.once('error', onDrop)
  }

  private handleFrame(frame: SessionHostFrame): void {
    if ('type' in frame) {
      const set = this.subs.get(frame.name)
      if (!set) return
      if (frame.type === 'data') {
        for (const sub of set) sub.onData(frame.data)
      } else {
        for (const sub of set) sub.onExit(frame.exitCode)
        this.subs.delete(frame.name)
        this.attachMemory.delete(frame.name)
      }
      return
    }
    const entry = this.pending.get(frame.id)
    if (!entry) return
    this.pending.delete(frame.id)
    if (frame.ok) entry.resolve({ ok: true, result: frame.result })
    else entry.reject(new Error(frame.error))
  }

  /** Send one request and await its correlated response. Reconnects (spawning the host if needed)
   *  before every call — cheap once warm (`ensureConnected` is a no-op on a live socket). */
  private async request<T>(req: SessionHostRequestBody): Promise<T> {
    await this.ensureConnected()
    const socket = this.socket
    if (!socket) throw new Error('session-host: not connected')
    const id = this.nextId++
    const full = { id, ...req } as SessionHostRequest
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve((v.result ?? undefined) as T),
        reject
      })
      try {
        socket.write(encodeFrame(full))
      } catch (e) {
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /**
   * Attach-or-create `name`, registering `sub` as a local subscriber of its `data`/`exit` push
   * frames. Remembers the spawn options so a later reconnect can replay this call transparently.
   */
  async attach(
    name: string,
    spawn: SessionHostSpawnOptions,
    scrollback: number,
    sub: SessionSubscriber
  ): Promise<AttachResult> {
    let set = this.subs.get(name)
    if (!set) {
      set = new Set()
      this.subs.set(name, set)
    }
    set.add(sub)
    this.attachMemory.set(name, { spawn, scrollback })
    return this.request<AttachResult>({ cmd: 'attach', name, spawn, scrollback })
  }

  /** Stop delivering `name`'s frames to `sub`. When it was the LAST local subscriber, also tells
   *  the host so it stops writing to this (now uninterested) connection. Never kills the session. */
  unsubscribe(name: string, sub: SessionSubscriber): void {
    const set = this.subs.get(name)
    if (!set) return
    set.delete(sub)
    if (set.size === 0) {
      this.subs.delete(name)
      this.attachMemory.delete(name)
      void this.request({ cmd: 'detach', name }).catch(() => {})
    }
  }

  /** After a reconnect, re-attach every name we still have local subscribers for (the new socket
   *  starts with an empty subscriber set at the host — see host.ts), and hand any returned screen
   *  to those subscribers as a synthetic repaint so their terminals catch up with whatever ran
   *  while the connection was down. A deliberately simpler cousin of the app's own `pty:resync`:
   *  it reuses the ordinary `onData` path rather than a dedicated resync channel, so it needs no
   *  changes anywhere above this file. */
  private async replayAttachesAfterReconnect(): Promise<void> {
    for (const [name, { spawn, scrollback }] of [...this.attachMemory]) {
      const set = this.subs.get(name)
      if (!set || set.size === 0) continue
      try {
        const result = await this.request<AttachResult>({ cmd: 'attach', name, spawn, scrollback })
        if (result.screen) {
          const repaint = '\x1b[2J\x1b[H' + result.screen
          for (const sub of set) sub.onData(repaint)
        }
      } catch {
        // The host may genuinely be gone (machine slept through a reboot, etc.) — the caller's
        // next explicit operation (write/resize/…) will fail and surface that honestly; we do not
        // guess at a synthetic exit here, since a transient reconnect race is far more common than
        // an actual lost session.
      }
    }
  }

  async hasSession(name: string): Promise<boolean> {
    const r = await this.request<HasSessionResult>({ cmd: 'hasSession', name })
    return r.exists
  }

  write(name: string, data: string): void {
    void this.request({ cmd: 'write', name, data }).catch(() => {})
  }

  resize(name: string, cols: number, rows: number): void {
    void this.request({ cmd: 'resize', name, cols, rows }).catch(() => {})
  }

  pause(name: string): void {
    void this.request({ cmd: 'pause', name }).catch(() => {})
  }

  resume(name: string): void {
    void this.request({ cmd: 'resume', name }).catch(() => {})
  }

  /** Background write — does not require an attached subscriber; the host looks the session up by
   *  name regardless (mirrors `sendText`'s tmux `send-keys -t <name>`, which needs no client). */
  async sendKeys(name: string, text: string, enter: boolean): Promise<boolean> {
    try {
      await this.request({ cmd: 'sendKeys', name, text, enter })
      return true
    } catch {
      return false
    }
  }

  async paneCommand(name: string): Promise<string | null> {
    try {
      const r = await this.request<PaneCommandResult>({ cmd: 'paneCommand', name })
      return r.command
    } catch {
      return null
    }
  }

  async capture(name: string, full: boolean): Promise<string> {
    try {
      const r = await this.request<CaptureResult>({ cmd: 'capture', name, full })
      return r.text
    } catch {
      return ''
    }
  }

  async killSession(name: string): Promise<void> {
    try {
      await this.request({ cmd: 'killSession', name })
    } catch {
      /* session may already be gone / host unreachable — nothing left to kill */
    }
    this.subs.delete(name)
    this.attachMemory.delete(name)
  }

  async listSessions(): Promise<string[]> {
    try {
      const r = await this.request<ListSessionsResult>({ cmd: 'listSessions' })
      return r.names
    } catch {
      return []
    }
  }
}
