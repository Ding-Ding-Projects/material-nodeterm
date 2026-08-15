<div align="center">

<img src="docs/assets/nodeterm.png" alt="nodeterm" width="120" height="120" />

# nodeterm

**A node-based terminal manager — your terminals and agents on an infinite canvas.**

Multiple real terminals live as draggable nodes on a single pan/zoom canvas, and every
project doubles as a **Trello-style board of live Claude Code sessions**. Built for
people with ADHD and scattered workflows: a spatial layout instead of a stack of
hidden tabs.

[![Platform](https://img.shields.io/badge/platform-macOS%20(arm64%20%2B%20x64)%20·%20Linux%20(x64)-black)](https://nodeterm.dev)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/eneskirca/nodeterm?style=flat)](https://github.com/eneskirca/nodeterm/stargazers)
[![Latest release](https://img.shields.io/github/v/release/eneskirca/nodeterm?include_prereleases&sort=semver)](https://github.com/eneskirca/nodeterm/releases)
<!-- Installer downloads: .dmg + .AppImage + .deb across every release, hand-written on purpose.
     shields' github/downloads/…/total reads ~12× higher because electron-updater's own traffic
     (latest-*.yml polls, mac .zip deltas, blockmaps) is counted as downloads there. Recount with:
     gh api --paginate repos/eneskirca/nodeterm/releases --jq \
       '[.[].assets[] | select(.name|test("\\.(dmg|AppImage|deb)$")) | .download_count] | add' -->
[![Downloads](https://img.shields.io/badge/downloads-1.2k-brightgreen)](https://github.com/eneskirca/nodeterm/releases)

**Install:** grab the latest build from **[nodeterm.dev](https://nodeterm.dev)**, or
`brew install --cask nodeterm` on macOS — see [Download](#-download) for the full list.

[Download](#-download) · [Site](https://nodeterm.dev) · [Feature docs](./docs/features/README.md) · [Features](#-features) · [Build from source](#-build-from-source) · [Contributing](#-contributing) · [License](#-license)

</div>

---

<div align="center">
  <a href="docs/assets/hero-tour.mp4">
    <img src="docs/assets/hero-tour.webp" alt="nodeterm in 30 seconds — canvas, agents, kanban board, three surfaces" width="900" />
  </a>
  <br/>
  <sub>▶ <a href="docs/assets/hero-tour.mp4">Watch the 30-second tour with sound</a></sub>
</div>

## Why nodeterm

Stacked terminal tabs hide context — you lose track of what's running where. nodeterm
turns that into a **map**: every shell is a node you can place, group, label, and zoom
into. Sessions are spatial and persistent, so your mental model stays intact across
restarts. And because the app is built around a clean service seam, the same canvas runs
three ways — as the **desktop app for macOS and Linux**, as a **self-hosted browser app**
you reach from anywhere (Server Edition), and an **iOS companion** that attaches to the
same live sessions.

📚 **Full documentation lives at [nodeterm.dev/docs](https://nodeterm.dev/docs)** and in this
repository's [`docs/features/`](./docs/features/README.md) — get started, concepts, agents,
remote access, troubleshooting, and one article per feature (behaviour, configuration, failure
modes, security, verification).

## ✨ Features

<table>
<tr>
<td width="42%" valign="middle">

### Everything is a node

Right-click the canvas to open a **terminal** — or an AI **agent**. Each runs in its own
persistent tmux session, next to **sticky notes** (link one to feed an agent context),
**Monaco editors**, **diff views**, and **web/video** nodes — arranged spatially, like a
map. Quit the app, even **restart the machine** — every session comes back.

</td>
<td><img src="docs/assets/canvas-tour.webp" alt="The canvas — terminals, agents, notes, editors and diffs as nodes; sessions survive a full restart" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Know when an agent needs you

Hook-driven status — no output scraping: pulsing **RUNNING / NEEDS YOU** badges,
**subagent** cards with live transcripts, a per-node **context meter**, and OS
notifications. Click the ping, answer the permission prompt right in the node, and get
told the moment the turn is **done**. On a MacBook, agents live in the **notch** too.

</td>
<td><img src="docs/assets/agents-tour.webp" alt="Agent status — NEEDS YOU flip, notification, answering a permission prompt, subagent fan-out" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### One project, two views

Every project is a canvas — **and also a kanban board**. Cards *are* your live
sessions: drag them across columns while the agent keeps running, open a card into a
**live card modal** (the real session + members, due date, priority, comments), and
assign teammates. Toggle with `⌘⇧B`.
<br/><sub>▶ <a href="docs/assets/kanban-launch.mp4">Watch the board video with sound</a></sub>

</td>
<td><img src="docs/assets/kanban-launch.webp" alt="The kanban board — live session cards, drag between columns, the card modal with a live Claude Code session" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Your sessions, anywhere

**Pair your phone** with one QR — *scan with the nodeterm iOS app* — and the **same
live session continues in your pocket**, E2E encrypted **over the relay, not just your
LAN**. The same canvas also runs self-hosted in any browser (Server Edition).

</td>
<td><img src="docs/assets/remote-tour.webp" alt="Pair your phone — scan the QR, the same live session continues on the iPhone" /></td>
</tr>
<tr>
<td width="42%" valign="middle">

### Talk to your terminal

Hold `⌘⇧D` and say it. On-device **Whisper** transcribes locally — review the text,
then **Send** (nothing auto-submits). Your voice never leaves the machine.

</td>
<td><img src="docs/assets/dictation-tour.webp" alt="Dictation — hold cmd-shift-D, speak, review, send into the terminal" /></td>
</tr>
</table>

<details>
<summary><strong>Node kinds</strong> — terminal, agent, sticky, group, editor, diff, web/video</summary>

🖥 **Terminal** (xterm + tmux, AI naming) · 🤖 **Agent** (Claude Code / Codex / Gemini /
opencode / Grok / custom) · 📝 **Sticky note** (link to an agent as context) · 🗂 **Group**
(bind to a **git worktree** for agent-per-branch) · ✏️ **Editor** (Monaco, ⌘S) ·
🔀 **Diff** · 🌐 **Web / Video**

See [`docs/features/canvas/node-kinds.md`](./docs/features/canvas/node-kinds.md) for the full
write-up of every node kind.

</details>

<details>
<summary><strong>More features</strong> — session continuity, worktrees, remote/SSH, GitHub Issues on the board, AI naming, command palette, and more</summary>

- **Session continuity (tmux, or the built-in session host on Windows)** — terminals keep
  running across node remounts *and* full app restarts, including live processes; machine
  reboots restore scrollback and resume agent sessions (`claude --resume`). The macOS app
  **ships its own tmux**, so this works with nothing installed; a tmux already on your
  system is always used in preference to it, and terminals opened before an upgrade stay as
  they were until you refresh the node. On Windows, where tmux does not exist, the app runs
  its own standalone **session host** instead — see
  [`docs/windows-session-host.md`](./docs/windows-session-host.md).
- **Talk to your terminal** — on-device Whisper dictation (⌘⇧D): speak, review, send.
- **Agent superpowers** — **context links** so agent nodes read each other's transcripts
  on demand; Claude-only **branch a conversation** and **managed accounts** for several
  logged-in Claude identities side by side; agents can drive the canvas (open nodes,
  spawn teams, verify each other's work) via the built-in canvas-control CLI.
- **Remote / SSH projects** — open a project on a remote host over SSH; terminals, files,
  git, and even the board run there while the canvas stays local.
- **Source control** — VS Code-style stage/unstage, discard, branch switch/create,
  commit, push/sync/publish, **worktrees**, and `gh` sign-in — backed by system `git`.
- **GitHub Issues on Kanban** – opt-in issue cards, exact label-to-column mapping,
  All / GitHub / Sessions filtering, and two-way move, close, and reopen sync. See
  [setup and security details](./docs/github-issues-kanban.md).
- **AI commit messages & terminal names** — bring-your-own local agent CLI run read-only
  on the staged diff or captured output.
- **Your sessions, in your pocket** — **nodeterm mobile** (iOS) attaches to the same live
  tmux sessions: watch an agent work, answer a "needs you", or type into any terminal
  from your phone — plus push notifications and a mobile board view.
- **File converter** — a local, offline, categorized file-conversion queue (JSON/YAML/TOML/
  XML/CSV/TSV, text encodings, Markdown→HTML, base64/hex, gzip/brotli — every unsupported
  format is still listed, disabled, naming what it would take). See
  [`docs/file-converter.md`](./docs/file-converter.md).
- **Ollama manager** — browse and pull local [Ollama](https://ollama.com) models with
  evidence-based hardware-fit verdicts, a download-only "cart" (never a purchase), and a
  streaming local chat surface. See [`docs/ollama-manager.md`](./docs/ollama-manager.md).
- **Command palette** (⌘K), **file explorer** (⌘⇧E), **markdown view** (⌘M),
  **undo/redo**, and a native macOS dark UI.
- **Language modes** — English, playful Hong Kong-style Cantonese, or bilingual, plus two
  independent funny-level sliders (English/Cantonese) that change *tone*, never facts, on
  every message including errors. Settings → Interface → Language. See
  [`docs/language-modes.md`](./docs/language-modes.md).
- **Regex builder, everywhere search is** — a real in-app builder (guided construction,
  live matches, capture groups, safe against catastrophic backtracking) anchored right
  beside the terminal find bar, the command palette, the Explorer filter, settings
  search, and any filterable context menu — plain text stays the default, regex is one
  click away. See [`docs/regex-builder.md`](./docs/regex-builder.md).
- **Auto-update & in-app announcements** — the app checks a self-hosted feed and
  surfaces a "Restart to update" banner and product news.
- **Export everything, in every format** — session memory, local settings history and
  every other list this app owns exports to JSON, JSONL, YAML, TOML, XML, CSV, TSV,
  Markdown, HTML or SQL, with a disclosure shown *before* the export runs for any
  format that cannot carry a field faithfully. See [`docs/exports.md`](./docs/exports.md).
- **Bulk actions everywhere** — click, shift-click, select-all/invert, and a reviewable
  preview before anything runs. See [`docs/bulk-actions.md`](./docs/bulk-actions.md).
- **Local settings history** — every settings save (accounts, custom agents, everything
  else) is snapshotted in an isolated local git repository, labelled by what changed, and
  restorable as a new, undoable revision. See [`docs/local-history.md`](./docs/local-history.md).
- **Toy locks & the built-in authenticator** *(Settings → Just for fun)* — a purely-for-fun,
  opt-in password/TOTP lock on a tab, a canvas node, or an appearance setting (this is a
  speed bump, not security — recovery is deleting the app's own local data folder), plus a
  local, offline TOTP authenticator with in-process QR pairing. See
  [`docs/toy-locks.md`](./docs/toy-locks.md) and [`docs/authenticator.md`](./docs/authenticator.md).

Every one of these has its own article under
[`docs/features/`](./docs/features/README.md), covering behaviour, configuration, failure
modes, security considerations, and how it's verified.

</details>

<details>
<summary><strong>🌍 Server Edition</strong> — the same canvas, self-hosted in any browser</summary>

The same canvas runs headless on a Linux (or macOS) host and is used from any browser —
so your terminals, editors, source control, board, and agents live on a server you reach
from anywhere. Single-user auth (password + secure cookie), a WebSocket bridge, and the
exact same renderer as the desktop app.

```bash
npm run server:dev     # build + serve; open http://127.0.0.1:8443 and set a password
```

Terminals, files/editor/diff, the full git panel, the kanban board, and agent-status
badges all work in the browser today. See [`docs/SERVER.md`](./docs/SERVER.md) for the
quickstart, security model, and current limitations, and
[`docs/features/remote/server-edition.md`](./docs/features/remote/server-edition.md) for the
feature-level write-up.

#### 🔔 Get push notifications from any SSH host

The same server also runs **headless** as a background notification host: install it on any
Linux box you SSH into, and your phone gets **RUNNING / NEEDS YOU** push + Live-Activity
coverage for the agents running there — with **zero open ports** (the hook server stays
loopback-only and push goes out over HTTPS under a grant your phone drops over SSH).

```bash
curl -fsSL https://raw.githubusercontent.com/eneskirca/nodeterm/main/scripts/install-server.sh | bash
```

One line installs, builds, and runs it as a systemd service (`NODETERM_HEADLESS=1`); re-run it
to update. See the [headless notification host](./docs/SERVER.md#headless-notification-host)
section for details.

</details>

## 📦 Download

Grab the latest build from **[nodeterm.dev](https://nodeterm.dev)** — the download button
detects your platform. Everything is also listed at
[nodeterm.dev/releases](https://nodeterm.dev/releases):

- **macOS** — `.dmg` for Apple Silicon and Intel (auto-updates), or **Homebrew**:

  ```bash
  brew tap nodeterm/tap
  brew trust nodeterm/tap        # Homebrew ≥6 refuses to load an untrusted tap
  brew install --cask nodeterm
  ```

  Both first lines are required. On its own, `brew install --cask nodeterm` only searches
  `homebrew/cask` and reports the cask as not found; without the trust grant, Homebrew ≥6
  fails rather than prompting. The cask tracks each promoted release, and the app updates
  itself (electron-updater), so `brew upgrade` is rarely needed for it.
- **Linux (x64)** — self-updating **AppImage**, or a `.deb` for Debian/Ubuntu
  (`sudo apt install ./nodeterm-*.deb`; updates are manual for `.deb`).
- **Windows (x64)** — self-updating Squirrel.Windows installer (`Setup.exe`). Unsigned — see
  [docs/windows.md](docs/windows.md) for the SmartScreen prompt you'll see on first run, what
  degrades without tmux, and how to build it yourself.
- **iOS** — **nodeterm mobile** on the
  [App Store](https://apps.apple.com/app/nodeterm/id6790581233).

> Builds are currently **unsigned/unnotarized** — see
> [`docs/features/packaging/packaging-and-auto-update.md`](./docs/features/packaging/packaging-and-auto-update.md)
> for what that means and the first-run workaround.

## 🛠 Build from source

Requires Node.js 20+ on macOS, Linux, or Windows (tmux recommended on macOS/Linux — it's what
makes sessions survive restarts; **Windows has no tmux build**, see
[docs/windows.md](docs/windows.md) for what that changes and how to get it anyway via
MSYS2/Cygwin). A source checkout does **not** carry the bundled tmux: run
`node scripts/build-tmux.mjs` once on macOS to build it into `resources/bin/tmux` (the
release job does this automatically), or just install tmux yourself.

```bash
npm install        # deps + rebuilds node-pty against Electron's ABI (postinstall)
npm run dev        # dev mode with renderer HMR
npm run build      # production build into out/
npm start           # preview the production build
npm run typecheck  # fastest correctness gate
npm test            # vitest unit + integration suite
npm run dist        # local UNSIGNED .dmg into dist/ (smoke test)
npm run dist:linux  # AppImage + .deb into dist/ (on a Linux host)
npm run dist:win    # local UNSIGNED Squirrel.Windows Setup.exe into dist/ (on a Windows host)
npm run server:dev  # build + run the browser Server Edition (needs Node 22 + tmux)
npm run count-lines # print the project's committed line-count table
```

### One-click build scripts

For a checkout with nothing installed, three scripts at the repository root take it all the way
to a running app or an installer, installing every dependency they need along the way (never
requiring administrator/sudo rights when a user-scoped install exists):

| Script | What it does |
| --- | --- |
| `download-dependencies.bat` / `.sh` | Installs Node.js (if missing) and runs `npm ci` / `npm install`. |
| `build.bat` / `.sh` | Runs the script above, builds `out/`, then offers to launch the app. |
| `build-installer.bat` / `.sh` | Runs the script above, then packages and verifies the platform installer (Squirrel.Windows on Windows, dmg+zip on macOS, AppImage+deb on Linux) — **unsigned**, since code signing is permanently out of scope for this project. |

All three accept `/s` on Windows or `-s`/`--silent` on macOS/Linux (also `SILENT=1` in the
environment) for a fully non-interactive run that exits non-zero on the first real failure.
**Always invoke the `.bat` files by absolute path** — see `docs/building.md` for why a relative
invocation can fail on a hardened Windows machine even though the file exists.

Full contract, exact flags, and every failure message: **[`docs/building.md`](docs/building.md)**.

<details>
<summary><strong>⌨️ Keyboard shortcuts</strong></summary>

| Shortcut | Action |
| --- | --- |
| `⌘K` | Command palette |
| `⌘T` / `⌘⇧C` | New terminal / New Claude Code |
| `⌘⇧B` | Toggle the kanban board |
| `⌘W` | Close the selected node |
| `⌘Z` / `⌘⇧Z` | Undo / Redo |
| `⌘M` | Toggle markdown view (terminal / editor) |
| `⌘⇧D` | Dictate into the focused terminal |
| `⌘⇧E` | File explorer |
| `⌘,` | Settings · `⌘/` Shortcuts |
| `Right-click` | Actions menu (empty space or node) |

</details>

<details>
<summary><strong>🏗 Architecture</strong> — the process boundaries and the seams that keep three surfaces on one codebase</summary>

- **Electron, three contexts** — `src/main` (the Electron shell), `src/preload` (the only
  bridge, `window.nodeTerminal`), `src/renderer` (React UI). `src/shared` holds the types
  and IPC channel names used by all three.
- **`CorePlatform` seam** — every service (PTY, workspace/settings, git, agents, hooks) lives
  in `src/core` behind a small platform interface and never imports `electron`. Electron is
  one implementation of that seam; the browser Server Edition (`src/server`) is another,
  booting the exact same services over a WebSocket-RPC bridge (`src/renderer/bridge` fills
  `window.nodeTerminal` in the browser). One codebase, one renderer, multiple shells.
- **`TerminalTransport` abstraction** — the renderer depends only on this interface, never on
  IPC or node-pty directly. `LocalTransport` talks to the local host; `RemoteTransport` talks
  to a remote agent over SSH — so remote projects drop in without touching the canvas UI.
- **React Flow is the single source of truth** for live nodes; projects persist serialized
  nodes to disk, and tmux keeps sessions alive across restarts.
- **Three surfaces** — the desktop app, the browser **Server Edition**, and the
  **mobile companion** (a separate SwiftUI repo) all ride the same core + transport seams.

See [`docs/SERVER.md`](./docs/SERVER.md) for the Server Edition, the design docs under
[`docs/`](./docs) for deeper notes, and [`docs/features/`](./docs/features/README.md) for a
feature-by-feature write-up covering behaviour, configuration, failure modes, security, and
verification for each one. [`CLAUDE.md`](./CLAUDE.md) is the full deep-reference these
summaries are distilled from.

</details>

## 📚 Documentation

| Where | What's there |
| --- | --- |
| [nodeterm.dev](https://nodeterm.dev) | The landing page — pitch, download, and a documentation index. |
| [`docs/features/`](./docs/features/README.md) | One article per feature: terminals, canvas, projects, agents, source control, kanban, remote/SSH, speech, packaging. |
| [`docs/SERVER.md`](./docs/SERVER.md) | Server Edition quickstart, security model, current limitations. |
| [`CLAUDE.md`](./CLAUDE.md) | The deep architecture reference, per subsystem, with reasoning and measurements. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Setup, process-boundary rules, and house rules for human contributors. |
| [`AGENTS.md`](./AGENTS.md) | A **sanitized mirror** of this project's working conventions, written for AI coding agents — see the note at the top of that file for what "mirror" means here. |
| [`CHANGELOG.md`](./CHANGELOG.md) | What shipped, when, generated from the real commit history. |
| [`docs/narrator.md`](./docs/narrator.md) | The spoken TTS narrator (Settings → Interface → Narrator) — voice pickers, queue and cooldown rules, failure modes. |
| [`docs/dim-sum.md`](./docs/dim-sum.md) | The startup dim-sum surprise — what it is, when it fires, and why it has no off switch. |
| [`docs/school-mode.md`](./docs/school-mode.md) | School mode — the shared switch, the rename, and the honest limits of a user-experience lock. |
| [`docs/personal-vocabulary.md`](./docs/personal-vocabulary.md) | The local personal-vocabulary JSON upload — schema, bounds, and the local-only guarantee. |
| [`docs/notifications.md`](./docs/notifications.md) | Non-blocking toasts and the reviewable notification centre — what is a toast vs a modal, and why. |
| [`docs/command-palette.md`](./docs/command-palette.md) | The command palette (`⌘K` or `Ctrl+Shift+F`) — rich inline controls, teleport-to-element, persisted size. |
| [`docs/destructive-confirmation.md`](./docs/destructive-confirmation.md) | The two-key + slider gate that stands in front of anything irreversible. |
| [`docs/scheduled-settings.md`](./docs/scheduled-settings.md) | Settings → Schedule — appearance overrides by time of day, date range, an HTTPS API, or a Home Assistant entity. |

## 🪟 Windows

Windows is a first-class desktop target: a Squirrel.Windows installer (`npm run dist:win`),
PowerShell/cmd as the default shell, and a Material title bar with the native window buttons on
the right. The one meaningful behavioral difference from macOS/Linux is that terminals run as a
plain shell instead of a tmux session, so they don't survive an app restart — see
[docs/windows.md](docs/windows.md) for the full picture (what degrades, the unsigned-installer
SmartScreen warning, and how to get tmux-backed continuity anyway).

### 🎨 Appearance & identity

- [**Appearance editor**](./docs/appearance.md) — right-click (or Shift+right-click on a tab)
  any tab or node title for a non-modal, per-element typography/colour editor, with presets you
  can export and import.
- [**Colour picker**](./docs/colour-picker.md) — the infinite spectrum picker behind every colour
  field in the app, with a HEX/RGB/HSL/HSV/HWB/Lab/LCH/OKLab/OKLCH/CMYK translator and a
  contrast readout.
- [**App rename**](./docs/app-rename.md) — give the app whatever display name you like; it never
  touches the app's real identity (data directory, installer, update feed).
- [**App logo**](./docs/app-logo.md) — pick a shipped colour variant of the mark or upload your
  own image, processed entirely on your machine.

## 🤝 Contributing

Issues and pull requests are welcome. **Start with [CONTRIBUTING.md](./CONTRIBUTING.md)** —
setup, the process-boundary rules, and the house rules that come up in review.
[CLAUDE.md](./CLAUDE.md) is the deep reference behind them, and
[AGENTS.md](./AGENTS.md) is a sanitized summary of the same conventions aimed at AI coding
agents (both are loaded automatically by tools that support it). Questions or bug reports are
also happy at [nodeterm.dev/support](https://nodeterm.dev/support) / support@nodeterm.dev.
nodeterm is licensed under the
[Business Source License 1.1](https://mariadb.com/bsl11/) — you can use, modify,
and redistribute it freely, including in production, except offering it as a
competing product or service (see [License](#-license)).

By submitting a contribution (pull request, patch, or code snippet), you agree
that it is licensed under the same [BUSL-1.1](./LICENSE) terms as the rest of
the project, and that the project may continue to relicense future versions
(including your contribution) as part of its normal licensing model.

## 📜 License

**[BUSL-1.1](./LICENSE)** ([Business Source License](https://mariadb.com/bsl11/)): you may
copy, modify, redistribute, and — under the Additional Use Grant — make **production
use** of nodeterm; the one thing you may not do is offer it (hosted, embedded, or as a
standalone product/service) in a way that **competes** with nodeterm or with the
Licensor's products built on it. Each release automatically becomes plain **MIT** four
years after it is published. See [`LICENSE`](./LICENSE) for the full terms and
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) for the bundled open-source
components. For a commercial license beyond the grant, contact eneskirca@gmail.com.

> "Claude" and "Claude Code" are trademarks of Anthropic, and "Trello" is a trademark of
> Atlassian; nodeterm is not affiliated with or endorsed by either.
