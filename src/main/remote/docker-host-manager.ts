import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import { registerNextcloudManaged } from './nextcloud-managed'
import {
  DOCKER_GUIDED_IMAGES,
  DOCKER_TYPED_EXEC_TASKS,
  type DockerComposeRow,
  type DockerHostAction,
  type DockerHostAreaState,
  type DockerHostContext,
  type DockerHostJobProgress,
  type DockerHostSnapshot
} from '../../shared/docker-host-manager'
import {
  GITLAB_HOSTING_IMAGES,
  GITLAB_HOSTING_VOLUME_ROLES,
  gitlabBackupResourceDescriptor,
  isGitLabHostingConfig,
  type GitLabBackupSummary,
  type GitLabCredentialHandoff,
  type GitLabHostingAction,
  type GitLabHostingConfig,
  type GitLabHostingStatus
} from '../../shared/gitlab-hosting'
import { validateBackupArchivePath } from '../../shared/backup-restore'

const execFileAsync = promisify(execFile)
const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_RESOURCE = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$/
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const SAFE_BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const MAX_OUTPUT = 1024 * 1024

function contextArgs(context: string, args: string[]): string[] {
  const selected = context.trim()
  if (selected && !SAFE_CONTEXT.test(selected)) throw new Error('The selected Docker context is invalid.')
  return [...(selected ? ['--context', selected] : []), ...args]
}

async function docker(context: string, args: string[], timeout = 20_000): Promise<string> {
  const result = await execFileAsync('docker', contextArgs(context, args), {
    windowsHide: true,
    timeout,
    maxBuffer: MAX_OUTPUT
  })
  return String(result.stdout)
}

function jsonLines<T>(value: string, map: (row: Record<string, unknown>) => T | null): T[] {
  return value.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      const mapped = map(row)
      return mapped ? [mapped] : []
    } catch {
      return []
    }
  })
}

function field(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) if (typeof row[key] === 'string') return row[key] as string
  return ''
}

function safeResource(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_RESOURCE.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

function safeName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw new Error(`${label} is invalid.`)
  return value
}

function redact(value: string): string {
  return value
    .replace(/\b(password|token|secret|authorization)(\s*[:=]\s*)[^\s]+/gi, '$1$2[redacted]')
    .slice(0, MAX_OUTPUT)
}

function contextKind(endpoint: string): DockerHostContext['kind'] {
  if (/^ssh:/i.test(endpoint)) return 'ssh'
  if (/^(unix:|npipe:|desktop-linux|tcp:\/\/127[.])/i.test(endpoint)) return 'local'
  return 'other'
}

export async function discoverDockerManagerContexts(): Promise<DockerHostContext[]> {
  const output = await docker('', ['context', 'ls', '--format', '{{json .}}'], 8_000)
  return jsonLines(output, (row) => {
    const name = field(row, 'Name')
    if (!SAFE_CONTEXT.test(name)) return null
    const endpoint = field(row, 'DockerEndpoint')
    const kind = contextKind(endpoint)
    return {
      name,
      current: row.Current === true || row.Current === '*',
      endpointLabel: kind === 'ssh' ? 'SSH context' : kind === 'local' ? 'Local context' : 'Docker context',
      kind,
      available: true
    }
  })
}

async function area<T>(run: () => Promise<T[]>): Promise<DockerHostAreaState<T>> {
  try {
    return { rows: await run() }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function composeFiles(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean).slice(0, 16)
}

function displayLeaf(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? 'Compose configuration'
}

async function composeRows(context: string): Promise<DockerComposeRow[]> {
  const raw = await docker(context, ['compose', 'ls', '--format', 'json'])
  let rows: Array<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) rows = parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  } catch {
    rows = jsonLines(raw, (row) => row)
  }
  return Promise.all(rows.slice(0, 64).flatMap(async (row) => {
    const name = field(row, 'Name')
    const files = composeFiles(field(row, 'ConfigFiles'))
    if (!SAFE_NAME.test(name) || files.length === 0) return []
    const fileArgs = files.flatMap((file) => ['--file', file])
    const profileOutput = await docker(context, ['compose', '--project-name', name, ...fileArgs, 'config', '--profiles']).catch(() => '')
    const profiles = profileOutput.split(/\r?\n/).map((item) => item.trim()).filter((item) => SAFE_NAME.test(item)).slice(0, 64)
    return [{ name, status: field(row, 'Status'), configLabel: files.map(displayLeaf).join(', '), profiles }]
  })).then((groups) => groups.flat())
}

