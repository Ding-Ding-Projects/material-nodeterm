// Installs the outbound canvas-control CLI + per-agent discovery docs. Mirrors
// context-link.ts: a self-contained POSIX-sh CLI (nodeterm.sh) POSTs to the hook server's
// /control/* routes; a Claude skill / codex-gemini instruction blocks tell the agent how +
// when to call it. The CLI no-ops unless NODETERM_CANVAS_CONTROL is set.
//
// The SSH counterpart of this file is RemoteHooks.installCanvasControl, which writes the very
// same shim + skill onto the remote host — the shim carries no machine-specific paths, so one
// script serves both sides.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import {
  CONTROL_SHIM_SCRIPT,
  buildCanvasControlInstructions,
  buildCanvasSkillBody,
  mergeCanvasControlBlock
} from './canvas-control-core'
import { opencodeConfigDir } from '../core/agents/hooks/opencode'
import { copilotHomeDir } from '../core/agents/hooks/copilot'
import { renameAtomicSync } from '../core/fs-atomic'

function dir(): string {
  return path.join(app.getPath('userData'), 'canvas-control')
}
function shimPath(): string {
  return path.join(dir(), 'nodeterm.sh')
}
function skillPathIn(configDir: string): string {
  return path.join(configDir, 'skills', 'manage-nodeterm-canvas', 'SKILL.md')
}
function systemClaudeConfigDir(): string {
  return path.join(os.homedir(), '.claude')
}
function skillBody(): string {
  return buildCanvasSkillBody(shimPath())
}

function sameDirectory(a: string, b: string): boolean {
  try {
    return path.resolve(fs.realpathSync(a)) === path.resolve(fs.realpathSync(b))
  } catch {
    return path.resolve(a) === path.resolve(b)
  }
}

function nextSkillsBackup(target: string): string {
  const first = `${target}.bak`
  const occupied = (candidate: string): boolean => {
    try {
      fs.lstatSync(candidate)
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
  }
  if (!occupied(first)) return first
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${target}.bak-${i}`
    if (!occupied(candidate)) return candidate
  }
  throw new Error(`could not choose a backup path for ${target}`)
}

/**
 * Claude resolves user skills relative to CLAUDE_CONFIG_DIR. Managed accounts therefore need a
 * live link to the system skills directory, not a one-time copy of nodeterm's own skill. Moving
 * an older account-local directory aside preserves custom skills while making later system skill
 * additions visible to the account too. Windows uses a junction because it does not require the
 * developer-mode privilege that a directory symlink would need.
 */
function linkManagedSkills(configDir: string, sharedSkillsDir: string): void {
  const target = path.join(configDir, 'skills')
  if (sameDirectory(target, sharedSkillsDir)) return

  fs.mkdirSync(configDir, { recursive: true })
  let hadExisting = false
  try {
    fs.lstatSync(target)
    hadExisting = true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  const backup = hadExisting ? nextSkillsBackup(target) : undefined
  if (backup) renameAtomicSync(target, backup)
  try {
    fs.symlinkSync(sharedSkillsDir, target, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (e) {
    if (backup) {
      try {
        renameAtomicSync(backup, target)
      } catch {
        /* preserve the original failure while leaving the backup recoverable */
      }
    }
    throw e
  }
}

function writeCliFiles(): void {
  const d = dir()
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(shimPath(), CONTROL_SHIM_SCRIPT)
  try {
    fs.chmodSync(shimPath(), 0o755)
  } catch {
    /* fail open */
  }
  // Sweep the retired Electron-as-Node CLI off upgraders' disks — the shim no longer execs it,
  // so it would sit there forever pointing at a binary path that moves with every app update.
  try {
    fs.rmSync(path.join(d, 'canvas-control-cli.mjs'), { force: true })
  } catch {
    /* fail open */
  }
}

/**
 * Install (or refresh) the canvas-control skill into the system Claude skills directory, then
 * expose that same directory to managed account config dirs. Claude Code resolves user skills
 * relative to CLAUDE_CONFIG_DIR, so copying one generated skill into an account hid every other
 * user skill. Best-effort, with any replaced account-local directory moved aside first.
 */
export function installCanvasSkillInto(configDir: string): void {
  try {
    const systemConfigDir = systemClaudeConfigDir()
    const sharedSkillsDir = path.join(systemConfigDir, 'skills')
    fs.mkdirSync(sharedSkillsDir, { recursive: true })
    fs.writeFileSync(skillPathIn(systemConfigDir), skillBody(), 'utf8')
    if (!sameDirectory(configDir, systemConfigDir)) linkManagedSkills(configDir, sharedSkillsDir)
  } catch (e) {
    console.warn('[canvas-control] skill install failed', configDir, e)
  }
}

// Codex/Gemini/Copilot/opencode use global instruction files here — merge the canvas-control block
// instruction files (marker-delimited, idempotent, other content preserved). Same pattern
// as context-link's get-linked-context block. The CLI env-gate keeps the block inert in
// the user's normal (non-nodeterm) codex/gemini/opencode sessions.
function installAgentInstructions(): void {
  const block = buildCanvasControlInstructions(shimPath())
  const targets = [
    path.join(os.homedir(), '.codex', 'AGENTS.md'),
    path.join(os.homedir(), '.gemini', 'GEMINI.md'),
    path.join(copilotHomeDir(), 'copilot-instructions.md'),
    path.join(opencodeConfigDir(), 'AGENTS.md')
  ]
  for (const p of targets) {
    try {
      let existing = ''
      try {
        existing = fs.readFileSync(p, 'utf8')
      } catch {
        /* new file */
      }
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, mergeCanvasControlBlock(existing, block), 'utf8')
    } catch (e) {
      console.warn('[canvas-control] instructions install failed', p, e)
    }
  }
}

export function initCanvasControl(): void {
  try {
    writeCliFiles()
    installCanvasSkillInto(systemClaudeConfigDir())
    installAgentInstructions()
  } catch (e) {
    console.error('[canvas-control] setup failed', e)
  }
}
