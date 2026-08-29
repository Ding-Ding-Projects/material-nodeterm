import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { base32Decode, base32Encode, totp } from '../core/toylocks/totp'
import type { ServerDeploymentStage } from '../shared/types'

export interface ServerDeploymentResult {
  ok: boolean
  state: 'ready' | 'docker-restart-required' | 'failed'
  url?: string
  totpCode?: string
  error?: string
}

const DEPLOYED_URL = 'http://127.0.0.1:8443'

/** Turns a raw `docker compose`/host.bat failure into a message that names WHICH thing went
 *  wrong and what to do about it, rather than the generic "it failed" a user cannot act on
 *  (CLAUDE.md: "Honest failure states... each says which, and what to do — never a generic
 *  'try again'"). The raw message is preserved as the tail of the friendly one so nothing is
 *  lost for anyone who needs the real log line. */
export function classifyComposeFailure(rawMessage: string): string {
  const message = rawMessage.trim()
  const lower = message.toLowerCase()
  if (lower.includes('address already in use') || lower.includes('port is already allocated')) {
    return `Port 8443 is already in use by another program on this machine. Close whatever is using it, then try again. (${message.split('\n').filter(Boolean).pop() ?? message})`
  }
  if (
    lower.includes('failed to solve') ||
    lower.includes('failed to build') ||
    lower.includes('copy failed') ||
    lower.includes('dockerfile')
  ) {
    const detail = message
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith('docker-desktop://') &&
          !line.toLowerCase().startsWith('view build details:')
      )
      .slice(-1)[0] ?? message
    return `The server image failed to build: ${detail}`
  }
  if (lower.includes('permission denied') || lower.includes('access is denied')) {
    return `Docker refused a required action (permission denied). Make sure Docker Desktop is running as the current user, then try again. (${message.split('\n').filter(Boolean).pop() ?? message})`
  }
  return message || 'The server deployment failed for an unknown reason.'
}

/**
 * Where `host.bat` + `docker-compose.yml` + `Dockerfile` (and the rest of the source tree the
 * Docker build context needs) actually live, mirroring `resolveSessionHostScript` in
 * `session-host-launcher.ts`: a packaged build ships them as a real extraResources directory
 * (asar cannot be executed by `cmd.exe`/Docker, so they must be plain files on disk), while a dev
 * checkout uses the repo root directly. First existing candidate wins.
 */
export function resolveServerDeploymentRoot(opts: {
  isPackaged: boolean
  resourcesPath?: string | null
  repoRoot: string
  exists?: (p: string) => boolean
}): string {
  const exists = opts.exists ?? existsSync
  if (opts.isPackaged && opts.resourcesPath) {
    const packaged = path.join(opts.resourcesPath, 'server-deployment')
    try {
      if (exists(path.join(packaged, 'host.bat'))) return packaged
    } catch {
      /* unreadable — fall through to the repo root */
    }
  }
  return opts.repoRoot
}

function run(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  extraEnv?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv }
    for (const key of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES']) delete env[key]
    const child = spawn(executable, args, { cwd, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf-8')).slice(-256_000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error(output.trim() || `${path.basename(executable)} exited with ${code}.`))
    })
  })
}

async function commandWorks(executable: string, args: string[], cwd: string): Promise<boolean> {
  try { await run(executable, args, cwd, 15_000); return true } catch { return false }
}

/** Deployment-first phone route. The existing host wrapper remains the authority for Compose
 * endpoint validation, image build/reuse, named-volume persistence and health polling.
 *
 * `projectRoot` is where `host.bat`/`docker-compose.yml`/`Dockerfile` live — the packaged
 * `server-deployment` resources directory, or the repo root in dev (see
 * `resolveServerDeploymentRoot`). `stateDir` is a writable, per-user location for the generated
 * `.env` (the first-boot password) and the TOTP secret. It MUST be outside `projectRoot`: a
 * packaged install lives under a Squirrel version directory that is replaced wholesale on every
 * update, so anything written beside `host.bat` there is silently lost on the next update and the
 * paired phone stops working with no explanation. `stateDir` is threaded through to `host.bat` and
 * `docker-compose.yml` via environment variables the wrapper/compose file read with a fallback to
 * their historical (repo-root-relative) behavior, so a dev checkout run without `stateDir` set is
 * unchanged. */
export class ServerDeploymentService {
  private inFlight: Promise<ServerDeploymentResult> | null = null
  /** In-memory only, per app process — see `status()`'s doc comment on `ServerDeploymentApi` for
   *  why that is the right scope for the always-visible canvas indicator. Cleared to `null` on
   *  any failed `start()` so a stale address can never be shown as reachable. */
  private lastReady: { url: string } | null = null
  private progressListeners = new Set<(stage: ServerDeploymentStage) => void>()
  constructor(private readonly projectRoot: string, private readonly stateDir: string = projectRoot) {}