export async function dockerHostSnapshot(contextName: string): Promise<DockerHostSnapshot> {
  const contexts = await discoverDockerManagerContexts()
  const selected = contextName.trim()
    ? contexts.find((row) => row.name === contextName.trim())
    : contexts.find((row) => row.current)
  if (!selected) throw new Error('Choose an available local or SSH Docker context and retry.')
  const context = selected.name
  const [containers, images, volumes, networks, compose, stats] = await Promise.all([
    area(async () => jsonLines(await docker(context, ['ps', '--all', '--format', '{{json .}}']), (row) => {
      const id = field(row, 'ID')
      return id ? { id, name: field(row, 'Names'), image: field(row, 'Image'), state: field(row, 'State'), status: field(row, 'Status'), ports: field(row, 'Ports') } : null
    })),
    area(async () => jsonLines(await docker(context, ['image', 'ls', '--format', '{{json .}}']), (row) => {
      const id = field(row, 'ID')
      return id ? { id, repository: field(row, 'Repository'), tag: field(row, 'Tag'), size: field(row, 'Size'), createdSince: field(row, 'CreatedSince') } : null
    })),
    area(async () => jsonLines(await docker(context, ['volume', 'ls', '--format', '{{json .}}']), (row) => {
      const name = field(row, 'Name')
      return name ? { name, driver: field(row, 'Driver'), scope: field(row, 'Scope') } : null
    })),
    area(async () => jsonLines(await docker(context, ['network', 'ls', '--format', '{{json .}}']), (row) => {
      const id = field(row, 'ID')
      return id ? { id, name: field(row, 'Name'), driver: field(row, 'Driver'), scope: field(row, 'Scope'), internal: field(row, 'Internal') === 'true' } : null
    })),
    area(() => composeRows(context)),
    area(async () => jsonLines(await docker(context, ['stats', '--no-stream', '--format', '{{json .}}']), (row) => {
      const id = field(row, 'ID', 'Container')
      return id ? { id, name: field(row, 'Name'), cpu: field(row, 'CPUPerc'), memory: field(row, 'MemUsage'), networkIo: field(row, 'NetIO'), blockIo: field(row, 'BlockIO'), pids: field(row, 'PIDs') } : null
    }))
  ])
  return { context: selected, capturedAt: Date.now(), containers, images, volumes, networks, compose, stats }
}

async function discoveredComposeArgs(context: string, project: string, profile?: string): Promise<string[]> {
  safeName(project, 'The Compose project')
  const rows = await composeRows(context)
  const selected = rows.find((row) => row.name === project)
  if (!selected) throw new Error('The Compose project is no longer present. Refresh and choose it again.')
  const raw = await docker(context, ['compose', 'ls', '--format', 'json'])
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
  const live = parsed.find((row) => field(row, 'Name') === project)
  const files = live ? composeFiles(field(live, 'ConfigFiles')) : []
  if (files.length === 0) throw new Error('The Compose project no longer exposes its configuration files.')
  if (profile && !selected.profiles.includes(profile)) throw new Error('The selected Compose profile is no longer available.')
  return ['compose', '--project-name', project, ...files.flatMap((file) => ['--file', file]), ...(profile ? ['--profile', profile] : [])]
}

function gitlabContainerName(nodeId: string): string {
  if (!SAFE_NODE_ID.test(nodeId)) throw new Error('The GitLab node identity is invalid.')
  return `nodeterm-gitlab-${nodeId}`.slice(0, 120)
}

function gitlabVolumeNames(nodeId: string): Record<(typeof GITLAB_HOSTING_VOLUME_ROLES)[number], string> {
  const base = gitlabContainerName(nodeId)
  return {
    config: `${base}-config`,
    logs: `${base}-logs`,
    data: `${base}-data`,
    backups: `${base}-backups`
  }
}

function validateGitLabConfig(config: unknown): GitLabHostingConfig {
  if (!isGitLabHostingConfig(config)) throw new Error('Choose a pinned GitLab image and valid private ports.')
  return config
}

function validateGitLabAction(action: GitLabHostingAction): GitLabHostingAction {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('The GitLab hosting action is invalid.')
  if (typeof action.context !== 'string') throw new Error('Choose a Docker context before continuing.')
  contextArgs(action.context, [])
  gitlabContainerName(action.nodeId)
  if (action.type === 'deploy' || action.type === 'update') validateGitLabConfig(action.config)
  if (action.type === 'restore') validateBackupArchivePath(action.backupId)
  return action
}

