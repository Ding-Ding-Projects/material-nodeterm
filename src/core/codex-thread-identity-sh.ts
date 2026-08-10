/** POSIX-sh prelude shared by Codex hooks and both NodeTerm agent shims. Mapping files are parsed
 * as data, never sourced as shell code, and both fields are revalidated after reading. Kept free
 * of Node/Electron imports because the generated-script cores are shared by desktop and server. */
export const CODEX_THREAD_IDENTITY_RESOLVER_SH = `# A shared-app-server Codex tool shell inherits
# CODEX_THREAD_ID, not the remote TUI client's NODETERM_* env. Recover its exact node binding.
if [ -z "$NODETERM_NODE_ID" ] && [ -n "$CODEX_THREAD_ID" ]; then
  case "$CODEX_THREAD_ID" in
    *[!A-Za-z0-9._-]*) ;;
    *)
      nt_codex_scope="\${NODETERM_CODEX_ACCOUNT_ID:-system}"
      case "$nt_codex_scope" in
        [A-Za-z0-9]*) ;;
        *) nt_codex_scope="" ;;
      esac
      case "$nt_codex_scope" in
        ''|*[!A-Za-z0-9._-]*) nt_codex_scope="" ;;
      esac
      nt_codex_map=""
      if [ -n "$nt_codex_scope" ]; then
        nt_codex_map="$HOME/.nodeterm/codex-thread-nodes/$nt_codex_scope/$CODEX_THREAD_ID"
      fi
      # Pre-multi-account system sessions used the global file. Managed accounts must NEVER use
      # that fallback: an equal thread id in another account would resolve to the wrong node.
      if [ "$nt_codex_scope" = system ] && [ ! -r "$nt_codex_map" ]; then
        nt_codex_map="$HOME/.nodeterm/codex-thread-nodes/$CODEX_THREAD_ID"
      fi
      if [ -n "$nt_codex_map" ] && [ -r "$nt_codex_map" ]; then
        nt_codex_file_scope=$(sed -n 's/^accountId=//p' "$nt_codex_map" | head -n 1)
        nt_codex_node=$(sed -n 's/^nodeId=//p' "$nt_codex_map" | head -n 1)
        nt_codex_endpoint=$(sed -n 's/^endpoint=//p' "$nt_codex_map" | head -n 1)
        # Legacy system files have no accountId line. Every scoped file must match its daemon.
        if [ "$nt_codex_map" != "$HOME/.nodeterm/codex-thread-nodes/$CODEX_THREAD_ID" ] &&
           [ "$nt_codex_file_scope" != "$nt_codex_scope" ]; then
          nt_codex_node=""
        fi
        case "$nt_codex_node" in ''|*[!A-Za-z0-9._-]*) nt_codex_node="" ;; esac
        case "$nt_codex_endpoint" in /*) ;; *) nt_codex_endpoint="" ;; esac
        case "$nt_codex_endpoint" in *[!A-Za-z0-9._/\\ -]*) nt_codex_endpoint="" ;; esac
        if [ -n "$nt_codex_node" ] && [ -n "$nt_codex_endpoint" ]; then
          NODETERM_NODE_ID="$nt_codex_node"
          NODETERM_HOOK_ENDPOINT="$nt_codex_endpoint"
          NODETERM_CANVAS_CONTROL=1
          export NODETERM_NODE_ID NODETERM_HOOK_ENDPOINT NODETERM_CANVAS_CONTROL
        fi
      fi
      ;;
  esac
fi`