  start(): Promise<ServerDeploymentResult> {
    if (!this.inFlight) this.inFlight = this.startOnce().finally(() => (this.inFlight = null))
    return this.inFlight
  }

  async currentTotp(): Promise<string> {
    const secret = (await readFile(path.join(this.stateDir, '.nodeterm-server-totp'), 'utf-8')).trim()
    return totp(base32Decode(secret))
  }

  status(): { running: boolean; url?: string } {
    return this.lastReady ? { running: true, url: this.lastReady.url } : { running: false }
  }

  /** Progress subscription for whatever `start()` call is currently in flight (or the next one).
   *  Returns an unsubscribe function. Never called with the TOTP code or the deployment URL —
   *  those are credentials/results, not progress, and must not ride a fire-and-forget broadcast. */
  onProgress(cb: (stage: ServerDeploymentStage) => void): () => void {
    this.progressListeners.add(cb)
    return () => this.progressListeners.delete(cb)
  }

  private emitStage(stage: ServerDeploymentStage): void {
    for (const listener of this.progressListeners) listener(stage)
  }

  private async startOnce(): Promise<ServerDeploymentResult> {
    if (process.platform !== 'win32') return { ok: false, state: 'failed', error: 'Automatic Server Edition deployment is currently available on Windows only.' }
    const wrapper = path.join(this.projectRoot, 'host.bat')
    try { await access(wrapper) } catch { return { ok: false, state: 'failed', error: 'The Server Edition deployment files are missing from this install. Reinstall nodeterm.' } }

    this.emitStage('preparing-secrets')
    await mkdir(this.stateDir, { recursive: true })
    const totpFile = path.join(this.stateDir, '.nodeterm-server-totp')
    let secretBase32 = ''
    try { secretBase32 = (await readFile(totpFile, 'utf-8')).trim() } catch { /* first deployment */ }
    if (!/^[A-Z2-7]{32}$/.test(secretBase32)) {
      secretBase32 = base32Encode(crypto.randomBytes(20))
      await writeFile(totpFile, `${secretBase32}\n`, { mode: 0o600 })
      await run('icacls.exe', [totpFile, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(R,W)`], this.stateDir, 15_000)
    }

    this.emitStage('checking-docker')
    if (!(await commandWorks('docker.exe', ['compose', 'version'], this.projectRoot))) {
      if (!(await commandWorks('winget.exe', ['--version'], this.projectRoot))) {
        return { ok: false, state: 'failed', error: 'Docker is not installed, and Windows Package Manager (winget) is unavailable to install it automatically. Install Docker Desktop yourself, then try again.' }
      }
      this.emitStage('installing-docker')
      try {
        await run('winget.exe', ['install', '--id', 'Docker.DockerDesktop', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'], this.projectRoot, 20 * 60_000)
      } catch (error) {
        return { ok: false, state: 'failed', error: `Docker Desktop could not be installed automatically: ${(error as Error).message}` }
      }
      return { ok: false, state: 'docker-restart-required', error: 'Docker Desktop was installed. Start it (and restart Windows if requested), then open this panel again.' }
    }

    if (!(await commandWorks('docker.exe', ['info'], this.projectRoot))) {
      this.emitStage('starting-docker-daemon')
      const desktop = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe')
      try { await access(desktop); spawn(desktop, [], { detached: true, windowsHide: true, stdio: 'ignore' }).unref() }
      catch { return { ok: false, state: 'failed', error: 'Docker Desktop is installed but its daemon is not running, and it could not be started automatically. Start Docker Desktop yourself, then try again.' } }
      let ready = false
      for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        ready = await commandWorks('docker.exe', ['info'], this.projectRoot)
      }
      if (!ready) return { ok: false, state: 'failed', error: 'Docker Desktop did not become ready within two minutes. Open Docker Desktop yourself and wait for it to finish starting, then try again.' }
    }

    this.emitStage('building-and-starting')
    try {
      // NODETERM_SERVER_ENV_DIR redirects host.bat's .env (first-boot password) out of the
      // (update-replaced) install directory; NODETERM_TOTP_SECRET_FILE_HOST is read by
      // docker-compose.yml's totp volume mount for the same reason. `docker compose` reads real
      // process environment for `${VAR}` interpolation, so neither has to be persisted into .env.
      await run('cmd.exe', ['/d', '/c', wrapper, '--start'], this.projectRoot, 30 * 60_000, {
        NODETERM_SERVER_ENV_DIR: this.stateDir,
        NODETERM_TOTP_SECRET_FILE_HOST: totpFile
      })
      this.lastReady = { url: DEPLOYED_URL }
      this.emitStage('ready')
      return {
        ok: true,
        state: 'ready',
        url: DEPLOYED_URL,
        totpCode: totp(base32Decode(secretBase32))
      }
    } catch (error) {
      this.lastReady = null
      return { ok: false, state: 'failed', error: classifyComposeFailure((error as Error).message) }
    }
  }
}
