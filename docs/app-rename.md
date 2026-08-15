# App rename

Settings → **App name & logo** lets you change what the app calls itself on screen — the title
bar, the brand mark in the tab bar, and (going forward) anywhere else it introduces itself. This
document covers behaviour, configuration, failure modes, security considerations and
verification.

## What it changes

- **Window / tab title** (`document.title`) — the desktop app's title bar and, in the Server
  Edition, the browser tab title.
- **The brand mark's wordmark** next to the logo in the tab bar (`TabBar.tsx`).

Both read `settings.appDisplayName` through `resolveAppDisplayName()` (`shared/appIdentity.ts`),
which trims whitespace, collapses internal runs of whitespace to a single space, bounds the
length to 60 characters, and falls back to the shipped name (`"nodeterm"`) when the setting is
empty or unset. There is no separate "off" state to configure — an empty field *is* "use the
shipped name", and that's also the one-click reset (Settings → App name & logo → **Reset**, which
clears the field back to empty).

## What it does **not** change

This is the load-bearing part. Renaming the app is **presentation only**:

- The **userData directory** the app stores its settings, workspace files, hook scripts, TOTP/
  logo cache and everything else in is unaffected. It is derived from a fixed identifier the
  Electron app is built with, never from `appDisplayName`.
- The **electron-builder `appId`/`productName`**, the installer, and the file the OS registers as
  "nodeterm.app" / `nodeterm.exe` are unaffected — those are baked in at build time and a
  renderer-side setting has no path to them at runtime, let alone a reason to.
- The **auto-update feed** is unaffected — it is keyed by the same build-time product identity.
- Any **marker this app writes into a user's own repository** — the `.nodeterm/project.json` file,
  hook scripts under `~/.claude/settings.json` (etc.), skill files, git config entries — keeps its
  real, literal name. Those are read by other tools (the Claude Code CLI, git, the user's shell)
  that have no idea a display name was ever chosen; renaming those would break every one of them
  silently.
- **Diagnostic reports, crash logs, and anything destined for a GitHub issue** always say
  `"nodeterm"` (`DIAGNOSTIC_APP_NAME` in `shared/appIdentity.ts`, currently the same constant as
  the shipped name) — a bug report titled after one user's personal rename is useless to whoever
  reads it next.
- The **OS-level "About" menu item** (macOS's default application menu, which this app does not
  override — see `CLAUDE.md` § Window chrome) still shows the real, build-time product name; it
  is drawn by the operating system from the packaged app bundle's metadata, entirely outside the
  renderer's reach.

The rule this enforces: **display reads a setting, identity reads a constant, and one must never
read the other.** `shared/appIdentity.ts` exists specifically so nothing in the renderer or main
process can accidentally derive a *path*, a *filename*, or an *update-feed URL* from the display
name a user typed into a text box — doing so would silently orphan that user's own stored data
the moment they renamed the app a second time.

## Configuration

`Settings.appDisplayName: string` in `settings.json`. Empty string (the default) means "use the
shipped name". Persisted the same way every other setting is (coalesced disk writes; see
`renderer/state/settings.ts`).

## Failure modes

- An absurdly long or control-character-laden value is bounded and normalized by
  `resolveAppDisplayName` before it is ever rendered — there is no length or content validation
  error to surface, because there's nothing that can actually fail: the function always returns a
  displayable string.
- Clearing the field and blurring/pressing Enter with nothing typed reverts to the shipped name
  immediately (an empty string is a valid, meaningful value, not an error state).

## Security & privacy

The display name is local settings data — the same file every other setting lives in — and never
transmitted anywhere the app doesn't already talk to (it isn't sent in any network request this
app makes). It is not read by the update check, the telemetry ping, or anything else that leaves
the machine.

## Verification

- `npx tsc --noEmit` passes for both TypeScript projects.
- Manual check: set a display name, confirmed the window/tab title and the tab-bar wordmark both
  update immediately (`App.tsx`'s `document.title` effect and `TabBar.tsx`'s selector both read
  the setting reactively). Reloaded the app and confirmed the name persisted. Cleared it and
  confirmed it fell back to `"nodeterm"` exactly.
- Confirmed (by reading `shared/appIdentity.ts` and every place `SHIPPED_APP_NAME` is used) that
  no userData path, IPC channel string, or file this app writes into a user's repository is
  derived from `appDisplayName` — only from the constant.
