import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { homedir } from 'os'
import path from 'path'

const SAFE_NODE_ID = /^[A-Za-z0-9._-]+$/
const SAFE_ENDPOINT = /^\/[A-Za-z0-9._/ -]+$/
const SAFE_THREAD_ID = /^[A-Za-z0-9._-]+$/
const SAFE_ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SYSTEM_ACCOUNT_SCOPE = 'system'

function accountScope(accountId?: string): string {
  if (!accountId) return SYSTEM_ACCOUNT_SCOPE
  if (!SAFE_ACCOUNT_ID.test(accountId)) throw new Error('Invalid NodeTerm Codex account identity')
  return accountId
}

function identityFile(threadId: string, accountId?: string): string {
  if (!SAFE_THREAD_ID.test(threadId)) throw new Error('Invalid NodeTerm Codex thread identity')
  return path.join(
    homedir(),
    '.nodeterm',
    'codex-thread-nodes',
    accountScope(accountId),
    threadId
  )
}

/**
 * Recover a persisted Codex thread owner after the Electron main process restarts.
 * Browser-use requests carry the Codex thread/session id but no account id, so an equal
 * thread id in multiple account scopes is deliberately treated as ambiguous. Duplicate
 * legacy + scoped-system records for the same node remain safe and resolve to that node.
 */
export function resolveCodexThreadNodeIdentity(
  threadId: string,
  root = path.join(homedir(), '.nodeterm', 'codex-thread-nodes')
): string | undefined {
  if (!SAFE_THREAD_ID.test(threadId)) return undefined
  const candidates: Array<{ file: string; scope?: string }> = [
    { file: path.join(root, threadId) }
  ]
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SAFE_ACCOUNT_ID.test(entry.name)) continue
      candidates.push({ file: path.join(root, entry.name, threadId), scope: entry.name })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
  }

  const owners = new Set<string>()
  for (const candidate of candidates) {
    try {
      const identity = parseCodexThreadIdentity(readFileSync(candidate.file, 'utf8'))
      if (candidate.scope && identity.accountId !== candidate.scope) continue
      if (!candidate.scope && identity.accountId) continue
      if (!validCodexIdentity(identity.nodeId, identity.hookEndpoint)) continue
      owners.add(identity.nodeId)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue
    }
  }
  return owners.size === 1 ? owners.values().next().value : undefined
}

