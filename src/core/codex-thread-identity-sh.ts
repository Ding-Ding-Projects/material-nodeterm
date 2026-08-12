/** POSIX-sh prelude shared by Codex hooks and both NodeTerm agent shims. Mapping files are parsed
 * as data, never sourced as shell code, and both fields are revalidated after reading. Kept free
 * of Node/Electron imports because the generated-script cores are shared by desktop and server. */
export const CODEX_THREAD_IDENTITY_RESOLVER_SH = `# A shared-app-server Codex tool shell inherits
# CODEX_THREAD_ID, not the remote TUI client's NODETERM_* env. Recover its exact node binding.
if [ -z "$NODETERM_NODE_ID" ] && [ -n "$CODEX_THREAD_ID" ]; then
  case "$CODEX_THREAD_ID" in
    *[!A-Za-z0-9._-]*) ;;
    *)
      nt_codex_scope=""
      nt_codex_map=""
      nt_codex_matches=0
      nt_codex_scan=0
      nt_codex_account_env="\${NODETERM_CODEX_ACCOUNT_ID+x}"
      if [ -n "$nt_codex_account_env" ]; then
        nt_codex_scope="\${NODETERM_CODEX_ACCOUNT_ID:-system}"
        case "$nt_codex_scope" in
          [A-Za-z0-9]*) ;;
          *) nt_codex_scope="" ;;
        esac
        case "$nt_codex_scope" in
          ''|*[!A-Za-z0-9._-]*) nt_codex_scope="" ;;
        esac
      fi
      if [ -n "$nt_codex_account_env" ] && [ -n "$nt_codex_scope" ]; then
        nt_codex_map="$HOME/.nodeterm/codex-thread-nodes/$nt_codex_scope/$CODEX_THREAD_ID"
      fi
      # Native tool shells spawned by the shared app-server may preserve CODEX_THREAD_ID while
      # dropping the TUI's account env. They can also preserve an explicitly empty account value
      # from an older/system TUI after a cross-account import. Only for missing/empty account env,
      # resolve a unique owner across every scope; explicit account scopes never cross boundaries.
      if [ -z "$nt_codex_account_env" ] || [ -z "\${NODETERM_CODEX_ACCOUNT_ID:-}" ]; then
        nt_codex_scan=1
      fi
      if [ "$nt_codex_scan" -eq 1 ]; then
        nt_codex_map=""
        nt_codex_matches=0
        for nt_codex_candidate in "$HOME/.nodeterm/codex-thread-nodes"/*/"$CODEX_THREAD_ID"; do
          if [ -r "$nt_codex_candidate" ]; then
            nt_codex_matches=$((nt_codex_matches + 1))
            nt_codex_map="$nt_codex_candidate"
          fi
        done
        nt_codex_legacy_map="$HOME/.nodeterm/codex-thread-nodes/$CODEX_THREAD_ID"
        if [ -r "$nt_codex_legacy_map" ]; then
          nt_codex_matches=$((nt_codex_matches + 1))
          nt_codex_map="$nt_codex_legacy_map"
        fi
        if [ "$nt_codex_matches" -eq 1 ]; then
          if [ "$nt_codex_map" = "$nt_codex_legacy_map" ]; then
            nt_codex_scope=system
          else
            nt_codex_scope="\${nt_codex_map%/*}"
            nt_codex_scope="\${nt_codex_scope##*/}"
          fi
          case "$nt_codex_scope" in
            [A-Za-z0-9]*) ;;
            *) nt_codex_scope=""; nt_codex_map="" ;;
          esac
          case "$nt_codex_scope" in
            ''|*[!A-Za-z0-9._-]*) nt_codex_scope=""; nt_codex_map="" ;;
          esac
        else
          nt_codex_map=""
          nt_codex_scope=""
        fi
      fi
      # Pre-multi-account system sessions used the global file. Managed accounts must NEVER use
      # that fallback: an equal thread id in another account would resolve to the wrong node.
      if [ -n "$nt_codex_account_env" ] && [ "$nt_codex_scope" = system ] &&
         [ ! -r "$nt_codex_map" ]; then
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
