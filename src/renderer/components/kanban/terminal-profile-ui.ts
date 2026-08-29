import type { WindowsTerminalProfile } from '@shared/types'
import type { ReactNode } from 'react'
import type {
  TerminalProfileChoice,
  TerminalProfileRestartAssessment
} from '../../lib/terminal-profile-actions'
import { terminalProfileChoices } from '../../lib/terminal-profile-actions'
import { terminalProfileLabel } from '../../state/terminal-profiles'
import type { MenuItem } from '../ContextMenu'

export type KanbanTerminalProfileAvailability = 'available' | 'unavailable' | 'unknown'

export interface KanbanTerminalProfileCreateOption {
  key: string
  label: string
  choice: { kind: 'terminal'; profileId: string }
  disabled?: boolean
  hint?: string
}

/**
 * Production mapping for Kanban's profile drill-in. Keeping the stable id inside the leaf choice
 * is the whole creation contract: Canvas later passes that exact fifth-slot value through the
 * terminal factory, while the ordinary Terminal row remains the saved-default path.
 */
export function kanbanTerminalProfileCreateOptions(
  profiles: readonly TerminalProfileChoice[]
): KanbanTerminalProfileCreateOption[] {
  return profiles.map((profile) => ({
    key: `terminal-profile:${profile.id}`,
    label: profile.label,
    choice: { kind: 'terminal', profileId: profile.id },
    disabled: profile.disabled,
    hint: profile.hint
  }))
}

/** Renderer-safe profile metadata shown beside a terminal card's title. */
export interface KanbanTerminalProfilePresentation extends TerminalProfileChoice {
  availability: KanbanTerminalProfileAvailability
}

export interface KanbanTerminalProfileDetection {
  loading: boolean
  initialized: boolean
  error: string | null
}

export interface KanbanTerminalProfileCopy {
  checkingAvailability: string
  noLongerDetected: string
  hostCannotConfirm: string
  detectingProfiles: string
  profilesUnavailable: string
  noProfilesDetected: string
  detectionPending: string
  restartMenuLabel: string
  restartBusy: string
  restartProgress: string
  defaultProfileLabel: string
  automaticLabel: string
  customLabel: string
  unavailableLabel: string
  unavailableOnMachine: string
}

const DEFAULT_COPY: KanbanTerminalProfileCopy = {
  checkingAvailability: 'Checking whether this terminal profile is available on this machine.',
  noLongerDetected: 'This selected profile is no longer detected on this machine.',
  hostCannotConfirm: 'This host cannot confirm that the old persistent session ended.',
  detectingProfiles: 'Detecting profiles…',
  profilesUnavailable: 'Profiles unavailable',
  noProfilesDetected: 'No Windows terminal profiles were detected.',
  detectionPending: 'Profile detection has not finished yet.',
  restartMenuLabel: 'Restart with profile…',
  restartBusy: 'This terminal is already restarting. Wait for that restart to finish.',
  restartProgress: 'Restarting with profile…',
  defaultProfileLabel: 'Default profile',
  automaticLabel: 'Automatic',
  customLabel: 'Custom executable',
  unavailableLabel: 'Unavailable terminal profile',
  unavailableOnMachine: 'This profile is unavailable on this machine.'
}

export interface KanbanCardMenuAnchor {
  x: number
  y: number
}

export type KanbanRestartProfileHandler = (
  nodeId: string,
  profile: TerminalProfileChoice,
  anchor: KanbanCardMenuAnchor
) => void

export type KanbanRestartProfileAssessment = Pick<
  TerminalProfileRestartAssessment,
  'disabled' | 'reason'
>

export type KanbanRestartProfileAssessor = (
  nodeId: string,
  profileId: string
) => KanbanRestartProfileAssessment