export function writeCodexThreadIdentity(
  threadId: string,
  nodeId: string,
  hookEndpoint: string,
  accountId?: string
): void {
  if (!SAFE_THREAD_ID.test(threadId) || !validCodexIdentity(nodeId, hookEndpoint)) {
    throw new Error('Invalid NodeTerm Codex thread identity')
  }
  const scope = accountScope(accountId)
  const file = identityFile(threadId, accountId)
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${threadId}.${process.pid}.${Date.now()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  let renamed = false
  try {
    writeFileSync(tmp, `accountId=${scope}\nnodeId=${nodeId}\nendpoint=${hookEndpoint}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(tmp, file)
    renamed = true
    removeOtherCodexThreadIdentities(nodeId, threadId, scope)
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
  isNodeLive: (nodeId: string) => boolean,
  accountId?: string
): void {
  if (!SAFE_THREAD_ID.test(threadId) || !validCodexIdentity(nodeId, hookEndpoint)) {
    throw new Error('Invalid NodeTerm Codex thread identity')
  }
  const scope = accountScope(accountId)
  const scopedFile = identityFile(threadId, accountId)
  // System-account sessions created by the previous NodeTerm build used the unscoped legacy file.
  // Inspect it for duplicate ownership, but never consult it for a managed account.
  const files = accountId
    ? [scopedFile]
    : [scopedFile, path.join(homedir(), '.nodeterm', 'codex-thread-nodes', threadId)]
  for (const file of files) {
    try {
      const existing = parseCodexThreadIdentity(readFileSync(file, 'utf8'))
      if (file === scopedFile && existing.accountId !== scope) {
        throw new Error('Codex thread account binding is invalid')
      }
      if (existing.nodeId === nodeId && existing.hookEndpoint === hookEndpoint) {
        removeOtherCodexThreadIdentities(nodeId, threadId, scope)
        return
      }
      if (existing.nodeId && isNodeLive(existing.nodeId)) {
        throw new Error('Codex thread is already bound to another live node')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  writeCodexThreadIdentity(threadId, nodeId, hookEndpoint, accountId)
}

/** Read-only preflight for an in-TUI resume. A stale owner may be replaced after the app-server
 * succeeds; a different LIVE owner must block before the request reaches that server. */
export function codexThreadIdentityHasLiveConflict(
  threadId: string,
  nodeId: string,
  isNodeLive: (nodeId: string) => boolean,
  accountId?: string
): boolean {
  if (!SAFE_THREAD_ID.test(threadId) || !SAFE_NODE_ID.test(nodeId)) return true
  const scopedFile = identityFile(threadId, accountId)
  const files = accountId
    ? [scopedFile]
    : [scopedFile, path.join(homedir(), '.nodeterm', 'codex-thread-nodes', threadId)]
  for (const file of files) {
    try {
      const existing = parseCodexThreadIdentity(readFileSync(file, 'utf8'))
      if (file === scopedFile && existing.accountId !== accountScope(accountId)) return true
      if (existing.nodeId && existing.nodeId !== nodeId && isNodeLive(existing.nodeId)) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true
    }
  }
  return false
}

/** One canvas node owns one current Codex conversation. A successful replacement binding is the
 * atomic lifecycle boundary: only then remove older mappings for that same node. This leaves the
 * source mapping intact if a cross-account fork or target launch fails, but releases it as soon as
 * the target launcher binds successfully. */
function removeOtherCodexThreadIdentities(
  nodeId: string,
  keepThreadId: string,
  keepScope: string
): void {
  const root = path.join(homedir(), '.nodeterm', 'codex-thread-nodes')
  const candidates: Array<{ file: string; scope: string }> = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && SAFE_THREAD_ID.test(entry.name)) {
        candidates.push({ file: path.join(root, entry.name), scope: SYSTEM_ACCOUNT_SCOPE })
        continue
      }
      if (!entry.isDirectory() || !SAFE_ACCOUNT_ID.test(entry.name)) continue
      for (const thread of readdirSync(path.join(root, entry.name), { withFileTypes: true })) {
        if (thread.isFile() && SAFE_THREAD_ID.test(thread.name)) {
          candidates.push({ file: path.join(root, entry.name, thread.name), scope: entry.name })
        }
      }
    }
  } catch {
    return
  }
  for (const candidate of candidates) {
    if (candidate.scope === keepScope && path.basename(candidate.file) === keepThreadId) continue
    try {
      const identity = parseCodexThreadIdentity(readFileSync(candidate.file, 'utf8'))
      if (identity.nodeId === nodeId) unlinkSync(candidate.file)
    } catch {
      // A concurrent external cleanup or malformed legacy record is not ours to remove.
    }
  }
}

function parseCodexThreadIdentity(raw: string): {
  accountId: string
  nodeId: string
  hookEndpoint: string
} {
  const values = Object.fromEntries(
    raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=')
        return separator < 1 ? ['', ''] : [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
  return {
    accountId: values.accountId ?? '',
    nodeId: values.nodeId ?? '',
    hookEndpoint: values.endpoint ?? ''
  }
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
      `case "\${NODETERM_CODEX_ACCOUNT_ID-}" in *[!A-Za-z0-9._-]*) echo "NodeTerm Codex account identity unavailable" >&2; exit 64 ;; esac\n` +
      `case "\${NODETERM_CODEX_ACCOUNT_ID-}" in ''|[A-Za-z0-9]*) ;; *) echo "NodeTerm Codex account identity unavailable" >&2; exit 64 ;; esac\n` +
      `[ "\${NODETERM_CANVAS_CONTROL-}" = 1 ] || { echo "NodeTerm Codex identity unavailable" >&2; exit 64; }\n` +
      `if [ "\${1-}" = resume ]; then\n` +
      `  nt_thread="\${2-}"\n` +
      `  case "$nt_thread" in ''|*[!A-Za-z0-9._-]*) echo "NodeTerm Codex thread identity unavailable" >&2; exit 64 ;; esac\n` +
      `fi\n` +
      `. "$NODETERM_HOOK_ENDPOINT" 2>/dev/null || { echo "NodeTerm Codex broker unavailable" >&2; exit 69; }\n` +
      `case "\${NODETERM_HOOK_PORT-}" in ''|*[!0-9]*) echo "NodeTerm Codex broker unavailable" >&2; exit 69 ;; esac\n` +
      `case "\${NODETERM_HOOK_TOKEN-}" in ''|*[!A-Za-z0-9-]*) echo "NodeTerm Codex broker unavailable" >&2; exit 69 ;; esac\n` +
      `codex app-server daemon start >/dev/null 2>&1 || { echo "NodeTerm Codex app-server unavailable" >&2; exit 69; }\n` +
      `nt_register_relay() {\n` +
      `  case "\${NODETERM_CODEX_RELAY_RUNTIME-}" in /*) ;; *) return 1 ;; esac\n` +
      `  case "\${NODETERM_CODEX_RELAY_SCRIPT-}" in /*) ;; *) return 1 ;; esac\n` +
      `  [ -x "$NODETERM_CODEX_RELAY_RUNTIME" ] && [ -r "$NODETERM_CODEX_RELAY_SCRIPT" ] || return 1\n` +
      `  nt_relay_info=\n` +
      `  for nt_relay_attempt in 1 2 3; do\n` +
      `    nt_relay_info=$(ELECTRON_RUN_AS_NODE=1 "$NODETERM_CODEX_RELAY_RUNTIME" "$NODETERM_CODEX_RELAY_SCRIPT" register "$NODETERM_NODE_ID" "\${NODETERM_CODEX_ACCOUNT_ID-}" "$CODEX_HOME/app-server-control/app-server-control.sock" "$NODETERM_HOOK_ENDPOINT") && break\n` +
      `    sleep 0.2\n` +
      `  done\n` +
      `  [ -n "$nt_relay_info" ] || return 1\n` +
      `  nt_relay_url=$(printf '%s\\n' "$nt_relay_info" | sed -n '1p')\n` +
      `  NODETERM_CODEX_RELAY_TOKEN=$(printf '%s\\n' "$nt_relay_info" | sed -n '2p')\n` +
      `  case "$nt_relay_url" in ws://127.0.0.1:*/relay/*) ;; *) return 1 ;; esac\n` +
      `  [ -n "$NODETERM_CODEX_RELAY_TOKEN" ] || return 1\n` +
      `  export NODETERM_CODEX_RELAY_TOKEN\n` +
      `}\n` +
      `if [ "\${1-}" = resume ]; then\n` +
      `  { printf 'header = "X-NodeTerm-Hook-Token: %s"\\n' "$NODETERM_HOOK_TOKEN"; } |\n` +
      `  curl --silent --show-error --fail --config - --request POST \\\n` +
      `    --data-urlencode "nodeId=$NODETERM_NODE_ID" \\\n` +
      `    --data-urlencode "threadId=$nt_thread" \\\n` +
      `    --data-urlencode "accountId=\${NODETERM_CODEX_ACCOUNT_ID-}" \\\n` +
      `    "http://127.0.0.1:$NODETERM_HOOK_PORT/codex-thread/bind" >/dev/null || { echo "NodeTerm Codex thread already in use or broker unavailable" >&2; exit 69; }\n` +
      `  if [ -n "\${NODETERM_CODEX_RELAY_RUNTIME-}\${NODETERM_CODEX_RELAY_SCRIPT-}" ]; then\n` +
      `    nt_register_relay || { echo "NodeTerm Codex relay unavailable" >&2; exit 69; }\n` +
      `    exec codex --remote "$nt_relay_url" --remote-auth-token-env NODETERM_CODEX_RELAY_TOKEN "$@"\n` +
      `  fi\n` +
      `  exec codex --remote unix:// "$@"\n` +
      `fi\n` +
      `nt_thread=$(\n` +
      `  { printf 'header = "X-NodeTerm-Hook-Token: %s"\\n' "$NODETERM_HOOK_TOKEN"; } |\n` +
      `  curl --silent --show-error --fail --config - --request POST \\\n` +
      `    --data-urlencode "nodeId=$NODETERM_NODE_ID" \\\n` +
      `    --data-urlencode "cwd=$PWD" \\\n` +
      `    --data-urlencode "accountId=\${NODETERM_CODEX_ACCOUNT_ID-}" \\\n` +
      `    "http://127.0.0.1:$NODETERM_HOOK_PORT/codex-thread/start"\n` +
      `) || { echo "NodeTerm Codex broker unavailable" >&2; exit 69; }\n` +
      `nt_thread=$(printf %s "$nt_thread" | tr -d '\\r\\n')\n` +
      `if [ -n "\${NODETERM_CODEX_RELAY_RUNTIME-}\${NODETERM_CODEX_RELAY_SCRIPT-}" ]; then\n` +
      `  nt_register_relay || { echo "NodeTerm Codex relay unavailable" >&2; exit 69; }\n` +
      `  exec codex --remote "$nt_relay_url" --remote-auth-token-env NODETERM_CODEX_RELAY_TOKEN resume "$nt_thread" "$@"\n` +
      `fi\n` +
      `exec codex --remote unix:// resume "$nt_thread" "$@"\n`,
    { encoding: 'utf8', mode: 0o700 }
  )
  chmodSync(file, 0o700)
  return file
}

export function validCodexIdentity(nodeId: string, hookEndpoint: string): boolean {
  return SAFE_NODE_ID.test(nodeId) && SAFE_ENDPOINT.test(hookEndpoint)
}
