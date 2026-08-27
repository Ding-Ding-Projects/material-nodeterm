import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IPC } from '../shared/ipc'
import type {
  WindowsDiagnosticCell,
  WindowsDiagnosticRow,
  WindowsDiagnosticSection,
  WindowsDiagnosticSectionState,
  WindowsDiagnosticsSnapshot
} from '../shared/windows-diagnostics'
import { WINDOWS_DIAGNOSTIC_SECTIONS } from '../shared/windows-diagnostics'
import { platform } from './platform'

const execFileAsync = promisify(execFile)
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const QUERY_TIMEOUT_MS = 15_000
const MAX_ROWS_PER_SECTION = 1_000

/** Fixed, read-only queries. No renderer value is interpolated into this script. */
const WINDOWS_DIAGNOSTICS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
function Read-Section([string] $name, [scriptblock] $query) {
  try {
    $items = @(& $query)
    return [ordered]@{ state = 'available'; rows = @($items) }
  } catch [System.Management.Automation.CommandNotFoundException] {
    return [ordered]@{ state = 'unavailable'; reason = 'This Windows capability is unavailable on this host.'; rows = @() }
  } catch {
    return [ordered]@{ state = 'error'; reason = 'The Windows diagnostics query could not be completed.'; rows = @() }
  }
}

