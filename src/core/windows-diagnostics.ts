import { execFile } from 'child_process'
import type {
  WindowsDiagnosticDrive,
  WindowsDiagnosticEvent,
  WindowsDiagnosticKind,
  WindowsDiagnosticNetworkAdapter,
  WindowsDiagnosticRecords,
  WindowsDiagnosticScheduledTask,
  WindowsDiagnosticSection,
  WindowsDiagnosticService,
  WindowsDiagnosticStartupEntry,
  WindowsDiagnosticStorage,
  WindowsDiagnosticUpdate,
  WindowsDiagnosticSnapshot,
  WindowsDiagnosticsApi
} from '../shared/windows-diagnostics'

/** Native queries are fixed allowlisted operations, never user-provided command text. */
const QUERY = {
  drives: `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,VolumeName,FileSystem,DriveType,Size,FreeSpace | ConvertTo-Json -Compress`,
  storage: `Get-CimInstance Win32_DiskDrive | Select-Object Model,MediaType,Size,Status | ConvertTo-Json -Compress`,
  services: `Get-CimInstance Win32_Service | Select-Object -First 300 Name,DisplayName,State,StartMode,ServiceType | ConvertTo-Json -Compress`,
  startup: `Get-CimInstance Win32_StartupCommand | Select-Object -First 200 Name,Command,Location,User | ConvertTo-Json -Compress`,
  'scheduled-tasks': `$tasks = Get-ScheduledTask | Select-Object -First 300; $tasks | ForEach-Object { $info = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{ TaskName = $_.TaskName; TaskPath = $_.TaskPath; State = $_.State; LastRunTime = $info.LastRunTime; NextRunTime = $info.NextRunTime } } | ConvertTo-Json -Compress`,
  updates: `Get-CimInstance Win32_QuickFixEngineering | Sort-Object InstalledOn -Descending | Select-Object -First 200 HotFixID,Description,InstalledOn,InstalledBy | ConvertTo-Json -Compress`,
  network: `$adapters = Get-NetAdapter | Select-Object -First 100; $adapters | ForEach-Object { $config = Get-NetIPConfiguration -InterfaceIndex $_.ifIndex; [pscustomobject]@{ Name = $_.Name; Status = $_.Status; LinkSpeed = $_.LinkSpeed; MacAddress = $_.MacAddress; IPv4 = @($config.IPv4Address.IPAddress); IPv6 = @($config.IPv6Address.IPAddress) } } | ConvertTo-Json -Compress`,
  events: `Get-WinEvent -LogName System -MaxEvents 100 | Select-Object TimeCreated,ProviderName,Id,LevelDisplayName,Message | ConvertTo-Json -Compress`
} as const satisfies Record<WindowsDiagnosticKind, string>

const MAX_OUTPUT_BYTES = 384 * 1024
const COMMAND_TIMEOUT_MS = 8_000
const MAX_TEXT = 600

export interface WindowsDiagnosticsRuntime {
  platform: NodeJS.Platform
  env: Readonly<NodeJS.ProcessEnv>
  execFile(file: string, args: readonly string[]): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number | null; error?: Error }>
}

function defaultRuntime(): WindowsDiagnosticsRuntime {
  return {
    platform: process.platform,
    env: process.env,
    execFile: (file, args) =>
      new Promise((resolve) => {
        execFile(
          file,
          [...args],
          {
            encoding: 'buffer',
            windowsHide: true,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: MAX_OUTPUT_BYTES
          },
          (error, stdout, stderr) => {
            const code = error ? (error as NodeJS.ErrnoException).code : undefined
            resolve({
              stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
              stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? ''),
              exitCode: error ? (typeof code === 'number' ? code : null) : 0,
              ...(error ? { error } : {})
            })
          }
        )
      })
  }
}

function text(value: unknown, max = MAX_TEXT): string {
  const cleaned = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const result = text(value)
  return result || null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    if (Number.isSafeInteger(n)) return n
  }
  return null
}

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : []
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item)).filter(Boolean).slice(0, 32)
}

function decodeOutput(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) return raw.subarray(2).toString('utf16le')
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return raw.subarray(3).toString('utf8')
  let nulCount = 0
  for (let i = 1; i < raw.length; i += 2) if (raw[i] === 0) nulCount++
  if (raw.length > 2 && nulCount > raw.length / 8) return raw.toString('utf16le')
  return raw.toString('utf8')
}

