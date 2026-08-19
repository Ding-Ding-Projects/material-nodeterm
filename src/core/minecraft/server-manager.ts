/**
 * Create-and-manage for a real local Minecraft server — see docs/minecraft-server-manager.md.
 *
 * SCOPE, STATED PLAINLY (and see the same note in shared/minecraft.ts): this runs the server as a
 * real `java -jar server.jar` child process of the SHELL that owns this manager (this desktop, or
 * the Server Edition host). It is not a wrapper around Docker or a remote host reached over SSH —
 * the `dockerhost`-style address field on other service kinds is a separate, still-unbuilt idea,
 * and nothing here reads or writes it.
 *
 * Every fact this module reports is re-derived on demand from something real: the manifest fetch
 * from `version-resolve.ts` (this module supplies the network, that one supplies the parsing and
 * the honest refusals), the jar and `eula.txt` on disk, a real Java probe (`java.ts`), and the real
 * process table. Nothing is optimistic. `status()` never says "running" because a client believes
 * it started something; it says so because `runtime.proc` is a live `ChildProcess`.
 *
 * WHAT NEVER HAPPENS HERE: the EULA is never written as accepted by anything but the explicit,
 * separate `acceptEula` call — `create()` always writes it `eula=false`, Mojang's own default, so
 * a server that has never been told "yes" by its actual user can never start.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Writable } from 'node:stream'
import { renameAtomic, tempNameFor, writeFileAtomic } from '../fs-atomic'
import type {
  MinecraftConsoleLine,
  MinecraftCreateInput,
  MinecraftEvent,
  MinecraftServerStatus,
  MinecraftVersionList
} from '../../shared/minecraft'
import { detectInstalledJava, ensureJavaRuntime, type JavaProbe } from './java'
import {
  checkJavaCompatibility,
  parseLatestVersions,
  parseVersionManifest,
  resolveServerDownload,
  verifySha1,
  type FetchJson
} from './version-resolve'

/** Mojang's own, publicly documented version manifest. Nothing else is ever fetched for version
 *  listings — every per-version document and every jar URL used below comes from what THIS
 *  manifest itself points at, never from an independently-typed or user-suppliable address. */
export const MOJANG_VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

const SERVER_JAR = 'server.jar'
const CONSOLE_LINE_CAP = 400
/** How long "stop" is given to save and exit gracefully before SIGTERM, and SIGTERM before
 *  SIGKILL. Generous — a large world's autosave-on-shutdown can genuinely take a while, and giving
 *  up early on a graceful stop is how a `stop` button starts corrupting worlds. */
const STOP_GRACE_MS = 20_000
const STOP_FORCE_MS = 8_000
const MANIFEST_TTL_MS = 10 * 60 * 1000
const JAVA_TTL_MS = 30_000

/** Instance ids are canvas node ids, but this value ends up in a filename
 *  (`<userData>/minecraft-servers/<id>.json`) — validated here rather than trusted, the same
 *  discipline `node-exec.ts`'s SAFE_OPAQUE_ID applies to every other opaque id that becomes part
 *  of a path. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/

interface InstanceRecord {
  id: string
  dir: string
  versionId: string
  sha1: string
  requiredJavaMajor: number | null
  createdAt: number
}

function isInstanceRecord(v: unknown): v is InstanceRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.dir === 'string' &&
    typeof r.versionId === 'string' &&
    typeof r.sha1 === 'string' &&
    (r.requiredJavaMajor === null || typeof r.requiredJavaMajor === 'number') &&
    typeof r.createdAt === 'number'
  )
}

/** Everything about one instance that is NOT written to disk — the live process, its buffered
 *  console, and the transient facts (a download in flight, a sticky error) that only make sense
 *  for the lifetime of this shell's process. Restarting the shell always starts from disk state:
 *  an instance mid-download when the app quit is simply "not installed yet" on the next launch. */
