import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, access } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import type { Readable } from 'node:stream'
import { IPC } from '../../shared/ipc'
import {
  favoriteFrom,
  isSafeContainerPath,
  mountOptionsFrom,
  normalizeDriveLetter,
  VERACRYPT_DEFAULTS,
  type VeraCryptApi,
  type VeraCryptAvailability,
  type VeraCryptFavorite,
  type VeraCryptMountInventory,
  type VeraCryptMountOptions,
  type VeraCryptMountPreflight,
  type VeraCryptMountedVolume,
  type VeraCryptOperation,
  type VeraCryptOperationKind
} from '../../shared/veracrypt'
import type { CorePlatform } from '../platform'
import { writeFileAtomic } from '../fs-atomic'
import { withCrossProcessLock } from '../fs-transaction-lock'

interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
}

type VeraCryptChildProcess = ChildProcessByStdio<null, Readable, Readable>

export interface VeraCryptRuntime {
  platform: NodeJS.Platform
  executableCandidates: readonly string[]
  whereExecutable(): Promise<string[]>
  run(executable: string, args: readonly string[], timeoutMs: number, onSpawn?: (child: VeraCryptChildProcess) => void): Promise<ProcessResult>
  pathExists(path: string): Promise<boolean>
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>
}

const DEFAULT_RUNTIME: VeraCryptRuntime = {
  platform: process.platform,
  executableCandidates: [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'VeraCrypt', VERACRYPT_DEFAULTS.executableName),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'VeraCrypt', VERACRYPT_DEFAULTS.executableName)
  ],
  async whereExecutable() {
    try {
      const result = await this.run('where.exe', [VERACRYPT_DEFAULTS.executableName], 10_000)
      return result.exitCode === 0 ? result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean) : []
    } catch {
      return []
    }
  },
  async run(executable, args, timeoutMs, onSpawn) {
    return new Promise((resolve) => {
      let settled = false
      let stdout = ''
      let stderr = ''
      let timer: ReturnType<typeof setTimeout> | undefined
      let child: VeraCryptChildProcess
      const finish = (exitCode: number): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve({ exitCode, stdout, stderr })
      }
      try {
        child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        onSpawn?.(child)
      } catch {
        finish(1)
        return
      }
      child.stdout.on('data', (chunk: Buffer | string) => {
        if (stdout.length < 4 * 1024 * 1024) stdout += String(chunk).slice(0, 4 * 1024 * 1024 - stdout.length)
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        if (stderr.length < 64 * 1024) stderr += String(chunk).slice(0, 64 * 1024 - stderr.length)
      })
      child.once('error', () => finish(1))
      child.once('close', (code) => finish(typeof code === 'number' ? code : 1))
      timer = setTimeout(() => {
        try { child.kill() } catch { /* process already gone */ }
        finish(124)
      }, timeoutMs)
    })
  },
  pathExists: async (path) => {
    try { await access(path); return true } catch { return false }
  },
  lstat: async (path) => lstat(path)
}

const emptyAvailability = (runtime: VeraCryptRuntime): VeraCryptAvailability => ({
  platform: runtime.platform,
  state: runtime.platform === 'win32' ? 'not-installed' : 'unsupported',
  executablePath: null,
  version: null,
  reason: runtime.platform === 'win32' ? 'VeraCrypt was not found in the validated installation locations.' : 'VeraCrypt mounting is available only in the Windows desktop application.',
  checkedAt: Date.now()
})

function isTrustedExecutableCandidate(candidate: string, trustedInstallDirs: readonly string[]): boolean {
  if (typeof candidate !== 'string' || !win32.isAbsolute(candidate)) return false
  const normalized = win32.normalize(candidate)
  if (win32.basename(normalized).toLowerCase() !== VERACRYPT_DEFAULTS.executableName.toLowerCase()) return false
  return trustedInstallDirs.some((root) => {
    const relative = win32.relative(win32.normalize(root), normalized)
    return relative === '' || (relative !== '' && !relative.startsWith('..') && !win32.isAbsolute(relative))
  })
}

function versionFromOutput(output: string): string | null {
  const match = output.match(/\bVeraCrypt\s+(?:version\s+)?(\d+(?:\.\d+){1,3})\b/iu) ?? output.match(/\b(\d+\.\d+(?:\.\d+){0,2})\b/u)
  return match?.[1] ?? null
}

function operationMessage(kind: VeraCryptOperationKind, state: VeraCryptOperation['state']): string {
  if (state === 'running') return kind === 'mount' ? 'VeraCrypt is waiting for its native credential prompt.' : `VeraCrypt ${kind} is in progress.`
  if (state === 'succeeded') return kind === 'mount' ? 'The container mount was independently verified.' : `VeraCrypt ${kind} completed.`
  if (state === 'cancelled') return `VeraCrypt ${kind} was cancelled.`
  return `VeraCrypt ${kind} did not complete.`
}

