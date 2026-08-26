import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile, statfs, readdir, rm } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import type { CorePlatform } from '../platform'
import {
  DEFAULT_VIRTUAL_MACHINE_CONFIG,
  normalizeVirtualMachineConfig,
  normalizeVirtualMachineLocalPaths,
  safeVirtualMachinePath,
  virtualMachineConfigReady,
  type VirtualMachineConfig,
  type VirtualMachineEvent,
  type VirtualMachineLocalPaths,
  type VirtualMachinePhase,
  type VirtualMachineStatus,
  type VirtualMachineToolStatus
} from '../../shared/virtual-machine'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SAFE_SNAPSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const QMP_TIMEOUT_MS = 2500
const STOP_TIMEOUT_MS = 3000
const WHPX_PROBE_TIMEOUT_MS = 1500

interface PersistedVm {
  id: string
  config: VirtualMachineConfig
  local: VirtualMachineLocalPaths
  phase: VirtualMachinePhase
  snapshotNames: string[]
  updatedAt: string
  isoSha256Actual?: string
  error?: string
}

interface RunningVm {
  process: ChildProcess
  displayPort: number
  qmpPort: number
  diskPath: string | null
  mode: VirtualMachineConfig['mode']
  accelerator: 'whpx' | 'tcg'
  generation: number
  stderr: string
}

function safeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}

function safeSnapshotName(name: unknown): name is string {
  return typeof name === 'string' && SAFE_SNAPSHOT.test(name)
}

function portFor(id: string, base: number): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return base + (hash % 500)
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => { probe.close(); resolve(false) })
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

async function choosePorts(id: string): Promise<{ displayPort: number; qmpPort: number }> {
  const displayBase = portFor(id, 5900)
  const qmpBase = portFor(id, 7900)
  for (let attempt = 0; attempt < 20; attempt++) {
    const displayPort = 5900 + ((displayBase - 5900 + attempt) % 500)
    const qmpPort = 7900 + ((qmpBase - 7900 + attempt) % 500)
    if (await portFree(displayPort) && await portFree(qmpPort)) return { displayPort, qmpPort }
  }
  throw new Error('No free loopback display and QMP ports are available for this VM.')
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

async function detectDiskFormat(file: string | null): Promise<'qcow2' | 'raw' | 'unknown'> {
  if (!file) return 'unknown'
  try {
    const handle = await import('node:fs/promises').then((fs) => fs.open(file, 'r'))
    const header = Buffer.alloc(4)
    const read = await handle.read(header, 0, 4, 0)
    await handle.close()
    return diskFormatFromHeader(read.bytesRead === 4 ? header : Buffer.alloc(0))
  } catch {
    return 'unknown'
  }
}

export function diskFormatFromHeader(header: Uint8Array): 'qcow2' | 'raw' | 'unknown' {
  if (header.byteLength < 4) return 'unknown'
  return Buffer.from(header.subarray(0, 4)).toString('ascii') === 'QFI\xfb' ? 'qcow2' : 'raw'
}

export function isoSha256Matches(expected: string | undefined, actual: string): boolean {
  return !expected || (expected.length === 64 && expected.toLowerCase() === actual.toLowerCase())
}

async function freeBytesFor(file: string | null): Promise<number | null> {
  if (!file) return null
  try {
    const target = await exists(file) ? file : path.dirname(file)
    const info = await statfs(target)
    return Number(info.bavail) * Number(info.bsize)
  } catch {
    return null
  }
}

function createDiskImage(executable: string, file: string, sizeGiB: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['create', '-f', 'qcow2', file, `${sizeGiB}G`], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('qemu-img did not create the disk before the timeout.'))
    }, QMP_TIMEOUT_MS * 4)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('qemu-img refused to create the persistent disk.'))
    })
  })
}

function waitForPort(port: number, timeoutMs: number, stillAlive: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const attempt = (): void => {
      if (!stillAlive()) return resolve(false)
      const socket = net.createConnection({ host: '127.0.0.1', port })
      let done = false
      const finish = (ok: boolean): void => { if (done) return; done = true; socket.destroy(); if (ok) resolve(true); else if (Date.now() - started >= timeoutMs) resolve(false); else setTimeout(attempt, 80) }
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
      socket.setTimeout(150, () => finish(false))
    }
    attempt()
  })
}

