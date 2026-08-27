import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  NEXTCLOUD_MANAGED_IMAGES,
  NEXTCLOUD_MANAGED_OPERATION_STEPS,
  NEXTCLOUD_MANAGED_SECRET_FILES,
  type NextcloudManagedAction,
  type NextcloudManagedBinding,
  type NextcloudManagedProgress,
  validateNextcloudManagedAction,
  validateNextcloudManagedBinding
} from '../../shared/nextcloud-managed'

const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/
const SAFE_SNAPSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_OUTPUT = 1024 * 1024

function contextArgs(context: string, args: string[]): string[] {
  if (!SAFE_CONTEXT.test(context)) throw new Error('The selected Docker context is invalid.')
  return ['--context', context, ...args]
}

function localPath(value: string, label: string): string {
  const normalized = path.resolve(value)
  if (normalized !== value && path.normalize(value) !== normalized) throw new Error(`${label} must be a resolved local folder.`)
  return normalized
}

function projectFile(dataDirectory: string, projectName: string): string {
  return path.join(dataDirectory, `.${projectName}.compose.yml`)
}

function secretDirectory(dataDirectory: string, projectName: string): string {
  return path.join(dataDirectory, `.${projectName}.secrets`)
}

function composeText(projectName: string, dataDirectory: string, port: number, secretsDir: string): string {
  const dataVolume = path.join(dataDirectory, 'nextcloud-data').replaceAll('\\', '/')
  const secrets = secretsDir.replaceAll('\\', '/')
  return [
    'services:',
    '  database:',
    `    container_name: ${projectName}-db`,
    `    image: ${NEXTCLOUD_MANAGED_IMAGES.database}`,
    '    restart: unless-stopped',
    '    environment:',
    '      POSTGRES_DB: nextcloud',
    '      POSTGRES_USER: nextcloud',
    '      POSTGRES_PASSWORD_FILE: /run/secrets/postgres-password',
    '    secrets:',
    '      - postgres-password',
    '    networks: [nextcloud-private]',
    '  cache:',
    `    container_name: ${projectName}-redis`,
    `    image: ${NEXTCLOUD_MANAGED_IMAGES.cache}`,
    '    restart: unless-stopped',
    '    networks: [nextcloud-private]',
    '  web:',
    `    container_name: ${projectName}-web`,
    `    image: ${NEXTCLOUD_MANAGED_IMAGES.web}`,
    '    restart: unless-stopped',
    '    depends_on: [database, cache]',
    '    environment:',
    '      POSTGRES_HOST: database',
    '      POSTGRES_DB: nextcloud',
    '      POSTGRES_USER: nextcloud',
    '      POSTGRES_PASSWORD_FILE: /run/secrets/postgres-password',
    '      REDIS_HOST: cache',
    '      NEXTCLOUD_ADMIN_USER: admin',
    '      NEXTCLOUD_ADMIN_PASSWORD_FILE: /run/secrets/nextcloud-admin-password',
    `    ports: ["127.0.0.1:${port}:80"]`,
    `    volumes: ["${dataVolume}:/var/www/html"]`,
    '    secrets:',
    '      - postgres-password',
    '      - nextcloud-admin-password',
    '      - nextcloud-instance-secret',
    '    networks: [nextcloud-private]',
    'networks:',
    '  nextcloud-private:',
    '    internal: true',
    'secrets:',
    '  postgres-password:',
    `    file: "${secrets}/postgres-password"`,
    '  nextcloud-admin-password:',
    `    file: "${secrets}/nextcloud-admin-password"`,
    '  nextcloud-instance-secret:',
    `    file: "${secrets}/nextcloud-instance-secret"`,
    ''
  ].join('\n')
}

