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
      // A remote TUI's config overrides are not applied to tool shells spawned by the already
      // running shared app-server. CODEX_THREAD_ID is. Bind it to this node before resume so the
      // hooks and shims can recover the exact per-node identity without a per-node server.
      `if [ "\${1-}" = resume ]; then\n` +
      `  nt_thread="\${2-}"\n` +
      `  case "$nt_thread" in ''|*[!A-Za-z0-9._-]*) echo "NodeTerm Codex thread identity unavailable" >&2; exit 64 ;; esac\n` +
      `  nt_map_dir="$HOME/.nodeterm/codex-thread-nodes"\n` +
      `  nt_map="$nt_map_dir/$nt_thread"\n` +
      `  nt_tmp="$nt_map_dir/.$nt_thread.$$"\n` +
      `  (umask 077; mkdir -p "$nt_map_dir") || exit 74\n` +
      `  (umask 077; { printf 'nodeId=%s\\n' "$NODETERM_NODE_ID"; printf 'endpoint=%s\\n' "$NODETERM_HOOK_ENDPOINT"; } > "$nt_tmp") || exit 74\n` +
      `  mv -f "$nt_tmp" "$nt_map" || { rm -f "$nt_tmp"; exit 74; }\n` +
      `fi\n` +
      `exec codex --remote unix:// "$@"\n`,
    { encoding: 'utf8', mode: 0o700 }
  )
  chmodSync(file, 0o700)
  return file
}

export function validCodexIdentity(nodeId: string, hookEndpoint: string): boolean {
  return SAFE_NODE_ID.test(nodeId) && SAFE_ENDPOINT.test(hookEndpoint)
}
