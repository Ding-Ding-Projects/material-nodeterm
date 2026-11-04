# Handoff: nodeterm v3, Material 3 Expressive redesign

## Overview

`v3/` is a full redesign of the nodeterm desktop app on **Material 3 Expressive**. It supersedes
`v2/` (classic Material Design 3) as the visual target. It keeps the v2 information architecture
(canvas-first workspace, navigation rail, kanban as an overlay, tools, history) and changes the
look and feel:

- **Seed colour `#1F8A70` (Jade)** instead of the stock purple `#6750A4`. Roles are generated with
  `@material/material-color-utilities` 0.3.0, tonal-spot scheme, dark and light. Warning and
  success roles are harmonised to the seed.
- **Expressive shape**: pressed controls morph from round to square (and back for square
  buttons), connected button groups, split buttons, list items with first and last corners
  rounded, nodes at 28 px corners, a shape-morphing loading indicator.
- **Expressive motion**: spring tokens for fast, default and slow spatial movement and for
  effects; staggered arrival of nodes and list rows; menus open from their anchor; the FAB grows
  into its menu; values roll in place; live dots pulse only while data streams. Every animation
  has a reduced-motion path (see `Motion.dc.html`).
- **Frameless window chrome** with browser-style project tabs, a 96 px navigation rail, and a
  floating canvas toolbar.

Fidelity is high: colours, radii, spacing, type sizes and motion tokens are final. `v3.css` holds
the token layer and the component classes every artboard uses.

## Files

| File | Specifies |
| --- | --- |
| `canvas.json` | Canvas index: every artboard, its frame and title |
| `v3.css` | Tokens (dark default, light under `html[data-theme='light']`), type scale, shape and motion tokens, component classes, reduced-motion rules |
| `Main.dc.html` | Colour roles, surface ladder, type scale, shape scale and morph, every component |
| `Motion.dc.html` | Interactive motion specimens with a Full / Reduced switch and Replay |
| `Coverage.dc.html` | Every canonical app contract mapped to the artboard that draws it |
| `Workspace.dc.html` | Frameless title bar, project tabs, rail, canvas with worktree group, agent / approval / terminal / sticky / subagent nodes, floating toolbar, minimap, live usage chip, version and build time on the first screen |
| `Palette.dc.html` | `Ctrl+Shift+F` palette with live setting controls in results, teleport, and its anchored regex builder |
| `Board.dc.html` | Kanban with collapsed filters that still show active filters, collapsed stats, bulk-action toolbar with preview, card context menu with filter field and shortcuts, a locked card |
| `Onboarding.dc.html` | Six-step first-run wizard with real detection results, Back / Next / Skip, save and resume |
| `SettingsYou.dc.html` | Language modes, both funny-level sliders, emoji switch, personal vocabulary drop zone, narrator voices, action sounds, School / Kids / ADHD / dim sum modes, schedules, external source, display name |
| `SettingsLook.dc.html` | Non-modal appearance editor anchored to the element it edits, per-state tabs, infinite colour picker with translator and animated rainbow, logo presets and upload, accessibility settings |
| `AppearanceDeep.dc.html` | Appearance editor in depth: word-processor-depth type tab, layered non-destructive image tab, keyframe animation tab, per-element capability matrix |
| `Regex.dc.html` | Full regex workbench: Create, Test, Debug, Use, Convert, Replace, Library, GREP, Benchmark, History, with the real engine named |
| `Safety.dc.html` | Two-key super confirmation with slider and Emergency exit, Support Tickets, six-mix lock wizard, unlock ladder, authenticator, QR pairing |
| `History.dc.html` | Local history with diff and restore, changelog with commit links and release code name, export dialog with loss notice, offline docs |
| `Tools.dc.html` | Minecraft server manager with world generator (100 × 100 chunk canvas, Folder or ZIP), file converter with an unavailable adapter, Base64, Ollama, VS Code hand-off, drawing pens |
| `Status.dc.html` | Update-ready banner (unsigned, Restart to install update, Later), Status Hub with a live chart, alert destinations, About with build provenance, an in-place recovery card |
| `Overlays.dc.html` | Menu filter, guide above its control with an info button, notification centre, accessibility tools menu, progress inside a dialog, download progress, stacked toasts |
| `Compact.dc.html` | 480 px window with a bottom navigation bar; 200% scale with bilingual strings |
| `frames/` | Each artboard rendered locally in Chrome with the app's shipped fonts |
| `support.js` | Prototype runtime only, copied from `v2/`. Never ship it. |

## Implementation order

1. **Tokens.** Replace the colour ramps in `src/renderer/styles.css` and `styles.md3.css` with the
   `:root` and `[data-theme='light']` blocks from `v3.css`. The `--md-*` names match what the
   renderer already uses. Add the shape and spring tokens. Keep `applyAccentTokens` as the accent
   override; `#1F8A70` becomes the default seed.
2. **Motion.** Adopt the spring tokens for every transition and the press morph on buttons, icon
   buttons, chips and FABs. Wire the reduced-motion rules to the OS setting, the app's Motion
   setting and Low stimulation together.
3. **Chrome.** Title bar, project tabs, rail and floating toolbar as drawn in `Workspace.dc.html`.
4. **Surfaces.** One artboard per destination as listed above. Each existing component keeps its
   behaviour; only its presentation changes unless the artboard shows a new control.
5. **Icons.** The app ships a Material Symbols subset. The artboards use icons the subset does not
   carry yet (for example `format_overline`, `ink_eraser`, `motion_photos_off`); regenerate the
   subset with `scripts/build-fonts.mjs` before relying on them.

## Placeholders

- `[DIM SUM CODE NAME]` and `[中文名]` stand for the release code name chosen from the public
  catalogue at release time.
- Account names are written as `your-account`.

## Not decided in this design

- Light theme artboards: the light token block is final, but no artboard is drawn light.
- Kids mode screens: v2's `MD3 Kids Mode.dc.html` remains the reference until a v3 board replaces it.
