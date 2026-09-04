/**
 * The Codex-sandbox self-diagnosis both generated sh shims share (issue #367).
 *
 * Codex's command sandbox can deny network connect() when its network policy is disabled.
 * A disabled network policy may reject every address family, including local sockets. Curl then
 * exits nonzero or reports HTTP 000 while the nodeterm hook server remains healthy, and the
 * shims' generic "nodeterm unreachable" message would send an agent toward the wrong recovery.
 *
 * Codex exports `CODEX_SANDBOX_NETWORK_DISABLED=1` into a sandboxed command, so the shims can
 * distinguish this state and recommend one bounded command-specific escalated retry.
 *
 * The message text lives in exported constants so the agent-facing docs and generated shims carry
 * the same sentences. The fragment is exercised against a real shell in the shim test suites.
 */

/** Line 1: what actually failed, and what not to do about it. */
export const CODEX_SANDBOX_BLOCKED_LINE =
  "Codex's sandbox blocked this connection to nodeterm. nodeterm itself is running; do not relink or restart it."

/** Line 2: the one bounded recovery action. */
export const CODEX_SANDBOX_RETRY_LINE =
  'Retry the SAME command once with command-specific escalated permissions (approve the escalation prompt for this command).'

/**
 * POSIX-sh fragment defining `nt_codex_sandbox_hint`: prints the actionable error to stderr and
 * returns 0 when the sandbox is the diagnosis, or 1 without output otherwise. Callers use
 * `nt_codex_sandbox_hint || echo "<the old generic message>" >&2`, so a genuine unreachable state
 * keeps its original message.
 */
export const CODEX_SANDBOX_HINT_SH = `# Codex-sandbox self-diagnosis (issue #367). Codex exports CODEX_SANDBOX_NETWORK_DISABLED=1 into
# every sandboxed command; when it is present, a dead transport (curl exit != 0 / HTTP 000) means
# the sandbox denied connect(), and the generic "unreachable" message would misdirect the agent into
# relinking or restarting a healthy server. Prints the actionable error and returns 0 only in that
# state; callers fall back to their own generic message on 1.
nt_codex_sandbox_hint() {
  [ -n "$CODEX_SANDBOX_NETWORK_DISABLED" ] || return 1
  echo "${CODEX_SANDBOX_BLOCKED_LINE}" >&2
  echo "${CODEX_SANDBOX_RETRY_LINE}" >&2
  return 0
}`
