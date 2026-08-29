import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { ipcMain } from 'electron'
import type { MainWindowLike } from './main-window'
import { writeFileAtomic } from '../core/fs-atomic'
import { discoverDockerManagerContexts } from './remote/docker-host-manager'
import { IPC } from '../shared/ipc'
import {
  OPEN_WEBUI_DATA_MOUNT,
  OPEN_WEBUI_IMAGE,
  type OpenWebUiApi,
  type OpenWebUiContext,
  type OpenWebUiIntent,
  type OpenWebUiJobProgress,
  type OpenWebUiLocalBinding,
  type OpenWebUiOperationInput,
  type OpenWebUiState,
  safeOpenWebUiCredentialRef,
  safeOpenWebUiEndpoint,
  safeOpenWebUiIntent,
  safeOpenWebUiLocalBinding,
  isSafeOpenWebUiContext
} from '../shared/open-webui-hosting'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT = 1024 * 1024
const STORE_VERSION = 1 as const

interface BindingStoreFile {
  version: typeof STORE_VERSION
  bindings: Record<string, OpenWebUiLocalBinding>
}

function contextArgs(context: string, args: string[]): string[] {
  const selected = context.trim()
  if (selected && !isSafeOpenWebUiContext(selected)) throw new Error('Choose an available Docker context.')
  return [...(selected ? ['--context', selected] : []), ...args]
}

async function docker(context: string, args: string[], timeout = 30_000): Promise<string> {
  const result = await execFileAsync('docker', contextArgs(context, args), {
    windowsHide: true,
    timeout,
    maxBuffer: MAX_OUTPUT
  })
  return String(result.stdout)
}

async function dockerAllowFailure(context: string, args: string[], timeout = 30_000): Promise<{ ok: boolean; output: string }> {
  try {
    return { ok: true, output: await docker(context, args, timeout) }
  } catch (error) {
    const value = error as { stdout?: unknown; stderr?: unknown; message?: unknown }
    return { ok: false, output: String(value.stderr ?? value.stdout ?? value.message ?? '') }
  }
}

function safeNodeKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function safePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value) || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute local path selected through the file picker.`)
  }
  return path.normalize(value)
}

async function existingDirectory(value: unknown, label: string): Promise<string> {
  const resolved = safePath(value, label)
  const stat = await fs.lstat(resolved).catch(() => null)
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an existing local folder, not a link.`)
  return resolved
}

