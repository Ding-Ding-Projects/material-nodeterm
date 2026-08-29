# nodeterm → Material Design 3 — handoff

Classic MD3 (Google-app register), seed **#6750A4** (M3 baseline scheme), dark + light.
Type: **Outfit** (UI) · **Roboto Mono** (code/terminal) · **Material Symbols Rounded** (icons).
Tonal elevation only — no drop shadows. Shape scale: 8 / 12 / 16 / 28 / full.

## Drop-in order

1. `tokens.css` — import before `styles.css`. Same `--md-*` names the app already speaks
   (`--md-surface`, `--md-surface-container*`, `--md-outline-variant`, …), dark on `:root`,
   light on `html[data-theme='light']` — the existing `data-theme` wiring in `App.tsx` needs
   no change. Delete the old `--md-tone-*` ramps; every role is now a literal from the
   baseline scheme. `--term-bg` is fixed dark in BOTH themes (decision: terminals stay dark).
2. Structural (markup) changes — approved:
   - **Top project tab strip → project switcher menu button** in the app bar
     (`.tabbar` tabs pill → one `secondary-container` menu chip + unread badge).
   - **Bottom dock → nav rail + FAB.** New `NavRail.tsx` replaces `Dock.tsx` placement:
     rail destinations Canvas / Board / Files / Alerts / Settings; the FAB owns node
     creation (old dock actions become the FAB menu, `⌘T`, `⌘⇧C` unchanged).
   - **Right drawer settings → full Settings screen** behind the rail destination
     (`SettingsSidebar.tsx` becomes the left nav column of the screen).

## Screen map (prototype → source)

| Prototype | Renderer source it replaces |
| --- | --- |
| `MD3 Canvas.dc.html` | `canvas/Canvas.tsx`, `CanvasPills.tsx`, `TerminalNode` chrome, `GroupNode`, `SubagentNode`, sticky/editor nodes, minimap, zoom controls, dictation capsule, announcement banner, app bar (`.tabbar`) |
| `MD3 Board.dc.html` | `components/kanban/KanbanView.tsx`, `KanbanColumn.tsx`, `SessionCard.tsx`, `CardModal.tsx`, `KanbanSourceFilter.tsx` |
| `MD3 Files.dc.html` | Explorer file tree (+ download strip), source control panel (stage/diff/commit composer with ✦ Generate), `git-history/GitHistoryPanel.tsx` |
| `MD3 Settings.dc.html` | `settings/SettingsPage.tsx`, `SettingsSidebar.tsx`, `FieldRow.tsx`, `ThemeSelect.tsx`, accent picker (`applyAccentTokens`), `TerminalPreview.tsx` |
| `MD3 Overlays.dc.html` | `CommandPalette.tsx`, `ContextMenu.tsx`, `DestructiveConfirmGate.tsx`, `CloneRepoDialog.tsx`, `NotificationToasts` / alerts panel, `regex/AnchoredRegexBuilder.tsx` |
| `MD3 Welcome.dc.html` | Welcome / empty state + recently-closed list |
| `MD3 Kids Mode.dc.html` | `kidsMode` surfaces: home tiles, parent gate (PIN pad), grown-up screen |

## Component recipes (the values, so CSS can be written from the table)

- **App bar**: 64px, `surface-container`, no border/shadow. Brand tile 38px r14
  `primary-container`. Search: docked bar 44px pill `surface-container-high`.
- **Nav rail**: 88px, `surface-container`. FAB 56px r16 `primary-container`.
  Destination: 56×32 pill indicator `secondary-container` (filled icon when active),
  12px label under. Badges: `error` on the pill corner.
- **Node card**: r24, body `surface-container`, header 52px `surface-container-high`,
  1px `outline-variant` ring (2px `error` ring when NEEDS YOU). Terminal body `--term-bg`.
  Context meter: 4px bar under header, fill `tertiary`.
- **Status chips**: RUNNING `tertiary-container` + pulsing dot; NEEDS YOU `error-container`;
  tmux/ok `success-container`; SLEEPING `surface-container-highest`. 28px pill, 11.5px/700.
- **Buttons**: filled `primary`, outlined 1px `outline`, text `primary`; all 40px pills.
- **Switch**: 52×32 track (`primary` on / `surface-container-highest` + `outline` border off),
  knob 24px `on-primary` / 16px `outline`.
- **Menus/dialogs**: r28 `surface-container-high`; rows r14–20; scrim `--md-scrim`.
- **Kanban**: column r24 `surface-container-low`; card r16 `surface-container-high`
  (hover `-highest`); session chip r8 mono.
- **Motion**: spatial `500ms cubic-bezier(.38,1.21,.22,1)`, effects `200ms` — as
  `--md-motion-spatial` / `--md-motion-effect`.

## Known divergence to resolve in the app

The current renderer palette is warm (neutral hue ~88°). Re-seed from `tokens.css`
literals, not by eye — `styles.theme.test.ts` should assert the new baseline values.
