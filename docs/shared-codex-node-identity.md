# Shared Codex node identity

NodeTerm Codex nodes reuse the authenticated Codex app-server at
`~/.codex/app-server-control/app-server-control.sock`. NodeTerm must not start an app-server per
canvas node or attach one process-global canvas identity to that shared server.

NodeTerm also supports multiple simultaneous Codex subscriptions. The sharing boundary is an
account, not a node: the system account uses `~/.codex`, while each managed account uses an
owner-only `<userData>/codex-accounts/<account-id>` home and exactly one app-server daemon. Every
node assigned to the same account reuses that account's socket; nodes assigned to different
accounts never share credentials, thread storage, or a socket. Shared non-secret Codex runtime
assets (including the standalone package used by the daemon) are symlinked into managed homes, so
adding an account does not duplicate the Codex installation.

## Runtime contract

For a fresh local Codex node, the generated `~/.nodeterm/bin/nodeterm-codex` launcher calls the
authenticated NodeTerm hook server before starting the TUI. The hook server:

1. creates exactly one thread on the shared Codex app-server with the node's absolute working
   directory;
2. receives the app-server's exact thread id;
3. atomically writes
   `~/.nodeterm/codex-thread-nodes/<system-or-account-id>/<thread-id>` with that account scope,
   node id, and live hook endpoint;
4. publishes an identity-only session event for the same node and thread.

Only after that succeeds does the launcher run `codex --remote unix:// resume <thread-id>`. Initial
prompt arguments remain attached to the resumed thread. Explicit NodeTerm resume commands call the
same authenticated broker to bind and publish their exact thread before launch, without creating a
new thread. A second live canvas node cannot claim an owned thread; a stale binding may move only
after its former node is absent from the loaded workspace.

Codex tool shells inherit `CODEX_THREAD_ID` and the managed daemon's account scope from the shared
server. NodeTerm hooks, linked-context, and canvas-control shims resolve the pair through the scoped
mapping file and recover the node-specific `NODETERM_NODE_ID` and `NODETERM_HOOK_ENDPOINT`. Mapping
files are owner-only and parsed as data, never sourced as shell. Managed accounts never consult the
old global mapping path; the system account alone accepts that path as an upgrade fallback.

The node chrome reads `Thread.name` for the exact mapped thread from the same shared app-server.
No cwd/time/FIFO matching is allowed: two concurrent nodes in the same directory must remain
distinct.

## Account UX and switching

- Settings → Accounts lists the system Codex identity and every managed identity, including the
  email returned by the account's own app-server `account/read` response.
- New Codex menus select the account before creating the node. The account id is persisted with
  the canvas node and passed through board co-attach, PTY creation, thread broker, title lookup,
  and usage lookup.
- The Usage popover renders one Codex section per identity, with its email or explicit label.
- An idle Codex node can switch accounts from its context menu. Codex authentication is process
  state, so this is not an in-place credential mutation: NodeTerm reads the source thread's rollout
  path, forks it into the target account, and resumes the new thread after recycling only that
  node. The source thread remains intact. A working node or a node without a thread id cannot be
  switched.
- A managed account cannot be removed while any non-login canvas node still uses it. Nodes must be
  switched or removed first, preventing a live process from falling back to the system identity.

## Failure behavior

- Missing or malformed node, hook, cwd, or thread identity fails before Codex launch.
- Missing or malformed account identity fails closed; it is never interpreted as a filesystem
  path. Missing managed Codex storage refuses the PTY spawn; it never falls back to another
  account. System sessions explicitly clear inherited managed scope.
- An unavailable NodeTerm broker or shared app-server fails visibly; it must not silently start an
  unbound Codex session.
- A malformed broker response is never used as a mapping filename or shell argument.
- App restarts may replace the hook endpoint, while persistent tmux/Codex sessions continue to use
  the thread mapping and source the live endpoint file.
- Local rollback app bundles must be archived outside `/Applications`. Multiple bundles with the
  same `com.nodeterm.app` identifier under `/Applications` create competing LaunchServices/TCC app
  identities and duplicate folder-access prompts.

## Verification

Focused tests cover:

- two parallel fresh nodes against one shared app-server;
- two parallel explicit resumes, mapping isolation, and duplicate-owner rejection;
- two parallel account homes and app-server sockets, plus two account-scoped broker requests;
- system plus multiple managed usage rows and cache invalidation when the account list changes;
- persisted Codex account identity across workspace serialization and board co-attach;
- invalid/missing node, cwd, endpoint, and thread identities;
- shared-app-server thread creation and `Thread.name` reads;
- mapping recovery in hooks, canvas control, and linked context.

Before a local candidate handoff, run the node TypeScript check, focused tests, production build,
and a packaged-app smoke. NodeTerm local installation is not a production deployment and must not
publish a release or trigger a production release pipeline.
