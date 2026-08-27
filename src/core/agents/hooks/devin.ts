// Devin CLI hook service. Devin's recommended `.devin/hooks.v1.json` is a direct event map, not
// the `{ hooks: ... }` wrapper used by Claude-family settings. This installer owns one managed
// command per event, preserves unrelated project hooks, and remains observation-only: it never
// emits a decision or rewrites tool input.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DEVIN_HOOK_EVENTS } from '@shared/agents/hook-events'
import { buildManagedHookCommand, installManagedHookScript } from './install-helper'
import { renameAtomicSync } from '../../fs-atomic'

const SCRIPT_FILE_NAME = 'devin.sh'
const MANAGED_MARKER = `agent-hooks/${SCRIPT_FILE_NAME}`
const MAX_PROJECT_ROOT = 4096

export interface DevinHookCommand {
  type: 'command'
  command: string
  timeout?: number
}

export interface DevinHookDefinition {
  matcher?: string
  hooks: DevinHookCommand[]
}

export type DevinHookConfig = Record<string, DevinHookDefinition[]>

export function devinProjectHookConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devin', 'hooks.v1.json')
}

function isSafeProjectRoot(projectRoot: string): boolean {
  return (
    typeof projectRoot === 'string' &&
    path.isAbsolute(projectRoot) &&
    projectRoot.length <= MAX_PROJECT_ROOT &&
    !/[\u0000-\u001f\u007f]/u.test(projectRoot)
  )
}

function isManaged(command: string | undefined): boolean {
  if (!command) return false
  return command.replaceAll('\\', '/').includes(MANAGED_MARKER)
}

function isHookDefinition(value: unknown): value is DevinHookDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const hooks = (value as { hooks?: unknown }).hooks
  return Array.isArray(hooks)
}

function hasManagedHook(value: DevinHookDefinition): boolean {
  return value.hooks.some((hook) => {
    if (!hook || typeof hook !== 'object') return false
    return isManaged((hook as { command?: unknown }).command as string | undefined)
  })
}

function readConfig(file: string): DevinHookConfig | null {
  if (!fs.existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as DevinHookConfig
  } catch {
    return null
  }
}

export function buildDevinHookConfig(
  command: string,
  existing: DevinHookConfig = {}
): DevinHookConfig {
  const next: DevinHookConfig = { ...existing }
  for (const event of DEVIN_HOOK_EVENTS) {
    const retained = Array.isArray(next[event])
      ? next[event].filter((entry) =>
          isHookDefinition(entry) && !hasManagedHook(entry)
        )
      : []
    next[event] = [
      ...retained,
      { hooks: [{ type: 'command', command, timeout: 5 }] }
    ]
  }
  return next
}

function writeConfig(file: string, config: DevinHookConfig): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameAtomicSync(temp, file)
  } finally {
    try {
      fs.unlinkSync(temp)
    } catch {
      /* already renamed or unavailable */
    }
  }
}

/** Install into a local project root. Invalid or unreadable project config is left untouched. */
export function installDevinHooksInto(projectRoot: string): boolean {
  if (!isSafeProjectRoot(projectRoot)) return false
  let stat: fs.Stats
  try {
    stat = fs.statSync(projectRoot)
  } catch {
    return false
  }
  if (!stat.isDirectory()) return false

  const script = installManagedHookScript('devin', SCRIPT_FILE_NAME)
  if (!script) return false
  const configPath = devinProjectHookConfigPath(projectRoot)
  const existing = readConfig(configPath)
  if (!existing) return false
  try {
    writeConfig(configPath, buildDevinHookConfig(buildManagedHookCommand(script), existing))
    return true
  } catch (error) {
    console.warn('[agent-hooks] devin install failed', error)
    return false
  }
}

/** The stable managed script path is useful to callers that show a local configuration status. */
export function devinManagedHookScriptPath(): string {
  return path.join(os.homedir(), '.nodeterm', 'agent-hooks', SCRIPT_FILE_NAME)
}
