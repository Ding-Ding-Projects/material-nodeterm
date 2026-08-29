# Claude skill visibility

Settings → Claude skills shows the skill catalogue that Claude can discover in each configuration
scope. It is a read-only view of metadata, not a skill editor or a transcript viewer.

## Scopes and states

The catalogue lists the local system scope (`~/.claude`), every non-pending local managed account,
and every currently connected SSH host with its system scope and non-pending managed accounts.
Each row identifies its scope and the relative configuration location:

| Scope | Location | Meaning |
| --- | --- | --- |
| Local Claude | `~/.claude` | The default Claude configuration for this computer. |
| Local Claude account | `~/.nodeterm/claude-accounts/<id>` | One isolated managed account on this computer. |
| Remote Claude | `~/.claude` | The default Claude configuration on a connected SSH host. |
| Remote Claude account | `~/.nodeterm/claude-accounts/<id>` | One isolated managed account on that SSH host. |

`Available` means a readable skill folder contains a regular `SKILL.md`. `Missing` means the scope
was read successfully but has no skills directory or no readable skills. `Unavailable` means the
config directory or skills directory could not be inspected. The two nodeterm-provided skills,
`manage-nodeterm-canvas` and `get-linked-context`, remain visible as explicit missing entries when
they are absent, so an empty list cannot be mistaken for a healthy install.

Refresh is explicit and non-blocking. A disconnected SSH host is not silently presented as empty;
the remote scope remains unavailable with a reason. The Server Edition presents its own local
system and managed-account scopes and documents that SSH scopes are not part of that shell.

## Search and accessibility

The panel has its own plain-text search. The adjacent regex control opens the full anchored regex
builder, preserving the field's query, pattern, flags, validation, and mode. Searching a scope
matches its label, location, state, and diagnosis; searching a skill matches its name and state.
Keyboard focus, screen-reader names, visible state text, and the no-match message are kept on the
same panel. Skill names are never hidden merely because a scope is unavailable.

## Privacy and security

Discovery never reads `SKILL.md` contents. Local discovery checks directory and file metadata only.
Remote discovery sends a bounded line-oriented list of validated folder names over the existing
SSH ControlMaster and never cats or returns a skill file. Credentials, provider sessions, session
transcripts, and absolute machine paths are not returned, logged, exported, or persisted by the
catalogue. The displayed `~` locations are stable relative labels, not filesystem disclosures.

The config scope is the authority for visibility. Claude Code resolves user skills relative to
`CLAUDE_CONFIG_DIR`, so a managed account can legitimately have a different skill set from the
system scope. The panel makes that difference visible rather than claiming that a skill installed
in one scope is available in another. Existing skill installation remains idempotent and best
effort; this view does not overwrite a user's real `skills/` folder or replace it with a symlink.

## Verification boundary

The implementation is present in `src/core/claude-skills.ts`, the desktop handler in
`src/main/index.ts`, the remote metadata reader in `src/main/remote-ssh/ssh-project.ts`, and the
Server Edition handler in `src/server/handlers/index.ts`. The renderer surface is
`src/renderer/components/settings/sections/ClaudeSkillsSection.tsx`.

This lane was delivered under the requested ultra-speed boundary. No tests, type checks, lint,
security review, installer execution, runtime interaction, or UI captures were run. Build and
packaging evidence remain separate release work and must not be inferred from this documentation.

## Suggested articles

- [Agent support](./agent-support.md) — lifecycle hooks, accounts, capabilities, and permission modes.
- [SSH projects](../remote/ssh-projects.md) — connection state and remote configuration scopes.
- [Local history](../../local-history.md) — the local settings history boundary.
