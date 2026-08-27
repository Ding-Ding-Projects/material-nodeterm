import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  NEXTCLOUD_AIO_BACKUP_VOLUME,
  NEXTCLOUD_AIO_CONFIG_VOLUME,
  NEXTCLOUD_AIO_CONTAINER,
  NEXTCLOUD_AIO_DATA_VOLUME,
  NEXTCLOUD_AIO_IMAGE,
  type NextcloudAioAction,
  type NextcloudAioBackupRecord,
  type NextcloudAioConfig,
  type NextcloudAioContext,
  type NextcloudAioJobProgress,
  type NextcloudAioSnapshot,
  type NextcloudAioStatus,
  validateNextcloudAioAction
} from '../../shared/nextcloud-aio'

const execFileAsync = promisify(execFile)
const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_BACKUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_OUTPUT = 1024 * 1024
const BACKUP_HELPER_IMAGE = 'busybox:1.36.1'

function contextArgs(context: string, args: string[]): string[] {
  const selected = context.trim()
  if (selected && !SAFE_CONTEXT.test(selected)) throw new Error('The selected Docker context is invalid.')
  return [...(selected ? ['--context', selected] : []), ...args]
}

async function docker(context: string, args: string[], timeout = 20_000): Promise<string> {
  const result = await execFileAsync('docker', contextArgs(context, args), { windowsHide: true, timeout, maxBuffer: MAX_OUTPUT })
  return String(result.stdout)
}

function field(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) if (typeof row[key] === 'string') return row[key] as string
  return ''
}

function jsonLines<T>(value: string, map: (row: Record<string, unknown>) => T | null): T[] {
  return value.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      const mapped = map(row)
      return mapped === null ? [] : [mapped]
    } catch {
      return []
    }
  })
}

function contextKind(endpoint: string): string {
  return /^(ssh:|tcp:\/\/127[.]|npipe:|unix:|desktop-linux)/i.test(endpoint) ? 'Local or SSH context' : 'Docker context'
}

export async function discoverNextcloudAioContexts(): Promise<NextcloudAioContext[]> {
  const output = await docker('', ['context', 'ls', '--format', '{{json .}}'], 8_000)
  return jsonLines(output, (row) => {
    const name = field(row, 'Name')
    if (!SAFE_CONTEXT.test(name)) return null
    const endpoint = field(row, 'DockerEndpoint')
    return { name, endpointLabel: contextKind(endpoint), current: row.Current === true || row.Current === '*', available: true }
  })
}

function selectedContext(contextName: string, contexts: NextcloudAioContext[]): NextcloudAioContext {
  const selected = contextName.trim() ? contexts.find((item) => item.name === contextName.trim()) : contexts.find((item) => item.current)
  if (!selected || !selected.available) throw new Error('Choose an available Docker context before using Nextcloud AIO.')
  return selected
}

function parseInspect(raw: string): { running: boolean; status: string; health: string } | null {
  try {
    const rows = JSON.parse(raw) as Array<Record<string, unknown>>
    const state = rows[0]?.State as Record<string, unknown> | undefined
    if (!state) return null
    const health = state.Health as Record<string, unknown> | undefined
    return {
      running: state.Running === true,
      status: typeof state.Status === 'string' ? state.Status : 'unknown',
      health: typeof health?.Status === 'string' ? health.Status : 'none'
    }
  } catch {
    return null
  }
}

