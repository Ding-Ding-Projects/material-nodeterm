import { create } from 'zustand'
import type { TerminalProfilesApi, WindowsTerminalProfile } from '@shared/types'
import { isWindowsPlatform } from '@shared/platform-utils'

interface TerminalProfilesState {
  profiles: WindowsTerminalProfile[]
  loading: boolean
  initialized: boolean
  /** `null` means support has not been probed yet. */
  supported: boolean | null
  error: string | null
  /** Detect once, on demand. Callers should invoke this only after their surface is visible. */
  ensureLoaded(): Promise<void>
  /** Re-run detection without discarding the last usable result while the request is in flight. */
  refresh(): Promise<void>
}

function profileApi(): TerminalProfilesApi | undefined {
  if (typeof window === 'undefined' || !isWindowsPlatform()) return undefined
  return window.nodeTerminal?.terminalProfiles
}

export const TERMINAL_PROFILE_DETECTION_FAILED = 'Terminal profile detection failed.'

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.trim() || TERMINAL_PROFILE_DETECTION_FAILED
}

/** Translate only the renderer's own generic fallback; host-provided diagnostics stay verbatim. */
export function terminalProfileDisplayError(
  error: string | null,
  localizedFallback: string
): string | null {
  return error === TERMINAL_PROFILE_DETECTION_FAILED ? localizedFallback : error
}

async function detect(
  api: TerminalProfilesApi,
  method: 'list' | 'refresh',
  set: (patch: Partial<TerminalProfilesState>) => void
): Promise<void> {
  set({ loading: true, supported: true, error: null })
  try {
    const profiles = await api[method]()
    set({
      profiles,
      loading: false,
      initialized: true,
      supported: true,
      error: null
    })
  } catch (error) {
    // A failed refresh is not evidence that the previously detected profiles disappeared. Keep
    // the last good list, surface the real failure, and let the user retry explicitly.
    set({
      loading: false,
      initialized: true,
      supported: true,
      error: errorMessage(error)
    })
  }
}

export const useTerminalProfiles = create<TerminalProfilesState>((set, get) => ({
  profiles: [],
  loading: false,
  initialized: false,
  supported: null,
  error: null,

  async ensureLoaded() {
    if (get().initialized || get().loading) return
    const api = profileApi()
    if (!api) {
      set({
        profiles: [],
        loading: false,
        initialized: true,
        supported: false,
        error: null
      })
      return
    }
    await detect(api, 'list', set)
  },

  async refresh() {
    if (get().loading) return
    const api = profileApi()
    if (!api) {
      set({
        profiles: [],
        loading: false,
        initialized: true,
        supported: false,
        error: null
      })
      return
    }
    await detect(api, 'refresh', set)
  }
}))

/** Synchronous capability gate for renderer surfaces. Server Edition and non-Windows hosts keep
 * their existing shell UI and never call the optional desktop-only API. */
export function supportsWindowsTerminalProfiles(): boolean {
  return profileApi() !== undefined
}

/** Stable label fallback while detection is loading or an installed profile has disappeared. */
export function terminalProfileLabel(
  profileId: string | undefined,
  profiles: readonly WindowsTerminalProfile[],
  fallbacks: Partial<{
    defaultProfile: string
    automatic: string
    custom: string
    unavailable: string
  }> = {}
): string {
  const detected = profiles.find((profile) => profile.id === profileId)
  if (detected) return detected.label
  if (profileId === undefined) return fallbacks.defaultProfile ?? 'Default profile'
  if (profileId.startsWith('wsl:')) {
    const distribution = profileId.slice(4)
    // Profile ids are machine-local but still hand-editable. Do not reflect unbounded control or
    // bidi characters into a terminal header or settings sentinel; exact valid distro names may
    // contain spaces and remain intact.
    const unsafe = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
    if (distribution.length > 0 && distribution.length <= 128 && !unsafe.test(distribution)) {
      return `WSL — ${distribution}`
    }
  }
  switch (profileId) {
    case 'auto':
      return fallbacks.automatic ?? 'Automatic'
    case 'pwsh':
      return 'PowerShell 7'
    case 'windows-powershell':
      return 'Windows PowerShell'
    case 'cmd':
      return 'Command Prompt'
    case 'git-bash':
      return 'Git Bash'
    case 'custom':
      return fallbacks.custom ?? 'Custom executable'
    default:
      return fallbacks.unavailable ?? 'Unavailable terminal profile'
  }
}
