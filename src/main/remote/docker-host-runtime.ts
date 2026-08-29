import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { DockerHostSettings } from '../../shared/types'

const execFileAsync = promisify(execFile)
const SAFE_CONTEXT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/
const SAFE_PREFIX = /^[a-z0-9][a-z0-9_.-]{0,47}$/

export interface DockerContextInfo { name: string; current: boolean; endpoint: string }
export interface DockerHostRuntime {
  context: string
  containerName: string
  stop(): Promise<void>
}

function dockerArgs(context: string, args: string[]): string[] {
  return [...(context ? ['--context', context] : []), ...args]
}

export async function discoverDockerContexts(): Promise<DockerContextInfo[]> {
  const { stdout } = await execFileAsync('docker', ['context', 'ls', '--format', '{{json .}}'], {
    windowsHide: true,
    timeout: 8_000,
    maxBuffer: 256 * 1024
  })
  return stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const row = JSON.parse(line) as { Name?: unknown; Current?: unknown; DockerEndpoint?: unknown }
      return typeof row.Name === 'string' && SAFE_CONTEXT.test(row.Name)
        ? [{ name: row.Name, current: row.Current === true || row.Current === '*', endpoint: typeof row.DockerEndpoint === 'string' ? row.DockerEndpoint : '' }]
        : []
    } catch { return [] }
  })
}

export async function startDockerHostRuntime(
  settings: DockerHostSettings,
  projectCwd: string
): Promise<DockerHostRuntime> {
  const context = settings.context.trim()
  if (context && !SAFE_CONTEXT.test(context)) throw new Error('The selected Docker context is invalid.')
  if (!SAFE_IMAGE.test(settings.image)) throw new Error('The selected Docker image is invalid.')
  if (!SAFE_PREFIX.test(settings.containerPrefix)) throw new Error('The container-name prefix is invalid.')
  if (!projectCwd) throw new Error('The selected project has no local workspace to mount.')
  const cpus = Math.min(8, Math.max(0.25, settings.cpus))
  const memoryMb = Math.min(16_384, Math.max(256, Math.round(settings.memoryMb)))
  const pidsLimit = Math.min(4_096, Math.max(32, Math.round(settings.pidsLimit)))
  const containerName = `${settings.containerPrefix}-${randomUUID().slice(0, 12)}`
  const args = dockerArgs(context, [
    'run', '--detach', '--rm', '--name', containerName,
    '--label', 'dev.nodeterm.owner=relay-host',
    '--cpus', String(cpus), '--memory', `${memoryMb}m`, '--pids-limit', String(pidsLimit),
    '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--network', settings.network,
    '--mount', `type=bind,source=${projectCwd},target=/workspace${settings.mountMode === 'writable' ? '' : ',readonly'}`,
    '--workdir', '/workspace', settings.image, 'sleep', 'infinity'
  ])
  await execFileAsync('docker', args, { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 })
  let stopped = false
  return {
    context,
    containerName,
    async stop() {
      if (stopped) return
      stopped = true
      await execFileAsync('docker', dockerArgs(context, ['rm', '--force', containerName]), {
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 256 * 1024
      }).catch(() => {})
    }
  }
}
