/**
 * Every disabled control in the Minecraft server panel names its exact unmet condition — a
 * disabled button with no explanation reads as broken, not as blocked. Kept pure and separate
 * from the panel so it is testable without mounting React, and so the panel never computes a
 * reason string inline (which is how a control silently loses its explanation in a later edit).
 *
 * Each function returns `null` when the control is fully enabled, or the exact reason(s) it is
 * not — joined into one sentence when more than one condition is unmet, because a user fixing
 * only the first one and hitting a second unexplained block is the same defect one step later.
 */

import type { MinecraftServerStatus } from '@shared/minecraft'

function join(reasons: string[]): string | null {
  if (reasons.length === 0) return null
  if (reasons.length === 1) return reasons[0]
  return reasons.map((r) => r.replace(/\.$/, '')).join(', and ') + '.'
}

export function createServerDisabledReason(input: {
  busy: boolean
  selectedVersion: string
  selectedDir: string
}): string | null {
  if (input.busy) return null // busy is a transient state, not a blocked one — no explanation needed
  const reasons: string[] = []
  if (!input.selectedVersion) reasons.push('Choose a Minecraft version first.')
  if (!input.selectedDir) reasons.push('Choose a server folder first.')
  return join(reasons)
}

export function startServerDisabledReason(input: { busy: boolean; status: MinecraftServerStatus }): string | null {
  if (input.busy) return null
  if (!input.status.javaOk) {
    return input.status.installedJavaMajor === null
      ? 'No Java runtime is installed yet — Java will be installed automatically when you start the server.'
      : (input.status.javaReason ?? 'The installed Java runtime is not compatible with this Minecraft version.')
  }
  return null
}

export function acceptEulaDisabledReason(input: { busy: boolean; eulaChecked: boolean }): string | null {
  if (input.busy) return null
  if (!input.eulaChecked) return 'Check the box above to confirm you have read and accept the Minecraft EULA.'
  return null
}

export function sendCommandDisabledReason(input: { phase: MinecraftServerStatus['phase']; commandDraft: string }): string | null {
  if (input.phase !== 'running') return 'The server is not running.'
  if (!input.commandDraft.trim()) return 'Type a command to send it.'
  return null
}

export function stopServerDisabledReason(input: { phase: MinecraftServerStatus['phase'] }): string | null {
  if (input.phase !== 'running') return 'The server is not running.'
  return null
}