export class VeraCryptManager implements VeraCryptApi {
  private readonly listeners = new Set<(operation: VeraCryptOperation) => void>()
  private readonly operations = new Map<string, VeraCryptOperation>()
  private readonly children = new Map<string, VeraCryptChildProcess>()
  private readonly managerMounts = new Map<string, string>()
  private executable: string | null = null
  private lastAvailabilityReason: string | null = null
  private favoriteRecords: VeraCryptFavorite[] = []

  constructor(private readonly host: CorePlatform, private readonly runtime: VeraCryptRuntime = DEFAULT_RUNTIME) {}

  private emit(operation: VeraCryptOperation): void {
    this.operations.set(operation.id, operation)
    for (const listener of this.listeners) listener(operation)
  }

  onOperation(listener: (operation: VeraCryptOperation) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async availability(): Promise<VeraCryptAvailability> {
    if (this.runtime.platform !== 'win32') return emptyAvailability(this.runtime)
    const trustedInstallDirs = this.runtime.executableCandidates.map((candidate) => win32.dirname(win32.normalize(candidate)))
    const candidates = [...this.runtime.executableCandidates, ...await this.runtime.whereExecutable()]
    for (const candidate of candidates) {
      if (!isTrustedExecutableCandidate(candidate, trustedInstallDirs)) continue
      try {
        const stats = await this.runtime.lstat(candidate)
        if (!stats.isFile() || stats.isSymbolicLink()) continue
        this.executable = candidate
        let version: string | null = null
        try {
          const versionResult = await this.runtime.run(candidate, ['/version'], 10_000)
          version = versionFromOutput(`${versionResult.stdout}\n${versionResult.stderr}`)
        } catch {
          // A validated executable remains available when its optional version probe is unavailable.
        }
        this.lastAvailabilityReason = null
        return { platform: 'win32', state: 'available', executablePath: candidate, version, reason: null, checkedAt: Date.now() }
      } catch {
        // Continue through the validated locations. A failed candidate is not proof of absence.
      }
    }
    this.executable = null
    const unavailable = emptyAvailability(this.runtime)
    this.lastAvailabilityReason = unavailable.reason
    return unavailable
  }

  private async executablePath(): Promise<string> {
    if (this.executable) return this.executable
    const state = await this.availability()
    if (state.state !== 'available' || !state.executablePath) {
      throw new Error(this.lastAvailabilityReason ?? state.reason ?? 'VeraCrypt is unavailable.')
    }
    return state.executablePath
  }

  private favoriteFile(): string { return join(this.host.userDataDir, 'veracrypt', 'favorites.json') }

  private async readFavorites(): Promise<VeraCryptFavorite[]> {
    try {
      const parsed = JSON.parse(await readFile(this.favoriteFile(), 'utf8')) as unknown
      return Array.isArray(parsed) ? parsed.map(favoriteFrom).filter((item): item is VeraCryptFavorite => item !== null).slice(0, VERACRYPT_DEFAULTS.maxFavorites) : []
    } catch {
      return []
    }
  }

  private async loadFavorites(): Promise<VeraCryptFavorite[]> {
    this.favoriteRecords = await this.readFavorites()
    return [...this.favoriteRecords]
  }

  private async saveFavoritesUnlocked(records: VeraCryptFavorite[]): Promise<VeraCryptFavorite[]> {
    this.favoriteRecords = records.slice(0, VERACRYPT_DEFAULTS.maxFavorites)
    const file = this.favoriteFile()
    await mkdir(join(this.host.userDataDir, 'veracrypt'), { recursive: true, mode: 0o700 })
    const payload = `${JSON.stringify(this.favoriteRecords, null, 2)}\n`
    await writeFileAtomic(file, payload, { mode: 0o600 })
    return [...this.favoriteRecords]
  }

  async favorites(): Promise<VeraCryptFavorite[]> { return [...await this.loadFavorites()] }

  async saveFavorite(favorite: VeraCryptFavorite): Promise<VeraCryptFavorite[]> {
    const safe = favoriteFrom(favorite)
    if (!safe) throw new Error('The VeraCrypt favorite is invalid.')
    return withCrossProcessLock(this.favoriteFile(), async (lease) => {
      await lease.fence()
      const current = await this.readFavorites()
      const next = current.filter((item) => item.id !== safe.id && item.containerPath !== safe.containerPath)
      next.unshift(safe)
      return this.saveFavoritesUnlocked(next)
    })
  }

  async removeFavorite(id: string): Promise<VeraCryptFavorite[]> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new Error('The VeraCrypt favorite id is invalid.')
    return withCrossProcessLock(this.favoriteFile(), async (lease) => {
      await lease.fence()
      return this.saveFavoritesUnlocked((await this.readFavorites()).filter((item) => item.id !== id))
    })
  }