async function gitlabRunArgs(action: GitLabHostingAction): Promise<{ label: string; steps: string[][] }> {
  validateGitLabAction(action)
  const container = gitlabContainerName(action.nodeId)
  const volumes = gitlabVolumeNames(action.nodeId)
  const commonRun = (config: GitLabHostingConfig): string[] => [
    'run', '--detach', '--name', container, '--hostname', container,
    '--label', 'dev.nodeterm.owner=gitlab-hosting',
    '--label', `dev.nodeterm.gitlab.edition=${config.edition}`,
    '--label', `dev.nodeterm.gitlab.image=${config.image}`,
    '--restart', 'unless-stopped', '--shm-size', '256m',
    '--cpus', '2', '--memory', '4096m', '--pids-limit', '1024',
    '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
    '--publish', `127.0.0.1:${config.httpPort}:80`,
    '--publish', `127.0.0.1:${config.sshPort}:22`,
    '--volume', `${volumes.config}:/etc/gitlab`,
    '--volume', `${volumes.logs}:/var/log/gitlab`,
    '--volume', `${volumes.data}:/var/opt/gitlab`,
    '--volume', `${volumes.backups}:/var/opt/gitlab/backups`,
    config.image
  ]

  switch (action.type) {
    case 'deploy':
      return {
        label: `Deploy GitLab ${action.config.edition.toUpperCase()} server`,
        steps: [
          ['pull', action.config.image],
          ...GITLAB_HOSTING_VOLUME_ROLES.map((role) => ['volume', 'create', volumes[role]]),
          commonRun(action.config)
        ]
      }
    case 'backup':
      return { label: 'Back up GitLab server', steps: [['exec', container, 'gitlab-backup', 'create']] }
    case 'restore': {
      const backups = await gitlabBackups(action.context, action.nodeId)
      if (!backups.some((backup) => backup.id === action.backupId)) throw new Error('The selected backup is no longer present for this GitLab resource. Refresh and choose it again.')
      return { label: 'Restore GitLab backup', steps: [['exec', container, 'gitlab-backup', 'restore', `BACKUP=${action.backupId}`, 'force=yes']] }
    }
    case 'update':
      return {
        label: `Update GitLab ${action.config.edition.toUpperCase()} server`,
        steps: [
          ['pull', action.config.image],
          ['stop', container],
          ['rename', container, `${container}-previous`],
          commonRun(action.config)
        ]
      }
    case 'rollback':
      return {
        label: 'Roll back GitLab server',
        steps: [
          ['stop', container],
          ['rm', '--force', container],
          ['rename', `${container}-previous`, container],
          ['start', container]
        ]
      }
  }
}

async function gitlabStatus(context: string, nodeId: string): Promise<GitLabHostingStatus> {
  const container = gitlabContainerName(nodeId)
  const volumes = gitlabVolumeNames(nodeId)
  const base = { nodeId, context, containerName: container, volumes, checkedAt: Date.now() }
  let inspect: Record<string, unknown>
  try {
    const raw = await docker(context, ['inspect', '--format', '{{json .}}', container], 15_000)
    inspect = JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    return { ...base, phase: 'missing', ready: false, edition: null, image: null, endpoint: null, detail: error instanceof Error && /No such object/i.test(error.message) ? 'The GitLab container has not been deployed yet.' : 'The GitLab container could not be inspected.' }
  }
  const state = (inspect.State ?? {}) as Record<string, unknown>
  const config = (inspect.Config ?? {}) as Record<string, unknown>
  const labels = (config.Labels ?? {}) as Record<string, unknown>
  const network = (inspect.NetworkSettings ?? {}) as Record<string, unknown>
  const ports = (network.Ports ?? {}) as Record<string, unknown>
  const httpBindings = Array.isArray(ports['80/tcp']) ? ports['80/tcp'] as Array<Record<string, unknown>> : []
  const httpPort = typeof httpBindings[0]?.HostPort === 'string' ? httpBindings[0].HostPort : '8929'
  const endpoint = `http://127.0.0.1:${httpPort}`
  const running = state.Running === true
  const image = typeof labels['dev.nodeterm.gitlab.image'] === 'string' ? labels['dev.nodeterm.gitlab.image'] : typeof inspect.Image === 'string' ? inspect.Image : null
  const edition = labels['dev.nodeterm.gitlab.edition'] === 'ee' ? 'ee' : labels['dev.nodeterm.gitlab.edition'] === 'ce' ? 'ce' : null
  if (!running) return { ...base, phase: 'stopped', ready: false, edition, image, endpoint: null, detail: 'The GitLab container exists but is stopped.' }
  try {
    await docker(context, ['exec', container, 'curl', '--fail', '--silent', '--show-error', 'http://127.0.0.1/-/readiness'], 15_000)
    return { ...base, phase: 'ready', ready: true, edition, image, endpoint, detail: 'GitLab readiness probe is healthy.' }
  } catch {
    return { ...base, phase: 'unready', ready: false, edition, image, endpoint, detail: 'GitLab is running but its readiness probe has not passed yet.' }
  }
}

