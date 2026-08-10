import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const SAFE_NODE_ID = /^[A-Za-z0-9._-]+$/
const SAFE_ENDPOINT = /^\/[A-Za-z0-9._/ -]+$/

export function codexLauncherDir(): string {
  return path.join(homedir(), '.nodeterm', 'bin')
}

export function installCodexLauncher(): string {
  const dir = codexLauncherDir()
  const file = path.join(dir, 'nodeterm-codex')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    file,
    `#!/bin/sh\n` +
      `case "\${NODETERM_NODE_ID-}" in ''|*[!A-Za-z0-9._-]*) echo "NodeTerm Codex identity unavailable" >&2; exit 64 ;; esac\n` +
      `case "\${NODETERM_HOOK_ENDPOINT-}" in /*) ;; *) echo "NodeTerm Codex identity unavailable" >&2; exit 64 ;; esac\n` +
      `case "\${NODETERM_HOOK_ENDPOINT}" in *[!A-Za-z0-9._/\\ -]*) echo "NodeTerm Codex identity unavailable" >&2; exit 64 ;; esac\n` +
      `[ "\${NODETERM_CANVAS_CONTROL-}" = 1 ] || { echo "NodeTerm Codex identity unavailable" >&2; exit 64; }\n` +
      `exec codex --remote unix:// \\\n` +
      `  -c "shell_environment_policy.set.NODETERM_NODE_ID=\\"\${NODETERM_NODE_ID}\\"" \\\n` +
      `  -c "shell_environment_policy.set.NODETERM_HOOK_ENDPOINT=\\"\${NODETERM_HOOK_ENDPOINT}\\"" \\\n` +
      `  -c 'shell_environment_policy.set.NODETERM_CANVAS_CONTROL="1"' "$@"\n`,
    { encoding: 'utf8', mode: 0o700 }
  )
  chmodSync(file, 0o700)
  return file
}

export function validCodexIdentity(nodeId: string, hookEndpoint: string): boolean {
  return SAFE_NODE_ID.test(nodeId) && SAFE_ENDPOINT.test(hookEndpoint)
}
