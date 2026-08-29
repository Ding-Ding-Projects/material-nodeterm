/**
 * Machine-local, read-only Windows diagnostics.
 *
 * This surface deliberately carries facts, not handles or command material. The main process
 * owns the native query and returns bounded, serialisable records. A project node stores only its
 * title and colour, so opening the same project on another computer never carries this machine's
 * paths, services, or event data with it.
 */

export const WINDOWS_DIAGNOSTIC_KINDS = [
  'drives',
  'storage',
  'services',
  'startup',
  'scheduled-tasks',
  'updates',
  'network',
  'events'
] as const

export type WindowsDiagnosticKind = (typeof WINDOWS_DIAGNOSTIC_KINDS)[number]

export interface WindowsDiagnosticDrive {
  device: string
  label: string | null
  filesystem: string | null
  type: string | null
  capacityBytes: number | null
  freeBytes: number | null
}

export interface WindowsDiagnosticStorage {
  model: string | null
  mediaType: string | null
  sizeBytes: number | null
  status: string | null
}

export interface WindowsDiagnosticService {
  name: string
  displayName: string
  state: string
  startMode: string
  serviceType: string
}

export interface WindowsDiagnosticStartupEntry {
  name: string
  command: string
  location: string
  user: string | null
}

export interface WindowsDiagnosticScheduledTask {
  taskName: string
  taskPath: string
  state: string
  lastRunTime: string | null
  nextRunTime: string | null
}

export interface WindowsDiagnosticUpdate {
  hotFixId: string
  description: string | null
  installedOn: string | null
  installedBy: string | null
}

export interface WindowsDiagnosticNetworkAdapter {
  name: string
  status: string
  linkSpeed: string | null
  macAddress: string | null
  ipv4: string[]
  ipv6: string[]
}

export interface WindowsDiagnosticEvent {
  timeCreated: string | null
  provider: string | null
  id: number | null
  level: string | null
  message: string
}

export interface WindowsDiagnosticRecords {
  drives: WindowsDiagnosticDrive[]
  storage: WindowsDiagnosticStorage[]
  services: WindowsDiagnosticService[]
  startup: WindowsDiagnosticStartupEntry[]
  'scheduled-tasks': WindowsDiagnosticScheduledTask[]
  updates: WindowsDiagnosticUpdate[]
  network: WindowsDiagnosticNetworkAdapter[]
  events: WindowsDiagnosticEvent[]
}

export interface WindowsDiagnosticSection<T extends WindowsDiagnosticKind = WindowsDiagnosticKind> {
  kind: T
  records: WindowsDiagnosticRecords[T]
  capturedAt: number
  truncated: boolean
  /** A query failure is distinct from a successfully observed empty list. */
  error?: string
}

export interface WindowsDiagnosticSnapshot {
  platform: NodeJS.Platform
  capturedAt: number
  sections: { [K in WindowsDiagnosticKind]: WindowsDiagnosticSection<K> }
}

export interface WindowsDiagnosticsApi {
  snapshot(): Promise<WindowsDiagnosticSnapshot>
  read<T extends WindowsDiagnosticKind>(kind: T): Promise<WindowsDiagnosticSection<T>>
}