  private async availableLetters(): Promise<string[]> {
    if (this.runtime.platform !== 'win32') return []
    const letters: string[] = []
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code)
      try {
        if (!(await this.runtime.pathExists(`${letter}:\\`))) letters.push(letter)
      } catch { /* unavailable */ }
    }
    return letters
  }

  async preflight(options: VeraCryptMountOptions): Promise<VeraCryptMountPreflight> {
    const path = isSafeContainerPath(options?.containerPath) ? options.containerPath : ''
    const driveLetter = normalizeDriveLetter(options?.driveLetter) ?? ''
    let availableDriveLetters: string[]
    try {
      availableDriveLetters = await this.availableLetters()
    } catch {
      availableDriveLetters = []
    }
    if (this.runtime.platform !== 'win32') return { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: 'VeraCrypt mounting is available only in the Windows desktop application.' }
    if (!path) return { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: 'Choose an existing VeraCrypt container file.' }
    if (!driveLetter) return { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: 'Choose one drive letter from A through Z.' }
    try {
      const stats = await this.runtime.lstat(path)
      if (!stats.isFile() || stats.isSymbolicLink()) return { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: 'The container must be an existing regular file, not a directory or reparse point.' }
    } catch {
      return { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: 'The selected container file could not be read.' }
    }
    if (!availableDriveLetters.includes(driveLetter)) return { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: `Drive ${driveLetter}: is already occupied or unavailable. Choose an available letter.` }
    const state = await this.availability()
    return state.state === 'available'
      ? { ok: true, containerPath: path, driveLetter, availableDriveLetters, reason: null }
      : { ok: false, containerPath: path, driveLetter, availableDriveLetters, reason: state.reason }
  }

  private newOperation(kind: VeraCryptOperationKind, driveLetter: string | null): VeraCryptOperation {
    const id = randomUUID().replaceAll('-', '').slice(0, 24)
    return { id, kind, state: 'queued', progress: null, driveLetter, message: operationMessage(kind, 'queued'), startedAt: Date.now(), finishedAt: null }
  }

  private async execute(kind: VeraCryptOperationKind, args: readonly string[], driveLetter: string | null): Promise<VeraCryptOperation> {
    const operation = this.newOperation(kind, driveLetter)
    this.emit(operation)
    if (this.runtime.platform !== 'win32') {
      const failed = { ...operation, state: 'failed' as const, message: 'VeraCrypt mounting is available only in the Windows desktop application.', finishedAt: Date.now() }
      this.emit(failed)
      return failed
    }
    const executable = await this.executablePath().catch(() => null)
    if (!executable) {
      const failed = { ...operation, state: 'failed' as const, message: this.lastAvailabilityReason ?? 'VeraCrypt was not found in the validated installation locations.', finishedAt: Date.now() }
      this.emit(failed)
      return failed
    }
    const running = { ...operation, state: 'running' as const, message: operationMessage(kind, 'running'), startedAt: Date.now() }
    this.emit(running)
    const result = await this.runtime.run(executable, args, VERACRYPT_DEFAULTS.operationTimeoutMs, (child) => this.children.set(operation.id, child))
    this.children.delete(operation.id)
    if (this.operations.get(operation.id)?.state === 'cancelled') return this.operations.get(operation.id)!
    if (result.exitCode !== 0) {
      const failed = { ...running, state: 'failed' as const, message: `${operationMessage(kind, 'failed')} VeraCrypt exit code ${result.exitCode}.`, finishedAt: Date.now() }
      this.emit(failed)
      return failed
    }
    if (kind === 'mount' || kind === 'unmount') {
      const inventory = await this.refresh()
      const observed = driveLetter ? inventory.volumes.some((item) => item.driveLetter === driveLetter) : false
      if ((kind === 'mount' && !observed) || (kind === 'unmount' && observed)) {
        const failed = { ...running, state: 'failed' as const, message: kind === 'mount' ? 'VeraCrypt exited successfully, but the requested mount was not independently observed.' : 'VeraCrypt exited successfully, but the requested drive remains mounted.', finishedAt: Date.now() }
        this.emit(failed)
        return failed
      }
      if (kind === 'unmount' && driveLetter) this.managerMounts.delete(driveLetter)
    }
    const succeeded = { ...running, state: 'succeeded' as const, progress: 100, message: operationMessage(kind, 'succeeded'), finishedAt: Date.now() }
    this.emit(succeeded)
    return succeeded
  }

  async mount(options: VeraCryptMountOptions): Promise<VeraCryptOperation> {
    const parsed = mountOptionsFrom(options)
    if (!parsed) throw new Error('The VeraCrypt mount options are invalid.')
    const preflight = await this.preflight(parsed)
    if (!preflight.ok) throw new Error(preflight.reason ?? 'The VeraCrypt mount preflight was not successful.')
    // Do not add /password, /pim, /keyfiles, or hidden-volume flags. VeraCrypt's native prompt is
    // the only credential route. These are the documented Windows switches: /c n disables cache,
    // and /m ro, /m rm, and /m ts select the safe mount modes.
    const args = ['/v', parsed.containerPath, '/l', parsed.driveLetter, '/c', 'n', ...(parsed.readOnly ? ['/m', 'ro'] : []), ...(parsed.removable ? ['/m', 'rm'] : []), ...(parsed.preserveTimestamp ? ['/m', 'ts'] : []), '/quit']
    this.managerMounts.set(parsed.driveLetter, parsed.containerPath)
    const operation = await this.execute('mount', args, parsed.driveLetter)
    if (operation.state !== 'succeeded') this.managerMounts.delete(parsed.driveLetter)
    if (operation.state === 'succeeded' && parsed.exploreAfterMount) await this.explore(parsed.driveLetter)
    return operation
  }

  async refresh(): Promise<VeraCryptMountInventory> {
    const checkedAt = Date.now()
    if (this.runtime.platform !== 'win32') return { state: 'unsupported', volumes: [], reason: 'VeraCrypt mounting is available only in the Windows desktop application.', checkedAt }
    const executable = await this.executablePath().catch(() => null)
    if (!executable) return { state: 'unavailable', volumes: [], reason: 'VeraCrypt was not found in the validated installation locations.', checkedAt }
    // VeraCrypt does not expose a documented mounted-volume listing command. The manager therefore
    // reports only mounts it created, and independently verifies those drive roots. Pre-existing
    // host mounts remain intentionally outside this list rather than being guessed from letters.
    const volumes: VeraCryptMountedVolume[] = []
    for (const [driveLetter, containerPath] of this.managerMounts) {
      if (await this.runtime.pathExists(`${driveLetter}:\\`)) {
        volumes.push({ driveLetter, containerPath, observedAt: checkedAt, managerCreated: true })
      } else {
        this.managerMounts.delete(driveLetter)
      }
    }
    return { state: 'verified', volumes, reason: null, checkedAt }
  }

  async explore(driveLetter: string): Promise<VeraCryptOperation> {
    const letter = normalizeDriveLetter(driveLetter)
    if (!letter) throw new Error('The VeraCrypt drive letter is invalid.')
    const inventory = await this.refresh()
    if (inventory.state !== 'verified' || !inventory.volumes.some((item) => item.driveLetter === letter)) throw new Error(`Drive ${letter}: is not an independently verified VeraCrypt mount.`)
    const operation = this.newOperation('explore', letter)
    this.emit({ ...operation, state: 'running', message: operationMessage('explore', 'running') })
    try {
      await this.host.openExternal(`file:///${letter}:/`)
      const succeeded = { ...operation, state: 'succeeded' as const, progress: 100, message: operationMessage('explore', 'succeeded'), finishedAt: Date.now() }
      this.emit(succeeded)
      return succeeded
    } catch {
      const failed = { ...operation, state: 'failed' as const, message: 'The mounted drive could not be opened in the file manager.', finishedAt: Date.now() }
      this.emit(failed)
      return failed
    }
  }

  async unmount(driveLetter: string, force = false): Promise<VeraCryptOperation> {
    const letter = normalizeDriveLetter(driveLetter)
    if (!letter) throw new Error('The VeraCrypt drive letter is invalid.')
    const inventory = await this.refresh()
    if (inventory.state !== 'verified' || !inventory.volumes.some((item) => item.driveLetter === letter)) throw new Error(`Drive ${letter}: is not an independently verified VeraCrypt mount.`)
    return this.execute('unmount', ['/u', letter, ...(force ? ['/f'] : []), '/quit'], letter)
  }

  async wipeCache(): Promise<VeraCryptOperation> { return this.execute('wipe-cache', ['/w', '/quit'], null) }

  async cancel(operationId: string): Promise<boolean> {
    if (typeof operationId !== 'string' || operationId.length > 64) return false
    const operation = this.operations.get(operationId)
    const child = this.children.get(operationId)
    if (!operation || !child || operation.state !== 'running') return false
    try { child.kill() } catch { /* process already gone */ }
    this.children.delete(operationId)
    this.emit({ ...operation, state: 'cancelled', message: operationMessage(operation.kind, 'cancelled'), finishedAt: Date.now() })
    return true
  }
}
