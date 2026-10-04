# Windows CLI resolution and npm shim execution

nodeterm runs several agent and tool CLIs itself, outside a terminal: capability probes for
Claude, Codex and grok, the AI commit-message agent, the Codex usage app-server tier, the Codex
account daemon, the opencode export read by context links, and every GitHub CLI call in Source
Control. On Windows those CLIs are usually npm installs, which put a `<name>.cmd` shim (and a
POSIX `<name>` shell shim for Git Bash) on the PATH. This article covers how nodeterm finds them
and how it runs a `.cmd` shim without letting a shell reinterpret the arguments.

## Behavior

- **Resolution goes through PATHEXT.** `findInPathString` (`src/core/exec-path.ts`) maps a bare
  name through PATHEXT on Windows (`gh` becomes `gh.COM`, `gh.EXE`, `gh.BAT`, `gh.CMD`, in
  PATHEXT order). The extensionless name is never a candidate there, so the Git Bash shell shim
  that npm lays down beside `<name>.cmd` is never returned. A name that already carries an
  extension is used as given. On other platforms the bare name is the only candidate.
- **Quoted PATH entries are accepted.** A PATH entry written as `"C:\Program Files\GitHub CLI"`
  is unquoted before the walk, as `where.exe` does.
- **`findInLoginPath`** lives in `exec-path.ts` (with a re-export from `pty-manager.ts`). On
  Linux it walks the cached login-shell PATH; elsewhere it walks the inherited PATH.
- **The GitHub CLI path is memoized on a hit only.** Source Control resolves `gh` through the
  shared `ghPath()` (`src/core/gh-path.ts`), so a GitHub CLI installed while the app is running is
  found on the next action, and the Windows installer locations (`Program Files\GitHub CLI` and
  `%LOCALAPPDATA%\Programs\GitHub CLI`) are checked after PATH.
- **A `.cmd` shim is run through cmd.exe with escaped arguments.**
  `directExecutableInvocation(executable, args)` returns how to spawn a resolved executable:
  - any non-Windows path, and any Windows executable that is not a script, is returned unchanged;
  - a `.cmd` shim runs as `%SystemRoot%\System32\cmd.exe /d /s /v:off /c "<command>"` with the
    command and every argument escaped for cmd.exe twice (npm shims forward `%*`, so cmd parses
    the arguments twice), delayed expansion off, `windowsVerbatimArguments` and `windowsHide` set;
  - standard input is the child's own byte stream, so a staged diff piped to an agent reaches it
    byte for byte (multiline and non-ASCII text included).
  Every caller spreads the returned spawn options.

## Configuration

None. Resolution follows the PATH and PATHEXT that nodeterm itself inherited (plus the login-shell
PATH on Linux). To make a CLI visible to a desktop launched from the Start menu, put its folder
on the user or system PATH.

## Failure modes

`directExecutableInvocation` fails closed (returns null, and the caller reports the CLI as
unavailable or the operation as failed) when:

- the target is a `.bat` or `.ps1` file;
- `%SystemRoot%\System32\cmd.exe` is missing or `SystemRoot` is unset;
- the executable path or any argument contains NUL, CR or LF (cmd.exe treats a line break as a
  command boundary even inside quotes);
- the wrapped command line exceeds 8100 characters.

What each caller does with a refusal: a capability probe answers its fail-open "unknown" caps
(no `--session-id`, no `auto` permission flag, no model list); the commit-message agent returns
"Cannot safely execute Windows script"; the Codex usage app-server tier declines and the backend
tier answers alone; the Codex daemon start reports that the CLI has no safe Windows entry point;
a GitHub CLI action reports that gh is not found or cannot be run safely.

## Security considerations

- No shell is used for native executables, and cmd.exe is used only for `.cmd` files with every
  token escaped, so a prompt, branch name, session id or repository name containing `&`, `|`,
  `%`, `!`, quotes or parentheses stays one literal argument.
- Line breaks and NUL are refused rather than escaped, because cmd.exe cannot carry them inside an
  argument.
- `.ps1` scripts are not executed. Running them would mean an execution-policy decision and a
  PowerShell text pipeline between nodeterm and the CLI's standard input.
- Resolution never executes anything: it is a subprocess-free walk of PATH strings.

## Surfaces

- **Desktop (Windows):** full; this is where `.cmd` shims exist.
- **Desktop and Server Edition (Linux):** resolution and invocation are unchanged, since
  `directExecutableInvocation` returns every non-Windows path as given.
- **Mobile companion:** not applicable; it runs no local CLI.

## Verification

- `src/core/exec-path.test.ts`: PATHEXT mapping, the no-extensionless rule, quoted PATH entries,
  the escaped cmd.exe command, every fail-closed case, and a real filesystem walk. Three guards were
  mutation-checked red (single escape pass, unquoting removed, line-break refusal removed).
- Windows-only tests (skipped on Linux): a real `.cmd` round trip of hostile argv, the
  commit-message agent's multiline Unicode standard input, and the Claude, Codex, grok, opencode,
  Codex usage and GitHub CLI shim paths (`claude-cli.test.ts`, `codex-identity-caps.test.ts`,
  `grok-cli.test.ts`, `context-link.windows.test.ts`, `codex-usage.windows.test.ts`,
  `git-service.windows.test.ts`, `commit-message.test.ts`).
- Device checklist, not yet run on Windows:
  1. With Claude Code installed by npm, the Agents settings show the `auto` permission mode and
     new Claude nodes carry `--session-id`.
  2. With Codex installed by npm, the usage popover's Codex row still fills when the backend read
     is blocked (the app-server tier), and adding a managed Codex account starts its daemon.
  3. AI commit message with a custom `.cmd` agent and a staged diff containing non-ASCII text
     returns a message built from the full diff.
  4. Source Control publish and "Propose" work with gh installed only under `%LOCALAPPDATA%`.
  5. A context link to an opencode node shows its transcript.
  6. With grok installed by npm, new grok nodes carry `--session-id` and the transfer model picker
     lists grok's own models.

## Suggested articles

- [Agent support](../agents/agent-support.md)
- [Grok session ids, models and home directory](../agents/grok-session-ids-and-models.md)
- [Usage indicator reliability and identity](../agents/usage-indicator-reliability.md)
