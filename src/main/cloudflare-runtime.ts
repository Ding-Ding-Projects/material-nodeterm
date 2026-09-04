import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { writeFileAtomic } from '../core/fs-atomic'
import { promisify } from 'node:util'
import path from 'node:path'
import type { CloudflareOriginTarget, CloudflareTunnelRuntime } from '../shared/cloudflare-tunnel'
import { validCloudflarePort, validCloudflareOrigin } from '../shared/cloudflare-tunnel'

const execFileAsync = promisify(execFile)
const LOCAL_HOST_ID = 'local'
const CONNECTOR_IMAGE = 'cloudflare/cloudflared:2025.8.1'
const MAX_STDOUT = 4 * 1024 * 1024
const SAFE_DOCKER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

interface DockerContainer {
  Id?: unknown
  Name?: unknown
  State?: unknown
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>
    Networks?: Record<string, { NetworkID?: string }>
  }
}

async function docker(args: string[]): Promise<string> {
  const result = await execFileAsync('docker', args, {
    timeout: 15_000,
    maxBuffer: MAX_STDOUT,
    windowsHide: true
  })
  return result.stdout
}

function localOrigin(port: number): string {
  return `http://127.0.0.1:${port}`
}

/** Desktop-only structured Docker runtime. User strings become validated argv values, never shell. */
export function createLocalCloudflareRuntime(userDataDir: string): CloudflareTunnelRuntime {
  const tokenRoot = path.join(userDataDir, 'cloudflare-tunnels')
  return {
    async discoverTargets(): Promise<CloudflareOriginTarget[]> {
      let listing: string
      try { listing = await docker(['ps', '--format', '{{json .}}']) } catch { return [] }
      const containers = listing.split(/\r?\n/).map((line) => {
        try { return JSON.parse(line) as DockerContainer } catch { return null }
      }).filter((row): row is DockerContainer => !!row && typeof row.Id === 'string')
      const out: CloudflareOriginTarget[] = []
      for (const listed of containers) {
        if (typeof listed.Id !== 'string' || !SAFE_DOCKER_ID.test(listed.Id)) continue
        let inspect: DockerContainer[]
        try { inspect = JSON.parse(await docker(['inspect', listed.Id])) as DockerContainer[] } catch { continue }
        const row = inspect[0]
        if (!row || typeof row.Id !== 'string') continue
        const ports = row.NetworkSettings?.Ports ?? {}
        const networks = Object.entries(row.NetworkSettings?.Networks ?? {})
        const network = networks.find(([name, value]) => typeof name === 'string' && SAFE_DOCKER_ID.test(name) && typeof value?.NetworkID === 'string')
        for (const [binding, mappings] of Object.entries(ports)) {
          const port = Number(binding.split('/')[0])
          const hostPort = mappings?.find((item) => item?.HostIp === undefined || item.HostIp === '' || item.HostIp === '0.0.0.0' || item.HostIp === '127.0.0.1')?.HostPort
          const chosenPort = Number(hostPort ?? port)
          if (!validCloudflarePort(chosenPort) || !validCloudflareOrigin(localOrigin(chosenPort))) continue
          const containerName = typeof row.Name === 'string' ? row.Name.replace(/^\//, '').slice(0, 128) : null
          out.push({
            id: `${row.Id}:${chosenPort}`,
            hostId: LOCAL_HOST_ID,
            hostLabel: 'This computer',
            containerId: row.Id,
            containerName,
            networkId: network?.[1].NetworkID ?? null,
            networkName: network?.[0] ?? null,
            port: chosenPort,
            originUrl: localOrigin(chosenPort),
            state: row.State === 'running' ? 'running' : 'stopped'
          })
        }
      }
      return out
    },

    async installConnector(input): Promise<{ connectorContainerId: string; tokenFilePath: string }> {
      if (input.hostId !== LOCAL_HOST_ID || !SAFE_DOCKER_ID.test(input.tunnelId) || !SAFE_DOCKER_ID.test(input.target.containerId ?? '') || !input.target.networkName || !SAFE_DOCKER_ID.test(input.target.networkName)) {
        throw new Error('The selected host, container, or network is no longer valid.')
      }
      if (!validCloudflareOrigin(input.target.originUrl) || !validCloudflarePort(input.target.port)) throw new Error('The selected origin is not a valid private target.')
      const connectorContainerId = `nodeterm-cloudflared-${input.tunnelId}`
      const tokenFilePath = path.join(tokenRoot, `${input.tunnelId}.token`)
      await mkdir(tokenRoot, { recursive: true })
      await writeFileAtomic(tokenFilePath, `${input.token}\n`, { mode: 0o600 })
      try {
        const args = [
          'run', '--detach', '--name', connectorContainerId, '--restart', 'unless-stopped',
          '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--pids-limit', '64', '--memory', '128m', '--network', input.target.networkName,
          '--mount', `type=bind,src=${tokenFilePath},dst=/etc/cloudflared/token,readonly`,
          CONNECTOR_IMAGE, 'tunnel', '--no-autoupdate', 'run', '--token-file', '/etc/cloudflared/token'
        ]
        const id = (await docker(args)).trim()
        if (!SAFE_DOCKER_ID.test(id)) throw new Error('The connector did not return a container id.')
        return { connectorContainerId: id, tokenFilePath }
      } catch (error) {
        await rm(tokenFilePath, { force: true }).catch(() => {})
        throw error
      }
    },

    async removeConnector(input): Promise<void> {
      if (input.hostId !== LOCAL_HOST_ID || !SAFE_DOCKER_ID.test(input.connectorContainerId)) return
      await docker(['rm', '--force', input.connectorContainerId]).catch(() => {})
      if (input.tokenFilePath.startsWith(`${tokenRoot}${path.sep}`)) await rm(input.tokenFilePath, { force: true }).catch(() => {})
    },

    async checkOrigin(target): Promise<{ ok: boolean; detail: string }> {
      if (!validCloudflareOrigin(target.originUrl) || !validCloudflarePort(target.port)) return { ok: false, detail: 'The selected origin is not a bounded private HTTP(S) endpoint.' }
      try {
        const response = await fetch(target.originUrl, { method: 'HEAD', signal: AbortSignal.timeout(5_000) })
        return response.ok ? { ok: true, detail: `Origin responded with HTTP ${response.status}.` } : { ok: false, detail: `Origin responded with HTTP ${response.status}.` }
      } catch { return { ok: false, detail: 'The private origin did not respond to the health check.' }
      }
    }
  }
}