function mapRecords<K extends WindowsDiagnosticKind>(kind: K, value: unknown): WindowsDiagnosticRecords[K] {
  const source = rows(value)
  switch (kind) {
    case 'drives':
      return source.map((row): WindowsDiagnosticDrive => ({
        device: text(row.DeviceID, 32),
        label: nullableText(row.VolumeName),
        filesystem: nullableText(row.FileSystem),
        type: nullableText(row.DriveType),
        capacityBytes: numberOrNull(row.Size),
        freeBytes: numberOrNull(row.FreeSpace)
      })).filter((row) => row.device) as WindowsDiagnosticRecords[K]
    case 'storage':
      return source.map((row): WindowsDiagnosticStorage => ({
        model: nullableText(row.Model),
        mediaType: nullableText(row.MediaType),
        sizeBytes: numberOrNull(row.Size),
        status: nullableText(row.Status)
      })) as WindowsDiagnosticRecords[K]
    case 'services':
      return source.map((row): WindowsDiagnosticService => ({
        name: text(row.Name, 128),
        displayName: text(row.DisplayName),
        state: text(row.State, 64),
        startMode: text(row.StartMode, 64),
        serviceType: text(row.ServiceType, 64)
      })).filter((row) => row.name) as WindowsDiagnosticRecords[K]
    case 'startup':
      return source.map((row): WindowsDiagnosticStartupEntry => ({
        name: text(row.Name, 128),
        command: text(row.Command),
        location: text(row.Location, 256),
        user: nullableText(row.User)
      })).filter((row) => row.name || row.command) as WindowsDiagnosticRecords[K]
    case 'scheduled-tasks':
      return source.map((row): WindowsDiagnosticScheduledTask => ({
        taskName: text(row.TaskName, 128),
        taskPath: text(row.TaskPath, 256),
        state: text(row.State, 64),
        lastRunTime: null,
        nextRunTime: null
      })).filter((row) => row.taskName) as WindowsDiagnosticRecords[K]
    case 'updates':
      return source.map((row): WindowsDiagnosticUpdate => ({
        hotFixId: text(row.HotFixId, 64),
        description: nullableText(row.Description),
        installedOn: nullableText(row.InstalledOn),
        installedBy: nullableText(row.InstalledBy)
      })).filter((row) => row.hotFixId) as WindowsDiagnosticRecords[K]
    case 'network':
      return source.map((row): WindowsDiagnosticNetworkAdapter => ({
        name: text(row.Name, 128),
        status: text(row.Status, 64),
        linkSpeed: nullableText(row.LinkSpeed),
        macAddress: nullableText(row.MacAddress),
        ipv4: stringArray(row.IPv4),
        ipv6: stringArray(row.IPv6)
      })).filter((row) => row.name) as WindowsDiagnosticRecords[K]
    case 'events':
      return source.map((row): WindowsDiagnosticEvent => ({
        timeCreated: nullableText(row.TimeCreated),
        provider: nullableText(row.ProviderName),
        id: typeof row.Id === 'number' && Number.isSafeInteger(row.Id) ? row.Id : null,
        level: nullableText(row.LevelDisplayName),
        message: text(row.Message, 1200)
      })) as WindowsDiagnosticRecords[K]
  }
}

function emptyRecords<K extends WindowsDiagnosticKind>(kind: K): WindowsDiagnosticRecords[K] {
  return [] as unknown as WindowsDiagnosticRecords[K]
}

function powershellPath(env: Readonly<NodeJS.ProcessEnv>): string {
  const root = env.SystemRoot || env.WINDIR
  return root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'
}

async function runQuery<K extends WindowsDiagnosticKind>(runtime: WindowsDiagnosticsRuntime, kind: K): Promise<WindowsDiagnosticSection<K>> {
  const capturedAt = Date.now()
  const unavailable = (error: string, truncated = false): WindowsDiagnosticSection<K> => ({
    kind,
    records: emptyRecords(kind),
    capturedAt,
    truncated,
    error
  })
  const result = await runtime.execFile(powershellPath(runtime.env), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    QUERY[kind]
  ])
  if (result.error || result.exitCode !== 0) {
    return unavailable('Windows did not provide this read-only diagnostic category.')
  }
  if (result.stdout.byteLength > MAX_OUTPUT_BYTES) {
    return unavailable('The diagnostic response exceeded the safety limit.', true)
  }
  const raw = decodeOutput(result.stdout).trim()
  if (!raw) return { kind, records: emptyRecords(kind), capturedAt, truncated: false }
  try {
    return { kind, records: mapRecords(kind, JSON.parse(raw)), capturedAt, truncated: false }
  } catch {
    return unavailable('Windows returned an unreadable diagnostic response.')
  }
}

export class WindowsDiagnosticsService implements WindowsDiagnosticsApi {
  private readonly runtime: WindowsDiagnosticsRuntime

  constructor(runtime: WindowsDiagnosticsRuntime = defaultRuntime()) {
    this.runtime = runtime
  }

  async read<T extends WindowsDiagnosticKind>(kind: T): Promise<WindowsDiagnosticSection<T>> {
    if (this.runtime.platform !== 'win32') {
      return {
        kind,
        records: emptyRecords(kind),
        capturedAt: Date.now(),
        truncated: false,
        error: 'Read-only Windows diagnostics are available only on the Windows desktop.'
      }
    }
    return runQuery(this.runtime, kind)
  }

  async snapshot(): Promise<WindowsDiagnosticSnapshot> {
    const capturedAt = Date.now()
    const entries = await Promise.all(WINDOWS_DIAGNOSTIC_KINDS.map(async (kind) => [kind, await this.read(kind)] as const))
    return {
      platform: this.runtime.platform,
      capturedAt,
      sections: Object.fromEntries(entries) as WindowsDiagnosticSnapshot['sections']
    }
  }
}

export function createWindowsDiagnosticsService(runtime?: WindowsDiagnosticsRuntime): WindowsDiagnosticsService {
  return new WindowsDiagnosticsService(runtime)
}
