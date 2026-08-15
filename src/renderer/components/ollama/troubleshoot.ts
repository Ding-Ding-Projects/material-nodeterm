// Bundled, offline per-platform install/start guidance for the Ollama troubleshooter. Plain
// strings baked into the build — no network fetch, so this works even when Ollama itself (and
// therefore any online help) is unreachable. See docs/ollama-manager.md.

export interface TroubleshootStep {
  label: string
  command?: string
}

export function troubleshootSteps(platform: string): TroubleshootStep[] {
  if (platform === 'darwin') {
    return [
      { label: 'Install Ollama (Homebrew)', command: 'brew install ollama' },
      { label: 'Or download the macOS app', command: 'https://ollama.com/download/mac' },
      { label: 'Start the Ollama service', command: 'ollama serve' },
      { label: 'Verify it is listening', command: 'curl http://127.0.0.1:11434' }
    ]
  }
  if (platform === 'win32') {
    return [
      { label: 'Download the Windows installer', command: 'https://ollama.com/download/windows' },
      { label: 'Ollama starts automatically after install — check the system tray icon' },
      { label: 'Verify it is listening (PowerShell)', command: 'curl http://127.0.0.1:11434' }
    ]
  }
  return [
    { label: 'Install Ollama', command: 'curl -fsSL https://ollama.com/install.sh | sh' },
    { label: 'Start the service', command: 'sudo systemctl start ollama' },
    { label: 'Or run it directly in a terminal', command: 'ollama serve' },
    { label: 'Verify it is listening', command: 'curl http://127.0.0.1:11434' }
  ]
}