/** Ask the bundled emulator itself whether WHPX is usable. OS version alone is not evidence: the
 * optional feature can be absent, disabled, or refused by the current host policy. */
function probeWhpx(executable: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(executable, ['-nodefaults', '-machine', 'none', '-accel', 'whpx', '-display', 'none'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr?.on('data', () => {})
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(false) }, WHPX_PROBE_TIMEOUT_MS)
    child.once('error', () => finish(false))
    child.once('exit', (code) => finish(code === 0))
  })
}

function absolutePath(value: string | undefined): string | null {
  if (!safeVirtualMachinePath(value) || !path.isAbsolute(value)) return null
  return path.normalize(value)
}

/** Resolve only files shipped in the application resources. PATH lookup is intentionally absent:
 * a developer's QEMU must never make a packaged feature appear bundled and portable. */
export async function resolveVirtualMachineTools(resourcesPath?: string): Promise<VirtualMachineToolStatus> {
  const root = resourcesPath ? path.join(resourcesPath, 'qemu') : ''
  const candidates = process.platform === 'win32'
    ? { qemu: ['qemu-system-x86_64.exe'], img: ['qemu-img.exe'] }
    : { qemu: ['qemu-system-x86_64'], img: ['qemu-img'] }
  const qemuPath = root ? path.join(root, candidates.qemu[0]) : null
  const qemuImgPath = root ? path.join(root, candidates.img[0]) : null
  const available = !!qemuPath && !!qemuImgPath && await exists(qemuPath) && await exists(qemuImgPath)
  const whpxAvailable = available && process.platform === 'win32' && qemuPath
    ? await probeWhpx(qemuPath)
    : process.platform === 'win32' ? false : null
  return {
    available,
    qemuPath: available ? qemuPath : null,
    qemuImgPath: available ? qemuImgPath : null,
    source: available ? 'bundled' : 'missing',
    resourceRoot: root || null,
    packageProof: available ? 'present' : 'absent',
    sizeDisclosure: 'QEMU 10.1.0 Windows x64 package is approximately 172 MiB before extraction.',
    reason: available ? undefined : 'The bundled QEMU and qemu-img files are missing from the installed package.',
    whpxAvailable
  }
}

function defaultStatus(id: string, record?: PersistedVm): VirtualMachineStatus {
  const config = record?.config ?? DEFAULT_VIRTUAL_MACHINE_CONFIG
  const local = record?.local ?? {}
  const ready = virtualMachineConfigReady(config, local)
  const phase = record?.phase ?? (ready ? 'ready' : 'unconfigured')
  return {
    id,
    phase,
    mode: config.mode,
    configured: ready,
    isoPath: local.isoPath ?? null,
    diskPath: local.diskPath ?? null,
    diskFormat: local.diskFormat ?? 'unknown',
    diskFreeBytes: null,
    isoSha256Expected: config.isoSha256 ?? null,
    isoSha256Actual: record?.isoSha256Actual ?? null,
    accelerator: 'unknown',
    networkEnabled: config.networkEnabled,
    displayUrl: null,
    qmpEndpoint: null,
    memoryMiB: config.memoryMiB,
    cpus: config.cpus,
    progress: ready ? 100 : 0,
    message: phase === 'error' ? 'The VM could not start. Review the error and retry.' : ready ? 'Ready to start.' : 'Choose a Linux ISO and configure the VM.',
    ...(record?.error ? { error: record.error } : {})
  }
}

export class VirtualMachineManager {
  private readonly running = new Map<string, RunningVm>()
  private readonly listeners = new Set<(event: VirtualMachineEvent) => void>()
  private readonly stateDir: string
  private readonly resourcesPath?: string
  private readonly generations = new Map<string, number>()
  private readonly writeTails = new Map<string, Promise<void>>()
  private readonly reconciliation: Promise<void>

  constructor(private readonly platform: CorePlatform) {
    this.stateDir = path.join(platform.userDataDir, 'virtual-machines')
    this.resourcesPath = platform.resourcesPath
    this.reconciliation = this.reconcileOrphans()
  }

