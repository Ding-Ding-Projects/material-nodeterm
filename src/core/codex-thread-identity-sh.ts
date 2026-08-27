/**
 * POSIX-sh prelude shared by managed hooks and the two agent shims.
 *
 * A tool shell spawned by the shared Codex app-server inherits `CODEX_THREAD_ID`, but it may not
 * inherit the node, hook endpoint, or account environment of the TUI client that launched it. The
 * record is parsed as data, never sourced, and every field is revalidated before export. Scoped
 * account records are preferred; a missing or explicitly empty account may recover only a UNIQUE
 * owner across all scopes, while an explicit managed account never crosses its boundary.
 *
 * This file deliberately has no Node/Electron dependency beyond the quoted root supplied by its
 * caller. Local managed hooks bake in `CorePlatform.userDataDir`; the exported constant retains
 * the `$HOME/.nodeterm` layout used by remote shims.
 */
import { posixQuote } from '../shared/ssh'

function buildResolver(
  rootAssignment: string,
  legacyMap: string,
  scopedMap: string
): string {
  return `# A shared-app-server Codex tool shell inherits CODEX_THREAD_ID, not the TUI client's
# NODETERM_* env. Recover this thread's exact node binding, or change nothing at all.
if [ -z "\${NODETERM_NODE_ID-}" ] && [ -n "\${CODEX_THREAD_ID-}" ]; then
  case "$CODEX_THREAD_ID" in
    # '.' and '..' match the charset but are path segments, so refuse them by name too.
    ''|.|..|*[!A-Za-z0-9._-]*) ;;
    *)
      ${rootAssignment}
      nt_codex_map=""
      nt_codex_scope=""
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
        nt_codex_map=${scopedMap}
      fi
      # Native tool shells may drop the account env, and older/system clients may preserve an
      # explicitly empty value after a cross-account import. Only those two shapes may discover a
      # unique owner across scopes; an explicit managed scope never crosses into another account.
      if [ -z "$nt_codex_account_env" ] || [ -z "\${NODETERM_CODEX_ACCOUNT_ID:-}" ]; then
        nt_codex_scan=1
      fi
      if [ "$nt_codex_scan" -eq 1 ]; then
        nt_codex_map=""
        nt_codex_matches=0
        for nt_codex_candidate in "$nt_codex_root"/*/"$CODEX_THREAD_ID"; do
          if [ -r "$nt_codex_candidate" ]; then
            nt_codex_matches=$((nt_codex_matches + 1))
            nt_codex_map="$nt_codex_candidate"
          fi
        done
        nt_codex_legacy_map=${legacyMap}
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
      # The modern system scope may still fall back to the pre-account flat record. Managed
      # accounts must never do so: an equal thread id in another account would resolve wrongly.
      if [ -n "$nt_codex_account_env" ] && [ "$nt_codex_scope" = system ] &&
         [ ! -r "$nt_codex_map" ]; then
        nt_codex_map=${legacyMap}
      fi
      if [ -n "$nt_codex_map" ] && [ -r "$nt_codex_map" ]; then
        nt_codex_file_scope=$(sed -n 's/^accountId=//p' "$nt_codex_map" | head -n 1)
        nt_codex_node=$(sed -n 's/^nodeId=//p' "$nt_codex_map" | head -n 1)
        nt_codex_endpoint=$(sed -n 's/^endpoint=//p' "$nt_codex_map" | head -n 1)
        # Legacy flat files omit accountId. Every scoped record must match its directory.
        if [ "$nt_codex_map" != "$nt_codex_legacy_map" ] &&
           [ "$nt_codex_file_scope" != "$nt_codex_scope" ]; then
          nt_codex_node=""
        fi
        case "$nt_codex_node" in ''|*[!A-Za-z0-9._-]*) nt_codex_node="" ;; esac
        # The Node writer and its bounded legacy migration both persist this one POSIX spelling.
        # The generated resolver has no second interpretation path and consumes only that form.
        case "$nt_codex_endpoint" in /*) ;; *) nt_codex_endpoint="" ;; esac
        case "$nt_codex_endpoint" in *[!A-Za-z0-9._/ -]*) nt_codex_endpoint="" ;; esac
        case "/$nt_codex_endpoint/" in */../*|*/./*) nt_codex_endpoint="" ;; esac
        if [ -n "$nt_codex_node" ] && [ -n "$nt_codex_endpoint" ]; then
          NODETERM_NODE_ID="$nt_codex_node"
          NODETERM_HOOK_ENDPOINT="$nt_codex_endpoint"
          NODETERM_AGENT_ID=codex
          NODETERM_CANVAS_CONTROL=1
          export NODETERM_NODE_ID NODETERM_HOOK_ENDPOINT NODETERM_AGENT_ID NODETERM_CANVAS_CONTROL
        fi
      fi
      ;;
  esac
fi`
}

/** Build the resolver for the app-owned identity root supplied by `CorePlatform`. */
export function codexThreadIdentityResolverSh(identityRoot: string): string {
  const root = posixQuote(identityRoot)
  return buildResolver(
    `nt_codex_root=${root}`,
    `${root}/"$CODEX_THREAD_ID"`,
    `${root}/"$nt_codex_scope"/"$CODEX_THREAD_ID"`
  )
}

/** `$HOME`-rooted form used by the remote context-link and canvas-control shims. */
export const CODEX_THREAD_IDENTITY_RESOLVER_SH = buildResolver(
  'nt_codex_root="$HOME/.nodeterm/codex-thread-nodes"',
  '"$HOME/.nodeterm/codex-thread-nodes/$CODEX_THREAD_ID"',
  '"$HOME/.nodeterm/codex-thread-nodes/$nt_codex_scope/$CODEX_THREAD_ID"'
)
