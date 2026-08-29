import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  UniGetUiApi,
  UniGetUiLogEntry,
  UniGetUiManager,
  UniGetUiOperation,
  UniGetUiPackage,
  UniGetUiPackageInstallOptions,
  UniGetUiSource,
  UniGetUiStatus,
  UniGetUiUniverseState
} from '../../shared/unigetui'
import { UNIGETUI_PAGES } from '../../shared/unigetui'
import type { UniGetUiUniverseStore } from './store'

const execFile = promisify(execFileCallback)
const MAX_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const WAIT_TIMEOUT_MS = 60_000
const NAVIGATABLE_PAGES = new Set<string>(UNIGETUI_PAGES.filter((page) => page !== 'overview' && page !== 'help'))
const OPERATION_REORDER_ACTIONS = new Set(['run-now', 'run-next', 'run-last'])

export class UniGetUiClientError extends Error {
  constructor(
    message: string,
    readonly health: UniGetUiStatus['health'] = 'failed',
    readonly exitCode: number | null = null
  ) {
    super(message)
    this.name = 'UniGetUiClientError'
  }
}

function safeArg(value: unknown, max = 256): string {
  if (typeof value !== 'string') throw new UniGetUiClientError('UniGetUI argument must be text.', 'malformed')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new UniGetUiClientError('UniGetUI argument is empty or contains unsupported characters.', 'malformed')
  }
  return trimmed
}

/** Validate a value that will be paired with a CLI option flag.
 *
 * `safeArg` deliberately accepts spaces and a leading dash because it is also used for free-form
 * queries and identifiers. An option value is different: a leading dash would turn the caller's
 * value into another CLI flag. Keep this validator conservative at the interpolation boundary.
 */
export function optionValue(value: unknown, max = 1024): string {
  const text = safeArg(value, max)
  if (text.startsWith('-') || !/^[\w.+:@/-]+$/u.test(text)) {
    throw new UniGetUiClientError('UniGetUI option values must be plain values, not CLI flags.', 'malformed')
  }
  return text
}

function packageId(value: string): string {
  const id = safeArg(value, 160)
  if (!/^[\w][\w.\-:/@+]*$/u.test(id)) {
    throw new UniGetUiClientError('Package identifiers must use the package-manager identifier format.', 'malformed')
  }
  return id
}

function managerId(value: string): string {
  const id = safeArg(value, 64)
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(id)) {
    throw new UniGetUiClientError('Manager identifiers must be stable ids.', 'malformed')
  }
  return id
}

function operationId(value: string): string {
  const id = safeArg(value, 128)
  if (!/^[a-z0-9._:-]+$/iu.test(id)) {
    throw new UniGetUiClientError('Operation identifiers are malformed.', 'malformed')
  }
  return id
}

function boundedPath(value: string): string {
  const p = safeArg(value, 1024)
  if (path.isAbsolute(p) === false || p.includes('..')) {
    throw new UniGetUiClientError('The selected path must be absolute and cannot contain parent traversal.', 'malformed')
  }
  return p
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redact(item, depth + 1))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.length > 8192 ? `${value.slice(0, 8192)}…` : value
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|credential|authorization|bearer|api[-_]?key|access[-_]?token/i.test(key)) continue
    out[key] = redact(item, depth + 1)
  }
  return out
}

function parseJson(stdout: string): unknown {
  try {
    return redact(JSON.parse(stdout))
  } catch {
    throw new UniGetUiClientError('UniGetUI returned malformed JSON.', 'malformed')
  }
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['items', 'results', 'operations', 'packages', 'sources', 'managers', 'entries']) {
      if (Array.isArray(record[key])) return record[key] as T[]
    }
  }
  return []
}

function boolArg(value: boolean | undefined): string[] {
  return value === undefined ? [] : [value ? 'true' : 'false']
}

