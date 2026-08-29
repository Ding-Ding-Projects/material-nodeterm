# SSH projects

**Category:** [Remote & SSH](./README.md)

A project can point at a folder on a remote host instead of your own machine. The canvas stays
local — you keep panning, zooming, and arranging nodes the same way — while every terminal,
file operation, git command, and even the kanban board for that project actually run on the
remote host.

## Behaviour

Connecting establishes a single persistent SSH control connection to the host (an SSH
"ControlMaster"), which every subsequent operation for that project reuses rather than opening
a fresh connection per command. A remote terminal node is *never* silently spawned locally —
if the connection isn't currently available, node creation is refused outright rather than
quietly falling back to a local shell that looks identical but is running in the wrong place
with the wrong credentials.

**tmux continuity applies remotely too**: a remote terminal's session lives in a tmux server on
the remote host, so it survives the same events a local one does (switching projects, closing
the app) — a machine-reboot-equivalent event is a reboot of the *remote* host, not yours.

**Agent hooks, permission-mode gating, and managed accounts** all extend to SSH projects. An
agent's permission mode is checked against the remote host's installed CLI version, not your
local one — an old or missing CLI on the remote host degrades the mode gracefully (falling back
to no special flag) rather than either failing the launch or silently claiming a capability the
remote CLI doesn't actually have. Managed Claude accounts get their own configuration directory
on the remote host, keyed by that host, just as a local account gets one on your machine.

**Canvas control, context links, and session-memory inspection** (seeing how much memory every
`nt-*` session on a machine is using, and killing one from a list) all work across SSH the same
way they work locally, reading from the remote host over the same control connection rather
than a second, separate mechanism.

## Configuration

- Add an SSH project from the connection dialog: host, user, and the remote folder to open —
  saved server entries are reusable across projects.
- Per-project permission-mode override applies to SSH projects exactly as it does to local
  ones, resolved against that project's remote host.

## Failure modes

- **The connection is down** (network loss, host unreachable, `ssh` not installed locally):
  affected nodes show as offline with a reconnect action, rather than either hanging or
  silently switching to a local shell. This is checked on *both* sides — the UI won't even
  attempt to create a remote node without a live connection, and the underlying service refuses
  the same request independently, so a connection that drops mid-request can't slip through.
- **A read fails vs. genuinely returns nothing**: every remote read this feature performs (worktree
  status, session-memory sweeps, and more) distinguishes "the read itself failed" from "the read
  succeeded and found nothing" — collapsing those two into one signal is exactly how a healthy
  host with thirty running sessions could get reported as having none, which nodeterm's own
  design principles treat as a defect to guard against explicitly.
- **The remote host's agent CLI is older than expected**: permission modes and other
  version-gated behaviour degrade to the safe default (no special flag) rather than sending a
  flag the remote CLI doesn't understand.

## Security considerations

- Credentials for the SSH connection are your own SSH keys/agent, handled by the `ssh` binary
  itself — nodeterm doesn't store or transmit a separate copy of them.
- Every credential this feature needs to send to a remote host (a per-session hook-server
  token, for instance) travels by a 0600 file or over stdin to the remote command — never as a
  plain command-line argument, because a process's argument list is readable by other accounts
  on a shared host.
- Reads and writes stay scoped to the remote project's directory and the paths its own
  features explicitly need (transcript directories for agent hooks, for example) — never
  widened to the remote user's entire home directory.

## Verification

- Open an SSH project, create a remote terminal node, and confirm commands actually execute on
  the remote host (`hostname` should print the remote machine's name).
- Disconnect network access to the remote host, attempt to open a new remote terminal node, and
  confirm it's refused with a reconnect affordance rather than silently opening a local shell.
- Start an agent node on the SSH project and confirm its permission mode matches what the
  remote host's installed CLI version actually supports.

## Suggested articles

- [Session continuity](../terminals/session-continuity.md) — the tmux mechanics this extends
  to a remote host.
- [Agent support](../agents/agent-support.md) — the permission-mode gating referenced above.
- [Server Edition](./server-edition.md) — the other way nodeterm reaches a machine that isn't
  in front of you.
- [Source control & worktrees](../source-control/source-control-and-worktrees.md) — the stated
  v1 limitation on remote worktree operations.