async function gitlabBackups(context: string, nodeId: string): Promise<GitLabBackupSummary[]> {
  const container = gitlabContainerName(nodeId)
  const status = await gitlabStatus(context, nodeId)
  const image = GITLAB_HOSTING_IMAGES.find((candidate) => candidate.ref === status.image)
  if (!status.edition || !image) throw new Error('GitLab backup metadata is unavailable until the managed image and edition are verified.')
  const resource = gitlabBackupResourceDescriptor(nodeId, status.edition, image.version)
  const raw = await docker(context, ['exec', container, 'find', '/var/opt/gitlab/backups', '-maxdepth', '1', '-type', 'f', '-printf', '%f\\t%s\\t%T@\\n'], 15_000)
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [filename, size, mtime] = line.split('\t')
    if (!filename || !SAFE_BACKUP_ID.test(filename)) return []
    try { validateBackupArchivePath(filename) } catch { return [] }
    const sizeBytes = Number(size)
    const createdAt = Number(mtime)
    return [{ id: filename, filename, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null, createdAt: Number.isFinite(createdAt) ? Math.round(createdAt * 1000) : null, resource }]
  }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 200)
}

const gitlabCredentialClaims = new Set<string>()

async function gitlabInitialCredential(context: string, nodeId: string): Promise<GitLabCredentialHandoff> {
  const container = gitlabContainerName(nodeId)
  const claimKey = `${context}\u0000${container}`
  if (gitlabCredentialClaims.has(claimKey)) throw new Error('The initial credential was already handed off in this session.')
  const raw = await docker(context, ['exec', container, 'cat', '/etc/gitlab/initial_root_password'], 15_000)
  const match = raw.match(/^Password:\s*(\S+)\s*$/mi)
  if (!match?.[1]) throw new Error('GitLab has not published an initial credential yet. Wait for readiness and retry.')
  gitlabCredentialClaims.add(claimKey)
  return { username: 'root', password: match[1], expiresAt: Date.now() + 15 * 60 * 1000 }
}

async function recoverGitLabUpdate(context: string, nodeId: string): Promise<void> {
  const container = gitlabContainerName(nodeId)
  const previous = `${container}-previous`
  // The new container may have been created before its health could be checked. Remove only this
  // deterministic owner-labelled name, then put the previous container back under its original
  // name. Every call uses fixed argv and any recovery failure remains visible on the failed job.
  await docker(context, ['rm', '--force', container], 15_000).catch(() => '')
  await docker(context, ['rename', previous, container], 15_000).catch(() => '')
  await docker(context, ['start', container], 15_000).catch(() => '')
}

function actionLabel(action: DockerHostAction): string {
  switch (action.type) {
    case 'container-lifecycle': return `${action.action} container`
    case 'container-remove': return 'remove container'
    case 'container-create': return 'create container'
    case 'image-pull': return 'pull image'
    case 'image-remove': return 'remove image'
    case 'volume-create': return 'create volume'
    case 'volume-remove': return 'remove volume'
    case 'network-create': return 'create network'
    case 'network-remove': return 'remove network'
    case 'compose-lifecycle': return `${action.action} Compose project`
    case 'typed-exec': return 'run typed container task'
  }
}

