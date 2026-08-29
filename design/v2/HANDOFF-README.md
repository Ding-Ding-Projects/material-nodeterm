# Handoff: nodeterm — full Material Design 3 rewrite

## Overview
A complete Material Design 3 (classic, Google-app register) rewrite of the nodeterm Electron
renderer, covering every product surface with no gaps: canvas + all node kinds, kanban board,
explorer / source control / git history, full settings, command palette + every dialog/overlay,
notifications, welcome, kids mode, Tools (Ollama manager, file converter, authenticator + toy
locks, exports), and History (session memory, local settings history, changelog).

Target codebase: `material-nodeterm` — Electron + React + TypeScript, renderer at
`src/renderer/`, styles in `src/renderer/styles.css` (~7000 lines), theme keyed off
`html[data-theme='light']` set by `App.tsx`.

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — clickable
prototypes showing intended look and behavior, NOT production code to copy directly. Open any of
them in a browser (keep `support.js` and `md3/` beside them). The task is to **recreate these
designs inside the existing renderer** (React + the existing class-based `styles.css`), using its
established patterns. One file IS production-ready as-is: `md3/tokens.css`.

## Fidelity
**High-fidelity.** Colors, radii, sizes, spacing and type are final. Recreate pixel-perfectly.

## Implementation order (the wiring plan)

1. **Tokens first — `md3/tokens.css` is drop-in.** Import it ahead of the existing rules (or
   paste its two blocks over the current `:root` / `[data-theme='light']` ramps). It uses the
   SAME `--md-*` names the app already speaks (`--md-surface`, `--md-surface-container*`,
   `--md-outline-variant`, `--md-primary`, …), so most of `styles.css` re-themes without edits.
   Delete the old `--md-tone-*` ramp definitions. `--term-bg` is fixed dark in BOTH themes
   (decision: terminal bodies never go light). Update `styles.theme.test.ts` to assert the new
   baseline literals. Keep `applyAccentTokens` (`lib/accentTokens.ts`) as the accent-override
   path; #6750A4 is the new default seed.
