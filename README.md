<div align="center">

<img src="docs/assets/nodeterm.png" alt="nodeterm logo" width="120" height="120" />

# nodeterm

**Terminals, coding agents, projects, and live work arranged on one spatial canvas.**

Instead of hiding every shell behind another tab, nodeterm makes each session a movable node.
Projects can be viewed as a canvas or a board, agent sessions keep their context visible, and
Windows terminals can reconnect through a dedicated session host.

[![Latest release](https://img.shields.io/github/v/release/Ding-Ding-Projects/material-nodeterm?sort=semver)](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/latest)
[![Release pipeline](https://github.com/Ding-Ding-Projects/material-nodeterm/actions/workflows/release.yml/badge.svg)](https://github.com/Ding-Ding-Projects/material-nodeterm/actions/workflows/release.yml)
[![Platform](https://img.shields.io/badge/current%20package-Windows%20x64-0078D4)](#platforms)
[![Design](https://img.shields.io/badge/design-Material%20Design%203-6750A4)](#interface-and-accessibility)
[![License](https://img.shields.io/badge/license-BUSL--1.1-blue)](./LICENSE)

[Download](#install) · [See it](#see-it-in-action) · [Features](#feature-map) ·
[Screenshots](#real-application-screenshots) · [Build](#build-from-source) ·
[Documentation](#documentation) · [Contributing](#contributing) · [License](#license)

**Release baseline documented here:** [v0.4.120](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/tag/v0.4.120),
published 2026-08-26 at 17:32:49 UTC.

</div>

![The nodeterm desktop application showing an empty project canvas, the project and sessions controls, the left destination rail, canvas zoom controls, and the minimap](./docs/assets/shots/app-04-canvas.png)

> [!NOTE]
> This is a downstream project based on
> [eneskirca/nodeterm](https://github.com/eneskirca/nodeterm). The current packaged delivery
> target is Windows x64. The browser-based Server Edition and the separate mobile companion are
> different surfaces with different deployment and verification boundaries.

## Install

The latest verified release baseline for this document is **v0.4.120**:

[**Download nodeterm Setup 0.4.120 for Windows x64**](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/download/v0.4.120/nodeterm-Setup-0.4.120.exe)

| Release file | Purpose | SHA-256 |
| --- | --- | --- |
| [`nodeterm-Setup-0.4.120.exe`](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/download/v0.4.120/nodeterm-Setup-0.4.120.exe) | Squirrel.Windows installer | `b982df10e225900ad6b8c4ec8d70d6658b36dc3be2c2741946aa07c78acf8bf1` |
| [`node-terminal-0.4.120-full.nupkg`](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/download/v0.4.120/node-terminal-0.4.120-full.nupkg) | Full Squirrel package | `1b65192671a44584f04114f2cc901963e2efd8aede63424c5dcf4f2cff6048dd` |
| [`RELEASES`](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/download/v0.4.120/RELEASES) | Squirrel update index | `f9e25fed43951d2f20005bcd8195effaf0c1c1f7a8a3c1b85929bf0e82cfdbe4` |

> [!WARNING]
> **The installer is unsigned.** Code signing is intentionally not used. Windows SmartScreen
> and an unknown-publisher warning may appear. Verify the release commit and SHA-256 above before
> running the installer.

The release workflow builds and packages the application. It does not run tests, lint, or type
checks. Local verification results are separate from the existence of a release.

## See it in action

![A recording of the built nodeterm renderer showing first run, project creation, a real terminal running a command, the command palette, and settings](./docs/assets/app-walkthrough.webp)

The recording was produced from the built `out/` application by
[`scripts/record-app.mjs`](./scripts/record-app.mjs), using a disposable profile and renderer-only
frames. It did not record the operator's desktop. Its source commit, duration, frame count, and
hash are recorded in [`app-walkthrough.json`](./docs/assets/app-walkthrough.json).

## What nodeterm is

nodeterm is a node-based terminal workspace. A project owns a spatial canvas containing real
terminal sessions, coding-agent sessions, notes, files, editors, diffs, browser surfaces, groups,
and service tools. The same project can be opened as a kanban board where cards are the live
sessions rather than copies of them.

The central idea is simple:

1. Put related work next to each other on a canvas.
2. Keep the terminal or agent session attached to the node that represents it.
3. Group sessions by project, task, or Git checkout.
4. Switch to the board when status and ownership matter more than spatial layout.
5. Restore the workspace without pretending that an operating-system reboot preserved a process
   that actually ended.

### Warm reconnect and cold restore

Session continuity has two distinct states:

- **Warm reconnect:** a tmux session or the Windows session-host process is still alive, so the
  application reconnects to the same running session.
- **Cold restore:** the machine or session host restarted. nodeterm restores recorded layout and
  scrollback, then resumes supported agent tools through their own resume mechanisms. The original
  operating-system process did not survive.

That distinction is intentional. A restored view is not described as a process that never stopped.

## Feature map

| Area | What is available | Detailed documentation |
| --- | --- | --- |
| Canvas and nodes | Spatial projects, terminal and agent nodes, notes, groups, editors, diffs, browser surfaces, timers, calendars, media, service nodes, portal doors, child canvases, and recovery activities | [Canvas features](./docs/features/canvas/README.md) |
| Terminals | Local shell profiles, persistent session backends, scrollback restoration, terminal rendering, and word-separator controls | [Terminal features](./docs/features/terminals/README.md) |
| Coding agents | Launch profiles, status hooks, context links, account selection, messaging, and supported capability reporting | [Agent support](./docs/features/agents/agent-support.md) |
| Projects and tabs | Multiple projects, portable project files, project settings, groups, searches, and tab organization | [Project features](./docs/features/projects/README.md) |
| Board | Live-session cards, columns, assignment, priority, due dates, comments, and issue-backed workflows | [Kanban board](./docs/features/kanban/kanban-board.md) |
| Source control | Git status, staging, diffs, commits, publishing, branches, and linked checkouts | [Source control](./docs/features/source-control/README.md) |
| Remote work | SSH projects, approved relay peers, browser-based hosting, and machine-scoped safety boundaries | [Remote features](./docs/features/remote/README.md) |
| Files and media | File conversion, portable media attachments, galleries, downloads, and export workflows | [Feature index](./docs/features/README.md) |
| Portals and multiverse | Depth-bounded child canvases, guided door construction, scope-owned catalogs, project import repair, and preserved portal lifecycle | [Multiverse canvases](./docs/features/canvas/multiverse-canvases.md) |
| Sensors and pipelines | Home Assistant sensor displays plus advanced media, archive, PDF, OCR, and structured-data conversion pipelines | [Integration index](./docs/features/integrations/README.md) |
| Interface | Material Design 3 primitives, appearance editing, logo and app-name controls, language modes, narrator, schedules, notifications, and the local Easter egg cabinet | [Appearance](./docs/features/appearance/README.md) |
| History and recovery | Local Git-backed history, settings history, changelog browsing, exports, and explicit recovery states | [Local history](./docs/local-history.md) |
| Accessibility | Keyboard operation, visible focus, reduced motion, language modes, attention accommodations, responsive layouts, and screen-reader semantics | [ADHD modes](./docs/adhd-modes.md) |
| Windows delivery | Shell-profile detection, Windows session host, Squirrel packaging, unsigned updates, and installer behavior | [Windows support](./docs/windows.md) |

<details>
<summary><strong>Expanded feature inventory</strong></summary>

### Spatial workflow

- Pan and zoom across a project rather than losing sessions inside a flat tab stack.
- Create terminal, coding-agent, sticky-note, group, editor, diff, browser, timer, calendar,
  gallery, download, virtual-machine, and service-oriented nodes.
- Create and navigate depth-bounded child canvases through guided doors, preserve portal state
  through import and deletion, and use the scoped recovery activity where a portal requires it.
- Nest and label groups, and bind a group to a linked Git checkout.
- Move between Canvas, Board, Files, Tools, History, Status, Alerts, Settings, and Kids surfaces.
- Keep project settings separate from global settings through explicit scope controls.

### Coding-agent workflow

- Launch Claude Code, Codex, Gemini, GitHub Copilot, opencode, Grok, or a validated custom profile.
- Read status from tool integrations rather than guessing from terminal text.
- Display running, waiting, and attention states on the session that owns them.
- Link session context so one agent can read another session's shared transcript on demand.
- Keep account and model choices scoped to the selected launch profile.

### Organization and search

- View the same project as a spatial canvas or as a board.
- Search project tabs, settings, history, notifications, and feature collections.
- Open the command palette to reach destinations and actions.
- Use plain-text search by default and open the adjacent regex workbench when needed.
- Persist project order, groups, settings scope, and local history.

### Personalization and accessibility

- Choose English, playful Hong Kong-style Cantonese, or bilingual presentation.
- Adjust English and Cantonese tone independently.
- Enable the narrator explicitly and choose voices for each narrated language.
- Configure theme, density, accent, fonts, app name, app logo, schedules, and per-element
  appearance controls.
- Enable Focus, Low stimulation, Time awareness, One thing at a time, and Momentum independently.
- Use keyboard-visible focus, reduced-motion behavior, screen-reader labels, and responsive layouts.

### Local utility surfaces

- Review notification history and application status.
- Browse a local changelog with dates and commit references.
- Export records and filtered views in formats that preserve their fields.
- Use local file conversion adapters with explicit capability and loss warnings.
- Use advanced media, archive, PDF, OCR, and structured-data pipelines through the same converter
  boundary, including honest unavailable-adapter states.
- Display Home Assistant sensor values as canvas nodes through the trusted local service boundary.
- Manage local Ollama models and chats through the documented loopback API boundary.
- Use toy locks as an explicitly non-security speed bump, with local recovery documentation.

</details>

## Real application screenshots

Every image in this section is grouped by what it proves. A built-renderer capture, a packaged
application capture, and a deployed documentation-page capture are not interchangeable evidence.

### Built renderer

The main desktop gallery below comes from built source commit
[`95929ff8`](https://github.com/Ding-Ding-Projects/material-nodeterm/commit/95929ff88983ed7d9e3bfc96702ed7b1591e0003).
The complete capture run is preserved in the
[historical manifest](https://github.com/Ding-Ding-Projects/material-nodeterm/blob/01bfbcabcf9b102ceda825c1feefb331d368f4e5/docs/assets/shots/capture-manifest.json).
These images demonstrate that recorded build. They are not a claim that current `HEAD` is
pixel-identical.

#### Main desktop surfaces

| Canvas | Board |
| --- | --- |
| ![The empty project canvas with the destination rail, project selector, sessions panel, zoom controls, status chips, and minimap](./docs/assets/shots/app-04-canvas.png) | ![The project board with Ungrouped, To Do, In Progress, and Done columns](./docs/assets/shots/app-05-kanban.png) |
| The normal application shell around an empty project. | The project represented as live workflow columns. |

| History | Settings |
| --- | --- |
| ![The History destination with session memory, settings history, and changelog tabs](./docs/assets/shots/app-06-history.png) | ![The settings surface with its search field, category navigation, global and project scopes, and agent controls](./docs/assets/shots/app-02-settings.png) |
| Local records and released-change history in one destination. | Searchable global and per-project settings. |

![The application status surface with status cards and evidence-oriented state reporting](./docs/assets/shots/app-status-surface.png)

The Status destination keeps operational state separate from promotional messaging.

#### Language, narration, appearance, and attention settings

| Language | Narrator |
| --- | --- |
| ![Language settings with English, Cantonese, and Bilingual modes, two independent tone sliders, and the dialog emoji switch](./docs/assets/shots/app-settings-language.png) | ![Narrator settings with opt-in controls, narrated language selection, per-language voice selection, rate, pitch, and effective-voice status](./docs/assets/shots/app-settings-narrator.png) |

| Appearance editor | Attention accommodations |
| --- | --- |
| ![The per-element appearance editor with typography, color, shape, spacing, state, and reset controls](./docs/assets/shots/app-settings-appearance-editor.png) | ![Five independent attention accommodation switches with plain descriptions and a non-medical disclosure](./docs/assets/shots/app-adhd-modes.png) |

![App name and logo settings with preset marks, local custom-image controls, and reset actions](./docs/assets/shots/app-settings-app-identity.png)

#### Kids mode and grown-up controls

| Kids home | Grown-up gate | Grown-up screen |
| --- | --- | --- |
| ![Kids mode home with activity choices and its terminal-sandbox limitation stated on screen](./docs/assets/shots/app-kids-home.png) | ![The grown-up gate with a PIN keypad and cancellation controls](./docs/assets/shots/app-kids-gate.png) | ![The grown-up screen with time, limits, stickers, sessions, activity history, and permission controls](./docs/assets/shots/app-kids-parent.png) |

Kids mode is a user-experience surface. Its gate is not described as encryption or protection from
someone who controls the computer.

<details>
<summary><strong>Docker host settings</strong></summary>

![Docker host settings with machine-scoped configuration, searchable controls, and explicit availability states](./docs/assets/shots/app-settings-docker-host.png)

This newer single screenshot is proven by the current
[`capture-manifest.json`](./docs/assets/shots/capture-manifest.json), which records source commit
`4031672e926fe249b5c0f2a0895af1714d8848e0` and a built `out/` application capture.

</details>

### Packaged Windows interaction evidence

The images below were captured from `dist/win-unpacked/nodeterm.exe` through the headless Windows
desktop route. Their hashes, candidate executable hash, and run metadata are in
[`packaged-capture-manifest.json`](./docs/assets/shots/packaged-capture-manifest.json).

| Profile picker | Missing-profile state |
| --- | --- |
| ![Packaged nodeterm Shell settings showing the selected automatic Windows PowerShell profile, detected profiles, availability states, refresh action, and custom executable picker](./docs/assets/shots/packaged/windows-terminal-profile-picker.png) | ![Packaged nodeterm showing an unavailable terminal profile with the exact reason and no silent fallback](./docs/assets/shots/packaged/windows-terminal-profile-unavailable.png) |

Only the two settings captures above are embedded here. The same packaged run also produced
terminal-session captures, but those frames expose a local account path and dense session payload
text, so this public README deliberately does not promote them.

> [!IMPORTANT]
> This packaged run recorded partial acceptance, not complete installer acceptance. Its remaining
> blockers were lossless clipboard restore and proof from an installed Squirrel artifact.

### Current documentation and landing surface

The documentation and landing surface was recaptured from commit
[`1ec54fa8`](https://github.com/Ding-Ding-Projects/material-nodeterm/commit/1ec54fa88552e9286090597d048534fcc8d51e93)
after its Windows-only release copy was brought current. The static output was hashed, served from a
task-owned loopback endpoint, and opened as the sole page in an isolated Microsoft Edge profile on an
off-screen Windows desktop. Desktop and emulated mobile audit receipts both validated with zero
console errors, unhandled exceptions, failed resources, unexpected third-party requests, unnamed
interactive accessibility nodes, or body overflow.

| Hallway | Home |
| --- | --- |
| ![The current nodeterm documentation hallway with searchable feature doors and a single Jump control](docs/assets/shots/site-current/site-hall-current.png) | ![The current nodeterm documentation Home room showing version 0.4.120, Windows download actions, feature cards, and the navigation rail](docs/assets/shots/site-current/site-home-current.png) |

| Documentation | Changelog |
| --- | --- |
| ![The current nodeterm documentation index with bulk selection, per-article actions, local search, and 23 guide entries](docs/assets/shots/site-current/site-docs-current.png) | ![The current nodeterm changelog showing the published version 0.4.120 release and Windows-scope history](docs/assets/shots/site-current/site-changelog-current.png) |

| Settings | Screenshot gallery |
| --- | --- |
| ![The current nodeterm settings room showing language, appearance, identity, School mode, narrator, and personal-vocabulary cards](docs/assets/shots/site-current/site-settings-current.png) | ![The current nodeterm screenshot room showing the built desktop capture gallery and searchable navigation](docs/assets/shots/site-current/site-screenshots-current.png) |

| Pattern builder | Appearance controls |
| --- | --- |
| ![The current nodeterm pattern builder open beside the settings search with guided tokens, sample text, and apply controls](docs/assets/shots/site-current/site-search-regex-current.png) | ![The current nodeterm appearance settings card filtered in place with theme, color, preset, text-size, logo, save, load, and reset controls](docs/assets/shots/site-current/site-appearance-current.png) |

![The current nodeterm documentation navigation at a 390 pixel emulated mobile viewport with touch-sized controls and no body overflow](docs/assets/shots/site-current/site-mobile-home-current.png)

The complete hashes, viewport tuples, audit summary, and raw-frame relationships are recorded in
[`docs/assets/recordings/site/`](docs/assets/recordings/site/README.md).

## Feature usage recordings

Each GIF below records real navigation or settings search against the same static output at commit
`1ec54fa8`. The GIFs are 720 by 450 visual derivatives of retained raw PNG frame sequences. They
contain no audio and do not replace the full-resolution still captures as evidence.

<details>
<summary><strong>Every documentation destination</strong></summary>

| Home | Guide book |
| --- | --- |
| ![Animated use of the Home destination](docs/assets/recordings/site/site-room-home.gif) | ![Animated use of the Guide book destination](docs/assets/recordings/site/site-room-docs.gif) |

| What changed | Messages |
| --- | --- |
| ![Animated use of the What changed destination](docs/assets/recordings/site/site-room-changelog.gif) | ![Animated use of the Messages destination](docs/assets/recordings/site/site-room-notes.gif) |

| Time machine | Code maker |
| --- | --- |
| ![Animated use of the Time machine destination](docs/assets/recordings/site/site-room-history.gif) | ![Animated use of the Code maker destination](docs/assets/recordings/site/site-room-auth.gif) |

| Model shop | Turn-it-into |
| --- | --- |
| ![Animated use of the Model shop destination](docs/assets/recordings/site/site-room-shop.gif) | ![Animated use of the Turn-it-into destination](docs/assets/recordings/site/site-room-convert.gif) |

| Take it home | Dim sum |
| --- | --- |
| ![Animated use of the Take it home destination](docs/assets/recordings/site/site-room-export.gif) | ![Animated use of the Dim sum destination](docs/assets/recordings/site/site-room-dish.gif) |

| Checklist | Screenshots |
| --- | --- |
| ![Animated use of the Checklist destination](docs/assets/recordings/site/site-room-coverage.gif) | ![Animated use of the Screenshots destination](docs/assets/recordings/site/site-room-shots.gif) |

| Remote access | Playroom |
| --- | --- |
| ![Animated use of the Remote access destination](docs/assets/recordings/site/site-room-pair.gif) | ![Animated use of the Playroom destination](docs/assets/recordings/site/site-room-play.gif) |

![Animated use of the Settings destination](docs/assets/recordings/site/site-room-settings.gif)

</details>
The full inventory of what nodeterm writes where (and what the script keeps, like the
`.nodeterm/` canvas folders inside your own repos) is documented in
[docs/uninstall.md](docs/uninstall.md).

## 🛠 Build from source

### The canvas

Right-click to open a **terminal** or an **agent** node. Alongside them live **sticky notes**
(link one to a terminal to feed it context on demand), **Monaco editors**, **diff views**, web and
browser views, annotations, and a family of **service managers** — Minecraft, Docker host,
Proxmox, GitLab, Home Assistant and FreePBX — each an ordinary node you drag, colour, group and
persist like any other, because a managed service is something you arrange beside the terminals
working on it, not a modal you visit.

The canvas also includes a **Torrent Downloader** node for explicit local WebTorrent tasks, with
magnet or `.torrent` intake, safe destination selection, file-level metadata choices, live transfer
progress, restart recovery, and a bounded per-task seeding policy.

**Group** nodes are real containers that nest inside each other and can bind to a git worktree, so
every node created inside one inherits that worktree's directory. Quit the app and the persistent
backend reattaches to the live session; reboot the machine and cold restore rebuilds the node,
replays saved scrollback and resumes a supported agent CLI — it does not preserve the original OS
process, and says so.

Each Multiverse and AWS Universe child canvas also owns one fixed **Shop** node. It opens the
scope-bound catalog, keeps a deterministic identity across import, hydration, undo and peer replay,
and refuses deletion, duplication, grouping, or movement. Live choices are handed to the unified
Node Catalog creation coordinator with immutable event ids and collision-free placement. The root
canvas has no Shop. See the
[special-universe Shop article](./docs/features/integrations/aws-universe-shop.md) for the
portable metadata, repair records, disabled AWS entries, and verification boundary.

The AWS Universe navigator creates unlimited AWS-only child canvases in the project root. Each
instance starts with one fixed scoped Shop, supports guided local search with an adjacent regex
builder, and preserves safe schema 3 intent without carrying credentials or local runtime state.
See the [AWS Universe portal article](./docs/features/canvas/aws-universe.md).

A project can now create and navigate a scoped **Multiverse canvas hierarchy** from the canvas app
bar. The guided parent picker searches names, depths, and identifiers with its adjacent regex
builder, explains why depth-8 parents cannot accept another child, and preserves each child canvas
through ordinary project files and portable schema 3 import and export. See the
[Multiverse child canvases article](./docs/features/canvas/multiverse-canvases.md).

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

Every terminal on Windows uses a detected `tmux.exe` or `psmux` session when one is available.
Otherwise nodeterm uses the bundled [Windows session host](#windows), a standalone process that
owns the real PTYs and outlives the app. A shell and anything running inside it can therefore
survive closing a node, switching projects, and quitting the app. See [Windows](#windows) for the
two honest caveats.

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
  rail's Tools destination or the command palette. It reserves collision-safe output names,
  publishes validated output atomically, reports partial batch outcomes, and opens completed files
  directly in Visual Studio Code. See
  [`docs/file-converter.md`](./docs/file-converter.md).
- **Automatic node dependency installation** — a shared manifest and privileged, machine-local
  lifecycle for canonical HTTPS downloads, SHA-256 verification, portable user-scoped installs,
  cache reuse, repair, cancellation, and restart reconciliation. Node Catalog `Install and
  continue` wiring and focused verification remain in progress. See
  [`docs/features/dependencies/automatic-node-dependencies.md`](./docs/features/dependencies/automatic-node-dependencies.md).
- **Shared hosted-resource backup and restore** — versioned, edition-aware, ownership-reviewed
  archives with bounded ZIP validation, explicit omissions, progress, cancellation, atomic
  publication, and rollback contracts for hosted-service nodes. See
  [`docs/features/integrations/backup-restore.md`](./docs/features/integrations/backup-restore.md).
- **Local Ollama suite manager** — a local manager for [Ollama](https://ollama.com) that talks
  only to its documented local HTTP API, never a cloud service. See
  [`docs/ollama-manager.md`](./docs/ollama-manager.md).
- **Torrent Downloader** — local WebTorrent downloads with magnet and `.torrent` intake,
  metadata/file selection, safe destination preflight, progress, pause/resume/cancel/retry,
  restart reconciliation, and bounded per-task seeding. See
  [`docs/features/torrents/torrent-downloader.md`](./docs/features/torrents/torrent-downloader.md).
- **Calendar nodes** — local calendars and ICS import, with guided CalDAV, Google Calendar, and
  Microsoft 365 account/calendar pickers, recurrence and timezone views, offline cache, and
  reviewable create/edit/delete actions. Provider credentials remain in the trusted shell's vault;
  project files carry only portable selection intent. See
  [`docs/features/canvas/node-kinds.md`](./docs/features/canvas/node-kinds.md).
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

**Session continuity works, through a Windows-aware resolver.** The desktop searches `PATH` for
`tmux` first and then the tmux-compatible `psmux` executable, using `PATHEXT` so `.exe` and package
manager shims are discovered just like native Windows commands. When neither is installed,
terminals use the **Windows session host** instead — a standalone Node process, built on the same
`node-pty` this app already depends on plus a headless `xterm.js` for server-side screen state,
that owns the real PTYs and outlives the Electron app. Close the app, reopen it, and terminals —
and any in-flight agent CLI turn — remain available with scrollback and the selected persistence
backend.

Two honest caveats, in the spirit of tmux's own trade-offs:

- **If the session-host process itself dies, its sessions die with it.** It is a standalone
  process this project maintains, not a decades-old, independently-shipped C daemon — a weaker
  guarantee than real tmux, stated plainly rather than glossed over.
- **A machine reboot ends every session either way** — that is true of tmux too. What survives a
  reboot is the **cold-restore path**: a periodically saved scrollback snapshot is replayed into
  the freshly reattached terminal, and a resumable agent CLI is automatically relaunched with
  its own `--resume`/equivalent flag, so you land back roughly where you left off even though
  the underlying process itself did not survive.

If you want tmux-grade durability instead, install `psmux` with Windows Package Manager
(`winget install -e --id marlocarlo.psmux`) or place a compatible `tmux.exe` on your Windows
`PATH` — nodeterm prefers `tmux`, then `psmux`, over its own session host every time one is found.
Full detail, architecture, and the protocol table: [`docs/windows-session-host.md`](./docs/windows-session-host.md) and
[`docs/windows.md`](./docs/windows.md).

## Install / build

Three Windows scripts live at the repository root. A checkout with nothing installed should
reach a running app, or a real installer, by running one of them:

| Script | Command | What it does |
| --- | --- | --- |
| Dependencies | `download-dependencies.bat` | Installs Node.js when missing and every npm dependency from canonical upstreams into a user-scoped location. |
| Build | `build.bat` | Runs the dependency script, builds `out/`, then offers to launch the app. |
| Installer | `build-installer.bat` | Runs the dependency script, then packages and verifies the unsigned Squirrel.Windows installer. |

All three accept `/s`, `--silent`, or a `SILENT=1` environment variable for unattended use and
exit non-zero on the first real failure. None of them ever installs a secret, a credential, or a
code-signing certificate.

<details>
<summary><strong>Every settings feature card</strong></summary>

| About you | How it looks |
| --- | --- |
| ![Animated settings search revealing the About you card](docs/assets/recordings/site/site-setting-you.gif) | ![Animated settings search revealing the How it looks card](docs/assets/recordings/site/site-setting-look.gif) |

| Words and jokes | Read it to me |
| --- | --- |
| ![Animated settings search revealing the Words and jokes card](docs/assets/recordings/site/site-setting-words.gif) | ![Animated settings search revealing the Read it to me card](docs/assets/recordings/site/site-setting-narrator.gif) |

| School mode | My own words |
| --- | --- |
| ![Animated settings search revealing the School mode card](docs/assets/recordings/site/site-setting-school.gif) | ![Animated settings search revealing the My own words card](docs/assets/recordings/site/site-setting-vocab.gif) |

| Toy locks | Timers |
| --- | --- |
| ![Animated settings search revealing the Toy locks card](docs/assets/recordings/site/site-setting-safety.gif) | ![Animated settings search revealing the Timers card](docs/assets/recordings/site/site-setting-timers.gif) |

| Download demo | ADHD modes |
| --- | --- |
| ![Animated settings search revealing the Download demo card](docs/assets/recordings/site/site-setting-demo.gif) | ![Animated settings search revealing the ADHD modes card](docs/assets/recordings/site/site-setting-adhd.gif) |

</details>

### Evidence that is still missing

The repository does not claim visual proof it does not have. Current gaps include:

- A current desktop light-theme capture.
- An agent session captured mid-turn.
- A live SSH project capture.
- The elapsed-time chip for Time awareness.
- Complete packaged clipboard-restore acceptance.
- Interaction proof from an installed Squirrel package.

See [`docs/assets/shots/README.md`](./docs/assets/shots/README.md) for the longer capture history,
including discarded captures and known harness limits.

## Interface and accessibility

The desktop shell uses Material Design 3 structure and a custom application title bar. Product
chrome, settings, overlays, controls, focus states, and motion are governed by shared design
tokens rather than one-off component styling.

The user-facing interface includes:

- English, playful Hong Kong-style Cantonese, and bilingual modes.
- Independent tone controls for English and Cantonese.
- Keyboard navigation and visible focus.
- Screen-reader names, roles, values, and state changes.
- Reduced-motion handling.
- Responsive layouts and high-display-scale constraints.
- Focus, Low stimulation, Time awareness, One thing at a time, and Momentum modes, all off by
  default and independently controlled.
- Search fields with adjacent regex-builder access.
- Non-blocking operational notifications plus a reviewable notification history.
- Local settings history and reversible restore paths.

Implementation coverage and open defects are tracked in
[`docs/features/appearance/material-3-audit.md`](./docs/features/appearance/material-3-audit.md)
and [`docs/features/appearance/material-3-migration-status.md`](./docs/features/appearance/material-3-migration-status.md).

## Platforms

| Surface | Current delivery state |
| --- | --- |
| Windows desktop | Active packaged target. The release includes an unsigned Squirrel.Windows installer for x64. |
| Server Edition | Self-hosted browser surface built from the shared core and renderer. It is not the desktop package. |
| Mobile companion | Separate native client for attached sessions. It is not the responsive browser edition. |
| Linux desktop | Source support exists historically, but it is not part of the current release workflow. |

The Windows desktop build uses a standalone session host when no real tmux is available. Shell
profiles are selected by stable identifiers and resolved at the trusted process boundary. A
missing explicit profile remains unavailable and does not silently open a different shell.

## Build from source

The repository root contains the intended Windows entry points:

| Script | Result |
| --- | --- |
| `download-dependencies.bat /s` | Resolves the pinned toolchain and project dependencies without interactive prompts. |
| `build.bat /s` | Builds the runnable application from the checkout. |
| `build-installer.bat /s` | Builds and verifies the unsigned Squirrel.Windows installer set without publishing it. |

For an interactive local development environment after dependencies are available:

```powershell
npm run dev
npm run typecheck
npm test
npm run build
npm run check:wired
```

> [!CAUTION]
> At the baseline of this README rewrite, `main` contains a pre-existing malformed
> `package.json` caused by duplicated merged script blocks. That defect prevents package-manager
> commands from parsing the file. The commands above describe the repository's intended entry
> points and are not claimed as green until
> [issue #98](https://github.com/Ding-Ding-Projects/material-nodeterm/issues/98) is repaired.

Build details, toolchain behavior, and the one-click script contract are documented in
[`docs/building.md`](./docs/building.md). Windows packaging and updates are documented in
[`docs/features/packaging/packaging-and-auto-update.md`](./docs/features/packaging/packaging-and-auto-update.md).

<details>
<summary><strong>Architecture</strong></summary>

| Path | Responsibility |
| --- | --- |
| `src/core/` | Platform-free services for sessions, projects, settings, Git, agent integrations, remote operations, history, and utilities. |
| `src/main/` | Desktop shell, native windows, dialogs, operating-system integration, IPC, and the desktop implementation of the core platform seam. |
| `src/server/` | Server Edition shell using HTTP, WebSocket, authentication, and browser-facing RPC without desktop-framework imports. |
| `src/preload/` | Narrow typed bridge exposed to the renderer with context isolation enabled. |
| `src/renderer/` | React application, canvas, nodes, settings, boards, history, and user-facing surfaces. |
| `src/shared/` | Cross-boundary types, channel names, capability contracts, and portable schemas. |

The renderer reaches host capabilities only through the typed bridge. Platform-neutral service
logic belongs in `src/core/`, not inside the desktop shell. The Server Edition and desktop shell
must implement the same declared behavior or expose a documented unavailable state.

See [`CLAUDE.md`](./CLAUDE.md) for subsystem invariants,
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for contributor-facing rules, and
[`docs/SERVER.md`](./docs/SERVER.md) for the browser-hosted architecture.

</details>

## Project scale

The latest published count is tied to release
[`v0.4.120`](https://github.com/Ding-Ding-Projects/material-nodeterm/releases/tag/v0.4.120) and
was generated by the committed `node scripts/count-lines.mjs` counter at commit `c6820730`.

| Category | Total lines | Non-blank lines | Files |
| --- | ---: | ---: | ---: |
| Source | 263,518 | 248,764 | 1,148 |
| Tests | 166,389 | 150,170 | 825 |
| Styles | 28,065 | 26,363 | 10 |
| Documentation | 38,816 | 32,315 | 152 |
| Configuration | 3,378 | 3,324 | 17 |
| **Project total** | **500,166** | **460,936** | **2,152** |

The counter excludes dependency directories, build output, lockfiles, bundled third-party
licenses, binary assets, and vendored runtime files. It attributes surviving lines with
`git blame`, not cumulative additions. At that release, 429,058 surviving lines were attributed
to automation identities, 54,636 to people, and 16,472 were unknown or unresolvable.

**Human implementation-time estimate:** roughly **8 to 21 full-time person-years** for the
460,936 non-blank lines, using 100 to 250 reviewed non-blank lines per person-day and 220 working
days per year:

```text
460,936 / (250 × 220) = 8.4 person-years
460,936 / (100 × 220) = 21.0 person-years
```

This is an estimate, not a measured duration. It excludes the same files as the committed counter
and does not treat a larger number as a quality claim.

## Documentation

| Resource | Purpose |
| --- | --- |
| [Documentation site](https://ding-ding-projects.github.io/material-nodeterm/) | Browse the landing and documentation surface. It is not the primary application runtime. |
| [`docs/features/`](./docs/features/README.md) | Categorized feature articles covering behavior, configuration, failure modes, security, and verification. |
| [`docs/app-contract.md`](./docs/app-contract.md) | Hand-written desktop feature coverage inventory and completeness checks. |
| [`docs/uh-feature-inventory.md`](./docs/uh-feature-inventory.md) | Cross-feature implementation and evidence inventory. |
| [`docs/ci-and-releases.md`](./docs/ci-and-releases.md) | Current release workflow, unsigned packaging, and verification boundaries. |
| [`docs/windows.md`](./docs/windows.md) | Windows terminal profiles, session behavior, packaging, and known limits. |
| [`docs/assets/shots/README.md`](./docs/assets/shots/README.md) | Screenshot provenance, capture methods, discarded captures, and evidence gaps. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release history linked to the commits that produced each change. |
| [`ROADMAP.md`](./ROADMAP.md) | Checked roadmap of completed and remaining work. |
| [`HANDOFF.md`](./HANDOFF.md) | Current implementation state, verification evidence, and open work. |

## Working conventions

> **This is a mirror, not a source.** It is a sanitized summary of the project guidance in
> [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md), and
> [`CONTRIBUTING.md`](./CONTRIBUTING.md). It contains no private infrastructure, credentials,
> account data, or machine-specific routes.

- **Process boundaries are enforced.** Keep platform-free behavior in `src/core/` behind the
  declared platform seam.
- **Design for three surfaces.** Desktop, Server Edition, and mobile behavior each need a real
  implementation or an explicit, documented unavailable state.
- **House rules.** Treat failed reads as unknown, degrade to explicit unavailability rather than
  a guessed substitute, validate editable values at use time, and test generated shell code in a
  real shell.
- **Testing.** Run focused local verification, state what was not verified, and deliberately
  break new completeness checks once to observe red before restoring green.
- **Git and commit conventions.** Preserve unrelated local work, use scoped commits that explain
  why the behavior changed, and never rewrite shared history merely to simplify integration.
- **Security boundaries.** Pass credentials through protected storage or standard input, never
  plain command arguments, and keep secrets plus private infrastructure out of public records.

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md), then read
[`CLAUDE.md`](./CLAUDE.md) for the subsystem you are changing.

Before opening a pull request:

1. Keep the change on the correct process side.
2. Update the affected feature article and changelog.
3. Run the smallest decisive local checks, then the full relevant suite when practical.
4. Capture visible behavior from the real built application when the interface changed.
5. Describe what changed, why it changed, and what remains unverified.

The canonical upstream source is pinned at `upstream/nodeterm` as a Git submodule. Updating that
pin is a deliberate review operation, not a side effect of fetching this repository.

## License

nodeterm is distributed under the [Business Source License 1.1](./LICENSE). The Additional Use
Grant permits use, modification, redistribution, and production use except for offering the
software as a competing hosted, embedded, or standalone product or service. Each version converts
to the license stated in `LICENSE` on its change date.

See [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) for bundled open-source components and
their notices.
