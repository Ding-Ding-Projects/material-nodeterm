# nodeterm feature documentation

Every feature nodeterm ships has its own article in a category below: what it does, how to
configure it, how it fails, what it means for security, and how it's verified. This index is
the front door — start here, or jump straight to a category.

If you are new to the project, read [`../../README.md`](../../README.md) first for the pitch
and the install line, then come back here for depth. [`../../CLAUDE.md`](../../CLAUDE.md) is
the deep architecture reference these articles are distilled from.

## Categories

| Category | What's in it |
| --- | --- |
| [Terminals](./terminals/README.md) | Real shells as nodes, persistent backends across app restarts, and cold restore after reboot. |
| [Canvas](./canvas/README.md) | The pan/zoom surface, every node kind, and the terminal-node lifecycle. |
| [Multiverse](./multiverse/README.md) | Scoped child canvases and staged portal-door construction. |
| [Projects](./projects/README.md) | Projects as tabs, per-project canvases, persistence and folder binding. |
| [Agents](./agents/README.md) | Claude Code, Codex, Gemini, opencode, Grok, Cognition Devin and custom agent CLIs as nodes. |
| [Source control](./source-control/README.md) | The git panel, and git worktrees bound to canvas group frames. |
| [Kanban](./kanban/README.md) | The Trello-style board that mirrors a project's live sessions as cards. |
| [Appearance](./appearance/README.md) | Design tokens, themes, and the measured state of the Material Design 3 migration. |
| [Remote & SSH](./remote/README.md) | Remote projects, the self-hosted browser edition, and isolated debugging browser sessions. |
| [Speech](./speech/README.md) | On-device dictation into any terminal. |
| [Converter pipelines](./converter/README.md) | Bounded offline file, image, ZIP, PDF, OCR, and structured-data conversion. |
| [Packaging](./packaging/README.md) | How builds are produced, distributed, and kept up to date. |
| [Dependency installation](./dependencies/README.md) | The manifest and machine-local lifecycle that installs prerequisites for node features. |
| [Torrents](./torrents/README.md) | Explicit local WebTorrent tasks with safe destinations, progress, recovery, and bounded seeding. |
| [Files and conversion](./files/README.md) | Local file conversion, collision-safe destinations, honest capability gaps, and completed-output handoff. |
| [File conversion and pipelines](./converter/README.md) | Guided local media, archive, PDF, OCR, and structured-data operations with bounded resources. |
| [Global and project settings](./global-and-project-settings.md) | Durable app defaults and complete sparse per-project overlays. |
| [Help](./help/README.md) | The in-app offline documentation browser these articles are read in. |
| [Calendar](./calendar/README.md) | Local, ICS, CalDAV, Google Calendar, and Microsoft 365 calendar nodes with offline cache and guided provider binding. |
| [Hosted service nodes](./hosting/README.md) | Guided local-first Docker service managers with portable intent and machine-local bindings. |
| [AWS managers](./aws/README.md) | Resource Explorer and Cloud Control manager nodes with local bindings, operation previews, bounded results, and cancellation. |
| [Browser](./browser/README.md) | Browser Portal profiles, tabs, lifecycle ownership, and embedded-browser boundaries. |
| [Automation](./automation/README.md) | Content-bound triggers with explicit local consent and bounded run history. |

## How these articles are organized

Every article follows the same shape, so you can skim for the part you need:

- **Behaviour** — what happens, in plain terms, including the non-obvious parts.
- **Configuration** — the settings that change it, and their defaults.
- **Failure modes** — what happens when something is missing, unreachable, or wrong, and how
  that is reported (nodeterm's own rule throughout the codebase: a failed read is never
  reported as "there is nothing" — the two are different facts).
- **Security considerations** — anything that touches credentials, local files, or another
  machine.
- **Verification** — how to check the feature actually works, for yourself or in review.
- **Suggested articles** — where to go next.

## Three surfaces

Most features exist on more than one of nodeterm's three shells, and behave slightly
differently (or not at all) on each:

1. **Desktop** — the Electron app for Windows (the delivery target; Linux packages are also built).
2. **Server Edition** — the same renderer, self-hosted and reached from any browser.
3. **Mobile companion** — a separate iOS app that attaches to the same live sessions.

Each article says explicitly which surfaces a feature reaches and how it degrades on the
others, rather than assuming "the app" means only the desktop build.