async function writeSecretFiles(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  for (const secret of NEXTCLOUD_MANAGED_SECRET_FILES) {
    const filename = path.join(directory, secret.fileName)
    try {
      await fs.access(filename)
    } catch {
      await fs.writeFile(filename, `${randomBytes(32).toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    }
  }
}

async function writeCompose(action: NextcloudManagedAction): Promise<string> {
  const dataDirectory = localPath(action.dataDirectory, 'The Nextcloud data directory')
  const secrets = secretDirectory(dataDirectory, action.projectName)
  await fs.mkdir(dataDirectory, { recursive: true })
  await writeSecretFiles(secrets)
  const file = projectFile(dataDirectory, action.projectName)
  await fs.writeFile(file, composeText(action.projectName, dataDirectory, action.loopbackPort, secrets), { encoding: 'utf8', mode: 0o600 })
  return file
}

function composeArgs(action: NextcloudManagedAction, file: string, args: string[]): string[] {
  return contextArgs(action.context, ['compose', '--project-name', action.projectName, '--file', file, ...args])
}

function snapshotName(action: NextcloudManagedAction): string {
  if (action.snapshotId && SAFE_SNAPSHOT.test(action.snapshotId)) return action.snapshotId
  return `nextcloud-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`
}

function operationCommands(action: NextcloudManagedAction, file: string): Array<{ phase: NextcloudManagedProgress['phase']; args: string[] }> {
  const compose = (args: string[]) => composeArgs(action, file, args)
  if (action.operation === 'deploy') return [{ phase: 'web', args: compose(['up', '--detach']) }]
  if (action.operation === 'update') return [
    { phase: 'backup', args: contextArgs(action.context, ['run', '--rm', '--volumes-from', `${action.projectName}-web`, '--volume', `${localPath(action.backupDirectory, 'The Nextcloud backup directory')}:/backup`, 'alpine:3.20', 'tar', '-czf', `/backup/${snapshotName(action)}.tar.gz`, '/var/www/html']) },
    { phase: 'web', args: compose(['pull', 'web']) },
    { phase: 'web', args: compose(['up', '--detach', '--no-deps', 'web']) }
  ]
  if (action.operation === 'backup') return [{ phase: 'backup', args: contextArgs(action.context, ['run', '--rm', '--volumes-from', `${action.projectName}-web`, '--volume', `${localPath(action.backupDirectory, 'The Nextcloud backup directory')}:/backup`, 'alpine:3.20', 'tar', '-czf', `/backup/${snapshotName(action)}.tar.gz`, '/var/www/html']) }]
  const snapshot = action.snapshotId && SAFE_SNAPSHOT.test(action.snapshotId) ? action.snapshotId : ''
  const restoreArgs = contextArgs(action.context, ['run', '--rm', '--volumes-from', `${action.projectName}-web`, '--volume', `${localPath(action.backupDirectory, 'The Nextcloud backup directory')}:/backup:ro`, 'alpine:3.20', 'tar', '-xzf', `/backup/${snapshot}.tar.gz`, '-C', '/var/www/html'])
  return [
    { phase: action.operation === 'restore' ? 'restore' : 'rollback', args: compose(['stop', 'web']) },
    { phase: action.operation === 'restore' ? 'restore' : 'rollback', args: restoreArgs },
    { phase: 'database', args: compose(['up', '--detach', 'database']) },
    { phase: 'cache', args: compose(['up', '--detach', 'cache']) },
    { phase: 'web', args: compose(['up', '--detach', 'web']) }
  ]
}

export function registerNextcloudManaged(win: BrowserWindow): { dispose(): void } {
  const jobs = new Map<string, ChildProcess>()
  const send = (progress: NextcloudManagedProgress): void => { if (!win.isDestroyed()) win.webContents.send(IPC.nextcloudManagedProgress, progress) }

  ipcMain.handle(IPC.nextcloudManagedSnapshots, async (_event, raw: NextcloudManagedBinding): Promise<string[]> => {
    const binding = validateNextcloudManagedBinding(raw)
    const directory = localPath(binding.backupDirectory, 'The Nextcloud backup directory')
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tar.gz'))
      .map((entry) => entry.name.slice(0, -'.tar.gz'.length))
      .filter((id) => SAFE_SNAPSHOT.test(id))
      .sort()
      .slice(-128)
  })

  ipcMain.handle(IPC.nextcloudManagedRun, async (_event, raw: NextcloudManagedAction): Promise<{ jobId: string }> => {
    const action = validateNextcloudManagedAction(raw)
    const jobId = randomUUID()
    const steps = NEXTCLOUD_MANAGED_OPERATION_STEPS[action.operation]
    send({ jobId, operation: action.operation, phase: 'queued', completedSteps: 0, totalSteps: steps.length, message: 'Queued.' })
    const file = await writeCompose(action)
    const commands = operationCommands(action, file)
    const execute = async (): Promise<void> => {
      let output = ''
      for (let index = 0; index < commands.length; index += 1) {
        const step = commands[index]
        const result = await new Promise<boolean | 'cancelled'>((resolve) => {
          const child = spawn('docker', step.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          jobs.set(jobId, child)
          let settled = false
          const finish = (value: boolean | 'cancelled'): void => { if (!settled) { settled = true; resolve(value) } }
          const append = (chunk: Buffer): void => {
            output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT)
            send({ jobId, operation: action.operation, phase: step.phase, completedSteps: index, totalSteps: steps.length, message: 'The selected managed operation is running.', output })
          }
          child.stdout.on('data', append)
          child.stderr.on('data', append)
          child.once('error', (error) => { output = (output + error.message).slice(-MAX_OUTPUT); finish(false) })
          child.once('close', (code, signal) => { jobs.delete(jobId); if (signal !== null) finish('cancelled'); else finish(code === 0) })
        })
        if (result === 'cancelled') {
          send({ jobId, operation: action.operation, phase: 'cancelled', completedSteps: index, totalSteps: steps.length, message: 'Cancelled.', output })
          return
        }
        if (!result) {
          send({ jobId, operation: action.operation, phase: 'failed', completedSteps: index, totalSteps: steps.length, message: 'The managed operation stopped before this sequence completed.', output })
          return
        }
      }
      send({ jobId, operation: action.operation, phase: 'completed', completedSteps: steps.length, totalSteps: steps.length, message: 'Completed.', output })
    }
    void execute().catch((cause) => send({ jobId, operation: action.operation, phase: 'failed', completedSteps: 0, totalSteps: steps.length, message: cause instanceof Error ? cause.message : String(cause) }))
    return { jobId }
  })
  ipcMain.on(IPC.nextcloudManagedCancel, (_event, jobId: string) => {
    const child = jobs.get(jobId)
    if (child) child.kill()
  })
  return { dispose() { for (const child of jobs.values()) child.kill(); jobs.clear(); ipcMain.removeHandler(IPC.nextcloudManagedRun); ipcMain.removeHandler(IPC.nextcloudManagedSnapshots); ipcMain.removeAllListeners(IPC.nextcloudManagedCancel) } }
}