async function existingFile(value: unknown, label: string): Promise<string> {
  const resolved = safePath(value, label)
  const stat = await fs.lstat(resolved).catch(() => null)
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an existing local file, not a link.`)
  return resolved
}

function validateIntent(value: unknown): OpenWebUiIntent {
  const intent = safeOpenWebUiIntent(value)
  if (!intent) throw new Error('The Open WebUI provider settings are invalid. Choose a listed provider and a valid model.')
  return intent
}

function jsonStore(value: unknown): BindingStoreFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: STORE_VERSION, bindings: {} }
  const raw = value as Record<string, unknown>
  const bindings: Record<string, OpenWebUiLocalBinding> = {}
  if (raw.version !== STORE_VERSION || !raw.bindings || typeof raw.bindings !== 'object' || Array.isArray(raw.bindings)) return { version: STORE_VERSION, bindings }
  for (const [nodeId, binding] of Object.entries(raw.bindings as Record<string, unknown>).slice(0, 256)) {
    const safe = safeOpenWebUiLocalBinding(binding)
    if (safe && /^[A-Za-z0-9._:-]{1,256}$/.test(nodeId)) bindings[nodeId] = safe
  }
  return { version: STORE_VERSION, bindings }
}

export class OpenWebUiStore {
  private readonly file: string
  private value: BindingStoreFile = { version: STORE_VERSION, bindings: {} }
  private loaded = false
  private writing: Promise<void> = Promise.resolve()

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'open-webui-bindings.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    const raw = await fs.readFile(this.file, 'utf8').catch(() => '')
    if (raw) {
      try { this.value = jsonStore(JSON.parse(raw)) } catch { this.value = { version: STORE_VERSION, bindings: {} } }
    }
    this.loaded = true
  }

  get(nodeId: string): OpenWebUiLocalBinding | undefined {
    return this.value.bindings[nodeId]
  }

  async set(nodeId: string, binding: OpenWebUiLocalBinding): Promise<void> {
    await this.load()
    this.value.bindings[nodeId] = binding
    const body = JSON.stringify(this.value, null, 2)
    const run = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, body, { mode: 0o600 })
    })
    // A failed publication must not poison the FIFO. Later saves still need to reach disk, while
    // this caller receives the real error from its own write.
    this.writing = run.catch(() => {})
    await run
  }
}

async function contexts(): Promise<OpenWebUiContext[]> {
  const rows = await discoverDockerManagerContexts()
  return rows.map((row) => ({ ...row, kind: row.kind }))
}

function operationLabel(operation: OpenWebUiOperationInput['operation']): string {
  return operation === 'deploy' ? 'Deploy Open WebUI' : operation === 'backup' ? 'Back up Open WebUI data' : operation === 'restore' ? 'Restore Open WebUI data' : operation === 'update' ? 'Update Open WebUI' : 'Roll back Open WebUI'
}

function endpointFor(binding: OpenWebUiLocalBinding, kind: OpenWebUiContext['kind']): string | null {
  return kind === 'local' ? binding.endpoint : null
}

async function inspectContainer(binding: OpenWebUiLocalBinding): Promise<{ status: string; health: string; running: boolean }> {
  const raw = await docker(binding.context, ['inspect', '--format', '{{json .State}}', binding.containerName])
  const state = JSON.parse(raw.trim()) as { Status?: string; Health?: { Status?: string } }
  return { status: state.Status ?? 'unknown', health: state.Health?.Status ?? 'none', running: state.Status === 'running' }
}

async function probeEndpoint(endpoint: string): Promise<{ health: OpenWebUiState['health']; setupRequired: boolean; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(`${endpoint}/health`, { signal: controller.signal })
    if (response.status === 401 || response.status === 403) return { health: 'needs-setup', setupRequired: true, detail: 'The host is responding but requires the first-user setup in Open WebUI.' }
    if (!response.ok) return { health: 'failed', setupRequired: false, detail: `Open WebUI health returned HTTP ${response.status}.` }
    const auth = await fetch(`${endpoint}/api/v1/auths/`, { signal: controller.signal })
    if (auth.status === 401 || auth.status === 403) return { health: 'needs-setup', setupRequired: true, detail: 'The host is responding but requires the first-user setup in Open WebUI.' }
    return { health: 'running', setupRequired: false, detail: 'Open WebUI is responding. First-user setup remains available from its own page if no account exists.' }
  } catch (error) {
    return { health: 'unreachable', setupRequired: false, detail: error instanceof Error ? error.message : 'The local Open WebUI endpoint did not answer.' }
  } finally {
    clearTimeout(timer)
  }
}

export function registerOpenWebUiHosting(getWindow: () => MainWindowLike | null, userDataDir: string): { api: OpenWebUiApi; dispose(): void } {
  const store = new OpenWebUiStore(userDataDir)
  const jobs = new Map<string, ChildProcess>()
  const cancelled = new Set<string>()
  const progressListeners = new Set<(progress: OpenWebUiJobProgress) => void>()
  const send = (progress: OpenWebUiJobProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.openWebUiProgress, progress)
    progressListeners.forEach((listener) => listener(progress))
  }

  const state = async (nodeId: string, intentValue: OpenWebUiIntent): Promise<OpenWebUiState> => {
    const intent = validateIntent(intentValue)
    await store.load()
    const binding = store.get(nodeId)
    if (!binding) return { health: 'unbound', endpoint: null, context: null, containerName: null, volumeName: null, image: null, provider: intent.provider, model: intent.model, setupRequired: false, detail: 'No local host is bound. Choose a Docker context and deploy, or configure this node later.', checkedAt: Date.now() }
    const row = (await contexts().catch(() => [])).find((item) => item.name === binding.context)
    try {
      const container = await inspectContainer(binding)
      const provider = binding.providerEndpoint ? { providerEndpoint: binding.providerEndpoint } : {}
      if (!container.running) return { health: 'stopped', endpoint: endpointFor(binding, row?.kind ?? 'other'), context: binding.context, containerName: binding.containerName, volumeName: binding.volumeName, image: binding.image, provider: intent.provider, model: intent.model, ...provider, setupRequired: false, detail: `The container is ${container.status}. Use Deploy or Update to start it.`, checkedAt: Date.now() }
      if (row?.kind !== 'local') return { health: 'running', endpoint: null, context: binding.context, containerName: binding.containerName, volumeName: binding.volumeName, image: binding.image, provider: intent.provider, model: intent.model, ...provider, setupRequired: true, detail: 'The remote container is running. A local tunnel or host-specific route is required before this desktop can probe its HTTP page.', checkedAt: Date.now() }
      const probe = await probeEndpoint(binding.endpoint)
      return { health: probe.health, endpoint: binding.endpoint, context: binding.context, containerName: binding.containerName, volumeName: binding.volumeName, image: binding.image, provider: intent.provider, model: intent.model, ...provider, setupRequired: probe.setupRequired, detail: probe.detail, checkedAt: Date.now() }
    } catch (error) {
      return { health: 'failed', endpoint: endpointFor(binding, row?.kind ?? 'other'), context: binding.context, containerName: binding.containerName, volumeName: binding.volumeName, image: binding.image, provider: intent.provider, model: intent.model, ...(binding.providerEndpoint ? { providerEndpoint: binding.providerEndpoint } : {}), setupRequired: false, detail: error instanceof Error ? error.message : 'The container state could not be read.', checkedAt: Date.now() }
    }
  }

  const runChild = (jobId: string, context: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
    if (cancelled.has(jobId)) return reject(new Error('Cancelled.'))
    const child = spawn('docker', contextArgs(context, args), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    jobs.set(jobId, child)
    let output = ''
    const append = (chunk: Buffer): void => { output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT) }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => { jobs.delete(jobId); reject(error) })
    child.once('close', (code, signal) => {
      jobs.delete(jobId)
      if (cancelled.has(jobId) || signal) reject(new Error('Cancelled.'))
      else if (code !== 0) reject(new Error(output.trim() || `Docker exited with code ${code ?? 'unknown'}.`))
      else resolve(output.trim())
    })
  })

  const commandFor = (intent: OpenWebUiIntent, binding: OpenWebUiLocalBinding, image: string): string[] => {
    const args = ['run', '--detach', '--name', binding.containerName, '--label', 'dev.nodeterm.owner=open-webui-hosting', '--restart', 'unless-stopped', '--publish', `${intent.port}:8080`, '--volume', `${binding.volumeName}:${OPEN_WEBUI_DATA_MOUNT}`]
    if (intent.reuseOllama) args.push('--env', 'OLLAMA_BASE_URL=http://host.docker.internal:11434')
    if (intent.provider === 'openai-compatible' && binding.providerEndpoint) args.push('--env', `OPENAI_API_BASE_URL=${binding.providerEndpoint}`)
    args.push(image)
    return args
  }

  const deploy = async (jobId: string, input: Extract<OpenWebUiOperationInput, { operation: 'deploy' }>): Promise<void> => {
    const intent = validateIntent(input.intent)
    if (!isSafeOpenWebUiContext(input.context)) throw new Error('Choose an available Docker context before deploying.')
    const selected = (await contexts()).find((row) => row.name === input.context)
    if (!selected?.available) throw new Error(selected?.reason ?? 'The selected Docker context is unavailable. Refresh and choose another context.')
    if (intent.provider === 'openai-compatible' && input.providerEndpoint !== undefined && !safeOpenWebUiEndpoint(input.providerEndpoint)) throw new Error('The OpenAI-compatible base URL is invalid or contains credentials.')
    const key = safeOpenWebUiCredentialRef(input.providerCredentialKey)
    const hash = safeNodeKey(input.nodeId)
    const binding: OpenWebUiLocalBinding = {
      context: input.context.trim(),
      containerName: `nodeterm-open-webui-${hash}`,
      volumeName: `nodeterm-open-webui-data-${hash}`,
      endpoint: `http://127.0.0.1:${intent.port}`,
      ...(input.providerEndpoint ? { providerEndpoint: input.providerEndpoint } : {}),
      ...(key ? { providerCredentialKey: key } : {}),
      image: OPEN_WEBUI_IMAGE,
      updatedAt: Date.now()
    }
    send({ jobId, nodeId: input.nodeId, operation: 'deploy', phase: 'running', completedSteps: 0, totalSteps: 4, message: 'Creating the persistent data volume.' })
    await dockerAllowFailure(binding.context, ['volume', 'create', binding.volumeName]).then((result) => { if (!result.ok) throw new Error(result.output || 'The persistent data volume could not be created.') })
    const existing = await dockerAllowFailure(binding.context, ['inspect', '--format', '{{json .Config.Labels}}', binding.containerName])
    if (existing.ok && !existing.output.includes('dev.nodeterm.owner=open-webui-hosting')) throw new Error('A container with the selected name exists but is not owned by this Open WebUI node.')
    send({ jobId, nodeId: input.nodeId, operation: 'deploy', phase: 'running', completedSteps: 1, totalSteps: 4, message: 'Starting the pinned Open WebUI image with persistent data.' })
    if (!existing.ok) await runChild(jobId, binding.context, commandFor(intent, binding, OPEN_WEBUI_IMAGE))
    else await runChild(jobId, binding.context, ['start', binding.containerName]).catch((error) => { throw error })
    await store.set(input.nodeId, binding)
    send({ jobId, nodeId: input.nodeId, operation: 'deploy', phase: 'running', completedSteps: 3, totalSteps: 4, message: 'Checking Open WebUI health and first-user setup state.' })
    const current = await state(input.nodeId, intent)
    send({ jobId, nodeId: input.nodeId, operation: 'deploy', phase: 'completed', completedSteps: 4, totalSteps: 4, message: current.setupRequired ? 'Open WebUI is running and ready for first-user setup.' : 'Open WebUI is running.', detail: current.detail })
  }

  const backup = async (jobId: string, input: Extract<OpenWebUiOperationInput, { operation: 'backup' }>): Promise<void> => {
    await store.load()
    const binding = store.get(input.nodeId)
    if (!binding) throw new Error('Deploy Open WebUI before creating a backup.')
    const context = (await contexts().catch(() => [])).find((row) => row.name === binding.context)
    if (context?.kind !== 'local') throw new Error('Backup and restore use a local Docker context so the selected folder stays on this machine.')
    const destination = await existingDirectory(input.destination, 'Backup destination')
    const filename = `open-webui-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`
    send({ jobId, nodeId: input.nodeId, operation: 'backup', phase: 'running', completedSteps: 0, totalSteps: 1, message: 'Streaming persistent Open WebUI data into the selected backup folder.' })
    await runChild(jobId, binding.context, ['run', '--rm', '--volumes-from', binding.containerName, '--volume', `${destination}:/backup`, binding.image, 'tar', '-czf', `/backup/${filename}`, '-C', '/app/backend', 'data'])
    await store.set(input.nodeId, { ...binding, lastBackupAt: Date.now(), updatedAt: Date.now() })
    send({ jobId, nodeId: input.nodeId, operation: 'backup', phase: 'completed', completedSteps: 1, totalSteps: 1, message: `Backup written to ${path.join(destination, filename)}.` })
  }

  const restore = async (jobId: string, input: Extract<OpenWebUiOperationInput, { operation: 'restore' }>): Promise<void> => {
    await store.load()
    const binding = store.get(input.nodeId)
    if (!binding) throw new Error('Deploy Open WebUI before restoring a backup.')
    const context = (await contexts().catch(() => [])).find((row) => row.name === binding.context)
    if (context?.kind !== 'local') throw new Error('Backup and restore use a local Docker context so the selected file stays on this machine.')
    const source = await existingFile(input.source, 'Backup source')
    if (!source.toLowerCase().endsWith('.tar.gz')) throw new Error('Choose an Open WebUI .tar.gz backup created by this node.')
    send({ jobId, nodeId: input.nodeId, operation: 'restore', phase: 'running', completedSteps: 0, totalSteps: 2, message: 'Validating the backup archive before changing persistent data.' })
    const listing = await runChild(jobId, binding.context, ['run', '--rm', '--volume', `${source}:/restore/backup.tar.gz:ro`, binding.image, 'tar', '-tzf', '/restore/backup.tar.gz'])
    const unsafe = listing.split(/\r?\n/).some((entry) => entry.startsWith('/') || entry.includes('..') || !(entry === '.' || entry.startsWith('data/')))
    if (unsafe) throw new Error('The backup contains an unsafe path and was refused without changing the container.')
    send({ jobId, nodeId: input.nodeId, operation: 'restore', phase: 'running', completedSteps: 1, totalSteps: 2, message: 'Restoring the validated archive into persistent Open WebUI data.' })
    await runChild(jobId, binding.context, ['run', '--rm', '--volumes-from', binding.containerName, '--volume', `${source}:/restore/backup.tar.gz:ro`, binding.image, 'tar', '-xzf', '/restore/backup.tar.gz', '-C', OPEN_WEBUI_DATA_MOUNT])
    send({ jobId, nodeId: input.nodeId, operation: 'restore', phase: 'completed', completedSteps: 2, totalSteps: 2, message: 'Open WebUI data was restored. Refresh health before opening the page.' })
  }

  const replaceImage = async (jobId: string, input: Extract<OpenWebUiOperationInput, { operation: 'update' | 'rollback' }>): Promise<void> => {
    await store.load()
    const binding = store.get(input.nodeId)
    if (!binding) throw new Error('Deploy Open WebUI before changing its image.')
    const target = input.operation === 'update' ? OPEN_WEBUI_IMAGE : binding.previousImage
    if (!target) throw new Error('No previous Open WebUI image is recorded for rollback.')
    const intent = validateIntent(input.intent)
    send({ jobId, nodeId: input.nodeId, operation: input.operation, phase: 'running', completedSteps: 0, totalSteps: 4, message: `Pulling the pinned Open WebUI image ${target}.` })
    await runChild(jobId, binding.context, ['pull', target])
    await runChild(jobId, binding.context, ['stop', binding.containerName]).catch(() => undefined)
    await runChild(jobId, binding.context, ['rm', binding.containerName])
    try {
      await runChild(jobId, binding.context, commandFor(intent, binding, target))
    } catch (error) {
      await runChild(jobId, binding.context, commandFor(intent, binding, binding.image)).catch(() => undefined)
      throw new Error(`Open WebUI ${input.operation} failed and the prior image was attempted again: ${error instanceof Error ? error.message : String(error)}`)
    }
    await store.set(input.nodeId, { ...binding, previousImage: binding.image, image: target, updatedAt: Date.now() })
    send({ jobId, nodeId: input.nodeId, operation: input.operation, phase: 'completed', completedSteps: 4, totalSteps: 4, message: `Open WebUI ${input.operation} completed on ${target}.` })
  }

  const run = async (input: OpenWebUiOperationInput): Promise<{ jobId: string }> => {
    if (!input || typeof input.nodeId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(input.nodeId)) throw new Error('The Open WebUI node id is invalid.')
    const jobId = randomUUID()
    send({ jobId, nodeId: input.nodeId, operation: input.operation, phase: 'queued', completedSteps: 0, totalSteps: 1, message: `${operationLabel(input.operation)} queued.` })
    void (async () => {
      try {
        if (input.operation === 'deploy') await deploy(jobId, input)
        else if (input.operation === 'backup') await backup(jobId, input)
        else if (input.operation === 'restore') await restore(jobId, input)
        else await replaceImage(jobId, input)
      } catch (error) {
        const cancelledJob = cancelled.has(jobId)
        send({ jobId, nodeId: input.nodeId, operation: input.operation, phase: cancelledJob ? 'cancelled' : 'failed', completedSteps: 0, totalSteps: 1, message: cancelledJob ? 'Cancelled without claiming success.' : error instanceof Error ? error.message : String(error) })
      } finally {
        cancelled.delete(jobId)
      }
    })()
    return { jobId }
  }

  const api: OpenWebUiApi = {
    contexts,
    state,
    health: state,
    run,
    cancel: (jobId) => { cancelled.add(jobId); jobs.get(jobId)?.kill() },
    onProgress: (listener) => { progressListeners.add(listener); return () => progressListeners.delete(listener) }
  }

  ipcMain.handle(IPC.openWebUiContexts, contexts)
  ipcMain.handle(IPC.openWebUiState, (_event, nodeId: string, intent: OpenWebUiIntent) => state(nodeId, intent))
  ipcMain.handle(IPC.openWebUiRun, (_event, input: OpenWebUiOperationInput) => run(input))
  ipcMain.on(IPC.openWebUiCancel, (_event, jobId: string) => api.cancel(jobId))

  return {
    api,
    dispose() {
      for (const child of jobs.values()) child.kill()
      jobs.clear()
      ipcMain.removeHandler(IPC.openWebUiContexts)
      ipcMain.removeHandler(IPC.openWebUiState)
      ipcMain.removeHandler(IPC.openWebUiRun)
      ipcMain.removeAllListeners(IPC.openWebUiCancel)
    }
  }
}
