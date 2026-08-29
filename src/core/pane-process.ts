import { isShellCommand } from '../shared/agents/pane'

export interface PaneProcess {
  panePid: number
  command: string
}

/** Parse the small tmux record used before terminating a foreground agent. */
export function parsePaneProcess(value: string): PaneProcess | null {
  const line = value.trim()
  const split = line.indexOf('|')
  if (split <= 0) return null
  const panePid = Number(line.slice(0, split))
  const command = line.slice(split + 1).trim()
  if (!Number.isSafeInteger(panePid) || panePid <= 0 || !command) return null
  return { panePid, command }
}

/** Validate the foreground process group before signalling it. Never target the pane shell. */
export function foregroundProcessGroup(pane: PaneProcess, value: string): number | null {
  if (isShellCommand(pane.command)) return null
  const processGroup = Number(value.trim())
  if (
    !Number.isSafeInteger(processGroup) ||
    processGroup <= 0 ||
    processGroup === pane.panePid
  ) return null
  return processGroup
}