interface RuntimeState {
  proc: ChildProcess | null
  stopping: boolean
  downloading: boolean
  /** Real bytes received so far. Always populated while downloading. */
  downloadedBytes: number | null
  /** Only when the response carried a `Content-Length` — Mojang's per-version metadata does not
   *  always state a size (measured against the live manifest: the current release's did not), so
   *  this must stay honestly absent rather than derived from something that isn't there. */
  totalBytes: number | null
  downloadPercent: number | null
  /** Sticky until the next successful create()/start(), or a clean voluntary stop. Never a generic
   *  message — see describeError. */
  error: string | null
  startedAt: number | null
  console: MinecraftConsoleLine[]
  seq: number
  outBuf: string
  errBuf: string
  /** dir/versionId for a create() that has not written its record yet — so a status() poll mid-
   *  download can still say what is being installed and where. */
  transientDir: string | null
  transientVersionId: string | null
}

function freshRuntime(): RuntimeState {
  return {
    proc: null,
    stopping: false,
    downloading: false,
    downloadedBytes: null,
    totalBytes: null,
    downloadPercent: null,
    error: null,
    startedAt: null,
    console: [],
    seq: 0,
    outBuf: '',
    errBuf: '',
    transientDir: null,
    transientVersionId: null
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function readEulaAccepted(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(dir, 'eula.txt'), 'utf-8')
    return /^\s*eula\s*=\s*true\s*$/im.test(raw)
  } catch {
    return false
  }
}

/** Mojang's own eula.txt shape (comment lines + one `eula=` key), so a user who opens the folder
 *  directly sees the file they already recognize rather than something nodeterm invented. */
function eulaFileContent(accepted: boolean): string {
  return [
    '# By changing the setting below to TRUE you are indicating your agreement to the Minecraft EULA',
    '# (https://aka.ms/MinecraftEULA).',
    '# Written by nodeterm — see docs/minecraft-server-manager.md. Never set to true automatically.',
    `eula=${accepted ? 'true' : 'false'}`,
    ''
  ].join('\n')
}

export interface MinecraftServerManagerOptions {
  userDataDir: string
  /** Injected for tests; production fetches real JSON over HTTPS. */
  fetchJson?: FetchJson
  /** Injected for tests; production streams a real HTTPS response body. */
  fetchBinary?: (url: string) => Promise<Response>
  manifestUrl?: string
  detectJava?: () => Promise<JavaProbe>
  ensureJava?: (requiredMajor: number) => Promise<JavaProbe>
  now?: () => number
  spawnFn?: typeof spawn
  onEvent?: (event: MinecraftEvent) => void
}

export class MinecraftServerManager {
  private readonly userDataDir: string
  private readonly fetchJson: FetchJson
  private readonly fetchBinary: (url: string) => Promise<Response>
  private readonly manifestUrl: string
  private readonly detectJavaFn: () => Promise<JavaProbe>
  private readonly ensureJavaFn: (requiredMajor: number) => Promise<JavaProbe>
  private readonly now: () => number
  private readonly spawnFn: typeof spawn
  private readonly onEvent?: (event: MinecraftEvent) => void
  private readonly runtime = new Map<string, RuntimeState>()
  private manifestCache: { at: number; list: MinecraftVersionList } | null = null
  private javaCache: { at: number; probe: JavaProbe } | null = null