async function actionArgs(action: DockerHostAction): Promise<{ context: string; args: string[] }> {
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') {
    throw new Error('The Docker action is invalid.')
  }
  const context = action.context.trim()
  contextArgs(context, [])
  switch (action.type) {
    case 'container-lifecycle': {
      if (!['start', 'stop', 'restart', 'pause', 'unpause'].includes(action.action)) throw new Error('The container action is invalid.')
      return { context, args: [action.action, safeResource(action.containerId, 'The container')] }
    }
    case 'container-remove':
      return { context, args: ['rm', '--force', safeResource(action.containerId, 'The container')] }
    case 'container-create': {
      if (!DOCKER_GUIDED_IMAGES.some((item) => item.ref === action.image)) throw new Error('Choose an image from the guided catalog.')
      const prefix = safeName(action.namePrefix, 'The container name prefix').toLowerCase()
      const name = `${prefix}-${randomUUID().slice(0, 10)}`
      const network = safeResource(action.network, 'The network')
      if (typeof action.readOnly !== 'boolean') throw new Error('The read-only choice is invalid.')
      if (network !== 'none') {
        const available = jsonLines(await docker(context, ['network', 'ls', '--format', '{{json .}}']), (row) => field(row, 'Name') || null)
        if (!available.includes(network)) throw new Error('The selected network is no longer available. Refresh and choose it again.')
      }
      return { context, args: ['run', '--detach', '--name', name, '--label', 'dev.nodeterm.owner=host-manager', '--cpus', '1', '--memory', '1024m', '--pids-limit', '256', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', ...(action.readOnly ? ['--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m'] : []), '--network', network, action.image, 'sleep', 'infinity'] }
    }
    case 'image-pull':
      if (!DOCKER_GUIDED_IMAGES.some((item) => item.ref === action.image)) throw new Error('Choose an image from the guided catalog.')
      return { context, args: ['pull', action.image] }
    case 'image-remove': return { context, args: ['image', 'rm', safeResource(action.imageId, 'The image')] }
    case 'volume-create': return { context, args: ['volume', 'create', safeName(action.name, 'The volume name')] }
    case 'volume-remove': return { context, args: ['volume', 'rm', safeName(action.name, 'The volume')] }
    case 'network-create': return { context, args: ['network', 'create', '--driver', 'bridge', ...(action.internal ? ['--internal'] : []), safeName(action.name, 'The network name')] }
    case 'network-remove': {
      const network = safeResource(action.networkId, 'The network')
      const builtIn = jsonLines(await docker(context, ['network', 'ls', '--format', '{{json .}}']), (row) => {
        const id = field(row, 'ID')
        const name = field(row, 'Name')
        return id && ['bridge', 'host', 'none'].includes(name) ? id : null
      })
      if (builtIn.some((id) => network === id || id.startsWith(network))) throw new Error('Built-in Docker networks cannot be removed here.')
      return { context, args: ['network', 'rm', network] }
    }
    case 'compose-lifecycle': {
      if (!['start', 'stop', 'restart'].includes(action.action)) throw new Error('The Compose action is invalid.')
      const base = await discoveredComposeArgs(context, action.project, action.profile)
      return { context, args: [...base, action.action] }
    }
    case 'typed-exec': {
      const container = safeResource(action.containerId, 'The container')
      if (!DOCKER_TYPED_EXEC_TASKS.some((task) => task.id === action.task)) throw new Error('Choose a supported typed task.')
      const commands: Record<typeof action.task, string[]> = {
        os: ['uname', '-a'], cwd: ['pwd'], workspace: ['ls', '-la', '/workspace'],
        'git-status': ['git', '-C', '/workspace', 'status', '--short', '--branch'],
        'node-version': ['node', '--version']
      }
      return { context, args: ['exec', '-i', container, ...commands[action.task]] }
    }
    default:
      throw new Error('The Docker action type is unsupported.')
  }
}

export function registerDockerHostManager(win: BrowserWindow): { dispose(): void } {
  const nextcloud = registerNextcloudManaged(win)
  const jobs = new Map<string, ChildProcess>()
  const send = (progress: DockerHostJobProgress): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.dockerHostManagerProgress, progress)
  }

  const runGitLab = async (action: GitLabHostingAction): Promise<{ jobId: string }> => {
    const plan = await gitlabRunArgs(action)
    const jobId = randomUUID()
    send({ jobId, phase: 'queued', label: plan.label, completedSteps: 0, totalSteps: plan.steps.length, message: 'Queued.' })
    const runStep = (args: string[], step: number): Promise<number> => new Promise((resolve, reject) => {
      let output = ''
      const child = spawn('docker', contextArgs(action.context, args), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      jobs.set(jobId, child)
      send({ jobId, phase: 'running', label: plan.label, completedSteps: step, totalSteps: plan.steps.length, message: 'GitLab hosting is processing the selected operation.' })
      const append = (chunk: Buffer): void => {
        output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT)
        send({ jobId, phase: 'running', label: plan.label, completedSteps: step, totalSteps: plan.steps.length, message: 'GitLab hosting is processing the selected operation.', output: redact(output) })
      }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (signal) reject(new Error('The GitLab hosting operation was cancelled.'))
        else if (code !== 0) reject(new Error(`GitLab operation exited with code ${code ?? 'unknown'}. ${redact(output)}`))
        else resolve(code ?? 0)
      })
    })
    void (async () => {
      try {
        for (let index = 0; index < plan.steps.length; index += 1) await runStep(plan.steps[index], index)
        jobs.delete(jobId)
        send({ jobId, phase: 'completed', label: plan.label, completedSteps: plan.steps.length, totalSteps: plan.steps.length, message: 'Completed.' })
      } catch (error) {
        if (action.type === 'update') await recoverGitLabUpdate(action.context, action.nodeId)
        jobs.delete(jobId)
        const cancelled = error instanceof Error && /cancelled/i.test(error.message)
        send({ jobId, phase: cancelled ? 'cancelled' : 'failed', label: plan.label, completedSteps: 0, totalSteps: plan.steps.length, message: cancelled ? 'Cancelled.' : error instanceof Error ? error.message : String(error) })
      }
    })()
    return { jobId }
  }

  ipcMain.handle(IPC.dockerHostManagerContexts, () => discoverDockerManagerContexts())
  ipcMain.handle(IPC.dockerHostManagerSnapshot, (_event, context: string) => dockerHostSnapshot(context))
  ipcMain.handle(IPC.dockerHostManagerLogs, async (_event, context: string, containerId: string) =>
    redact(await docker(context, ['logs', '--tail', '200', safeResource(containerId, 'The container')], 15_000)))
  ipcMain.handle(IPC.dockerHostManagerGitlabStatus, (_event, context: string, nodeId: string) => gitlabStatus(context, nodeId))
  ipcMain.handle(IPC.dockerHostManagerGitlabBackups, (_event, context: string, nodeId: string) => gitlabBackups(context, nodeId))
  ipcMain.handle(IPC.dockerHostManagerGitlabCredential, (_event, context: string, nodeId: string) => gitlabInitialCredential(context, nodeId))
  ipcMain.handle(IPC.dockerHostManagerGitlabRun, (_event, action: GitLabHostingAction) => runGitLab(action))
  ipcMain.handle(IPC.dockerHostManagerRun, async (_event, action: DockerHostAction): Promise<{ jobId: string }> => {
    const jobId = randomUUID()
    const label = actionLabel(action)
    send({ jobId, phase: 'queued', label, completedSteps: 0, totalSteps: 1, message: 'Queued.' })
    const plan = await actionArgs(action)
    const child = spawn('docker', contextArgs(plan.context, plan.args), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    jobs.set(jobId, child)
    let output = ''
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT)
      send({ jobId, phase: 'running', label, completedSteps: 0, totalSteps: 1, message: 'Docker is processing the selected action.' })
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => {
      jobs.delete(jobId)
      send({ jobId, phase: 'failed', label, completedSteps: 0, totalSteps: 1, message: error.message, output: redact(output) })
    })
    child.once('close', (code, signal) => {
      jobs.delete(jobId)
      const cancelled = signal !== null
      send({ jobId, phase: cancelled ? 'cancelled' : code === 0 ? 'completed' : 'failed', label, completedSteps: cancelled || code !== 0 ? 0 : 1, totalSteps: 1, message: cancelled ? 'Cancelled.' : code === 0 ? 'Completed.' : `Docker exited with code ${code ?? 'unknown'}.`, output: redact(output) })
    })
    return { jobId }
  })
  ipcMain.on(IPC.dockerHostManagerCancel, (_event, jobId: string) => jobs.get(jobId)?.kill())

  return {
    dispose() {
      for (const child of jobs.values()) child.kill()
      jobs.clear()
      for (const channel of [IPC.dockerHostManagerContexts, IPC.dockerHostManagerSnapshot, IPC.dockerHostManagerLogs, IPC.dockerHostManagerRun, IPC.dockerHostManagerGitlabStatus, IPC.dockerHostManagerGitlabBackups, IPC.dockerHostManagerGitlabCredential, IPC.dockerHostManagerGitlabRun]) ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(IPC.dockerHostManagerCancel)
      nextcloud.dispose()
    }
  }
}