async function status(context: NextcloudAioContext): Promise<NextcloudAioStatus> {
  let health: NextcloudAioStatus['health'] = 'unknown'
  let message = 'The Nextcloud AIO container has not been inspected yet.'
  try {
    const inspected = parseInspect(await docker(context.name, ['container', 'inspect', NEXTCLOUD_AIO_CONTAINER], 8_000))
    if (!inspected) { health = 'stopped'; message = 'Nextcloud AIO is not deployed on this Docker context.' }
    else if (inspected.running && (inspected.health === 'none' || inspected.health === 'healthy')) { health = 'healthy'; message = `Nextcloud AIO container is running (${inspected.status}).` }
    else if (inspected.running) { health = 'unhealthy'; message = `Nextcloud AIO container is running but its health is ${inspected.health}.` }
    else { health = 'stopped'; message = `Nextcloud AIO container is stopped (${inspected.status}).` }
  } catch {
    health = 'stopped'
    message = 'Nextcloud AIO is not deployed on this Docker context.'
  }
  return {
    context,
    capturedAt: Date.now(),
    health,
    phase: 'completed',
    message,
    endpointLabel: context.endpointLabel,
    socketAuthority: 'docker-socket-mounted-read-only',
    privileged: false,
    image: NEXTCLOUD_AIO_IMAGE,
    containerName: NEXTCLOUD_AIO_CONTAINER
  }
}

async function backups(context: NextcloudAioContext): Promise<NextcloudAioBackupRecord[]> {
  const output = await docker(context.name, ['volume', 'ls', '--filter', 'label=dev.nodeterm.nextcloud-aio.backup=true', '--format', '{{json .}}'], 8_000).catch(() => '')
  return jsonLines(output, (row) => {
    const name = field(row, 'Name')
    if (!name.startsWith(`${NEXTCLOUD_AIO_BACKUP_VOLUME}-`) || !SAFE_BACKUP.test(name)) return null
    return { id: name, label: `Nextcloud AIO backup ${name.slice(NEXTCLOUD_AIO_BACKUP_VOLUME.length + 1)}`, createdAt: Date.now(), sizeLabel: 'size reported by Docker when opened', available: true }
  })
}

export async function nextcloudAioSnapshot(contextName = ''): Promise<NextcloudAioSnapshot> {
  const contexts = await discoverNextcloudAioContexts()
  const context = selectedContext(contextName, contexts)
  return { status: await status(context), backups: await backups(context) }
}

function socketBinding(): string {
  return process.platform === 'win32' ? '//./pipe/docker_engine:/var/run/docker.sock:ro' : '/var/run/docker.sock:/var/run/docker.sock:ro'
}

function volumeMounts(config: NextcloudAioConfig): string[] {
  return ['--volume', `${config.configVolume}:/mnt/docker-aio-config`, '--volume', `${config.dataVolume}:/mnt/ncdata`]
}

function deployArgs(config: NextcloudAioConfig): string[] {
  const bind = config.bindingMode === 'loopback' ? `127.0.0.1:${config.port}:8080` : `${config.port}:8080`
  return [
    'run', '--detach', '--name', config.containerName, '--restart', 'always',
    '--publish', bind, '--volume', socketBinding(), ...volumeMounts(config),
    '--env', 'NEXTCLOUD_DATADIR=/mnt/ncdata', '--label', 'dev.nodeterm.owner=nextcloud-aio',
    '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    config.image
  ]
}

function ensureBackupId(value: string): string {
  if (!SAFE_BACKUP.test(value) || !value.startsWith(`${NEXTCLOUD_AIO_BACKUP_VOLUME}-`)) throw new Error('Choose a discovered Nextcloud AIO backup record.')
  return value
}