  constructor(opts: MinecraftServerManagerOptions) {
    this.userDataDir = opts.userDataDir
    this.fetchJson =
      opts.fetchJson ??
      (async (url: string) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
        return res.json()
      })
    this.fetchBinary = opts.fetchBinary ?? ((url: string) => fetch(url))
    this.manifestUrl = opts.manifestUrl ?? MOJANG_VERSION_MANIFEST_URL
    this.detectJavaFn = opts.detectJava ?? (() => detectInstalledJava())
    this.ensureJavaFn = opts.ensureJava ?? ((requiredMajor) => ensureJavaRuntime({ userDataDir: this.userDataDir, requiredMajor }))
    this.now = opts.now ?? Date.now
    this.spawnFn = opts.spawnFn ?? spawn
    this.onEvent = opts.onEvent
  }

  // ---- small internals ---------------------------------------------------------------------

  private getRuntime(id: string): RuntimeState {
    let r = this.runtime.get(id)
    if (!r) {
      r = freshRuntime()
      this.runtime.set(id, r)
    }
    return r
  }

  private recordPath(id: string): string {
    return path.join(this.userDataDir, 'minecraft-servers', `${id}.json`)
  }

  private async readRecord(id: string): Promise<InstanceRecord | null> {
    if (!SAFE_ID.test(id)) return null
    try {
      const raw = await readFile(this.recordPath(id), 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      return isInstanceRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private async writeRecord(record: InstanceRecord): Promise<void> {
    await mkdir(path.join(this.userDataDir, 'minecraft-servers'), { recursive: true })
    await writeFileAtomic(this.recordPath(record.id), JSON.stringify(record, null, 2))
  }

  private async detectJavaCached(): Promise<JavaProbe> {
    const now = this.now()
    if (this.javaCache && now - this.javaCache.at < JAVA_TTL_MS) return this.javaCache.probe
    const probe = await this.detectJavaFn()
    this.javaCache = { at: now, probe }
    return probe
  }

  private async computeStatus(id: string): Promise<MinecraftServerStatus> {
    const runtime = this.runtime.get(id) ?? null
    const record = await this.readRecord(id)
    const java = await this.detectJavaCached()
    const dir = record?.dir ?? runtime?.transientDir ?? null
    const versionId = record?.versionId ?? runtime?.transientVersionId ?? null
    const requiredJavaMajor = record?.requiredJavaMajor ?? null
    const compat = checkJavaCompatibility(requiredJavaMajor, java.major)

    const status: MinecraftServerStatus = {
      id,
      phase: 'unconfigured',
      dir,
      versionId,
      eulaAccepted: false,
      installedJavaMajor: java.major,
      installedJavaPath: java.path,
      requiredJavaMajor,
      javaOk: compat.ok,
      javaReason: compat.reason ?? null,
      error: null,
      pid: runtime?.proc?.pid ?? null,
      startedAt: runtime?.startedAt ?? null,
      downloadedBytes: null,
      totalBytes: null,
      downloadPercent: null
    }

    if (runtime?.downloading) {
      status.phase = 'downloading'
      status.downloadedBytes = runtime.downloadedBytes
      status.totalBytes = runtime.totalBytes
      status.downloadPercent = runtime.downloadPercent
      return status
    }
    if (runtime?.proc) {
      status.phase = runtime.stopping ? 'stopping' : 'running'
      return status
    }
    if (runtime?.error) {
      status.phase = 'error'
      status.error = runtime.error
      return status
    }
    if (!record) return status // 'unconfigured'

    const jarPath = path.join(record.dir, SERVER_JAR)
    if (!(await pathExists(jarPath))) {
      status.phase = 'not-installed'
      return status
    }

    status.eulaAccepted = await readEulaAccepted(record.dir)
    status.phase = status.eulaAccepted ? 'stopped' : 'needs-eula'
    return status
  }

  private async emitStatus(id: string): Promise<MinecraftServerStatus> {
    const status = await this.computeStatus(id)
    this.onEvent?.({ kind: 'status', id, status })
    return status
  }

  /** A one-shot refusal that reports the REAL current phase plus this call's own reason, without
   *  mutating persisted runtime state — so an invalid request (a bad id, an absolute-path check)
   *  never sticks the instance in an 'error' phase that outlives the request that caused it. */
  private async oneShotError(id: string, message: string): Promise<MinecraftServerStatus> {
    const status = await this.computeStatus(id)
    return { ...status, phase: 'error', error: message }
  }

  /**
   * `totalBytes` is only ever set when the response's own `Content-Length` said so — Mojang's
   * per-version metadata does not always publish a `size` (measured against the live manifest:
   * absent for the current release), so `downloadPercent` must stay honestly null right along
   * with it rather than being computed from a total that was never actually stated. A UI with no
   * total should show real bytes-downloaded and an indeterminate indicator, never a fabricated
   * percentage.
   */
  private emitDownloadProgress(id: string, downloadedBytes: number, totalBytes: number | null): void {
    const runtime = this.getRuntime(id)
    const percent = totalBytes ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : null
    if (runtime.downloadedBytes === downloadedBytes && runtime.downloadPercent === percent) return
    runtime.downloadedBytes = downloadedBytes
    runtime.totalBytes = totalBytes
    runtime.downloadPercent = percent
    this.onEvent?.({
      kind: 'status',
      id,
      status: {
        id,
        phase: 'downloading',
        dir: runtime.transientDir,
        versionId: runtime.transientVersionId,
        eulaAccepted: false,
        installedJavaMajor: null,
        installedJavaPath: null,
        requiredJavaMajor: null,
        javaOk: true,
        javaReason: null,
        error: null,
        pid: null,
        startedAt: null,
        downloadedBytes,
        totalBytes,
        downloadPercent: percent
      }
    })
  }

  private pushConsole(id: string, stream: 'stdout' | 'stderr', text: string): void {
    const runtime = this.getRuntime(id)
    const line: MinecraftConsoleLine = { seq: ++runtime.seq, stream, text, at: this.now() }
    runtime.console.push(line)
    if (runtime.console.length > CONSOLE_LINE_CAP) runtime.console.shift()
    this.onEvent?.({ kind: 'console', id, line })
  }

  private consumeChunk(id: string, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const runtime = this.getRuntime(id)
    const key = stream === 'stdout' ? 'outBuf' : 'errBuf'
    runtime[key] += chunk.toString('utf-8')
    const lines = runtime[key].split('\n')
    runtime[key] = lines.pop() ?? ''
    for (const line of lines) this.pushConsole(id, stream, line.replace(/\r$/, ''))
  }

  /**
   * Streams `url` to `jarPath`, hashing as it writes, verifying against `expectedSha1`, and only
   * then renaming the unique temp file into place — the same "download to a temp, verify, rename"
   * discipline `whisper-models.ts` uses for its own binary downloads, simplified because a
   * server's jar has exactly one writer (its own instance directory) rather than a shared cache
   * several processes could be filling at once.
   */
  private async downloadAndVerify(
    id: string,
    url: string,
    jarPath: string,
    expectedSha1: string
  ): Promise<void> {
    const tmp = tempNameFor(jarPath)
    const res = await this.fetchBinary(url)
    if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`)
    // Honest, not assumed: Mojang's per-version metadata does not always publish a size, and
    // measured directly against the live manifest it was absent for the current release. A
    // missing/zero header means "unknown total", never "0 bytes".
    const headerTotal = Number(res.headers.get('content-length'))
    const total = Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : null
    let received = 0
    const hash = createHash('sha1')
    const sink = createWriteStream(tmp)
    try {
      const reader = res.body.getReader()
      const writer = Writable.toWeb(sink).getWriter()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value)
        hash.update(value)
        received += value.byteLength
        this.emitDownloadProgress(id, received, total)
      }
      await writer.close()
    } catch (e) {
      sink.destroy()
      await rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    const verified = verifySha1(expectedSha1, hash.digest('hex'))
    if (!verified.ok) {
      await rm(tmp, { force: true }).catch(() => {})
      throw new Error(verified.reason ?? 'The download did not match its published checksum.')
    }
    await renameAtomic(tmp, jarPath)
    // No final 100%/verified progress event here on purpose: create() immediately continues to
    // write eula.txt and the instance record, then emits the real next status (needs-eula or
    // error) — a synthetic "download complete" tick between those two would only flicker.
  }

  // ---- public surface (mirrors shared/minecraft.ts's MinecraftApi) ------------------------

  async versions(): Promise<MinecraftVersionList> {
    const now = this.now()
    if (this.manifestCache && now - this.manifestCache.at < MANIFEST_TTL_MS) {
      return this.manifestCache.list
    }
    const doc = await this.fetchJson(this.manifestUrl)
    const versions = parseVersionManifest(doc).map((v) => ({ id: v.id, type: v.type }))
    const latest = parseLatestVersions(doc)
    const list: MinecraftVersionList = {
      versions,
      latestRelease: latest?.release ?? null,
      latestSnapshot: latest?.snapshot ?? null
    }
    this.manifestCache = { at: now, list }
    return list
  }

  async status(id: string): Promise<MinecraftServerStatus> {
    return this.computeStatus(id)
  }

  async recentConsole(id: string): Promise<MinecraftConsoleLine[]> {
    return [...(this.runtime.get(id)?.console ?? [])]
  }

  async create(input: MinecraftCreateInput): Promise<MinecraftServerStatus> {
    const { id, versionId, dir } = input
    if (!SAFE_ID.test(id)) return this.oneShotError(id, 'That is not a valid instance id.')
    if (!path.isAbsolute(dir)) {
      return this.oneShotError(id, 'The server directory must be an absolute path — choose it with the folder picker.')
    }
    const runtime = this.getRuntime(id)
    if (runtime.downloading) return this.emitStatus(id) // a create() is already in flight
    if (runtime.proc) return this.oneShotError(id, 'Stop the running server before creating over it.')

    runtime.downloading = true
    runtime.downloadedBytes = 0
    runtime.totalBytes = null
    runtime.downloadPercent = null
    runtime.error = null
    runtime.transientDir = dir
    runtime.transientVersionId = versionId
    await this.emitStatus(id)

    try {
      const download = await resolveServerDownload(versionId, this.fetchJson, this.manifestUrl)
      if (download.requiredJavaMajor !== null) {
        const java = await this.ensureJavaFn(download.requiredJavaMajor)
        this.javaCache = { at: this.now(), probe: java }
      }
      const url = new URL(download.url)
      if (url.protocol !== 'https:') {
        throw new Error('The published download is not https; refusing it.')
      }
      await mkdir(dir, { recursive: true })
      const jarPath = path.join(dir, SERVER_JAR)
      await this.downloadAndVerify(id, url.toString(), jarPath, download.sha1)
      // Mojang's own default, and the only value create() ever writes: false. See acceptEula.
      await writeFile(path.join(dir, 'eula.txt'), eulaFileContent(false), 'utf-8')
      const record: InstanceRecord = {
        id,
        dir,
        versionId,
        sha1: download.sha1,
        requiredJavaMajor: download.requiredJavaMajor,
        createdAt: this.now()
      }
      await this.writeRecord(record)
    } catch (e) {
      runtime.error = describeError(e)
    } finally {
      runtime.downloading = false
      runtime.transientDir = null
      runtime.transientVersionId = null
    }
    return this.emitStatus(id)
  }

  async acceptEula(id: string): Promise<MinecraftServerStatus> {
    const record = await this.readRecord(id)
    if (!record) return this.oneShotError(id, 'No server has been created for this node yet.')
    await writeFile(path.join(record.dir, 'eula.txt'), eulaFileContent(true), 'utf-8')
    return this.emitStatus(id)
  }

  async start(id: string): Promise<MinecraftServerStatus> {
    const runtime = this.getRuntime(id)
    if (runtime.proc) return this.computeStatus(id) // already running or stopping — no-op
    const record = await this.readRecord(id)
    if (!record) return this.oneShotError(id, 'No server has been created for this node yet.')
    const jarPath = path.join(record.dir, SERVER_JAR)
    if (!(await pathExists(jarPath))) {
      return this.oneShotError(id, 'The server jar is missing on disk. Create the server again.')
    }
    if (!(await readEulaAccepted(record.dir))) {
      return this.oneShotError(id, 'The Minecraft EULA has not been accepted yet.')
    }
    let java = await this.detectJavaCached()
    if (record.requiredJavaMajor !== null && (!java.path || java.major === null || java.major < record.requiredJavaMajor)) {
      try {
        java = await this.ensureJavaFn(record.requiredJavaMajor)
        this.javaCache = { at: this.now(), probe: java }
      } catch (e) {
        runtime.error = `Java ${record.requiredJavaMajor} could not be installed automatically: ${describeError(e)}`
        return this.emitStatus(id)
      }
    }
    const compat = checkJavaCompatibility(record.requiredJavaMajor, java.major)
    if (!compat.ok) {
      runtime.error = compat.reason ?? 'This Java runtime is not compatible with this Minecraft version.'
      return this.emitStatus(id)
    }
    if (!java.path) return this.oneShotError(id, 'No Java runtime could be found on this machine.')

    runtime.error = null
    let proc: ChildProcess
    try {
      proc = this.spawnFn(java.path, ['-jar', SERVER_JAR, 'nogui'], {
        cwd: record.dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (e) {
      runtime.error = `The server process could not be started: ${describeError(e)}`
      return this.emitStatus(id)
    }
    runtime.proc = proc
    runtime.stopping = false
    runtime.startedAt = this.now()
    runtime.outBuf = ''
    runtime.errBuf = ''

    proc.stdout?.on('data', (chunk: Buffer) => this.consumeChunk(id, 'stdout', chunk))
    proc.stderr?.on('data', (chunk: Buffer) => this.consumeChunk(id, 'stderr', chunk))
    proc.once('error', (err) => {
      runtime.proc = null
      runtime.startedAt = null
      runtime.error = `The server process could not be started: ${err.message}`
      void this.emitStatus(id)
    })
    proc.once('exit', (code, signal) => {
      const wasStopping = runtime.stopping
      runtime.proc = null
      runtime.stopping = false
      runtime.startedAt = null
      if (!wasStopping) {
        runtime.error =
          code === 0 || code === null
            ? null
            : `The server process exited unexpectedly with code ${code}${signal ? ` (${signal})` : ''}. See the console output above.`
      }
      this.pushConsole(
        id,
        'stderr',
        `[nodeterm] server process exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`
      )
      void this.emitStatus(id)
    })

    return this.emitStatus(id)
  }

  /**
   * Graceful, bounded, then forceful — the standard shape this codebase uses everywhere a live
   * process must end (`spawnAgent`'s SIGKILL timeout, the session-host's stop sequence): ask
   * nicely via the console (which is what actually triggers Minecraft's own world-save-then-exit),
   * give it real time to finish, then escalate. Resolves once the process has actually exited.
   */
  async stop(id: string): Promise<MinecraftServerStatus> {
    const runtime = this.getRuntime(id)
    if (!runtime.proc) return this.computeStatus(id) // not running — no-op
    if (runtime.stopping) return this.computeStatus(id) // a stop is already in flight
    const proc = runtime.proc
    runtime.stopping = true
    await this.emitStatus(id)
    // The process can exit DURING the await above — start()'s own exit handler already ran, ran
    // its cleanup, and cleared runtime.proc. Waiting on `proc.once('exit', ...)` below would then
    // wait forever (the event already fired once and never fires again), stalling this call for
    // the full STOP_GRACE_MS + STOP_FORCE_MS on a process that is already gone. exitCode/signalCode
    // are Node's own synchronous "has this already exited" answer — check before waiting on it.
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return this.computeStatus(id)
    }
    try {
      proc.stdin?.write('stop\n')
    } catch {
      // stdin already gone (process died between the check above and here) — the exit/timeout
      // handling below still resolves this call either way.
    }
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const graceful = setTimeout(() => {
        try {
          proc.kill('SIGTERM')
        } catch {
          // already gone
        }
      }, STOP_GRACE_MS)
      const forceful = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // already gone
        }
        finish()
      }, STOP_GRACE_MS + STOP_FORCE_MS)
      proc.once('exit', () => {
        clearTimeout(graceful)
        clearTimeout(forceful)
        finish()
      })
    })
    return this.computeStatus(id)
  }

  async sendCommand(id: string, command: string): Promise<boolean> {
    const runtime = this.runtime.get(id)
    if (!runtime?.proc || runtime.stopping) return false
    const trimmed = command.replace(/[\r\n]+/g, ' ').trim()
    if (!trimmed) return false
    try {
      runtime.proc.stdin?.write(`${trimmed}\n`)
      return true
    } catch {
      return false
    }
  }

  async remove(id: string, deleteFiles: boolean): Promise<void> {
    if (!SAFE_ID.test(id)) return
    if (this.runtime.get(id)?.proc) await this.stop(id)
    const record = await this.readRecord(id)
    if (deleteFiles && record) {
      await rm(record.dir, { recursive: true, force: true }).catch(() => {})
    }
    await rm(this.recordPath(id), { force: true }).catch(() => {})
    this.runtime.delete(id)
    await this.emitStatus(id)
  }

  /**
   * Called at shell shutdown. Deliberately synchronous and fire-and-forget rather than the awaited
   * `stop()` above: a managed server is an ordinary child process, and an ordinary child process is
   * NOT killed by its parent quitting (on any platform this app targets) — it is reparented and
   * keeps running. So there is nothing to wait for here; writing "stop" is enough to make the
   * server shut down gracefully on its own schedule, independent of whether this shell is still
   * alive to see it happen. Blocking app quit for up to `STOP_GRACE_MS + STOP_FORCE_MS` per
   * instance, as the awaited `stop()` does, would make quitting nodeterm feel broken for the sake
   * of watching an exit this module has no need to witness.
   */
  requestGracefulStopAll(): void {
    for (const runtime of this.runtime.values()) {
      if (runtime.proc && !runtime.stopping) {
        runtime.stopping = true
        try {
          runtime.proc.stdin?.write('stop\n')
        } catch {
          // already gone
        }
      }
    }
  }
}
