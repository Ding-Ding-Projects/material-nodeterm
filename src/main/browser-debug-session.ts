/**
 * Runtime owner for isolated debugging browser sessions.
 *
 * Every child is launched with a newly-created profile and a fixed argument list from
 * `@shared/browser-debug`. The service never accepts caller-supplied flags, never opens a normal
 * browser profile, and never exposes a non-loopback CDP endpoint. Only a session id and safe
 * observable state cross the renderer boundary.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  buildDebugBrowserLaunchArgs,
  normalizeDebugBrowserSpec,
  validateDebugBrowserTargetList,
  type DebugBrowserBinding,
  type DebugBrowserCdpTarget,
  type DebugBrowserExecutable,
  type DebugBrowserInspectionResult,
  type DebugBrowserSessionResult,
  type DebugBrowserSessionState,
  type DebugBrowserSessionSummary,
  type DebugBrowserSpec
} from '../shared/browser-debug'

interface RuntimeSession {
  id: string
  spec: DebugBrowserSpec
  binding: DebugBrowserBinding
  child: ChildProcess
  state: DebugBrowserSessionState
  error?: string
}

const MAX_SESSIONS = 16
const STARTUP_TIMEOUT_MS = 12_000

function knownExecutableCandidates(env: NodeJS.ProcessEnv): Array<Omit<DebugBrowserExecutable, 'path'> & { paths: string[] }> {
  const local = env.LOCALAPPDATA || ''
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  return [
    {
      id: 'edge',
      label: 'Microsoft Edge',
      paths: [
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ]
    },
    {
      id: 'chrome',
      label: 'Google Chrome',
      paths: [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ]
    },
    {
      id: 'chromium',
      label: 'Chromium',
      paths: [
        path.join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
        path.join(local, 'Chromium', 'Application', 'chrome.exe')
      ]
    }
  ]
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function discoverDebugBrowserExecutables(
  env: NodeJS.ProcessEnv = process.env
): Promise<DebugBrowserExecutable[]> {
  const output: DebugBrowserExecutable[] = []
  for (const candidate of knownExecutableCandidates(env)) {
    for (const candidatePath of candidate.paths) {
      if (await isFile(candidatePath)) {
        output.push({ ...candidate, path: candidatePath })
        break
      }
    }
  }
  return output
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('Unable to reserve a loopback debugging port'))
      })
    })
  })
}

async function fetchTargets(endpoint: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${endpoint}/json/list`, { signal })
  if (!response.ok) throw new Error(`CDP target listing returned HTTP ${response.status}`)
  return response.json()
}

export class DebugBrowserSessionService {
  private readonly sessions = new Map<string, RuntimeSession>()

  constructor(private readonly profileRoot: string) {}

  async listExecutables(): Promise<DebugBrowserExecutable[]> {
    return discoverDebugBrowserExecutables()
  }

  async start(specInput: unknown, executablePath?: string): Promise<DebugBrowserSessionResult> {
    const spec = normalizeDebugBrowserSpec(specInput)
    if (!spec) return { ok: false, error: 'The debugging browser settings are invalid or incomplete.' }
    if (this.sessions.size >= MAX_SESSIONS) {
      return { ok: false, error: `The debugging browser session limit is ${MAX_SESSIONS}. Stop one before starting another.` }
    }
    const executables = await this.listExecutables()
    if (executablePath !== undefined && !executables.some((item) => item.path === executablePath)) {
      return { ok: false, error: 'That browser executable is not in the supported detected-browser list.' }
    }
    const executable = executables.find((item) => item.path === executablePath) ?? executables[0]
    if (!executable) return { ok: false, error: 'No supported Chromium browser was found on this computer.' }

    const sessionId = randomUUID()
    const profileDir = await mkdtemp(path.join(this.profileRoot, 'isolated-browser-'))
    const port = await reserveLoopbackPort()
    const endpoint = `http://127.0.0.1:${port}`
    let child: ChildProcess
    try {
      const args = buildDebugBrowserLaunchArgs(spec, profileDir, port)
      child = spawn(executable.path, args, {
        detached: false,
        windowsHide: true,
        stdio: 'ignore'
      })
    } catch (error) {
      await rm(profileDir, { recursive: true, force: true })
      return { ok: false, error: `The isolated browser could not start: ${error instanceof Error ? error.message : String(error)}` }
    }

    const session: RuntimeSession = {
      id: sessionId,
      spec,
      binding: { profileDir, endpoint },
      child,
      state: 'starting'
    }
    this.sessions.set(sessionId, session)
    child.once('exit', () => {
      if (session.state !== 'stopping') session.state = 'stopped'
    })
    child.once('error', (error) => {
      session.state = 'error'
      session.error = error.message
    })

    try {
      const target = await this.waitForTarget(session, STARTUP_TIMEOUT_MS)
      if (!target) throw new Error('The browser did not expose exactly one matching loopback CDP page.')
      session.state = 'running'
      return { ok: true, session: this.summary(session) }
    } catch (error) {
      session.state = 'error'
      session.error = error instanceof Error ? error.message : String(error)
      await this.stop(sessionId)
      return { ok: false, error: session.error }
    }
  }

  status(sessionId: string): DebugBrowserSessionSummary | undefined {
    const session = this.sessions.get(sessionId)
    return session ? this.summary(session) : undefined
  }

  async inspect(sessionId: string): Promise<DebugBrowserInspectionResult> {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: 'That isolated debugging browser session is not owned by this app.' }
    if (session.state !== 'running') return { ok: false, error: `The isolated debugging browser is ${session.state}.` }
    try {
      const target = await this.waitForTarget(session, 2_000)
      if (!target) return { ok: false, error: 'The CDP endpoint did not return exactly one matching loopback page.' }
      return { ok: true, session: this.summary(session), target }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async stop(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.state = 'stopping'
    if (!session.child.killed) session.child.kill()
    await new Promise<void>((resolve) => {
      if (session.child.exitCode !== null || session.child.signalCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        // A browser that ignores the graceful signal must not leave a live process using the
        // disposable profile. The child is owned by this service, so the bounded hard stop is
        // safe and still cannot touch the user's normal browser process.
        if (!session.child.killed) session.child.kill('SIGKILL')
        resolve()
      }, 900)
      session.child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await rm(session.binding.profileDir, { recursive: true, force: true })
    session.state = 'stopped'
    this.sessions.delete(sessionId)
    return true
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)))
  }

  private async waitForTarget(session: RuntimeSession, timeoutMs: number): Promise<DebugBrowserCdpTarget | undefined> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (session.state === 'stopped' || session.state === 'error') return undefined
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 600)
      try {
        const targets = await fetchTargets(session.binding.endpoint, controller.signal)
        const target = validateDebugBrowserTargetList(targets, session.spec.startUrl)
        if (target) return target
      } catch {
        // Chromium's debugging endpoint is not ready during the first few polls. Keep the retry
        // bounded, and let the caller report the exact isolation failure if it never settles.
      } finally {
        clearTimeout(timer)
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    return undefined
  }

  private summary(session: RuntimeSession): DebugBrowserSessionSummary {
    return {
      sessionId: session.id,
      state: session.state,
      startUrl: session.spec.startUrl,
      ...(session.spec.proxy ? { proxy: session.spec.proxy } : {}),
      endpoint: session.state === 'running' || session.state === 'starting' ? session.binding.endpoint : undefined,
      ...(session.error ? { error: session.error } : {})
    }
  }
}