  private recordPath(id: string): string {
    if (!safeId(id)) throw new Error('The VM id is invalid.')
    return path.join(this.stateDir, `${id}.json`)
  }

  private async read(id: string): Promise<PersistedVm | null> {
    try {
      const raw = JSON.parse(await readFile(this.recordPath(id), 'utf8')) as Partial<PersistedVm>
      if (!safeId(raw.id) || raw.id !== id) return null
      return {
        id,
        config: normalizeVirtualMachineConfig(raw.config),
        local: normalizeVirtualMachineLocalPaths(raw.local),
        phase: typeof raw.phase === 'string' ? raw.phase as VirtualMachinePhase : 'stopped',
        snapshotNames: Array.isArray(raw.snapshotNames) ? raw.snapshotNames.filter(safeSnapshotName) : [],
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
        ...(typeof raw.isoSha256Actual === 'string' ? { isoSha256Actual: raw.isoSha256Actual } : {}),
        ...(typeof raw.error === 'string' ? { error: raw.error } : {})
      }
    } catch {
      return null
    }
  }

  /** Runtime PIDs are deliberately not persisted. On restart, never attach to a guessed PID or
   * kill an unrelated process. Mark stale records as recoverable errors and require an explicit
   * start, which gives the next launch a fresh generation and QMP/display pair. */
  private async reconcileOrphans(): Promise<void> {
    let entries: string[]
    try { entries = await readdir(this.stateDir) } catch { return }
    await Promise.all(entries.filter((name) => name.endsWith('.json')).map(async (name) => {
      const id = name.slice(0, -5)
      if (!safeId(id)) return
      const record = await this.read(id)
      if (!record || (record.phase !== 'running' && record.phase !== 'starting' && record.phase !== 'stopping')) return
      await this.write({ ...record, phase: 'error', error: 'The previous VM process is no longer owned after restart. Start it again to create a fresh lifecycle.', updatedAt: new Date().toISOString() })
    }))
  }

  private async write(record: PersistedVm): Promise<void> {
    const previous = this.writeTails.get(record.id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.writeOnce(record))
    this.writeTails.set(record.id, next)
    try { await next } finally { if (this.writeTails.get(record.id) === next) this.writeTails.delete(record.id) }
  }