/**
 * Resolve a node's stable profile id into modal-safe display metadata.
 *
 * Detection failure is deliberately `unknown`, not `unavailable`: a failed refresh does not prove
 * that the selected shell disappeared. Conversely, a successful detection that omits the saved id
 * is actionable and is shown as unavailable without falling back to another profile.
 */
export function selectedKanbanTerminalProfile(
  profileId: string | undefined,
  profiles: readonly WindowsTerminalProfile[],
  detection: KanbanTerminalProfileDetection,
  copy: KanbanTerminalProfileCopy = DEFAULT_COPY
): KanbanTerminalProfilePresentation | undefined {
  if (profileId === undefined) return undefined

  const detected = profiles.find((profile) => profile.id === profileId)
  if (detected) {
    const choice = terminalProfileChoices([detected], copy.unavailableOnMachine)[0]
    return {
      ...choice,
      availability: detected.available ? 'available' : 'unavailable'
    }
  }

  const label = terminalProfileLabel(profileId, profiles, {
    defaultProfile: copy.defaultProfileLabel,
    automatic: copy.automaticLabel,
    custom: copy.customLabel,
    unavailable: copy.unavailableLabel
  })
  if (detection.loading || !detection.initialized) {
    return {
      id: profileId,
      label,
      disabled: true,
      hint: copy.checkingAvailability,
      availability: 'unknown'
    }
  }
  if (detection.error) {
    return {
      id: profileId,
      label,
      disabled: true,
      hint: detection.error,
      availability: 'unknown'
    }
  }
  return {
    id: profileId,
    label,
    disabled: true,
    hint: copy.noLongerDetected,
    availability: 'unavailable'
  }
}

export interface KanbanRestartProfileMenuOptions {
  nodeId: string
  anchor: KanbanCardMenuAnchor
  profiles: readonly TerminalProfileChoice[]
  detection: KanbanTerminalProfileDetection
  canRecyclePersistentSession: boolean
  restartPending?: boolean
  icon?: ReactNode
  /** Live node/settings assessment; required so agent restrictions cannot silently fail open. */
  assessProfile: KanbanRestartProfileAssessor
  onSelect: KanbanRestartProfileHandler
  copy?: KanbanTerminalProfileCopy
}

/**
 * Build the exact menu item used by every Kanban terminal/agent card.
 *
 * The extra handler guard keeps an unavailable row inert even when invoked outside the DOM. The
 * ContextMenu also renders it with `aria-disabled` plus the reason, so keyboard and pointer users
 * get the same fail-closed behavior.
 */
export function kanbanRestartProfileMenuItem({
  nodeId,
  anchor,
  profiles,
  detection,
  canRecyclePersistentSession,
  restartPending = false,
  icon,
  assessProfile,
  onSelect,
  copy = DEFAULT_COPY
}: KanbanRestartProfileMenuOptions): MenuItem {
  const children: MenuItem[] = profiles.length
    ? profiles.map((profile) => {
        const assessment = assessProfile(nodeId, profile.id)
        const disabled =
          profile.disabled || assessment.disabled || !canRecyclePersistentSession || restartPending
        const hint = restartPending
          ? copy.restartBusy
          : !canRecyclePersistentSession
            ? copy.hostCannotConfirm
            : profile.disabled
              ? profile.hint
              : assessment.disabled
                ? (assessment.reason ?? profile.hint)
                : profile.hint
        return {
          label: profile.label,
          icon,
          disabled,
          hint,
          onClick: () => {
            if (disabled) return
            onSelect(nodeId, profile, anchor)
          }
        }
      })
    : [
        {
          label: detection.loading ? copy.detectingProfiles : copy.profilesUnavailable,
          icon,
          disabled: true,
          hint:
            detection.error ??
            (detection.initialized ? copy.noProfilesDetected : copy.detectionPending),
          onClick: () => {}
        }
      ]

  return {
    type: 'submenu',
    label: restartPending ? copy.restartProgress : copy.restartMenuLabel,
    icon,
    children
  }
}
