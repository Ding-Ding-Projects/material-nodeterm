<div align="center">

<img src="docs/assets/nodeterm.png" alt="nodeterm" width="120" height="120" />

# nodeterm

**Your terminals and coding agents on one infinite canvas.**

Real shells live as draggable nodes on a pan/zoom canvas instead of behind a row of tabs, and
every project doubles as a **board of live agent sessions**. Built for people whose work does not
fit in a stack of hidden tabs — a map you arrange, not a list you scroll.

[![Build check](https://github.com/Ding-Ding-Projects/material-nodeterm/actions/workflows/ci.yml/badge.svg)](https://github.com/Ding-Ding-Projects/material-nodeterm/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-Windows%20·%20macOS%20(arm64%20%2B%20x64)%20·%20Linux-black)](#windows)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Material Design 3](https://img.shields.io/badge/design-Material%203-6750A4)](#the-interface)
[![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Ding-Ding-Projects/material-nodeterm?style=flat)](https://github.com/Ding-Ding-Projects/material-nodeterm/stargazers)
[![Latest release](https://img.shields.io/github/v/release/Ding-Ding-Projects/material-nodeterm?sort=semver)](https://github.com/Ding-Ding-Projects/material-nodeterm/releases)

[Site](https://ding-ding-projects.github.io/material-nodeterm/) · [Releases](https://github.com/Ding-Ding-Projects/material-nodeterm/releases) · [Features](#-features) · [Windows](#windows) · [Build from source](#install--build) · [Documentation](#documentation) · [Contributing](#contributing) · [License](#license)

</div>

![The nodeterm canvas: a 64px Material Design 3 top app bar carrying the brand mark, project switcher and docked search; an 88px left nav rail with its floating action button and the destinations Canvas, Board, Files, Tools, History, Alerts and Settings; the sessions sidebar; and the pan/zoom canvas with its dot grid, zoom controls and minimap](./docs/assets/shots/app-04-canvas.png)

> **Install:** grab the latest build from **[Releases](https://github.com/Ding-Ding-Projects/material-nodeterm/releases)**
> (Windows `Setup.exe` today — see [Windows](#windows) for the unsigned-installer note), or build
> it yourself with `build.bat` / `build.sh` — see [Install / build](#install--build).

This is a fork of [eneskirca/nodeterm](https://github.com/eneskirca/nodeterm). The site's own
custom domain belongs to the upstream repository, so this fork publishes its documentation at
[ding-ding-projects.github.io/material-nodeterm](https://ding-ding-projects.github.io/material-nodeterm/)
instead — note the trailing `/material-nodeterm/`.

## Why nodeterm

Stacked terminal tabs hide context — you lose track of what is running where. nodeterm turns that
into a **map**: every shell is a node you can place, group, label and zoom into. Sessions are
spatial and persistent, so your mental model survives a restart. And because the app is built
around a clean service seam, the same canvas runs two ways: as the **desktop app** (Windows,
macOS, Linux) and as a **self-hosted browser app** you reach from anywhere — including a phone,
with nothing to install.

## The interface

The whole app is **Material Design 3** — one baseline scheme seeded at `#6750A4`, tonal elevation
rather than drop shadows, and Outfit / Roboto Mono / Material Symbols bundled and subsetted so it
renders identically offline. A 64px top app bar carries the brand, the project switcher and a
docked search; an 88px nav rail carries the destinations and a FAB that owns node creation.

Every colour, typeface, size, weight, radius and spacing the app renders is adjustable at runtime
through the appearance editor, and every colour control is a continuous field with a colour-space
translator rather than a fixed list of swatches.

### Watch it run

![A recording of the built app: the first-run cover, creating a project, opening a real terminal on the canvas and running a command in it, the command palette searching, and the settings surface](./docs/assets/app-walkthrough.webp)

A still proves a surface exists. This proves it moves. It is a real recording of the built
artifact, driven by [`scripts/record-app.mjs`](./scripts/record-app.mjs) against a disposable
profile, and it is frames of the app's own renderer: nothing here captures a screen, a desktop or
any other window. Provenance, including the commit it was recorded at, sits beside it in
[`app-walkthrough.json`](./docs/assets/app-walkthrough.json).

<details>
<summary><strong>See it</strong> — real captures of the built app, not mockups</summary>

Every image below was taken from the built `out/` artifact over the DevTools protocol by
[`scripts/capture-shots.mjs`](./scripts/capture-shots.mjs), which fails the run when a required
surface cannot be reached. Provenance for each is in
[`capture-manifest.json`](./docs/assets/shots/capture-manifest.json).

| | |
| --- | --- |
| ![The command palette open over the app, listing create actions for terminals and each supported agent](./docs/assets/shots/app-03-palette.png) | ![The project rendered as a kanban board with Ungrouped, To Do, In Progress and Done columns](./docs/assets/shots/app-05-kanban.png) |
| **Command palette** — every command, destination and setting behind `Ctrl+Shift+F`. | **The same project as a board** — cards *are* the session nodes, not a separate list. |
| ![The History screen inset behind the app bar and nav rail, with Session memory, Settings history and Changelog tabs](./docs/assets/shots/app-06-history.png) | ![The settings surface with sidebar navigation, a search field with the regex-builder affordance beside it, and per-agent controls](./docs/assets/shots/app-02-settings.png) |
| **History** — session memory, local settings history and the changelog viewer. | **Settings** — every surface carries its own search, wired to the full regex builder. |
| ![The Language settings section: an English, Cantonese and Bilingual segmented button and two independent funny-level sliders](./docs/assets/shots/app-settings-language.png) | ![The Narrator settings section: a master toggle off by default, a narrated-language choice, and a separate voice picker per language](./docs/assets/shots/app-settings-narrator.png) |
| **Language** — three modes, and two sliders that change tone without changing the facts. | **Narrator** — off by default, with a live line saying which voice will actually speak. |
| ![The ADHD modes settings section: five independent switches — Focus, Low stimulation, Time awareness, One thing at a time and Momentum — each with a plain description, and a note that they are not a diagnosis, assessment or advice](./docs/assets/shots/app-adhd-modes.png) | |
| **ADHD modes** — five accommodations, switched on independently, all off by default. | |

Kids mode ships its own screens, captured the same way:

| | |
| --- | --- |
| ![The Kids mode home screen: a robot avatar introducing itself as Beep, activity tiles, and a notice that Kids mode does not sandbox the terminal](./docs/assets/shots/app-kids-home.png) | ![The grown-up screen: time today, daily limit, stickers and sessions, an activity log, and permission switches](./docs/assets/shots/app-kids-parent.png) |
| **Kids home** — the disclosure sits on the screen the child uses. | **The grown-up screen**, behind a PIN gate that the docs call a speed bump, not security. |

Also captured: [at launch](./docs/assets/shots/app-01-launch.png),
[the appearance editor](./docs/assets/shots/app-settings-appearance-editor.png),
[app name & logo](./docs/assets/shots/app-settings-app-identity.png),
[scheduled settings](./docs/assets/shots/app-settings-schedule.png),
[the Kids gate](./docs/assets/shots/app-kids-gate.png) and
[Kids mode settings](./docs/assets/shots/app-settings-kids-mode.png).

Two surfaces are deliberately **absent** rather than faked — an agent mid-turn and an SSH project
need a live agent session and a reachable host, so the harness skips them loudly and lists why.

</details>

## ✨ Features

### The canvas

Right-click to open a **terminal** or an **agent** node. Alongside them live **sticky notes**
(link one to a terminal to feed it context on demand), **Monaco editors**, **diff views**, web and
browser views, annotations, and a family of **service managers** — Minecraft, Docker host,
Proxmox, GitLab, Home Assistant and FreePBX — each an ordinary node you drag, colour, group and
persist like any other, because a managed service is something you arrange beside the terminals
working on it, not a modal you visit.

**Group** nodes are real containers that nest inside each other and can bind to a git worktree, so
every node created inside one inherits that worktree's directory. Quit the app and the persistent
backend reattaches to the live session; reboot the machine and cold restore rebuilds the node,
replays saved scrollback and resumes a supported agent CLI — it does not preserve the original OS
process, and says so.

### Agent support — Claude Code, Codex, Gemini, opencode, Grok, or your own

An **agent** node is a terminal preset that launches an agent CLI as its first command. Status
comes from each agent's own hooks — never from scraping terminal output — so you get pulsing
**RUNNING / NEEDS YOU** badges, a per-node context-window meter, subagent cards with live
transcripts, and, for capable agents, session renaming and conversation branching. A custom
command works too, with basic process/title status.

Capabilities are per agent and none are assumed: see
[`docs/features/agents/agent-support.md`](./docs/features/agents/agent-support.md) for exactly what
each one has, and what it does not.

### One project, two views — the kanban board

Every project is a canvas **and** a Trello-style board. Cards *are* your live session nodes,
derived from the same data on every render — drag one across columns while its agent keeps
running, or open a card into a live modal holding the real session plus members, due date,
priority and comments. The canvas stays mounted underneath, so switching views never interrupts
anything.

### Session continuity

Every terminal runs inside a persistent [tmux](https://github.com/tmux/tmux) session on macOS and
Linux, so a shell — and anything in it, including an in-flight agent turn — survives closing a
node, switching projects and quitting the app. **Windows has no tmux binary to bundle**, so
nodeterm ships a from-scratch equivalent: the [Windows session host](#windows), a standalone
process that owns the real PTYs and outlives the app. See [Windows](#windows) for its two honest
caveats.

### Remote & SSH, and the Server Edition

Point a project at a folder on a remote host and every terminal, file operation, git command and
even the kanban board for that project runs there while the canvas stays local — session
continuity applies remotely too. Or run the **Server Edition**: the same renderer served headless
over HTTP/WebSocket from a host you own, reached from any browser, with passkey or password auth.
One command (`./host.sh`, or `host.bat` on Windows) builds and starts it in a container. Phone
pairing is a free feature, not a paywalled one.

### Source control and git worktrees

A full git panel — stage/unstage, discard, diff nodes, branch switch/create, commit (with an
optional AI-generated message from a local agent CLI you already have), push/sync, `gh` sign-in.
**Worktrees bind to group frames**: create one from the panel or the command palette and every
node opened inside that frame runs in that worktree, so an agent per branch is just a group per
branch.

### ADHD modes

This README has always said nodeterm is built for scattered workflows. These are the part you
can actually switch on — five accommodations, independently, all off by default:
**Focus** (fades everything but the node you are in), **Low stimulation** (less motion, quieter
colour, and only the notifications that need an answer), **Time awareness** (elapsed time on the
node, not in a menu), **One thing at a time** (one next action, in your words), and **Momentum**
(a note when something has sat untouched).

Independent on purpose: someone may want a quieter interface without time nudges, or want the
nudges precisely because they are hyperfocusing. Behind one master switch, most people turn the
lot off to escape the single part that does not suit them.

Focus **dims and never hides** — nothing becomes unreachable, at any setting. The copy states
facts and never verdicts: no streaks, no scores, no congratulation. And none of it is presented
as medical: these are interface accommodations, not assessment or advice, and nothing is
recorded or sent anywhere. See [`docs/adhd-modes.md`](./docs/adhd-modes.md).

### Dictation

Voice-to-text for any terminal or agent node, transcribed entirely on-device with
[Whisper](https://github.com/openai/whisper) — nothing you say leaves your machine. Hold the
chord, speak, then choose **Send** (submits) or **Insert** (drops it in without submitting).
Identical on desktop and in the browser.

<details>
<summary><strong>More — language modes, the regex builder, toy locks, exports, and everything else this fork adds</strong></summary>

- **Language modes & funny-level sliders** — English, playful Hong Kong-style Cantonese, or
  bilingual, plus two independent funny-level sliders (one per language) that style every
  dialog and message box without changing what they actually say. See
  [`docs/language-modes.md`](./docs/language-modes.md).
- **Regex builder** — a real, in-app pattern builder wired into every search field in the app,
  not a link to an external site. Plain text by default, regex an explicit opt-in. See
  [`docs/regex-builder.md`](./docs/regex-builder.md).
- **School mode** — a shared, renamable focus switch that, while on, presents the app in plain
  English with Cantonese, funny levels, the dim-sum surprise and personal vocabulary treated as
  not installed. A user-experience switch, not a security boundary. See
  [`docs/school-mode.md`](./docs/school-mode.md).
- **Personal vocabulary** — upload a small local JSON file of your own `term → replacement`
  pairs and the app's own prose adopts your wording. Local and private; nothing is ever
  uploaded anywhere. See [`docs/personal-vocabulary.md`](./docs/personal-vocabulary.md).
- **Narrator** — an opt-in spoken TTS narrator for app events (an agent finishing, needing
  attention, or erroring), off by default. See [`docs/narrator.md`](./docs/narrator.md).
- **Toy locks & the built-in authenticator** — a purely-for-fun password/TOTP gate you can put
  on a project tab, a canvas node, or an appearance setting, plus a local offline place to keep
  arbitrary TOTP secrets and read live codes. Explicitly *not* a security boundary — see
  [`docs/toy-locks.md`](./docs/toy-locks.md) and [`docs/authenticator.md`](./docs/authenticator.md).
- **Exports & bulk actions** — every record, view, list and generated artifact nodeterm owns is
  exportable in whatever formats can faithfully represent it, and every list/table/grid
  supports select-all, bulk delete/export/move with a reviewable preview first. See
  [`docs/exports.md`](./docs/exports.md) and [`docs/bulk-actions.md`](./docs/bulk-actions.md).
- **Universal file converter** — a local, offline conversion surface (documents/PDF, images,
  audio, video, archives, structured data, code/text, binary encodings) reachable from the nav
  rail's Tools destination or the command palette. See
  [`docs/file-converter.md`](./docs/file-converter.md).
- **Local Ollama suite manager** — a local manager for [Ollama](https://ollama.com) that talks
  only to its documented local HTTP API, never a cloud service. See
  [`docs/ollama-manager.md`](./docs/ollama-manager.md).
- **AWS CDK manager** — a guided local project-folder picker with detected application and runtime
  facts, manifest trust review, pinned CDK dependency bootstrap, and typed synth, diff, deploy, and
  destroy workflows. It never exposes an arbitrary shell command; credentials and generated runtime
  state stay local. See [`docs/features/integrations/cdk-manager.md`](./docs/features/integrations/cdk-manager.md).
- **Scheduled settings** — rules that automatically overlay appearance/customization settings
  for a date+time window ("dark theme after 22:00"), with an optional Home Assistant boolean
  source. See [`docs/scheduled-settings.md`](./docs/scheduled-settings.md).
- **Appearance editor & infinite colour picker** — a non-modal, anchored editor that can
  re-typeset a tab, a node title, or a piece of app chrome, backed everywhere by one continuous
  colour field (never a fixed swatch list) with a colour-space translator. See
  [`docs/appearance.md`](./docs/appearance.md) and [`docs/colour-picker.md`](./docs/colour-picker.md).
- **The dim-sum surprise** — a 10% chance at startup of a small, non-blocking card showing one
  randomly chosen dim-sum dish, bilingual name and all. Entirely optional, never gates
  anything. See [`docs/dim-sum.md`](./docs/dim-sum.md).
- **Command palette** — `Ctrl+Shift+F` (and `Cmd/Ctrl+K`, unchanged) opens a palette over every
  command, setting and destination in the app. See [`docs/command-palette.md`](./docs/command-palette.md).

</details>
## Windows

Windows is a first-class desktop target: a native **Squirrel.Windows** installer, a
Windows-shaped default shell (PowerShell/cmd, not `bash`), and a Material title bar with native
window buttons.

**The installer is unsigned.** Code signing is permanently out of scope for this project (see
`CLAUDE.md`'s "Permanent no-signing policy"), so Windows SmartScreen will very likely show a
**"Windows protected your PC"** interstitial the first time you run `Setup.exe` — click **More
info**, then **Run anyway**. This is expected of every unsigned installer from any publisher; it
is not a sign of a corrupted download, and it is not something this project will ever silently
work around by acquiring a certificate.

**Session continuity works, through a different mechanism.** There is no Windows build of tmux
to bundle, so Windows terminals are backed by the **Windows session host** instead — a
standalone Node process, built on the same `node-pty` this app already depends on plus a
headless `xterm.js` for server-side screen state, that owns the real PTYs and outlives the
Electron app. It is selected automatically whenever no real tmux is found on `PATH` (which is
always, on a stock Windows install), and it gives you the same practical guarantee: close the
app, reopen it, and your terminals — and any in-flight agent CLI turn — are still there,
scrollback and all.

Two honest caveats, in the spirit of tmux's own trade-offs:

- **If the session-host process itself dies, its sessions die with it.** It is a standalone
  process this project maintains, not a decades-old, independently-shipped C daemon — a weaker
  guarantee than real tmux, stated plainly rather than glossed over.
- **A machine reboot ends every session either way** — that is true of tmux too. What survives a
  reboot is the **cold-restore path**: a periodically saved scrollback snapshot is replayed into
  the freshly reattached terminal, and a resumable agent CLI is automatically relaunched with
  its own `--resume`/equivalent flag, so you land back roughly where you left off even though
  the underlying process itself did not survive.

If you want tmux-grade durability instead, install a real tmux somewhere on your Windows
`PATH` (MSYS2's `pacman -S tmux`, or Cygwin's tmux package) — nodeterm prefers a system tmux
over its own session host every time one is found. Full detail, architecture, and the protocol
table: [`docs/windows-session-host.md`](./docs/windows-session-host.md) and
[`docs/windows.md`](./docs/windows.md).

## Install / build

Three scripts live at the repository root, each with a Windows `.bat` and a POSIX `.sh`
sibling. A checkout with nothing installed should reach a running app (or a real installer) by
running one of them:

| Script | Windows | macOS / Linux | What it does |
| --- | --- | --- | --- |
| Dependencies | `download-dependencies.bat` | `download-dependencies.sh` | Installs Node.js (if missing) and every npm dependency, from canonical upstreams into a user-scoped location. |
| Build | `build.bat` | `build.sh` | Runs the dependency script, builds `out/`, then offers to launch the app. |
| Installer | `build-installer.bat` | `build-installer.sh` | Runs the dependency script, then packages and verifies the real platform installer (Squirrel on Windows, `.dmg`/`.zip` on macOS, `.AppImage`/`.deb` on Linux). |

All three accept a silent flag (`/s` / `--silent` on Windows, `-s` / `--silent` elsewhere, or a
`SILENT=1` environment variable) for unattended use, and exit non-zero on the first real
failure. None of them ever installs a secret, a credential, or a code-signing certificate.

<details>
<summary><strong>npm scripts, once dependencies are installed</strong></summary>

```bash
npm install        # deps + rebuilds node-pty against Electron's ABI (postinstall hook)
npm run dev         # dev mode with renderer HMR
npm run build       # production build into out/
npm start           # preview the production build
npm run typecheck   # tsc for both the main/preload and renderer projects
npm test            # vitest (unit + integration)
npm run dist:win     # package the Windows Squirrel installer
npm run dist         # package the macOS .dmg + .zip
npm run dist:linux   # package the Linux .AppImage + .deb
npm run server:dev   # build and run the Server Edition
```

</details>

Full detail on every script, including the Windows batch-file traps this project has already
hit and fixed (`NoDefaultCurrentDirectoryInExePath`, CRLF-only `.bat` line endings, the
package-manager `PATH` refresh race): [`docs/building.md`](./docs/building.md).

## Documentation

| Where | What's there |
| --- | --- |
| [Documentation site](https://ding-ding-projects.github.io/material-nodeterm/) | The landing page and browsable docs, published from `site/`. |
| [`docs/features/`](./docs/features/README.md) | One article per feature — behaviour, configuration, failure modes, security, verification — grouped by category. |
| [`docs/app-contract.md`](./docs/app-contract.md) | The desktop app's hand-written feature-completeness guard (`npm run check:app-contract`) — what it checks and why, alongside the site's `check-site-contract.mjs`. |
| [`CLAUDE.md`](./CLAUDE.md) | The deep architecture reference: process boundaries, every subsystem's invariants and the reasoning behind them. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Setup, the process-boundary rules, and the house rules a PR gets sent back for. |
| [`AGENTS.md`](./AGENTS.md) | Guidance for coding agents working in this repository. |
| [`docs/adhd-modes.md`](./docs/adhd-modes.md) | The five ADHD modes: what each does, why they are independent, and the rules the copy follows. |
| [`CHANGELOG.md`](./CHANGELOG.md) | What actually shipped, release by release. |

## Screenshots

The app captures live in [The interface](#the-interface) above. This section is the **site**: the
published documentation site at
[ding-ding-projects.github.io/material-nodeterm](https://ding-ding-projects.github.io/material-nodeterm/),
captured from the deployed page rather than a local server. The full manifest — what each image
shows, the commit it came from, the exact capture method — is in
[`docs/assets/shots/README.md`](./docs/assets/shots/README.md).

<details>
<summary><strong>The site</strong> — light and dark, the regex builder, and a phone layout</summary>

| | |
| --- | --- |
| ![The nodeterm site home page in its light theme](./docs/assets/shots/site-home-light.png) | ![The same site home page in its dark theme](./docs/assets/shots/site-home-dark.png) |
| **Home, light.** | **Home, dark.** |
| ![A search field on the site with the anchored regex builder open beside it](./docs/assets/shots/site-search-regex-builder.png) | ![The site rendered at a 390px phone width](./docs/assets/shots/site-narrow-390.png) |
| **The regex builder**, anchored to the field it belongs to. | **390px phone width** — measured, not eyeballed: no sideways scroll at 390, 768 or 1280. |
| ![The deployed Screenshots room: a three-column gallery of fifteen real app captures, each with a caption, above a note about the two surfaces deliberately absent](./docs/assets/shots/site-screenshots-room.png) | |
| **The Screenshots room** — the site publishing the same captures this README shows, taken from the deployed page. | |

</details>

**Honestly absent rather than staged:** an agent mid-turn (the RUNNING / NEEDS YOU badge and a
subagent fan-out) and an SSH project need a live agent session and a reachable host, so the
capture harness skips them loudly and records why. The canvas shot shows a real, live session
whose pane is empty — [the manifest](./docs/assets/shots/README.md) explains that, and lists the
captures that were taken and discarded rather than shipped.

## Working conventions (sanitized mirror)

> **This section is a mirror, not a source.** It is a sanitized summary of the shared working
> conventions that live in [`CLAUDE.md`](./CLAUDE.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
> [`AGENTS.md`](./AGENTS.md), kept here so they are visible from the repository's front door.
> Edit those files first when a rule changes — this copy is refreshed from them, never edited in
> place — and it deliberately contains no machine-, account- or infrastructure-specific details
> (`scripts/check-instruction-mirror.mjs` enforces both halves of that).

- **Process boundaries are enforced, not advisory.** Platform-free service logic lives in
  `src/core` behind a small platform interface; the desktop shell (`src/main`), the
  browser-edition shell (`src/server`), the one typed preload bridge (`src/preload`) and the
  React UI (`src/renderer`) each stay on their own side, and dedicated tests fail the build on
  an illegal import. Put new service logic in the platform-free core — logic left in a shell
  silently doesn't exist on the other one.
- **Design for three surfaces, every time** — the desktop app, the self-hosted Server Edition,
  and the separately maintained mobile companion. A feature is not finished until each surface
  has a real implementation or a deliberate, visibly documented "not applicable here"; a stub
  that compiles but does nothing is worse than an explicit "not supported".
- **House rules** (each one earned by a real shipped bug): a failed read is never evidence of
  absence; degrade to nothing, never to something wrong; re-validate hand-editable values at the
  point of use, not by their type alone; test generated shell scripts under a real shell;
  credentials never travel as command-line arguments — use a locked-down file or standard input;
  keep parallel shell implementations in sync deliberately; comments explain *why* and name the
  failure they prevent.
- **Testing.** `npm run typecheck` is the fastest correctness gate and `npm test` runs the
  suite. Mutation-test your own guards — deliberately reintroduce the mistake a new check exists
  to catch and watch it go red before trusting it — and never pin behavior by asserting on
  source text.
- **Autonomous work.** Inside an already-authorized task, keep going through natural checkpoints
  without asking permission to continue; when genuinely blocked, state exactly what blocks, what
  is finished, and the smallest unblocking step.
- **Git and commit conventions.** `type(scope): subject` commit subjects (the changelog is
  generated from them); explain *why* a change was made; say plainly what you did **not**
  verify; post PR updates as new comments rather than editing old ones; never commit secrets,
  tokens or credentials.
- **Security boundaries.** Never disclose or characterize anyone's credentials, and never place
  secrets or private infrastructure details — internal hostnames, private IP addresses, account
  names, machine-specific paths — into source, comments, commits or documentation. Where a rule
  cannot be stated without such a detail, describe the *kind* of thing instead of naming the
  specific one.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, the process-boundary rules
(`src/main` / `src/core` / `src/preload` / `src/renderer` / `src/server`), and the testing
habits this repository expects.

## License

[Business Source License 1.1](./LICENSE) (BUSL-1.1) — you may copy, modify, create derivative
works from, and make non-production use of nodeterm freely, plus a production-use grant that
excludes offering it to third parties on a hosted/embedded basis or as a competing commercial
product or service. On the fourth anniversary of a given version's first public release (or the
license's stated Change Date, whichever comes first), that version automatically converts to the
**MIT License**.
