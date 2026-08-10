import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

const SAFE_NODE_ID = /^[A-Za-z0-9._-]+$/
const SAFE_ENDPOINT = /^\/[A-Za-z0-9._/ -]+$/
const SAFE_THREAD_ID = /^[A-Za-z0-9._-]+$/

export function writeCodexThreadIdentity(
  threadId: string,
  nodeId: string,
  hookEndpoint: string
): void {
  if (!SAFE_THREAD_ID.test(threadId) || !validCodexIdentity(nodeId, hookEndpoint)) {
    throw new Error('Invalid NodeTerm Codex thread identity')
  }
  const dir = path.join(homedir(), '.nodeterm', 'codex-thread-nodes')
  const file = path.join(dir, threadId)
  const tmp = path.join(dir, `.${threadId}.${process.pid}.${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  let renamed = false
  try {
    writeFileSync(tmp, `nodeId=${nodeId}\nendpoint=${hookEndpoint}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(tmp, file)
    renamed = true
  } finally {
    if (!renamed) {
      try {
        unlinkSync(tmp)
      } catch {
        /* best effort */
      }
    }
  }
}

export function bindCodexThreadIdentity(
  threadId: string,
  nodeId: string,
  hookEndpoint: string,
  isNodeLive: (nodeId: string) => boolean
): void {
  if (!SAFE_THREAD_ID.test(threadId) || !validCodexIdentity(nodeId, hookEndpoint)) {
    throw new Error('Invalid NodeTerm Codex thread identity')
  }
  const file = path.join(homedir(), '.nodeterm', 'codex-thread-nodes', threadId)
  try {
    const existing = parseCodexThreadIdentity(readFileSync(file, 'utf8'))
    if (existing.nodeId === nodeId && existing.hookEndpoint === hookEndpoint) return
    if (existing.nodeId && isNodeLive(existing.nodeId)) {
      throw new Error('Codex thread is already bound to another live node')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  writeCodexThreadIdentity(threadId, nodeId, hookEndpoint)
}

function parseCodexThreadIdentity(raw: string): { nodeId: string; hookEndpoint: string } {
  const values = Object.fromEntries(
    raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=')
        return separator < 1 ? ['', ''] : [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
  return { nodeId: values.nodeId ?? '', hookEndpoint: values.endpoint ?? '' }
}

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
      `if [ "\${1-}" = resume ]; then\n` +
      `  nt_thread="\${2-}"\n` +
      `  case "$nt_thread" in ''|*[!A-Za-z0-9._-]*) echo "NodeTerm Codex thread identity unavailable" >&2; exit 64 ;; esac\n` +
      `fi\n` +
      `. "$NODETERM_HOOK_ENDPOINT" 2>/dev/null || { echo "NodeTerm Codex broker unavailable" >&2; exit 69; }\n` +
      `case "\${NODETERM_HOOK_PORT-}" in ''|*[!0-9]*) echo "NodeTerm Codex broker unavailable" >&2; exit 69 ;; esac\n` +
      `case "\${NODETERM_HOOK_TOKEN-}" in ''|*[!A-Za-z0-9-]*) echo "NodeTerm Codex broker unavailable" >&2; exit 69 ;; esac\n` +
      `if [ "\${1-}" = resume ]; then\n` +
      `  { printf 'header = "X-NodeTerm-Hook-Token: %s"\\n' "$NODETERM_HOOK_TOKEN"; } |\n` +
      `  curl --silent --show-error --fail --config - --request POST \\\n` +
      `    --data-urlencode "nodeId=$NODETERM_NODE_ID" \\\n` +
      `    --data-urlencode "threadId=$nt_thread" \\\n` +
      `    "http://127.0.0.1:$NODETERM_HOOK_PORT/codex-thread/bind" >/dev/null || { echo "NodeTerm Codex thread already in use or broker unavailable" >&2; exit 69; }\n` +
      `  exec codex --remote unix:// "$@"\n` +
      `fi\n` +
      `nt_thread=$(\n` +
      `  { printf 'header = "X-NodeTerm-Hook-Token: %s"\\n' "$NODETERM_HOOK_TOKEN"; } |\n` +
      `  curl --silent --show-error --fail --config - --request POST \\\n` +
      `    --data-urlencode "nodeId=$NODETERM_NODE_ID" \\\n` +
      `    --data-urlencode "cwd=$PWD" \\\n` +
      `    "http://127.0.0.1:$NODETERM_HOOK_PORT/codex-thread/start"\n` +
      `) || { echo "NodeTerm Codex broker unavailable" >&2; exit 69; }\n` +
      `nt_thread=$(printf %s "$nt_thread" | tr -d '\\r\\n')\n` +
      `exec codex --remote unix:// resume "$nt_thread" "$@"\n`,
    { encoding: 'utf8', mode: 0o700 }
  )
  chmodSync(file, 0o700)
  return file
}

export function validCodexIdentity(nodeId: string, hookEndpoint: string): boolean {
  return SAFE_NODE_ID.test(nodeId) && SAFE_ENDPOINT.test(hookEndpoint)
}
