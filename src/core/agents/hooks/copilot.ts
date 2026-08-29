import fs from 'fs'
import os from 'os'
import path from 'path'
import { COPILOT_HOOK_EVENTS } from '@shared/agents/hook-events'
import { buildManagedHookCommand, buildManagedScript } from './install-helper'

const SCRIPT_FILE_NAME = 'copilot.sh'
export const COPILOT_HOOK_FILE = 'nodeterm-status.json'

export interface CopilotHookCommand {
  type: 'command'
  bash: string
  timeoutSec: number
  matcher?: string
}

export interface CopilotHookConfig {
  version: 1
  hooks: Record<string, CopilotHookCommand[]>
}

export function copilotHomeDir(
  env: { COPILOT_HOME?: string } = process.env,
  home = os.homedir()
): string {
  return env.COPILOT_HOME?.trim() || path.join(home, '.copilot')
}

export function copilotHookConfigPath(): string {
  return path.join(copilotHomeDir(), 'hooks', COPILOT_HOOK_FILE)
}

export function buildCopilotHookConfig(command: string): CopilotHookConfig {
  const hooks: Record<string, CopilotHookCommand[]> = {}
  for (const event of COPILOT_HOOK_EVENTS) {
    hooks[event] = [
      {
        type: 'command',
        bash: command,
        timeoutSec: 5,
        ...(event === 'Notification' ? { matcher: 'permission_prompt|elicitation_dialog' } : {})
      }
    ]
  }
  return { version: 1, hooks }
}

/** Install Copilot's native hook-file shape while keeping the managed script shared. */
export function installCopilotHooks(): void {
  const scriptPath = path.join(os.homedir(), '.nodeterm', 'agent-hooks', SCRIPT_FILE_NAME)
  try {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
    fs.writeFileSync(scriptPath, buildManagedScript('copilot'), 'utf8')
    try {
      fs.chmodSync(scriptPath, 0o755)
    } catch {
      // Some platforms do not expose executable mode bits. The hook file remains useful there.
    }
    const configPath = copilotHookConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(buildCopilotHookConfig(buildManagedHookCommand(scriptPath)), null, 2)}\n`,
      'utf8'
    )
  } catch (error) {
    console.warn('[agent-hooks] copilot install failed', error)
  }
}

export function removeCopilotHooks(): void {
  try {
    fs.writeFileSync(
      copilotHookConfigPath(),
      `${JSON.stringify({ version: 1, hooks: {} }, null, 2)}\n`,
      'utf8'
    )
  } catch {
    // Hook cleanup is best effort and must not prevent the application from starting.
  }
}
