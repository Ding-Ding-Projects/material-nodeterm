/**
 * Read-only host facts for the Windows diagnostics canvas node.
 *
 * The shared shape intentionally carries rows and labels only. It never carries a command line,
 * credential, process handle, machine-local path, or a control that could mutate the host.
 */

export const WINDOWS_DIAGNOSTIC_SECTIONS = [
  'drives',
  'services',
  'startup',
  'scheduledTasks',
  'updates',
  'network',
  'events'
] as const

export type WindowsDiagnosticSection = (typeof WINDOWS_DIAGNOSTIC_SECTIONS)[number]

export type WindowsDiagnosticCell = string | number | boolean | null

export interface WindowsDiagnosticRow {
  id: string
  values: Record<string, WindowsDiagnosticCell>
}

export type WindowsDiagnosticSectionState =
  | {
      section: WindowsDiagnosticSection
      state: 'available'
      rows: WindowsDiagnosticRow[]
      checkedAt: number
    }
  | {
      section: WindowsDiagnosticSection
      state: 'unavailable' | 'error'
      rows: []
      reason: string
      checkedAt: number
    }

export interface WindowsDiagnosticsSnapshot {
  platform: 'win32' | 'unsupported'
  source: 'powershell-read-only' | 'unavailable'
  checkedAt: number
  durationMs: number
  sections: Record<WindowsDiagnosticSection, WindowsDiagnosticSectionState>
}

export interface WindowsDiagnosticsApi {
  /** Read the current host snapshot. The call has no mutation sibling by design. */
  snapshot(): Promise<WindowsDiagnosticsSnapshot>
}