function optionArgs(options: UniGetUiPackageInstallOptions): string[] {
  const args: string[] = []
  const add = (flag: string, value: string | undefined) => { if (value !== undefined) args.push(flag, optionValue(value)) }
  add('--manager', options.manager ? managerId(options.manager) : undefined)
  add('--source', options.source)
  add('--version', options.version)
  add('--scope', options.scope)
  if (options.preRelease !== undefined) args.push('--pre-release', options.preRelease ? 'true' : 'false')
  if (options.elevated !== undefined) args.push('--elevated', options.elevated ? 'true' : 'false')
  if (options.interactive !== undefined) args.push('--interactive', options.interactive ? 'true' : 'false')
  if (options.skipHash !== undefined) args.push('--skip-hash', options.skipHash ? 'true' : 'false')
  add('--architecture', options.architecture)
  if (options.location !== undefined) args.push('--location', boundedPath(options.location))
  if (options.detach === true) args.push('--detach')
  else if (options.wait !== undefined) args.push('--wait', options.wait ? 'true' : 'false')
  return args
}

export class UniGetUiClient implements UniGetUiApi {
  private executable: string | null = null

  constructor(private readonly universeStore: UniGetUiUniverseStore) {}

  private async locate(): Promise<string | null> {
    if (this.executable) return this.executable
    const names = process.platform === 'win32' ? ['unigetui.exe', 'UniGetUI.exe', 'unigetui'] : ['unigetui']
    const trustedDirs: string[] = []
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA
      const programFiles = process.env.ProgramFiles
      const programFilesX86 = process.env['ProgramFiles(x86)']
      const programW6432 = process.env.ProgramW6432
      for (const root of [local, programFiles, programFilesX86, programW6432]) {
        if (!root) continue
        trustedDirs.push(root, path.join(root, 'UniGetUI'), path.join(root, 'UniGetUI', 'CLI'))
      }
    }
    // Known installation roots win over inherited PATH. PATH remains a compatibility fallback,
    // but every candidate gets the same regular-file and symlink checks.
    const dirs = [...new Set([...trustedDirs, ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)])]
    for (const dir of dirs) {
      for (const name of names) {
        const candidate = path.join(dir, name)
        try {
          const stat = await lstat(candidate)
          if (!stat.isFile() || stat.isSymbolicLink()) continue
          this.executable = candidate
          return candidate
        } catch {
          // Keep looking. A failed lookup is not proof of absence until every PATH entry was tried.
        }
      }
    }
    return null
  }

  async status(): Promise<UniGetUiStatus> {
    const executable = await this.locate()
    if (!executable) return {
      health: 'not-installed', executable: null, version: null, transport: 'unknown',
      detail: 'The UniGetUI CLI was not found on PATH.', checkedAt: Date.now()
    }
    try {
      const result = await this.runRaw(['status'])
      const payload = typeof result.json === 'object' && result.json ? result.json as Record<string, unknown> : {}
      const transport = payload.transport === 'named-pipe' || payload.transport === 'tcp' ? payload.transport : 'unknown'
      return {
        health: 'ok', executable, version: typeof payload.version === 'string' ? payload.version : null,
        transport, detail: null, checkedAt: Date.now()
      }
    } catch (error) {
      const e = error instanceof UniGetUiClientError ? error : new UniGetUiClientError(String(error))
      return { health: e.health, executable, version: null, transport: 'unknown', detail: e.message, checkedAt: Date.now() }
    }
  }

  private async runRaw(args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<{ json: unknown; stdout: string }> {
    const executable = await this.locate()
    if (!executable) throw new UniGetUiClientError('The UniGetUI CLI is not installed or is not on PATH.', 'not-installed')
    try {
      const result = await execFile(executable, args, {
        shell: false,
        windowsHide: true,
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES
      })
      const stdout = result.stdout.trim()
      return { json: stdout ? parseJson(stdout) : {}, stdout }
    } catch (error) {
      const e = error as { code?: unknown; killed?: boolean; stdout?: string; stderr?: string; message?: string }
      if (e.code === 'ENOENT') this.executable = null
      if (e.killed) throw new UniGetUiClientError('The UniGetUI operation exceeded its time limit.', 'unavailable')
      const code = typeof e.code === 'number' ? e.code : null
      const rawDetail = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr.trim() : String(e.message ?? error)
      const detail = rawDetail.replace(/(token|secret|password|credential|authorization)[^\r\n]{0,160}/giu, '$1 redacted').replace(/[\r\n]+/gu, ' ').slice(0, 2000)
      if (code === 3 || /ipc|pipe|socket|unavailable|not running|connection refused/i.test(detail)) {
        throw new UniGetUiClientError(detail, 'stopped', code)
      }
      if (code === 2 || /invalid|malformed|argument/i.test(detail)) {
        throw new UniGetUiClientError(detail, 'malformed', code)
      }
      if (/elevat|administrator|permission/i.test(detail)) {
        throw new UniGetUiClientError(detail, 'elevation-required', code)
      }
      throw new UniGetUiClientError(detail, 'failed', code)
    }
  }

  private async run(args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    return (await this.runRaw(args, timeout)).json
  }

  async universeState(): Promise<UniGetUiUniverseState> { return this.universeStore.load() }
  async saveUniverseState(state: UniGetUiUniverseState): Promise<UniGetUiUniverseState> { return this.universeStore.save(state) }
  async appStatus(): Promise<unknown> { return this.run(['app', 'status']) }
  async navigate(page: Exclude<import('../../shared/unigetui').UniGetUiPage, 'overview' | 'help'>): Promise<unknown> {
    if (typeof page !== 'string' || !NAVIGATABLE_PAGES.has(page)) throw new UniGetUiClientError('UniGetUI navigation page is not supported.', 'malformed')
    return this.run(['app', 'navigate', '--page', optionValue(page)])
  }
  async operations(): Promise<UniGetUiOperation[]> { return asArray<UniGetUiOperation>(await this.run(['operation', 'list'])) }
  async operation(id: string): Promise<UniGetUiOperation | null> { return (await this.run(['operation', 'get', '--id', operationId(id)])) as UniGetUiOperation }
  async operationOutput(id: string, tail = 100): Promise<string[]> { const n = Math.max(1, Math.min(500, Math.floor(tail))); return asArray<string>(await this.run(['operation', 'output', '--id', operationId(id), '--tail', String(n)])) }
  async operationWait(id: string, timeoutSeconds = 60): Promise<UniGetUiOperation | null> { const n = Math.max(1, Math.min(300, Math.floor(timeoutSeconds))); return (await this.run(['operation', 'wait', '--id', operationId(id), '--timeout', String(n)], WAIT_TIMEOUT_MS)) as UniGetUiOperation }
  async operationCancel(id: string): Promise<unknown> { return this.run(['operation', 'cancel', '--id', operationId(id)]) }
  async operationRetry(id: string, mode = 'default'): Promise<unknown> { return this.run(['operation', 'retry', '--id', operationId(id), '--mode', optionValue(mode, 64)]) }
  async operationReorder(id: string, action: 'run-now' | 'run-next' | 'run-last'): Promise<unknown> {
    if (typeof action !== 'string' || !OPERATION_REORDER_ACTIONS.has(action)) throw new UniGetUiClientError('UniGetUI reorder action is not supported.', 'malformed')
    return this.run(['operation', 'reorder', '--id', operationId(id), '--action', optionValue(action, 32)])
  }
  async operationForget(id: string): Promise<unknown> { return this.run(['operation', 'forget', '--id', operationId(id)]) }
  async managers(): Promise<UniGetUiManager[]> { return asArray<UniGetUiManager>(await this.run(['manager', 'list'])) }
  async managerAction(manager: string, action: string, input: { path?: string; confirm?: boolean } = {}): Promise<unknown> {
    const id = managerId(manager)
    const allowed = new Set(['reload', 'enable', 'disable', 'maintenance', 'set-executable', 'clear-executable', 'notifications-enable', 'notifications-disable'])
    if (!allowed.has(action)) throw new UniGetUiClientError('The requested manager action is not allowlisted.', 'malformed')
    if (action === 'set-executable') {
      if (input.path === undefined) throw new UniGetUiClientError('A verified executable path is required.', 'malformed')
      return this.run(['manager', 'set-executable', '--manager', id, '--path', boundedPath(input.path)])
    }
    if (action === 'clear-executable') return this.run(['manager', 'clear-executable', '--manager', id])
    if (action === 'notifications-enable' || action === 'notifications-disable') {
      return this.run(['manager', 'notifications', action.endsWith('enable') ? 'enable' : 'disable', '--manager', id])
    }
    if (action === 'maintenance') return this.run(['manager', 'action', '--manager', id, '--action', 'maintenance', ...(input.confirm === undefined ? [] : ['--confirm', input.confirm ? 'true' : 'false'])])
    const args = ['manager', action, '--manager', id]
    if (input.path !== undefined) args.push('--path', boundedPath(input.path))
    if (input.confirm !== undefined) args.push('--confirm', input.confirm ? 'true' : 'false')
    return this.run(args)
  }
  async sources(manager?: string): Promise<UniGetUiSource[]> { return asArray<UniGetUiSource>(await this.run(['source', 'list', ...(manager ? ['--manager', managerId(manager)] : [])])) }
  async sourceAdd(manager: string, name: string, url?: string): Promise<unknown> { return this.run(['source', 'add', '--manager', managerId(manager), '--name', safeArg(name), ...(url ? ['--url', safeArg(url, 2048)] : [])]) }
  async sourceRemove(manager: string, name: string, url?: string): Promise<unknown> { return this.run(['source', 'remove', '--manager', managerId(manager), '--name', safeArg(name), ...(url ? ['--url', safeArg(url, 2048)] : [])]) }
  async settings(): Promise<import('../../shared/unigetui').UniGetUiSetting[]> { return asArray<import('../../shared/unigetui').UniGetUiSetting>(await this.run(['settings', 'list'])) }
  async settingGet(key: string): Promise<import('../../shared/unigetui').UniGetUiSetting | null> { return await this.run(['settings', 'get', '--key', safeArg(key, 160)]) as import('../../shared/unigetui').UniGetUiSetting }
  async settingSet(key: string, input: { enabled?: boolean; value?: string }): Promise<unknown> { return this.run(['settings', 'set', '--key', safeArg(key, 160), ...(input.enabled !== undefined ? ['--enabled', input.enabled ? 'true' : 'false'] : []), ...(input.value !== undefined ? ['--value', safeArg(input.value, 4096)] : [])]) }
  async settingClear(key: string): Promise<unknown> { return this.run(['settings', 'clear', '--key', safeArg(key, 160)]) }
  async settingsReset(): Promise<unknown> { return this.run(['settings', 'reset']) }
  async shortcuts(): Promise<unknown> { return this.run(['shortcut', 'list']) }
  async shortcutSet(p: string, status: 'keep' | 'delete'): Promise<unknown> { return this.run(['shortcut', 'set', '--path', boundedPath(p), '--status', status]) }
  async shortcutReset(p: string): Promise<unknown> { return this.run(['shortcut', 'reset', '--path', boundedPath(p)]) }
  async shortcutResetAll(): Promise<unknown> { return this.run(['shortcut', 'reset-all']) }
  async logs(kind: 'app' | 'operations' | 'manager', manager?: string, level?: number): Promise<UniGetUiLogEntry[]> {
    const args = kind === 'operations' ? ['log', 'operations'] : kind === 'manager' ? ['log', 'manager', ...(manager ? ['--manager', managerId(manager)] : [])] : ['log', 'app', ...(level !== undefined ? ['--level', String(Math.max(0, Math.min(9, Math.floor(level))))] : [])]
    return asArray<UniGetUiLogEntry>(await this.run(args))
  }
  async backups(): Promise<unknown> { return this.run(['backup', 'status']) }
  async backupLocalCreate(): Promise<unknown> { return this.run(['backup', 'local', 'create'], WAIT_TIMEOUT_MS) }
  async backupCloudList(): Promise<unknown> { return this.run(['backup', 'cloud', 'list']) }
  async backupCloudCreate(): Promise<unknown> { return this.run(['backup', 'cloud', 'create'], WAIT_TIMEOUT_MS) }
  async backupCloudDownload(key: string): Promise<unknown> { return this.run(['backup', 'cloud', 'download', '--key', safeArg(key, 256)], WAIT_TIMEOUT_MS) }
  async backupCloudRestore(key: string, append = false): Promise<unknown> { return this.run(['backup', 'cloud', 'restore', '--key', safeArg(key, 256), ...(append ? ['--append'] : [])], WAIT_TIMEOUT_MS) }
  async backupLoginStart(launchBrowser = false): Promise<unknown> { return this.run(['backup', 'github', 'login', 'start', ...(launchBrowser ? ['--launch-browser'] : [])]) }
  async backupLoginComplete(): Promise<unknown> { return this.run(['backup', 'github', 'login', 'complete']) }
  async backupLogout(): Promise<unknown> { return this.run(['backup', 'github', 'logout']) }
  async bundle(): Promise<unknown> { return this.run(['bundle', 'get']) }
  async bundleReset(): Promise<unknown> { return this.run(['bundle', 'reset']) }
  async bundleImport(input: { path?: string; content?: string; format?: string; append?: boolean }): Promise<unknown> {
    if (!input.path || input.content !== undefined) throw new UniGetUiClientError('Bundle import requires a selected local file; raw bundle content is not accepted on the command line.', 'malformed')
    return this.run(['bundle', 'import', '--path', boundedPath(input.path), ...(input.format ? ['--format', safeArg(input.format, 32)] : []), ...boolArg(input.append).flatMap((v) => ['--append', v])])
  }
  async bundleExport(p?: string): Promise<unknown> { return this.run(['bundle', 'export', ...(p ? ['--path', boundedPath(p)] : [])]) }
  async bundleAdd(input: UniGetUiPackageInstallOptions & { id: string; selection?: string }): Promise<unknown> { return this.run(['bundle', 'add', '--id', packageId(input.id), ...optionArgs(input), ...(input.selection ? ['--selection', safeArg(input.selection, 32)] : [])]) }
  async bundleRemove(input: UniGetUiPackageInstallOptions & { id: string; selection?: string }): Promise<unknown> { return this.run(['bundle', 'remove', '--id', packageId(input.id), ...optionArgs(input), ...(input.selection ? ['--selection', safeArg(input.selection, 32)] : [])]) }
  async bundleInstall(input: { includeInstalled?: boolean; elevated?: boolean; interactive?: boolean; skipHash?: boolean } = {}): Promise<unknown> { return this.run(['bundle', 'install', ...(input.includeInstalled === undefined ? [] : ['--include-installed', input.includeInstalled ? 'true' : 'false']), ...(input.elevated === undefined ? [] : ['--elevated', input.elevated ? 'true' : 'false']), ...(input.interactive === undefined ? [] : ['--interactive', input.interactive ? 'true' : 'false']), ...(input.skipHash === undefined ? [] : ['--skip-hash', input.skipHash ? 'true' : 'false'])], WAIT_TIMEOUT_MS) }
  async packageSearch(query: string, manager?: string, maxResults = 100): Promise<UniGetUiPackage[]> { return asArray<UniGetUiPackage>(await this.run(['package', 'search', '--query', safeArg(query, 512), ...(manager ? ['--manager', managerId(manager)] : []), '--max-results', String(Math.max(1, Math.min(500, Math.floor(maxResults))))])) }
  async packageDetails(id: string, manager?: string, source?: string): Promise<unknown> { return this.run(['package', 'details', '--id', packageId(id), ...(manager ? ['--manager', managerId(manager)] : []), ...(source ? ['--source', safeArg(source)] : [])]) }
  async packageVersions(id: string, manager?: string, source?: string): Promise<unknown> { return this.run(['package', 'versions', '--id', packageId(id), ...(manager ? ['--manager', managerId(manager)] : []), ...(source ? ['--source', safeArg(source)] : [])]) }
  async packageInstalled(manager?: string): Promise<UniGetUiPackage[]> { return asArray<UniGetUiPackage>(await this.run(['package', 'installed', ...(manager ? ['--manager', managerId(manager)] : [])])) }
  async packageUpdates(manager?: string): Promise<UniGetUiPackage[]> { return asArray<UniGetUiPackage>(await this.run(['package', 'updates', ...(manager ? ['--manager', managerId(manager)] : [])])) }
  async packageInstall(id: string, options: UniGetUiPackageInstallOptions = {}): Promise<unknown> { return this.run(['package', 'install', '--id', packageId(id), ...optionArgs(options)], WAIT_TIMEOUT_MS) }
  async packageDownload(id: string, options: UniGetUiPackageInstallOptions & { output?: string } = {}): Promise<unknown> { return this.run(['package', 'download', '--id', packageId(id), ...optionArgs(options), ...(options.output ? ['--output', boundedPath(options.output)] : [])], WAIT_TIMEOUT_MS) }
  async packageUpdate(id: string, options: UniGetUiPackageInstallOptions = {}): Promise<unknown> { return this.run(['package', 'update', '--id', packageId(id), ...optionArgs(options)], WAIT_TIMEOUT_MS) }
  async packageUninstall(id: string, manager?: string, options: { elevated?: boolean; wait?: boolean } = {}): Promise<unknown> { return this.run(['package', 'uninstall', '--id', packageId(id), ...(manager ? ['--manager', managerId(manager)] : []), ...(options.elevated === undefined ? [] : ['--elevated', options.elevated ? 'true' : 'false']), ...(options.wait === undefined ? [] : ['--wait', options.wait ? 'true' : 'false'])], WAIT_TIMEOUT_MS) }
  async packageRepair(id: string, manager?: string, options: { elevated?: boolean; wait?: boolean } = {}): Promise<unknown> { return this.run(['package', 'repair', '--id', packageId(id), ...(manager ? ['--manager', managerId(manager)] : []), ...(options.elevated === undefined ? [] : ['--elevated', options.elevated ? 'true' : 'false']), ...(options.wait === undefined ? [] : ['--wait', options.wait ? 'true' : 'false'])], WAIT_TIMEOUT_MS) }
  async packageReinstall(id: string, options: UniGetUiPackageInstallOptions = {}): Promise<unknown> { return this.run(['package', 'reinstall', '--id', packageId(id), ...optionArgs(options)], WAIT_TIMEOUT_MS) }
  async ignoredUpdates(): Promise<UniGetUiPackage[]> { return asArray<UniGetUiPackage>(await this.run(['package', 'ignored', 'list'])) }
  async ignoredUpdateAdd(id: string, options: { manager?: string; version?: string; source?: string } = {}): Promise<unknown> { return this.run(['package', 'ignored', 'add', '--id', packageId(id), ...(options.manager ? ['--manager', managerId(options.manager)] : []), ...(options.version ? ['--version', safeArg(options.version)] : []), ...(options.source ? ['--source', safeArg(options.source)] : [])]) }
  async ignoredUpdateRemove(id: string, options: { manager?: string; version?: string; source?: string } = {}): Promise<unknown> { return this.run(['package', 'ignored', 'remove', '--id', packageId(id), ...(options.manager ? ['--manager', managerId(options.manager)] : []), ...(options.version ? ['--version', safeArg(options.version)] : []), ...(options.source ? ['--source', safeArg(options.source)] : [])]) }
  async packageUpdateAll(options: { elevated?: boolean; interactive?: boolean; wait?: boolean } = {}): Promise<unknown> { return this.run(['package', 'update-all', ...(options.elevated === undefined ? [] : ['--elevated', options.elevated ? 'true' : 'false']), ...(options.interactive === undefined ? [] : ['--interactive', options.interactive ? 'true' : 'false']), ...(options.wait === undefined ? [] : ['--wait', options.wait ? 'true' : 'false'])], WAIT_TIMEOUT_MS) }
  async packageUpdateManager(manager: string, options: { elevated?: boolean; interactive?: boolean; wait?: boolean } = {}): Promise<unknown> { return this.run(['package', 'update-manager', '--manager', managerId(manager), ...(options.elevated === undefined ? [] : ['--elevated', options.elevated ? 'true' : 'false']), ...(options.interactive === undefined ? [] : ['--interactive', options.interactive ? 'true' : 'false']), ...(options.wait === undefined ? [] : ['--wait', options.wait ? 'true' : 'false'])], WAIT_TIMEOUT_MS) }
}
