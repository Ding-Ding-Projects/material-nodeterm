# Shared Codex node identity

NodeTerm Codex nodes reuse the authenticated Codex app-server at
`~/.codex/app-server-control/app-server-control.sock`. NodeTerm must not start an app-server per
canvas node or attach one process-global canvas identity to that shared server.

## Runtime contract

For a fresh local Codex node, the generated `~/.nodeterm/bin/nodeterm-codex` launcher calls the
authenticated NodeTerm hook server before starting the TUI. The hook server:

1. creates exactly one thread on the shared Codex app-server with the node's absolute working
   directory;
2. receives the app-server's exact thread id;
3. atomically writes `~/.nodeterm/codex-thread-nodes/<thread-id>` with that node's id and live hook
   endpoint;
4. publishes an identity-only session event for the same node and thread.

Only after that succeeds does the launcher run `codex --remote unix:// resume <thread-id>`. Initial
prompt arguments remain attached to the resumed thread. Explicit NodeTerm resume commands call the
same authenticated broker to bind and publish their exact thread before launch, without creating a
new thread. A second live canvas node cannot claim an owned thread; a stale binding may move only
after its former node is absent from the loaded workspace.

Codex tool shells inherit `CODEX_THREAD_ID` from the shared server. NodeTerm hooks, linked-context,
and canvas-control shims resolve that id through the mapping file and recover the node-specific
`NODETERM_NODE_ID` and `NODETERM_HOOK_ENDPOINT`. Mapping files are owner-only and parsed as data,
never sourced as shell.

The node chrome reads `Thread.name` for the exact mapped thread from the same shared app-server.
No cwd/time/FIFO matching is allowed: two concurrent nodes in the same directory must remain
distinct.

## Failure behavior

- Missing or malformed node, hook, cwd, or thread identity fails before Codex launch.
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
- invalid/missing node, cwd, endpoint, and thread identities;
- shared-app-server thread creation and `Thread.name` reads;
- mapping recovery in hooks, canvas control, and linked context.

Before a local candidate handoff, run the node TypeScript check, focused tests, production build,
and a packaged-app smoke. NodeTerm local installation is not a production deployment and must not
publish a release or trigger a production release pipeline.