async function actionPlan(action: NextcloudAioAction): Promise<{ context: string; args: string[]; operation: NextcloudAioJobProgress['operation']; totalSteps: number }> {
  const checked = validateNextcloudAioAction(action)
  if (!checked) throw new Error('The Nextcloud AIO operation is invalid or contains unsupported input.')
  if (checked.type === 'deploy') {
    const contexts = await discoverNextcloudAioContexts()
    const context = selectedContext(checked.context, contexts).name
    return { context, args: deployArgs(checked.config), operation: 'deploy', totalSteps: 3 }
  }
  const contexts = await discoverNextcloudAioContexts()
  const context = selectedContext(checked.context, contexts).name
  switch (checked.type) {
    case 'start': return { context, args: ['start', NEXTCLOUD_AIO_CONTAINER], operation: 'start', totalSteps: 1 }
    case 'stop': return { context, args: ['stop', '--time', '30', NEXTCLOUD_AIO_CONTAINER], operation: 'stop', totalSteps: 1 }
    case 'update': return { context, args: ['pull', checked.config.image], operation: 'update', totalSteps: 2 }
    case 'backup': {
      const id = ensureBackupId(checked.backupId)
      return { context, args: ['volume', 'create', '--label', 'dev.nodeterm.nextcloud-aio.backup=true', id], operation: 'backup', totalSteps: 2 }
    }
    case 'restore':
    case 'rollback': {
      const id = ensureBackupId(checked.backupId)
      return { context, args: ['run', '--rm', '--mount', `source=${id},target=/backup,readonly`, '--mount', `source=${NEXTCLOUD_AIO_DATA_VOLUME},target=/data`, BACKUP_HELPER_IMAGE, 'sh', '-c', 'rm -rf /data/* && tar -xzf /backup/nextcloud-aio.tar.gz -C /data'], operation: checked.type, totalSteps: 3 }
    }
  }
}

function redacted(value: string): string {
  return value.replace(/\b(password|token|secret|authorization)(\s*[:=]\s*)[^\s]+/gi, '$1$2[redacted]').slice(-MAX_OUTPUT)
}

export function registerNextcloudAioManager(win: BrowserWindow): { dispose(): void } {
  const jobs = new Map<string, ChildProcess>()
  const send = (progress: NextcloudAioJobProgress): void => { if (!win.isDestroyed()) win.webContents.send(IPC.nextcloudAioProgress, progress) }
  ipcMain.handle(IPC.nextcloudAioContexts, () => discoverNextcloudAioContexts())
  ipcMain.handle(IPC.nextcloudAioSnapshot, (_event, context?: string) => nextcloudAioSnapshot(typeof context === 'string' ? context : ''))
  ipcMain.handle(IPC.nextcloudAioRun, async (_event, raw: unknown): Promise<{ jobId: string }> => {
    const action = validateNextcloudAioAction(raw)
    if (!action) throw new Error('The Nextcloud AIO operation is invalid.')
    const plan = await actionPlan(action)
    const jobId = randomUUID()
    send({ jobId, operation: plan.operation, phase: 'queued', completedSteps: 0, totalSteps: plan.totalSteps, message: 'Queued.' })
    const child = spawn('docker', contextArgs(plan.context, plan.args), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    jobs.set(jobId, child)
    let output = ''
    const append = (chunk: Buffer): void => { output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT); send({ jobId, operation: plan.operation, phase: 'running', completedSteps: 1, totalSteps: plan.totalSteps, message: 'Docker is processing the selected fixed Nextcloud AIO operation.' }) }
    child.stdout?.on('data', append); child.stderr?.on('data', append)
    child.once('error', (error) => { jobs.delete(jobId); send({ jobId, operation: plan.operation, phase: 'failed', completedSteps: 0, totalSteps: plan.totalSteps, message: error.message, output: redacted(output) }) })
    child.once('close', (code, signal) => { jobs.delete(jobId); const cancelled = signal !== null; send({ jobId, operation: plan.operation, phase: cancelled ? 'cancelled' : code === 0 ? 'completed' : 'failed', completedSteps: cancelled || code !== 0 ? 0 : plan.totalSteps, totalSteps: plan.totalSteps, message: cancelled ? 'Cancelled.' : code === 0 ? 'Completed.' : `Docker exited with code ${code ?? 'unknown'}.`, output: redacted(output) }) })
    return { jobId }
  })
  ipcMain.on(IPC.nextcloudAioCancel, (_event, jobId: unknown) => { if (typeof jobId === 'string') jobs.get(jobId)?.kill() })
  return { dispose() { for (const child of jobs.values()) child.kill(); jobs.clear(); for (const channel of [IPC.nextcloudAioContexts, IPC.nextcloudAioSnapshot, IPC.nextcloudAioRun]) ipcMain.removeHandler(channel); ipcMain.removeAllListeners(IPC.nextcloudAioCancel) } }
}
