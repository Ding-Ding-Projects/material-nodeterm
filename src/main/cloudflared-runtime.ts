import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { IPC } from '../shared/ipc'
import type { CorePlatform } from '../core/platform'
import {
  CLOUDFLARED_DEFAULT_IMAGE,
  CLOUDFLARED_TOKEN_FILE_NAME,
  type CloudflaredRuntimeApi,
  type CloudflaredRuntimeKind,
  type CloudflaredRuntimeSettings,
  type CloudflaredRuntimeStatus
} from '../shared/cloudflared'

const execFileAsync = promisify(execFile)
const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const SAFE_IMAGE = /^cloudflare\/cloudflared(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})$/
const SAFE_DIGEST = /^cloudflare\/cloudflared@sha256:[a-f0-9]{64}$/
const TOKEN_LIMIT = 8192
const LOG_LINES = 120
const HEALTH_SIGNAL = /(registered tunnel connection|connection .* registered|connection .* healthy)/i

interface RuntimeEntry {
  status: CloudflaredRuntimeStatus
  child: ChildProcess | null
  tokenDir: string
  serviceName: string
  resolvedImage: string | null
  recentLog: string[]
}

interface CloudflaredRuntimeOptions {
  userDataDir: string
  resourcesPath?: string
  /** Allows the packaged build to resolve its bundled binary without consulting PATH. */
  binaryPath?: string
  /** Dependency download is explicit and verified against the release asset digest. */
  fetchImpl?: typeof fetch
}

function safeNodeId(nodeId: string): string {
  if (!SAFE_NODE_ID.test(nodeId)) throw new Error('The connector node identity is invalid.')
  return nodeId
}

function validateSettings(settings: CloudflaredRuntimeSettings): CloudflaredRuntimeSettings {
  if (!['process', 'windows-service', 'docker'].includes(settings.runtime)) {
    throw new Error('Choose a supported connector runtime.')
  }
  let origin: URL
  try { origin = new URL(settings.origin) } catch { throw new Error('The origin must be a complete http:// or https:// URL.') }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('The origin must use http:// or https:// without embedded credentials.')
  }
  const image = settings.image.trim() || CLOUDFLARED_DEFAULT_IMAGE
  if (!SAFE_IMAGE.test(image)) throw new Error('Choose an official cloudflare/cloudflared image tag or digest.')
  return {
    runtime: settings.runtime,
    origin: origin.href,
    image,
    cpus: Math.min(4, Math.max(0.25, Number.isFinite(settings.cpus) ? settings.cpus : 1)),
    memoryMb: Math.min(4096, Math.max(128, Math.round(Number.isFinite(settings.memoryMb) ? settings.memoryMb : 512))),
    pidsLimit: Math.min(1024, Math.max(32, Math.round(Number.isFinite(settings.pidsLimit) ? settings.pidsLimit : 128)))
  }
}

function initialStatus(runtime: CloudflaredRuntimeKind): CloudflaredRuntimeStatus {
  return {
    phase: 'unconfigured', runtime, pid: null, containerName: null, imageDigest: null,
    tokenFile: null, startedAt: null, lastHealthAt: null, health: 'unknown', detail: null, recentLog: []
  }
}

function redactLine(line: string): string {
  return line
    .replace(/(token(?:[-_ ]?file)?|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/--token(?:-file)?\s+[^\s]+/gi, '--token-file [redacted]')
    .slice(-4000)
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ['TUNNEL_TOKEN', 'CLOUDFLARED_TOKEN', 'CF_TUNNEL_TOKEN', 'CLOUDFLARED_TUNNEL_TOKEN']) delete env[key]
  return env
}