2. **Nav rail replaces the bottom dock** — new `src/renderer/components/NavRail.tsx`.
   88px wide, `--md-surface-container`. Top: FAB 56×56, r16, `--md-primary-container`, icon
   `add` 26px — owns node creation (the old dock's menu becomes the FAB menu; keep `⌘T`, `⌘⇧C`).
   Destinations (top→bottom): Canvas `workspaces`, Board `view_kanban`, Files `folder`,
   Tools `construction`, History `history`, Alerts `notifications` (error badge),
   Settings `settings`; Kids `child_care` pinned at the bottom. Active = 56×32 pill
   `--md-secondary-container` + FILLed icon + 600-weight label; label 11-12px under every icon.
   Remove `Dock.tsx` from the canvas layer; retire `.dock*` rules.
3. **Project tab strip becomes a project switcher menu button** in the top app bar
   (replaces `.tabbar` pill segments): 44px pill, `--md-secondary-container`, project color dot
   10px, name 14.5px/600, unread badge (`--md-error` pill), `arrow_drop_down`. The caret menu
   (project list, branch quick-pick, missing/remote states) moves inside this menu. Remote
   projects keep a separate outlined chip: 32px, r8, 1px `--md-outline-variant`, `vpn_key` icon.
4. **Top app bar**: 64px, `--md-surface-container`, flat (no border/shadow). Traffic lights
   (mac) / none on `data-platform='win'`. Brand tile 38px r14 `--md-primary-container` + 17px/600
   wordmark. Right: docked search bar (340px, 44px pill, `--md-surface-container-high`,
   placeholder 14px, `⌘K` key chip r8 `--md-surface-container-highest`), presence facepile
   (32px circles, −8px overlap, 2px surface ring), 44px round icon buttons (notifications with
   badge, smartphone, cast).
5. **Screens** — one per rail destination; see the screen table below. The kanban stays an
   overlay over the mounted canvas exactly as today; the rail's Board item toggles it.

## Screens / Views (file → what it specifies → source it replaces)

| Design file | Specifies | Replaces / lands in |
| --- | --- | --- |
| `MD3 Canvas.dc.html` | App bar, rail, announcement banner, group frame w/ worktree chip, agent node (RUNNING), Codex node (NEEDS YOU + Approve/Deny), plain terminal node, subagent card, sticky note, editor node, zoom cluster, usage + RAM pills, minimap, dictation capsule, FAB add-node menu | `canvas/Canvas.tsx`, `CanvasPills.tsx`, `TerminalNode`, `GroupNode`, `SubagentNode`, sticky/editor nodes, minimap, `DictationOverlay.tsx` |
| `MD3 Board.dc.html` | Board header + filter chips, 4 columns, session cards w/ status chips + facepiles, card modal (labels, due, priority, live terminal, comment composer) | `kanban/KanbanView.tsx`, `KanbanColumn.tsx`, `SessionCard.tsx`, `CardModal.tsx`, `KanbanSourceFilter.tsx` |
| `MD3 Files.dc.html` | Explorer tree (git-ignored dimmed italic, per-row download, download strip), source control (staged/changes rows, diff preview, commit composer w/ ✦ Generate, Sync), git history rail | Explorer, SCM panel, `git-history/GitHistoryPanel.tsx` |
| `MD3 Settings.dc.html` | Full six-group nav (every section incl. Appearance editor, Notch, Dictation, Your name, Team seats, License, Personal vocabulary, Toy locks, Authenticator, Dim-sum, Kids mode), list-card rows w/ MD3 switches/selects, accent picker, terminal preview | `settings/SettingsPage.tsx`, `SettingsSidebar.tsx`, `FieldRow.tsx`, `ThemeSelect.tsx`, `TerminalPreview.tsx` |
| `MD3 Overlays.dc.html` | Command palette (regex chip, rich rows, kbd chips), context menu (FLAT + filter head — never sectioned/categorized; destructive row in error red), destructive two-key + slider gate, clone dialog (MD3 outlined text fields w/ floating labels), notifications panel + filters | `CommandPalette.tsx`, `ContextMenu.tsx`, `DestructiveConfirmGate.tsx`, `CloneRepoDialog.tsx`, `NotificationToasts` |
| `MD3 Regex Builder.dc.html` | THE anchored regex builder — opens from the `.*` anchor every search field carries; fully live in the prototype (real `RegExp`): filterable token palette (classes/anchors/quantifiers/groups/lookaround/escapes), 12 presets, 6 flags, error + catastrophic-backtracking warning, live highlight, numbered + named capture groups, substitution ($1/$<name>/$&/$`/$'), token-by-token explanation, escape-literal, copy /literal/flags. Popover anchored under its field, never a page or modal | `regex/RegexBuilder.tsx`, `AnchoredRegexBuilder.tsx`, `insertTokens.ts`, `lib/regex/*` |
| `MD3 Welcome.dc.html` | Hero, 4 action cards (New project primary-container, Open/Clone/SSH neutral), recently-closed list | Welcome / empty state |
| `MD3 Kids Mode.dc.html` | Home (Beep avatar, status chips, 6 activity tiles from container roles), parent gate (PIN pad 84px keys r28), grown-up screen (stats, activity log, permission switches, exit to developer mode) | `kidsMode` surfaces |
| `MD3 Tools.dc.html` | Ollama manager (hardware-fit verdict chips Comfortable/Tight/Won't fit), file converter (category rail, drop zone, queue states incl. Unsupported), authenticator (TOTP cards w/ conic countdown) + toy locks, exports (10 formats, lossy-warning card, bulk-action preview card) | `ollama/OllamaManagerPanel.tsx`, `converter/FileConverterPanel.tsx`, `authenticator/`, `toylocks/`, exports |
| `MD3 History.dc.html` | Session memory (pin/delete rows, tag chips), local settings history (restore-as-new, CURRENT chip), changelog (version pills, date presets, category-tagged bullets) | session memory, local history, changelog viewer |

Exact layout, sizes, colors and copy for every component are in the files themselves — all
styling is inline `style=""` attributes reading the tokens, so each element is self-documenting.

## Interactions & Behavior
- LIVE in the prototypes (open them — these behaviors are implemented, not implied): Canvas search bar opens the command palette with live filtering; right-click on the canvas opens the context menu at the cursor — a FLAT filterable list (filter field on top, no categories/sections/dividers ever), destructive rows in error red; Board/Files/Settings/Tools/History search bars all live-filter their content (Files: directories never hide — lazy tree contract); the regex builder evaluates every keystroke.
- Every search field carries the `.*` anchor chip — plain text by default, regex an explicit opt-in that opens the anchored builder (`MD3 Regex Builder.dc.html`).
- Settings: "Startup dim-sum" has NO switch — it renders a fixed "Always on — by design" chip (there is deliberately no off switch).
- Theme: `document.documentElement.dataset.theme = 'light'|'dark'` (existing wiring; unchanged).
- Motion: `--md-motion-spatial` = 500ms cubic-bezier(.38,1.21,.22,1) for movement/scale;
  `--md-motion-effect` = 200ms cubic-bezier(.34,.8,.34,1) for color/hover. Switch knob slides
  with spatial; hover fills with effect. Status dots pulse 1.4s (scale 1→1.3, opacity .4→1).
- Hover: interactive rows/cards step one surface-container level up (low→container→high→highest).
  No shadows anywhere — elevation is tonal only.
- Status language: RUNNING = tertiary-container chip + pulsing dot; NEEDS YOU = error-container
  chip + 2px error ring on the node; ok/tmux = success-container; SLEEPING/idle =
  surface-container-highest. Hook-driven, never output-scraped (unchanged contract).
- Destructive actions always go through the two-key + slider gate.
- Search fields everywhere carry the `.*` regex-builder anchor chip.

## State Management
No new state model — the redesign maps onto existing stores (`useSettings`, `useViewMode`,
`useKidsMode`, `useSchoolMode`, kanban/canvas stores). New: rail active-destination state
(replaces drawer open/close booleans) and FAB menu open state.

## Design Tokens
All in `md3/tokens.css` (M3 baseline, seed #6750A4, dark default + light under
`[data-theme='light']`), including custom `success`/`warning` roles, `--term-bg` (#0F0D13, fixed),
shape scale (8/12/16/28/full), motion, and font stacks.
Type: Outfit 400–700 (UI) · Roboto Mono (code/terminal) · Material Symbols Rounded (icons;
FILL 1 for active/emphasis). Bundle the fonts locally for the Electron build — no network fetch.

## Assets
`md3/assets/claude.svg`, `codex-color.svg`, `gemini-color.svg`, `opencode.svg` — copied verbatim
from `src/renderer/assets/` (already in the repo). All other iconography is Material Symbols
Rounded glyph names visible in the markup.

## Files
- `MD3 *.dc.html` — the ten screen prototypes (open in a browser; interactive)
- `md3/tokens.css` — production-ready token layer (drop in first)
- `md3/HANDOFF.md` — component recipes with exact values + known palette divergence note
- `support.js` — prototype runtime only; never ship it