  private async writeOnce(record: PersistedVm): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    const tmp = `${this.recordPath(record.id)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 })
    let lastError: unknown
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        try { await rename(tmp, this.recordPath(record.id)); return } catch (cause) {
          lastError = cause
          const code = (cause as NodeJS.ErrnoException).code
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw cause
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
        }
      }
      throw lastError instanceof Error ? lastError : new Error('The VM state file could not be replaced.')
    } finally {
      await rm(tmp, { force: true }).catch(() => {})
    }
  }

  private emit(status: VirtualMachineStatus): VirtualMachineStatus {
    const event: VirtualMachineEvent = { id: status.id, status }
    for (const listener of this.listeners) listener(event)
    return status
  }

  private async statusFrom(id: string, record?: PersistedVm | null): Promise<VirtualMachineStatus> {
    const current = record ?? await this.read(id)
    const status = defaultStatus(id, current ?? undefined)
    status.diskFreeBytes = await freeBytesFor(status.diskPath)
    const live = this.running.get(id)
    if (!live) return status
    return {
      ...status,
      phase: 'running',
      accelerator: live.accelerator,
      displayUrl: this.resourcesPath ? `vnc://127.0.0.1:${live.displayPort}` : null,
      qmpEndpoint: this.resourcesPath ? `127.0.0.1:${live.qmpPort}` : null,
      progress: 100,
      message: this.resourcesPath ? 'Linux is running in the VM.' : 'Linux is running on the server host. Its loopback display is not exposed to this browser.'
    }
  }

  async tools(): Promise<VirtualMachineToolStatus> {
    return resolveVirtualMachineTools(this.resourcesPath)
  }

  async status(id: string): Promise<VirtualMachineStatus> {
    if (!safeId(id)) throw new Error('The VM id is invalid.')
    await this.reconciliation
    return this.statusFrom(id)
  }

  async configure(id: string, configInput: VirtualMachineConfig, localInput: VirtualMachineLocalPaths): Promise<VirtualMachineStatus> {
    if (!safeId(id)) throw new Error('The VM id is invalid.')
    await this.reconciliation
    if (this.running.has(id)) throw new Error('Stop the VM before changing its configuration.')
    const config = normalizeVirtualMachineConfig(configInput)
    const local = normalizeVirtualMachineLocalPaths(localInput)
    if (!virtualMachineConfigReady(config, local)) {
      throw new Error(config.mode === 'persistent-install'
        ? 'Choose an ISO and a persistent disk before starting.'
        : 'Choose a Linux ISO before starting.')
    }
    const previous = await this.read(id)
    await this.write({
      id,
      config,
      local,
      phase: 'ready',
      snapshotNames: previous?.snapshotNames ?? [],
      updatedAt: new Date().toISOString()
    })
    return this.emit(await this.statusFrom(id))
  }

  async createDisk(id: string, folderInput: string): Promise<VirtualMachineStatus> {
    if (!safeId(id)) throw new Error('The VM id is invalid.')
    await this.reconciliation
    if (this.running.has(id)) throw new Error('Stop the VM before creating a persistent disk.')
    const folder = absolutePath(folderInput)
    if (!folder) throw new Error('Choose an absolute disk folder.')
    const record = await this.read(id)
    const config = normalizeVirtualMachineConfig({ ...(record?.config ?? DEFAULT_VIRTUAL_MACHINE_CONFIG), mode: 'persistent-install' })
    const tools = await this.tools()
    if (!tools.qemuImgPath) throw new Error(tools.reason ?? 'Bundled qemu-img is unavailable.')
    await mkdir(folder, { recursive: true })
    const free = await freeBytesFor(folder)
    const required = config.diskSizeGiB * 1024 ** 3
    if (free !== null && free < required) throw new Error(`Not enough free space for the requested ${config.diskSizeGiB} GiB disk.`)
    const diskPath = path.join(folder, `nodeterm-${id}.qcow2`)
    if (await exists(diskPath)) throw new Error('The proposed persistent disk already exists. Choose another folder or disk.')
    await createDiskImage(tools.qemuImgPath, diskPath, config.diskSizeGiB)
    const next: PersistedVm = {
      id,
      config,
      local: { ...(record?.local ?? {}), diskPath, diskFormat: 'qcow2' },
      phase: 'ready',
      snapshotNames: record?.snapshotNames ?? [],
      updatedAt: new Date().toISOString()
    }
    await this.write(next)
    return this.emit(await this.statusFrom(id, next))
  }

  private async qmp(port: number, command: string, args?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      let buffer = ''
      let settled = false
      let greetingSeen = false
      let capabilityReady = false
      const timer = setTimeout(() => finish(new Error('QMP did not answer before the timeout.')), QMP_TIMEOUT_MS)
      const finish = (error: Error | null, value?: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        if (error) reject(error)
        else resolve(value)
      }
      socket.on('error', (error) => finish(error))
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let parsed: unknown
          try { parsed = JSON.parse(line) } catch { continue }
          if (typeof parsed === 'object' && parsed !== null && 'QMP' in parsed) {
            socket.write(`${JSON.stringify({ execute: 'qmp_capabilities' })}\r\n`)
            greetingSeen = true
          } else if (typeof parsed === 'object' && parsed !== null && ('return' in parsed || 'error' in parsed)) {
            if ('error' in parsed) finish(new Error('QMP rejected the requested lifecycle action.'))
            else if (greetingSeen && !capabilityReady) {
              capabilityReady = true
              socket.write(`${JSON.stringify({ execute: command, ...(args ? { arguments: args } : {}) })}\r\n`)
            } else if (capabilityReady) finish(null, parsed)
          }
        }
      })
    })
  }

  async start(id: string): Promise<VirtualMachineStatus> {
    if (!safeId(id)) throw new Error('The VM id is invalid.')
    await this.reconciliation
    if (this.running.has(id)) return this.emit(await this.statusFrom(id))
    const record = await this.read(id)
    if (!record || !virtualMachineConfigReady(record.config, record.local)) throw new Error('Configure the VM with an ISO before starting.')
    const tools = await this.tools()
    if (!tools.available || !tools.qemuPath) throw new Error(tools.reason ?? 'Bundled QEMU is unavailable.')
    const isoPath = absolutePath(record.local.isoPath)
    const baseDiskPath = absolutePath(record.local.diskPath)
    if (!isoPath || !(await exists(isoPath))) throw new Error('The selected Linux ISO is not readable on this machine.')
    const actualIsoSha256 = await sha256File(isoPath)
    if (!isoSha256Matches(record.config.isoSha256, actualIsoSha256)) {
      const message = `The selected Linux ISO checksum does not match. Expected ${record.config.isoSha256}, actual ${actualIsoSha256}.`
      await this.write({ ...record, phase: 'error', error: message, isoSha256Actual: actualIsoSha256, updatedAt: new Date().toISOString() })
      throw new Error(message)
    }
    if (record.config.mode === 'persistent-install' && !baseDiskPath) throw new Error('Persistent install mode requires a selected disk path.')
    if (record.config.mode === 'persistent-install' && baseDiskPath && !(await exists(baseDiskPath))) {
      if (!tools.qemuImgPath) throw new Error('Bundled qemu-img is unavailable, so the persistent disk cannot be created.')
      await createDiskImage(tools.qemuImgPath, baseDiskPath, record.config.diskSizeGiB)
    }
    const diskFormat = await detectDiskFormat(baseDiskPath)
    if (baseDiskPath && diskFormat === 'unknown') throw new Error('The selected disk format could not be detected safely.')
    const { displayPort, qmpPort } = await choosePorts(id)
    const accelerator = process.platform === 'win32' && record.config.whpxPreferred && tools.whpxAvailable
      ? 'whpx'
      : 'tcg'
    const argv = [
      '-nodefaults',
      '-machine', 'q35',
      '-accel', accelerator,
      '-m', String(record.config.memoryMiB),
      '-smp', String(record.config.cpus),
      '-cdrom', isoPath,
      '-boot', 'menu=on',
      '-qmp', `tcp:127.0.0.1:${qmpPort},server=on,wait=off`,
      '-device', 'virtio-vga',
      '-display', `vnc=127.0.0.1:${displayPort}`
    ]
    if (baseDiskPath) argv.push('-drive', `file=${baseDiskPath},format=${diskFormat},if=virtio`)
    if (record.config.mode === 'disposable-live') argv.push('-snapshot')
    argv.push('-nic', record.config.networkEnabled ? 'user,model=virtio' : 'none')
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    await this.write({ ...record, phase: 'starting', error: undefined, updatedAt: new Date().toISOString() })
    const child = spawn(tools.qemuPath, argv, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const live: RunningVm = { process: child, displayPort, qmpPort, diskPath: baseDiskPath, mode: record.config.mode, accelerator, generation, stderr: '' }
    this.running.set(id, live)
    this.emit({ ...defaultStatus(id, record), phase: 'starting', progress: 10, message: 'Starting QEMU and waiting for its QMP and loopback display sockets.' })
    child.stderr?.on('data', (chunk: Buffer) => { live.stderr = (live.stderr + chunk.toString('utf8')).slice(-16 * 1024) })
    let exited = false
    child.once('error', (cause) => { exited = true; live.stderr = `${live.stderr}\n${cause.message}`.slice(-16 * 1024) })
    child.once('exit', () => {
      exited = true
      if (this.running.get(id)?.process !== child) return
      this.running.delete(id)
      void this.write({ ...record, phase: 'stopped', updatedAt: new Date().toISOString() })
      void this.emit({ ...(defaultStatus(id, record)), phase: 'stopped', message: live.stderr ? 'The VM stopped with a QEMU diagnostic.' : 'The VM stopped.' })
    })
    const qmpBound = await waitForPort(qmpPort, QMP_TIMEOUT_MS * 4, () => !exited && this.generations.get(id) === generation)
    if (!qmpBound || this.generations.get(id) !== generation) {
      child.kill('SIGTERM')
      this.running.delete(id)
      const message = live.stderr ? `QEMU exited before startup completed: ${live.stderr.slice(-800)}` : 'QEMU exited before its QMP control socket was ready.'
      await this.write({ ...record, phase: 'error', error: message, updatedAt: new Date().toISOString() })
      throw new Error(message)
    }
    try {
      await this.qmp(qmpPort, 'query-status')
      const displayBound = await waitForPort(displayPort, QMP_TIMEOUT_MS * 4, () => !exited && this.generations.get(id) === generation)
      if (!displayBound) throw new Error('The loopback display did not bind before the startup timeout.')
    } catch (cause) {
      child.kill('SIGTERM')
      this.running.delete(id)
      const message = cause instanceof Error ? cause.message : 'The VM startup handshake failed.'
      await this.write({ ...record, phase: 'error', error: message, updatedAt: new Date().toISOString() })
      throw new Error(message)
    }
    const nextRecord = { ...record, phase: 'running' as const, local: { ...record.local, isoPath, ...(baseDiskPath ? { diskPath: baseDiskPath, diskFormat } : {}) }, isoSha256Actual: actualIsoSha256, updatedAt: new Date().toISOString() }
    await this.write(nextRecord)
    const status = await this.statusFrom(id, nextRecord)
    return this.emit({ ...status, isoSha256Actual: actualIsoSha256, diskFormat })
  }

  async stop(id: string): Promise<VirtualMachineStatus> {
    if (!safeId(id)) throw new Error('The VM id is invalid.')
    await this.reconciliation
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
    const live = this.running.get(id)
    if (!live) return this.emit(await this.statusFrom(id))
    try { await this.qmp(live.qmpPort, 'quit') } catch { live.process.kill('SIGTERM') }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { live.process.kill('SIGKILL'); resolve() }, STOP_TIMEOUT_MS)
      live.process.once('exit', () => { clearTimeout(timer); resolve() })
    })
    this.running.delete(id)
    const record = await this.read(id)
    if (record) await this.write({ ...record, phase: 'stopped', updatedAt: new Date().toISOString() })
    return this.emit(await this.statusFrom(id))
  }

  async snapshot(id: string, name: string): Promise<VirtualMachineStatus> {
    if (!safeId(id) || !safeSnapshotName(name)) throw new Error('The VM or snapshot name is invalid.')
    const live = this.running.get(id)
    if (!live) throw new Error('Start the VM before creating a snapshot.')
    await this.qmp(live.qmpPort, 'human-monitor-command', { 'command-line': `savevm ${name}` })
    const record = await this.read(id)
    if (record && !record.snapshotNames.includes(name)) await this.write({ ...record, snapshotNames: [...record.snapshotNames, name], updatedAt: new Date().toISOString() })
    return this.emit(await this.statusFrom(id, record))
  }

  async restore(id: string, name: string): Promise<VirtualMachineStatus> {
    if (!safeId(id) || !safeSnapshotName(name)) throw new Error('The VM or snapshot name is invalid.')
    const live = this.running.get(id)
    if (!live) throw new Error('Start the VM before restoring a snapshot.')
    const record = await this.read(id)
    if (!record?.snapshotNames.includes(name)) throw new Error('That snapshot does not exist for this VM.')
    await this.qmp(live.qmpPort, 'human-monitor-command', { 'command-line': `loadvm ${name}` })
    return this.emit(await this.statusFrom(id, record))
  }

  async openDisplay(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    if (!safeId(id)) return { ok: false, error: 'The VM id is invalid.' }
    const status = await this.statusFrom(id)
    if (!status.displayUrl) return { ok: false, error: 'The loopback display belongs to the server host and is not exposed through this browser.' }
    try {
      await this.platform.openExternal(status.displayUrl)
      return { ok: true, url: status.displayUrl }
    } catch {
      return { ok: false, error: 'The loopback display viewer could not be opened.' }
    }
  }

  async reset(id: string): Promise<VirtualMachineStatus> {
    return this.stop(id)
  }

  onEvent(listener: (event: VirtualMachineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)))
    this.listeners.clear()
  }
}