$sections = [ordered]@{}
$sections.drives = Read-Section 'drives' {
  Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType = 3" |
    Sort-Object DeviceID |
    ForEach-Object { [ordered]@{ drive = [string]$_.DeviceID; label = [string]$_.VolumeName; fileSystem = [string]$_.FileSystem; sizeBytes = if ($null -eq $_.Size) { $null } else { [int64]$_.Size }; freeBytes = if ($null -eq $_.FreeSpace) { $null } else { [int64]$_.FreeSpace } } }
}
$sections.services = Read-Section 'services' {
  Get-CimInstance -ClassName Win32_Service |
    Sort-Object DisplayName, Name |
    ForEach-Object { [ordered]@{ name = [string]$_.Name; displayName = [string]$_.DisplayName; state = [string]$_.State; startMode = [string]$_.StartMode; account = [string]$_.StartName } }
}
$sections.startup = Read-Section 'startup' {
  Get-CimInstance -ClassName Win32_StartupCommand |
    Sort-Object Name, Location |
    ForEach-Object { [ordered]@{ name = [string]$_.Name; command = [string]$_.Command; location = [string]$_.Location; user = [string]$_.User } }
}
$sections.scheduledTasks = Read-Section 'scheduledTasks' {
  Get-ScheduledTask |
    Sort-Object TaskPath, TaskName |
    ForEach-Object { [ordered]@{ name = [string]$_.TaskName; path = [string]$_.TaskPath; state = [string]$_.State; author = [string]$_.Author } }
}
$sections.updates = Read-Section 'updates' {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem
  $hotfixes = @(Get-CimInstance -ClassName Win32_QuickFixEngineering | Sort-Object InstalledOn -Descending | Select-Object -First 200)
  @([ordered]@{ kind = 'operating-system'; caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; lastBoot = [string]$os.LastBootUpTime }) +
    @($hotfixes | ForEach-Object { [ordered]@{ kind = 'hotfix'; id = [string]$_.HotFixID; description = [string]$_.Description; installedOn = [string]$_.InstalledOn } })
}
$sections.network = Read-Section 'network' {
  $adapters = @(Get-NetAdapter | Sort-Object Name | ForEach-Object { [ordered]@{ kind = 'adapter'; name = [string]$_.Name; status = [string]$_.Status; linkSpeed = [string]$_.LinkSpeed; mac = [string]$_.MacAddress } })
  $configs = @(Get-NetIPConfiguration | Sort-Object InterfaceAlias | ForEach-Object { [ordered]@{ kind = 'configuration'; interface = [string]$_.InterfaceAlias; ipv4 = [string](($_.IPv4Address | ForEach-Object { $_.IPv4Address }) -join ', '); ipv6 = [string](($_.IPv6Address | ForEach-Object { $_.IPv6Address }) -join ', '); gateways = [string](($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop }) -join ', '); dns = [string](($_.DnsServer.ServerAddresses) -join ', ') } })
  $adapters + $configs
}
$sections.events = Read-Section 'events' {
  $since = (Get-Date).AddDays(-7)
  Get-WinEvent -FilterHashtable @{ LogName = @('System', 'Application'); StartTime = $since } -MaxEvents 500 |
    Group-Object @{ Expression = { '{0}|{1}|{2}|{3}' -f $_.LogName, $_.LevelDisplayName, $_.ProviderName, $_.Id } } |
    Sort-Object Count -Descending |
    Select-Object -First 200 |
    ForEach-Object { $parts = $_.Name -split '\|', 4; [ordered]@{ log = [string]$parts[0]; level = [string]$parts[1]; provider = [string]$parts[2]; eventId = [int]$parts[3]; count = [int]$_.Count } }
}
$sections | ConvertTo-Json -Depth 8 -Compress
`

interface WindowsDiagnosticsRuntime {
  platform: NodeJS.Platform
  execFile(file: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

const defaultRuntime: WindowsDiagnosticsRuntime = {
  platform: process.platform,
  async execFile(file, args) {
    try {
      const result = await execFileAsync(file, [...args], {
        windowsHide: true,
        timeout: QUERY_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8'
      })
      return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), exitCode: 0 }
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string; code?: number | string }
      return {
        stdout: String(value.stdout ?? ''),
        stderr: String(value.stderr ?? ''),
        exitCode: typeof value.code === 'number' ? value.code : 1
      }
    }
  }
}

const emptySections = (state: 'unavailable' | 'error', reason: string, checkedAt: number): Record<WindowsDiagnosticSection, WindowsDiagnosticSectionState> =>
  Object.fromEntries(WINDOWS_DIAGNOSTIC_SECTIONS.map((section) => [section, { section, state, rows: [], reason, checkedAt }])) as Record<WindowsDiagnosticSection, WindowsDiagnosticSectionState>

function scalar(value: unknown): WindowsDiagnosticCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function rowsFor(value: unknown): WindowsDiagnosticRow[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return list.slice(0, MAX_ROWS_PER_SECTION).map((item, index) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : { value: item }
    const values = Object.fromEntries(Object.entries(record).slice(0, 24).map(([key, cell]) => [key, scalar(cell)]))
    const idValue = values.id ?? values.name ?? values.drive ?? values.interface ?? values.kind ?? String(index + 1)
    return { id: String(idValue ?? index + 1), values }
  })
}

function parseSnapshot(raw: string, checkedAt: number, durationMs: number): WindowsDiagnosticsSnapshot {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const sections = Object.fromEntries(WINDOWS_DIAGNOSTIC_SECTIONS.map((section) => {
    const value = parsed[section]
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [section, { section, state: 'error', rows: [], reason: 'The Windows diagnostics response had an invalid section.', checkedAt }]
    const record = value as Record<string, unknown>
    if (record.state !== 'available') return [section, { section, state: record.state === 'unavailable' ? 'unavailable' : 'error', rows: [], reason: typeof record.reason === 'string' ? record.reason : 'The Windows diagnostics query could not be completed.', checkedAt }]
    return [section, { section, state: 'available', rows: rowsFor(record.rows), checkedAt }]
  })) as Record<WindowsDiagnosticSection, WindowsDiagnosticSectionState>
  return { platform: 'win32', source: 'powershell-read-only', checkedAt, durationMs, sections }
}

export async function readWindowsDiagnostics(runtime: WindowsDiagnosticsRuntime = defaultRuntime): Promise<WindowsDiagnosticsSnapshot> {
  const started = Date.now()
  const checkedAt = Date.now()
  if (runtime.platform !== 'win32') {
    const reason = 'Windows diagnostics are unavailable because this host is not Windows.'
    return { platform: 'unsupported', source: 'unavailable', checkedAt, durationMs: Date.now() - started, sections: emptySections('unavailable', reason, checkedAt) }
  }
  const result = await runtime.execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_DIAGNOSTICS_SCRIPT])
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    const reason = 'Windows diagnostics are unavailable because the read-only PowerShell query did not return a snapshot.'
    return { platform: 'win32', source: 'unavailable', checkedAt, durationMs: Date.now() - started, sections: emptySections('unavailable', reason, checkedAt) }
  }
  try {
    return parseSnapshot(result.stdout, checkedAt, Date.now() - started)
  } catch {
    const reason = 'Windows diagnostics are unavailable because the read-only response could not be parsed.'
    return { platform: 'win32', source: 'unavailable', checkedAt, durationMs: Date.now() - started, sections: emptySections('error', reason, checkedAt) }
  }
}

export function registerWindowsDiagnosticsIpc(runtime: WindowsDiagnosticsRuntime = defaultRuntime): { dispose(): void } {
  platform().handle(IPC.windowsDiagnosticsSnapshot, () => readWindowsDiagnostics(runtime))
  return { dispose: () => {} }
}
