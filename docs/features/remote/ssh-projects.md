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

**The `SSH user@host` header chip appears only where it says something new.** Inside an SSH
project every terminal on the project's own host used to carry the same chip; it is now hidden for
the nodes the project's own connection serves (the same host test as the connection id), and kept
for a node on a different host, any SSH node in a local project, and a plain `ssh` node logging in
as a different user on the project's host. A remote-tmux node saved under another user runs as the
project's user, so hiding its chip also removes a label that was wrong.

**The phone's status slice follows state edges promptly.** The per-project agent-status file
pushed to an SSH host is throttled to one write every two seconds, but a change of a node's
`state` (working, blocked, done) now ships immediately unless the previous push was less than
500 ms ago, so a short turn's `done` no longer waits behind its `working`.

**Remote writes never leave a truncated file.** Every file nodeterm writes onto a host (the hook
endpoint, node tokens, the tmux conf, agent hook scripts, the canvas and context shims and skills,
the files an editor node saves) is streamed into a sibling temporary file, checked to hold exactly
the body's byte count, and only then renamed over the target. `cat` cannot tell "the body ended"
from "the ssh channel ended", so a write cut short by a dropped link used to publish an empty file;
now it exits with a distinct status and the previous file is untouched. A file that belongs to you
(`~/.claude/settings.json`, a codex `config.toml`, an `AGENTS.md`) additionally goes through a
guarded read-modify-write that resolves symlinks, takes a lock, keeps the file's mode and refuses to
publish if the file changed since it was read. A scan (`remote-write.guard.test.ts`) fails the
suite on any new bare `cat > file` in the shells' source.

**The reverse hook tunnel is re-verified on a reused connection.** A dead ControlMaster is rebuilt
by the next command that needs it, and the rebuilt master answers `ssh -O check` but carries no
reverse tunnel, so agent status and canvas control went deaf without any visible error. Every
reuse now probes the tunnel and, when it does not answer, rebuilds it (the first repair is free,
later ones back off). Two failed probes in a row raise a warning strip — "Agent status and canvas
control lost their verified connection. Retrying automatically…" — which clears itself once a probe
or a repair succeeds; it never triggers a reconnect, and the terminals keep running.

**The host's agent tools stay current.** On every connect and tunnel repair the host computes POSIX
`cksum` over the canvas and context shims, both skills (system and each managed account pinned to
the host) and the marker span of each instruction block, in one round trip; only what differs from
this build is rewritten. A host without `cksum` is written without comparison, a file that cannot be
read is never written over, and a stray end marker no longer makes every merge append a copy. The
detailed rules are in [SSH agent skills](../../ssh-agent-skills.md).

**Concurrency and wake-up.** At most a bounded number of ssh exec children run per ControlMaster at
once, so a connect's install fan-out, a Source Control refresh and a project switch no longer push a
host past `MaxSessions` into full logins that `MaxStartups` resets. After the computer wakes from
sleep, each master is tested with a real round trip (`ssh -o ControlMaster=no … true`, 10 s); a
master whose TCP died in the sleep is told to exit so terminals reconnect at once instead of
staying frozen for a minute.

**Hook endpoint files are owned per installation.** The endpoint file written on a host is named
after this installation (`hook-endpoint-<project>-<owner>.env`), so two desktops sharing one host
account no longer overwrite each other's file. An older unqualified file is migrated only when it
holds a bearer this installation issued (the current one, the one the host file held, or the one
the previous run of this app advertised locally); anything else is left untouched.

## Configuration

- Add an SSH project from the connection dialog: host, user, and the remote folder to open —
  saved server entries are reusable across projects.
- Per-project permission-mode override applies to SSH projects exactly as it does to local
  ones, resolved against that project's remote host.

## Failure modes

- **The hook tunnel stops answering while the connection is up**: a warning strip says agent
  status and canvas control lost their verified connection and are retrying; a single slow probe
  never raises it, and it never offers Reconnect because the repair is already running.
- **A remote write is cut short** (master killed, link dropped, the runner's timeout): the host
  keeps the previous file; the write reports the exit status and the path, never the body.
- **A malformed host or user** (empty, starting with `-`, or containing whitespace or control
  characters) is refused when the ssh argument list is built, so a saved value can never be read
  by `ssh` as an option such as `-oProxyCommand=…`.
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

- **A relay tab never makes this machine dial SSH.** When another machine shares an SSH project
  over the relay, its `ssh.server` (host, user, port, identity file, extra arguments) is that
  machine's connection. The adopt boundary and every relay canvas-sync update strip the
  dial-capable connection objects (`src/renderer/session/relay-ssh.ts`), and each dial site — the
  active-project connect, the host-attachment pre-warm, the reconnect coordinator and a terminal's
  master lookup — independently refuses a relay project. The tab keeps only display strings for
  its `SSH user@host` chip; a relay SSH-project terminal is created on the sharing machine's core
  with `requireRemote`, so it joins a live session there or is refused, never spawned locally.

## Verification

- `remote-write-truncation.test.ts` runs the remote writers under a real `/bin/sh` against a fake
  host whose channel ends early, `remote-write.guard.test.ts` scans the source for bare
  `cat >` writes, `tunnel-repair.test.ts` and `ssh-project.test.ts` cover the tunnel repair and its
  two-probe report, `agent-tools-freshness.test.ts` and `agent-tools-refresh.test.ts` run the
  freshness probe under `/bin/sh`, `posix-cksum.test.ts` pins the checksum against the real
  `cksum`, `ssh-child-gate.test.ts` the per-master cap, `legacy-hook-endpoint.test.ts` the endpoint
  migration, and `SshConnectionBanner.test.tsx` the banner's tones and copy.
- `src/core/remote-ssh/control-master.destination.test.ts` proves the destination refusal;
  `session-age.realsh.test.ts` runs the generated session-age line under a real POSIX shell
  (through `src/core/testing/posix-shell.ts`, so Windows uses Git Bash);
  `src/shared/ssh.test.ts` covers the chip decision and
  `src/main/remote-ssh/remote-status-push.test.ts` the state-edge push.
- `src/renderer/session/relay-ssh.test.ts`, `relay-ssh.wiring.test.ts`, `relay-tab.test.ts` and
  `src/renderer/lib/sshAttachments.test.ts` prove a relay tab carries no dial-capable connection
  and that every guest-side dial site refuses it.
- Open an SSH project, create a remote terminal node, and confirm commands actually execute on
  the remote host (`hostname` should print the remote machine's name).
- Disconnect network access to the remote host, attempt to open a new remote terminal node, and
  confirm it's refused with a reconnect affordance rather than silently opening a local shell.
- Start an agent node on the SSH project and confirm its permission mode matches what the
  remote host's installed CLI version actually supports.

## Surfaces

- **Desktop**: everything on this page.
- **Server Edition**: there is no SSH-project manager in the server shell — a server runs ON the
  machine it serves, so SSH projects, the hook tunnel, the banner's tunnel state and the remote
  agent-tool refresh do not apply there. The shared `remoteAtomicWrite`, settings-file and
  destination-refusal code is used by the desktop only.
- **Mobile companion**: not applicable; it attaches to tmux sessions over its own transport and has
  no SSH-project concept.

## Suggested articles

- [Session continuity](../terminals/session-continuity.md) — the tmux mechanics this extends
  to a remote host.
- [Agent support](../agents/agent-support.md) — the permission-mode gating referenced above.
- [Server Edition](./server-edition.md) — the other way nodeterm reaches a machine that isn't
  in front of you.
- [Source control & worktrees](../source-control/source-control-and-worktrees.md) — the stated
  v1 limitation on remote worktree operations.
