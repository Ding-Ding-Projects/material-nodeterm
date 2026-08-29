/** Shared contract for the machine-owned UniGetUI Global Universe.
 *
 * This file carries only safe display data and typed operation intent. The local UniGetUI
 * session owns its authentication token, manager credentials, and package-manager state. None of
 * those values are accepted in project data or renderer state.
 */

export type UniGetUiHealth =
  | 'unknown'
  | 'checking'
  | 'ok'
  | 'not-installed'
  | 'stopped'
  | 'unavailable'
  | 'malformed'
  | 'elevation-required'
  | 'failed'

export interface UniGetUiStatus {
  health: UniGetUiHealth
  executable: string | null
  version: string | null
  transport: 'named-pipe' | 'tcp' | 'unknown'
  detail: string | null
  checkedAt: number
}

export const UNIGETUI_PAGES = [
  'overview', 'discover', 'installed', 'updates', 'operations', 'managers', 'sources', 'bundles',
  'settings', 'shortcuts', 'logs', 'backups', 'help'
] as const
export type UniGetUiPage = (typeof UNIGETUI_PAGES)[number]

export interface UniGetUiUniverseState {
  schemaVersion: 1
  selectedPage: UniGetUiPage
  search: string
  regexEnabled: boolean
  regexPattern: string
  regexFlags: string
  updatedAt: number
}

export interface UniGetUiOperation {
  id: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  command: string
  manager: string | null
  packageId: string | null
  progress: number | null
  output: string[]
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface UniGetUiPackage {
  id: string
  name: string | null
  manager: string | null
  source: string | null
  version: string | null
  installedVersion: string | null
  description: string | null
  publisher: string | null
  url: string | null
}

type UniGetUiRecord = Record<string, unknown>

function isUniGetUiRecord(value: unknown): value is UniGetUiRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(value: unknown, max = 8_192): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function nullableText(value: unknown, max = 8_192): string | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === 'string' && value.length <= max ? value : undefined
}

/** Normalize one machine-owned setting response before it crosses the renderer boundary. */
export function normalizeUniGetUiSetting(value: unknown): UniGetUiSetting | null {
  if (!isUniGetUiRecord(value)) return null
  const key = optionalText(value.key, 160)
  if (!key) return null
  const settingValue = value.value
  if (settingValue !== null && typeof settingValue !== 'string' && typeof settingValue !== 'boolean') return null
  if (typeof value.secure !== 'boolean') return null
  return { key, value: settingValue, secure: value.secure }
}

/** Decode a nullable setting response and reject malformed payloads instead of widening them. */
export function parseUniGetUiSetting(value: unknown): UniGetUiSetting | null {
  if (value === null) return null
  const setting = normalizeUniGetUiSetting(value)
  if (!setting) throw new Error('UniGetUI returned a malformed setting response.')
  return setting
}

/** Normalize one package record. Missing nullable metadata is represented explicitly as null. */
export function normalizeUniGetUiPackage(value: unknown): UniGetUiPackage | null {
  if (!isUniGetUiRecord(value)) return null
  const id = optionalText(value.id, 512)
  if (!id) return null
  const name = nullableText(value.name)
  const manager = nullableText(value.manager)
  const source = nullableText(value.source)
  const version = nullableText(value.version)
  const installedVersion = nullableText(value.installedVersion)
  const description = nullableText(value.description)
  const publisher = nullableText(value.publisher)
  const url = nullableText(value.url)
  if (name === undefined || manager === undefined || source === undefined || version === undefined || installedVersion === undefined || description === undefined || publisher === undefined || url === undefined) return null
  return { id, name, manager, source, version, installedVersion, description, publisher, url }
}

/** Decode a package-list response and reject malformed entries before they reach UI consumers. */
export function parseUniGetUiPackageList(value: unknown): UniGetUiPackage[] {
  if (!Array.isArray(value)) throw new Error('UniGetUI returned a malformed package list response.')
  const packages: UniGetUiPackage[] = []
  for (const item of value) {
    const normalized = normalizeUniGetUiPackage(item)
    if (!normalized) throw new Error('UniGetUI returned a malformed package record.')
    packages.push(normalized)
  }
  return packages
}

export interface UniGetUiSource { manager: string; name: string; url: string | null; enabled: boolean | null }
export interface UniGetUiManager { id: string; name: string; installed: boolean | null; enabled: boolean | null; detail: string | null }
export interface UniGetUiSetting { key: string; value: string | boolean | null; secure: boolean }
export interface UniGetUiBackup { id: string; name: string; createdAt: string | null; sizeBytes: number | null; state: string | null }
export interface UniGetUiBundleItem { id: string; manager: string | null; source: string | null; version: string | null; scope: string | null }
export interface UniGetUiBundle { items: UniGetUiBundleItem[]; format: string | null; updatedAt: number | null }
export interface UniGetUiLogEntry { timestamp: string | null; level: string | null; message: string; operationId: string | null }

export interface UniGetUiPackageInstallOptions {
  manager?: string
  source?: string
  version?: string
  scope?: string
  preRelease?: boolean
  elevated?: boolean
  interactive?: boolean
  skipHash?: boolean
  architecture?: string
  location?: string
  wait?: boolean
  detach?: boolean
}

