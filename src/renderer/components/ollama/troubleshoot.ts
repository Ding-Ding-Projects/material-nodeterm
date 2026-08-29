// Bundled, offline per-platform install/start guidance for the Ollama troubleshooter. Plain
// strings baked into the build — no network fetch, so this works even when Ollama itself (and
// therefore any online help) is unreachable. See docs/ollama-manager.md.

import type { OllamaHealth } from '@shared/ollama'

export interface TroubleshootStep {
  label: string
  command?: string
}

/**
 * `health`, when passed, tailors WHICH steps show — not just the wording. "not installed",
 * "unreachable" (timeout/abort — genuinely don't know if it's installed) and "unhealthy" all show
 * the full install-then-start-then-verify sequence; `'stopped'` (real evidence the binary is
 * already on disk — see core/ollama/installation.ts) skips the install step entirely and goes
 * straight to "start it". Different words alone (the health dot's message) are not the same as a
 * different NEXT ACTION — someone whose Ollama is merely stopped does not need a download link.
 * Omitting `health` (or passing an 'ok'/'unknown'/'checking' value, which never reaches here in
 * practice) preserves the original always-show-everything behavior.
 */
export function troubleshootSteps(platform: string, health?: OllamaHealth): TroubleshootStep[] {
  const knownInstalled = health === 'stopped'
  if (platform === 'darwin') {
    const steps: TroubleshootStep[] = []
    if (!knownInstalled) {
      steps.push(
        { label: 'Install Ollama (Homebrew)', command: 'brew install ollama' },
        { label: 'Or download the macOS app', command: 'https://ollama.com/download/mac' }
      )
    }
    steps.push(
      { label: 'Start the Ollama service', command: 'ollama serve' },
      { label: 'Verify it is listening', command: 'curl http://127.0.0.1:11434' }
    )
    return steps
  }
  if (platform === 'win32') {
    const steps: TroubleshootStep[] = []
    if (!knownInstalled) {
      steps.push({ label: 'Download the Windows installer', command: 'https://ollama.com/download/windows' })
    }
    steps.push(
      { label: 'Ollama starts automatically after install — check the system tray icon' },
      { label: 'Verify it is listening (PowerShell)', command: 'curl http://127.0.0.1:11434' }
    )
    return steps
  }
  const steps: TroubleshootStep[] = []
  if (!knownInstalled) {
    steps.push({ label: 'Install Ollama', command: 'curl -fsSL https://ollama.com/install.sh | sh' })
  }
  steps.push(
    { label: 'Start the service', command: 'sudo systemctl start ollama' },
    { label: 'Or run it directly in a terminal', command: 'ollama serve' },
    { label: 'Verify it is listening', command: 'curl http://127.0.0.1:11434' }
  )
  return steps
}