function powershellEncoded(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function powershellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function runElevated(executable: string, args: string[], cwd: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Windows service management is available on Windows only.')
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$a = ConvertFrom-Json ${powershellSingleQuote(JSON.stringify(args))}`,
    `$p = Start-Process -FilePath ${powershellSingleQuote(executable)} -ArgumentList $a -Verb RunAs -Wait -PassThru`,
    'if ($p.ExitCode -ne 0) { exit $p.ExitCode }'
  ].join(';')
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)], {
      cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
    })
    let error = ''
    child.stderr?.on('data', (chunk) => { error = (error + chunk.toString()).slice(-4000) })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error(error.trim() || `Elevated command exited with ${code}.`)))
  })
}

export class CloudflaredRuntimeManager implements CloudflaredRuntimeApi {
  private readonly entries = new Map<string, RuntimeEntry>()
  private readonly listeners = new Set<(event: { nodeId: string; status: CloudflaredRuntimeStatus }) => void>()
  private readonly fetchImpl: typeof fetch
  private readonly binaryPathOverride?: string

  constructor(private readonly options: CloudflaredRuntimeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.binaryPathOverride = options.binaryPath
  }

  private entry(nodeId: string, runtime: CloudflaredRuntimeKind = 'process'): RuntimeEntry {
    safeNodeId(nodeId)
    let found = this.entries.get(nodeId)
    if (!found) {
      const tokenDir = path.join(this.options.userDataDir, 'cloudflared', nodeId)
      found = {
        status: initialStatus(runtime), child: null, tokenDir,
        serviceName: `nodeterm-cloudflared-${nodeId}`, resolvedImage: null, recentLog: []
      }
      this.entries.set(nodeId, found)
    }
    return found
  }

  private publish(nodeId: string, entry: RuntimeEntry): CloudflaredRuntimeStatus {
    entry.status = { ...entry.status, recentLog: [...entry.recentLog] }
    const snapshot = { ...entry.status, recentLog: [...entry.status.recentLog] }
    for (const listener of this.listeners) listener({ nodeId, status: snapshot })
    return snapshot
  }

  private appendLog(nodeId: string, line: string): void {
    const entry = this.entry(nodeId)
    const clean = redactLine(line).trim()
    if (!clean) return
    entry.recentLog.push(clean)
    if (entry.recentLog.length > LOG_LINES) entry.recentLog.splice(0, entry.recentLog.length - LOG_LINES)
    if (HEALTH_SIGNAL.test(clean)) {
      entry.status.health = 'healthy'
      entry.status.lastHealthAt = Date.now()
    }
    this.publish(nodeId, entry)
  }

  private tokenFile(entry: RuntimeEntry): string { return path.join(entry.tokenDir, CLOUDFLARED_TOKEN_FILE_NAME) }

  private async protectTokenFile(file: string): Promise<void> {
    if (process.platform === 'win32') {
      const account = `${process.env.USERDOMAIN ?? '.'}\\${process.env.USERNAME ?? 'current-user'}`
      // The demand-start service runs under LocalSystem unless the user supplies a separate
      // service account. Grant only LocalSystem and the current user read access, with inheritance
      // removed, so the service can consume the file without making it world-readable.
      await execFileAsync('icacls.exe', [file, '/inheritance:r', '/grant:r', `${account}:(R,W)`, '/grant:r', 'SYSTEM:(R)'], { windowsHide: true, timeout: 10_000 })
    } else {
      await chmod(file, 0o600)
    }
  }

  async setToken(nodeId: string, token: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.entry(nodeId)
    const value = token.trim()
    if (!value || value.length > TOKEN_LIMIT || /[\u0000-\u001f\u007f]/.test(value)) {
      return { ok: false, error: 'Enter a connector token without line breaks or control characters.' }
    }
    await mkdir(entry.tokenDir, { recursive: true })
    const temp = `${this.tokenFile(entry)}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, `${value}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await protectTokenFile(temp)
      await rename(temp, this.tokenFile(entry))
      await protectTokenFile(this.tokenFile(entry))
      entry.status = { ...entry.status, tokenFile: this.tokenFile(entry), detail: null }
      this.publish(nodeId, entry)
      return { ok: true }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      return { ok: false, error: `The connector token could not be stored safely: ${(error as Error).message}` }
    }
  }

  async clearToken(nodeId: string): Promise<void> {
    const entry = this.entry(nodeId)
    await this.stop(nodeId).catch(() => {})
    await rm(entry.tokenDir, { recursive: true, force: true })
    entry.status = { ...initialStatus(entry.status.runtime), detail: null }
    entry.recentLog = []
    this.publish(nodeId, entry)
  }

  private async requireToken(entry: RuntimeEntry): Promise<string> {
    const file = this.tokenFile(entry)
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size === 0 || info.size > TOKEN_LIMIT + 1) throw new Error('missing or oversized token file')
      return file
    } catch {
      throw new Error('Add a connector token first. It is kept in a protected local file and never passed as a command argument or environment value.')
    }
  }

  private async resolveBinary(): Promise<string> {
    const candidates = [
      this.binaryPathOverride,
      this.options.resourcesPath ? path.join(this.options.resourcesPath, 'cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared') : undefined,
      path.join(this.options.userDataDir, 'cloudflared', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
    ].filter((v): v is string => !!v)
    for (const candidate of candidates) {
      try { await access(candidate); return candidate } catch { /* try next */ }
    }
    if (process.platform !== 'win32') throw new Error('The managed cloudflared binary is not bundled for this platform.')

    const response = await this.fetchImpl('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'nodeterm-cloudflared-manager' }, signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`The official cloudflared release metadata returned HTTP ${response.status}.`)
    const release = await response.json() as { assets?: Array<{ name?: string; browser_download_url?: string; digest?: string }> }
    const asset = release.assets?.find((item) => item.name === 'cloudflared-windows-amd64.exe')
    if (!asset?.browser_download_url || !asset.digest?.startsWith('sha256:')) throw new Error('The official release did not publish a verifiable Windows checksum.')
    const binary = await this.fetchImpl(asset.browser_download_url, { headers: { 'user-agent': 'nodeterm-cloudflared-manager' }, signal: AbortSignal.timeout(120_000) })
    if (!binary.ok) throw new Error(`The official cloudflared binary returned HTTP ${binary.status}.`)
    const bytes = Buffer.from(await binary.arrayBuffer())
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (digest !== asset.digest) throw new Error('The downloaded cloudflared binary checksum did not match the official release.')
    const destination = candidates[candidates.length - 1]
    await mkdir(path.dirname(destination), { recursive: true })
    const temp = `${destination}.${randomUUID()}.tmp`
    await writeFile(temp, bytes, { flag: 'wx' })
    await rename(temp, destination)
    return destination
  }

  private async resolveImage(entry: RuntimeEntry, image: string): Promise<string> {
    await execFileAsync('docker.exe', ['pull', image], { windowsHide: true, timeout: 15 * 60_000, maxBuffer: 512 * 1024 })
    const { stdout } = await execFileAsync('docker.exe', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}'], { windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 })
    let digests: unknown
    try { digests = JSON.parse(stdout) } catch { throw new Error('Docker returned an unreadable image digest.') }
    const digest = Array.isArray(digests) ? digests.find((value): value is string => typeof value === 'string' && SAFE_DIGEST.test(value)) : undefined
    if (!digest) throw new Error('The cloudflared image did not resolve to an official sha256 digest.')
    if (SAFE_DIGEST.test(image) && digest !== image) throw new Error('Docker resolved a different cloudflared digest than the one selected.')
    entry.resolvedImage = digest
    return digest
  }

  async status(nodeId: string, runtime?: CloudflaredRuntimeKind): Promise<CloudflaredRuntimeStatus> { return this.reconcile(nodeId, runtime) }

  async start(nodeId: string, rawSettings: CloudflaredRuntimeSettings): Promise<CloudflaredRuntimeStatus> {
    const settings = validateSettings(rawSettings)
    if (process.platform !== 'win32' && settings.runtime === 'windows-service') throw new Error('Windows service runtime is available on Windows only.')
    const entry = this.entry(nodeId, settings.runtime)
    await this.stop(nodeId).catch(() => {})
    const token = await this.requireToken(entry)
    entry.status = { ...entry.status, runtime: settings.runtime, phase: 'starting', detail: null, health: 'unknown', tokenFile: token, startedAt: null, pid: null, containerName: null }
    this.publish(nodeId, entry)
    try {
      if (settings.runtime === 'docker') {
        const image = await this.resolveImage(entry, settings.image)
        // Deterministic per-node identity lets a fresh app process reconcile a connector that kept
        // running in Docker after the desktop closed. The node id is validated before it reaches
        // this name, so a project file cannot smuggle Docker flags through it.
        const containerName = `nodeterm-cloudflared-${nodeId}`
        const args = [
          'run', '--detach', '--rm', '--name', containerName,
          '--label', 'dev.nodeterm.owner=nodeterm', '--label', `dev.nodeterm.node=${nodeId}`,
          '--read-only', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
          '--network', 'bridge', '--cpus', String(settings.cpus), '--memory', `${settings.memoryMb}m`, '--pids-limit', String(settings.pidsLimit),
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,source=${token},target=/run/secrets/cloudflared-token,readonly`,
          image, 'tunnel', '--no-autoupdate', 'run', '--token-file', '/run/secrets/cloudflared-token'
        ]
        await execFileAsync('docker.exe', args, { windowsHide: true, timeout: 60_000, maxBuffer: 256 * 1024 })
        entry.status = { ...entry.status, phase: 'running', containerName, imageDigest: image, startedAt: Date.now(), health: 'unknown' }
        this.publish(nodeId, entry)
        return this.reconcile(nodeId)
      }
      const binary = await this.resolveBinary()
      if (settings.runtime === 'windows-service') return this.installServiceWithBinary(nodeId, settings, entry, binary, token)
      const child = spawn(binary, ['tunnel', '--no-autoupdate', 'run', '--token-file', token], {
        cwd: entry.tokenDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: runtimeEnvironment()
      })
      entry.child = child
      child.stdout?.on('data', (chunk) => String(chunk).split(/\r?\n/).forEach((line) => this.appendLog(nodeId, line)))
      child.stderr?.on('data', (chunk) => String(chunk).split(/\r?\n/).forEach((line) => this.appendLog(nodeId, line)))
      child.once('error', (error) => {
        entry.child = null
        entry.status = { ...entry.status, phase: 'failed', detail: `cloudflared could not start: ${error.message}`, pid: null }
        this.publish(nodeId, entry)
      })
      child.once('close', (code) => {
        entry.child = null
        if (entry.status.phase !== 'stopping') entry.status = { ...entry.status, phase: code === 0 ? 'stopped' : 'failed', detail: code === 0 ? null : `cloudflared exited with code ${code}.`, pid: null, health: 'unhealthy' }
        else entry.status = { ...entry.status, phase: 'stopped', pid: null, health: 'unknown' }
        this.publish(nodeId, entry)
      })
      entry.status = { ...entry.status, phase: 'running', pid: child.pid ?? null, startedAt: Date.now(), health: 'unknown' }
      this.publish(nodeId, entry)
      return this.reconcile(nodeId)
    } catch (error) {
      entry.status = { ...entry.status, phase: 'failed', detail: redactLine((error as Error).message), pid: null, containerName: null, health: 'unhealthy' }
      this.publish(nodeId, entry)
      throw error
    }
  }

  private async installServiceWithBinary(nodeId: string, settings: CloudflaredRuntimeSettings, entry: RuntimeEntry, binary: string, token: string): Promise<CloudflaredRuntimeStatus> {
    const binPath = `"${binary}" tunnel --no-autoupdate run --token-file "${token}"`
    await runElevated('sc.exe', ['create', entry.serviceName, 'binPath=', binPath, 'start=', 'demand', 'DisplayName=', `nodeterm cloudflared connector ${nodeId}`], entry.tokenDir)
    await runElevated('sc.exe', ['start', entry.serviceName], entry.tokenDir)
    entry.status = { ...entry.status, runtime: settings.runtime, phase: 'running', startedAt: Date.now(), health: 'unknown', detail: 'Windows service installed and started with explicit UAC consent.' }
    this.publish(nodeId, entry)
    return this.reconcile(nodeId)
  }

  async installWindowsService(nodeId: string, settings: CloudflaredRuntimeSettings): Promise<CloudflaredRuntimeStatus> {
    if (settings.runtime !== 'windows-service') settings = { ...settings, runtime: 'windows-service' }
    return this.start(nodeId, settings)
  }

  async stop(nodeId: string): Promise<CloudflaredRuntimeStatus> {
    const entry = this.entry(nodeId)
    if (entry.status.runtime === 'windows-service' && entry.status.phase === 'running') {
      entry.status = { ...entry.status, phase: 'stopping' }
      this.publish(nodeId, entry)
      await runElevated('sc.exe', ['stop', entry.serviceName], entry.tokenDir).catch(() => {})
    }
    if (entry.status.containerName) {
      const name = entry.status.containerName
      entry.status = { ...entry.status, phase: 'stopping' }
      this.publish(nodeId, entry)
      await execFileAsync('docker.exe', ['rm', '--force', name], { windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 }).catch(() => {})
      entry.status = { ...entry.status, phase: 'stopped', containerName: null, pid: null, health: 'unknown' }
      this.publish(nodeId, entry)
    }
    if (entry.child) {
      const child = entry.child
      entry.status = { ...entry.status, phase: 'stopping' }
      this.publish(nodeId, entry)
      child.kill()
      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(resolvePromise, 5000)
        child.once('close', () => { clearTimeout(timer); resolvePromise() })
      })
    }
    if (entry.status.phase === 'stopping') entry.status = { ...entry.status, phase: 'stopped', pid: null, containerName: null, health: 'unknown' }
    return this.publish(nodeId, entry)
  }

  async uninstall(nodeId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.entry(nodeId)
    try {
      await this.stop(nodeId)
      if (entry.status.runtime === 'windows-service') await runElevated('sc.exe', ['delete', entry.serviceName], entry.tokenDir)
      await rm(entry.tokenDir, { recursive: true, force: true })
      entry.status = initialStatus(entry.status.runtime)
      entry.recentLog = []
      this.publish(nodeId, entry)
      return { ok: true }
    } catch (error) {
      entry.status = { ...entry.status, phase: 'failed', detail: redactLine((error as Error).message) }
      this.publish(nodeId, entry)
      return { ok: false, error: entry.status.detail ?? 'The connector could not be uninstalled.' }
    }
  }

  async reconcile(nodeId: string, runtime?: CloudflaredRuntimeKind): Promise<CloudflaredRuntimeStatus> {
    const entry = this.entry(nodeId, runtime ?? 'process')
    if (runtime && entry.status.phase === 'unconfigured') entry.status.runtime = runtime
    if (entry.child) {
      if (entry.child.exitCode !== null) entry.child = null
      else if (entry.status.phase === 'running' && entry.status.health === 'unknown') entry.status.detail = 'Process is running; waiting for a registered tunnel connection signal.'
      return this.publish(nodeId, entry)
    }
    if (entry.status.containerName) {
      try {
        const { stdout } = await execFileAsync('docker.exe', ['inspect', entry.status.containerName, '--format', '{{.State.Running}}'], { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 })
        const running = stdout.trim() === 'true'
        entry.status = { ...entry.status, phase: running ? 'running' : 'stopped', health: running ? entry.status.health : 'unhealthy', lastHealthAt: running ? entry.status.lastHealthAt : Date.now(), detail: running ? entry.status.detail : 'The Docker connector is no longer running.' }
      } catch {
        entry.status = { ...entry.status, phase: 'degraded', health: 'unknown', detail: 'Docker could not confirm the connector container state.' }
      }
    }
    // Docker containers intentionally outlive the renderer process. Re-discover the exact
    // task-owned name after a desktop restart rather than claiming the connector vanished merely
    // because this manager instance has no in-memory entry yet.
    if (!entry.status.containerName && entry.status.runtime === 'docker') {
      const knownName = `nodeterm-cloudflared-${nodeId}`
      try {
        const { stdout } = await execFileAsync('docker.exe', ['inspect', knownName, '--format', '{{.State.Running}}'], { windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 })
        entry.status = { ...entry.status, containerName: knownName, phase: stdout.trim() === 'true' ? 'running' : 'stopped', health: stdout.trim() === 'true' ? 'unknown' : 'unhealthy', detail: stdout.trim() === 'true' ? 'Docker connector found after app restart; waiting for a health signal.' : 'The Docker connector is not running.' }
      } catch { /* no task-owned container exists */ }
    }
    if (entry.status.runtime === 'windows-service' && process.platform === 'win32') {
      try {
        const { stdout } = await execFileAsync('sc.exe', ['query', entry.serviceName], { windowsHide: true, timeout: 10_000, maxBuffer: 32 * 1024 })
        const running = /STATE\s*:\s*4\s+RUNNING/i.test(stdout)
        entry.status = { ...entry.status, phase: running ? 'running' : 'stopped', health: running ? entry.status.health : 'unhealthy', lastHealthAt: running ? entry.status.lastHealthAt : Date.now(), detail: running ? entry.status.detail : 'The Windows service is installed but not running.' }
      } catch {
        // A service that has never been installed is unconfigured, not a healthy connector.
        if (entry.status.phase === 'running' || entry.status.phase === 'stopped') entry.status = { ...entry.status, phase: 'degraded', health: 'unknown', detail: 'Windows could not confirm the connector service state.' }
      }
    }
    return this.publish(nodeId, entry)
  }

  onStatus(listener: (event: { nodeId: string; status: CloudflaredRuntimeStatus }) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function registerCloudflaredIpc(platform: CorePlatform, options: CloudflaredRuntimeOptions): CloudflaredRuntimeManager {
  const manager = new CloudflaredRuntimeManager(options)
  platform.handle(IPC.cloudflaredStatus, (nodeId: string, runtime?: CloudflaredRuntimeKind) => manager.status(nodeId, runtime))
  platform.handle(IPC.cloudflaredSetToken, (nodeId: string, token: string) => manager.setToken(nodeId, token))
  platform.handle(IPC.cloudflaredClearToken, (nodeId: string) => manager.clearToken(nodeId))
  platform.handle(IPC.cloudflaredStart, (nodeId: string, settings: CloudflaredRuntimeSettings) => manager.start(nodeId, settings))
  platform.handle(IPC.cloudflaredStop, (nodeId: string) => manager.stop(nodeId))
  platform.handle(IPC.cloudflaredUninstall, (nodeId: string) => manager.uninstall(nodeId))
  platform.handle(IPC.cloudflaredReconcile, (nodeId: string, runtime?: CloudflaredRuntimeKind) => manager.reconcile(nodeId, runtime))
  platform.handle(IPC.cloudflaredInstallService, (nodeId: string, settings: CloudflaredRuntimeSettings) => manager.installWindowsService(nodeId, settings))
  manager.onStatus((event) => platform.broadcast(IPC.cloudflaredStatusEvent, event))
  return manager
}