export interface UniGetUiApi {
  status(): Promise<UniGetUiStatus>
  universeState(): Promise<UniGetUiUniverseState>
  saveUniverseState(state: UniGetUiUniverseState): Promise<UniGetUiUniverseState>
  appStatus(): Promise<unknown>
  navigate(page: Exclude<UniGetUiPage, 'overview' | 'help'>): Promise<unknown>
  operations(): Promise<UniGetUiOperation[]>
  operation(id: string): Promise<UniGetUiOperation | null>
  operationOutput(id: string, tail?: number): Promise<string[]>
  operationWait(id: string, timeoutSeconds?: number): Promise<UniGetUiOperation | null>
  operationCancel(id: string): Promise<unknown>
  operationRetry(id: string, mode?: string): Promise<unknown>
  operationReorder(id: string, action: 'run-now' | 'run-next' | 'run-last'): Promise<unknown>
  operationForget(id: string): Promise<unknown>
  managers(): Promise<UniGetUiManager[]>
  managerAction(manager: string, action: string, input?: { path?: string; confirm?: boolean }): Promise<unknown>
  sources(manager?: string): Promise<UniGetUiSource[]>
  sourceAdd(manager: string, name: string, url?: string): Promise<unknown>
  sourceRemove(manager: string, name: string, url?: string): Promise<unknown>
  settings(): Promise<UniGetUiSetting[]>
  settingGet(key: string): Promise<UniGetUiSetting | null>
  settingSet(key: string, input: { enabled?: boolean; value?: string }): Promise<unknown>
  settingClear(key: string): Promise<unknown>
  settingsReset(): Promise<unknown>
  shortcuts(): Promise<unknown>
  shortcutSet(path: string, status: 'keep' | 'delete'): Promise<unknown>
  shortcutReset(path: string): Promise<unknown>
  shortcutResetAll(): Promise<unknown>
  logs(kind: 'app' | 'operations' | 'manager', manager?: string, level?: number): Promise<UniGetUiLogEntry[]>
  backups(): Promise<UniGetUiBackup[] | unknown>
  backupLocalCreate(): Promise<unknown>
  backupCloudList(): Promise<unknown>
  backupCloudCreate(): Promise<unknown>
  backupCloudDownload(key: string): Promise<unknown>
  backupCloudRestore(key: string, append?: boolean): Promise<unknown>
  backupLoginStart(launchBrowser?: boolean): Promise<unknown>
  backupLoginComplete(): Promise<unknown>
  backupLogout(): Promise<unknown>
  bundle(): Promise<UniGetUiBundle | unknown>
  bundleReset(): Promise<unknown>
  bundleImport(input: { path?: string; content?: string; format?: string; append?: boolean }): Promise<unknown>
  bundleExport(path?: string): Promise<unknown>
  bundleAdd(input: UniGetUiPackageInstallOptions & { id: string; selection?: string }): Promise<unknown>
  bundleRemove(input: UniGetUiPackageInstallOptions & { id: string; selection?: string }): Promise<unknown>
  bundleInstall(input?: { includeInstalled?: boolean; elevated?: boolean; interactive?: boolean; skipHash?: boolean }): Promise<unknown>
  packageSearch(query: string, manager?: string, maxResults?: number): Promise<UniGetUiPackage[]>
  packageDetails(id: string, manager?: string, source?: string): Promise<unknown>
  packageVersions(id: string, manager?: string, source?: string): Promise<unknown>
  packageInstalled(manager?: string): Promise<UniGetUiPackage[]>
  packageUpdates(manager?: string): Promise<UniGetUiPackage[]>
  packageInstall(id: string, options?: UniGetUiPackageInstallOptions): Promise<unknown>
  packageDownload(id: string, options?: UniGetUiPackageInstallOptions & { output?: string }): Promise<unknown>
  packageUpdate(id: string, options?: UniGetUiPackageInstallOptions): Promise<unknown>
  packageUninstall(id: string, manager?: string, options?: { elevated?: boolean; wait?: boolean }): Promise<unknown>
  packageRepair(id: string, manager?: string, options?: { elevated?: boolean; wait?: boolean }): Promise<unknown>
  packageReinstall(id: string, options?: UniGetUiPackageInstallOptions): Promise<unknown>
  ignoredUpdates(): Promise<UniGetUiPackage[]>
  ignoredUpdateAdd(id: string, options?: { manager?: string; version?: string; source?: string }): Promise<unknown>
  ignoredUpdateRemove(id: string, options?: { manager?: string; version?: string; source?: string }): Promise<unknown>
  packageUpdateAll(options?: { elevated?: boolean; interactive?: boolean; wait?: boolean }): Promise<unknown>
  packageUpdateManager(manager: string, options?: { elevated?: boolean; interactive?: boolean; wait?: boolean }): Promise<unknown>
}

export const UNIGETUI_DEFAULT_UNIVERSE_STATE: UniGetUiUniverseState = {
  schemaVersion: 1,
  selectedPage: 'overview',
  search: '',
  regexEnabled: false,
  regexPattern: '',
  regexFlags: '',
  updatedAt: 0
}

export function isUniGetUiPage(value: unknown): value is UniGetUiPage {
  return typeof value === 'string' && (UNIGETUI_PAGES as readonly string[]).includes(value)
}

export function sanitizeUniGetUiState(value: unknown): UniGetUiUniverseState {
  if (!value || typeof value !== 'object') return { ...UNIGETUI_DEFAULT_UNIVERSE_STATE }
  const raw = value as Partial<UniGetUiUniverseState>
  return {
    schemaVersion: 1,
    selectedPage: isUniGetUiPage(raw.selectedPage) ? raw.selectedPage : 'overview',
    search: typeof raw.search === 'string' ? raw.search.slice(0, 256) : '',
    regexEnabled: raw.regexEnabled === true,
    regexPattern: typeof raw.regexPattern === 'string' ? raw.regexPattern.slice(0, 512) : '',
    regexFlags: typeof raw.regexFlags === 'string' ? raw.regexFlags.slice(0, 32) : '',
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  }
}
