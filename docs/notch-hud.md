# Agent HUD (formerly the macOS Notch HUD) — contract

A small, frameless, always-on-top, click-through tool window docked at the **top-center of the
primary display's work area**, showing **walking agent mascots** while agents work and expanding
on click into a **mini session panel** with a "Go" button that opens the node in nodeterm.
Windows desktop only. Fed by nodeterm's own hook-based agent-status (precise working/done — no
~30 s afterglow), reusing nodeterm's existing mascot art. **Default ON** (`settings.notchHud`,
toggleable in Settings).

**History — this is a REWIRE, not a new feature.** The HUD began life as the macOS "Notch HUD", a
full-display-width strip fused to the MacBook notch. When the macOS desktop target was deleted
(Windows-only product decision, 2026-08), the HUD was rewired rather than amputated: the pure data
model (`notch-hud-model.ts`) is byte-identical, the renderer contract (`HudPush`) and preload
(`src/preload/hud.ts`) are unchanged, and the renderer already had a "notchless" floating-pill
mode for external monitors — the Windows window simply always reports `hasNotch: false`, so the
pill mode is now *the* mode. What changed is only the window shape: notch geometry (display
bounds, menu-bar inset, AppKit constraint escapes) became work-area geometry, and the NSPanel
became a Windows tool window. Several identifiers and setting keys (`notchHud`, `notchWidth`,
`IPC` channel names, this file's name) keep their historical "notch" spelling so persisted
settings survive; their doc comments say so at each site.

## Window (src/main/notch-hud.ts)

One BrowserWindow: `{frame:false, transparent:true, hasShadow:false, resizable:false,
alwaysOnTop:true, focusable:false, skipTaskbar:true}` + `setIgnoreMouseEvents(true,
{forward:true})`. `skipTaskbar` + non-focusable make it a tool window: it never appears in the
taskbar/Alt-Tab and never steals focus from the terminal the user is typing into. Its own
renderer entry `hud.html` (in `electron.vite.config.ts` `renderer.input`) with the small
HUD-specific preload.

- **Geometry** from `screen.getPrimaryDisplay().workArea`: the window is `HUD_WINDOW_WIDTH`
  (560 px — the 400 px expanded panel plus its 44 px blur shadow on each side; narrower would clip
  the panel's edges, which reads as a rendering bug) by `HUD_WINDOW_HEIGHT` (460, capped to the
  work-area height), centered horizontally, at the top of the work area. The frame is never
  resized; expand/collapse is a CSS transform in the renderer. The push still carries the
  contract's required `bar` field (`HUD_BAR` 24 — in pill mode it only seeds the `--bar` CSS
  variable) and always `hasNotch: false`. Re-asserted on `screen` `display-metrics-changed` +
  `display-added/removed`.
- **Click-through with a hotspot**: the window stays mouse-ignoring; the renderer reports pointer
  enter/leave of the pill/panel rect over IPC → main toggles `setIgnoreMouseEvents(false/true,
  {forward:true})` (`forward` keeps move events flowing so the renderer still sees pointer-leave
  to re-enable click-through).
- `assertRegularDockPresence()` is a documented no-op survivor of the macOS Dock guard; it stays
  exported only because `src/main/index.ts` still calls it. Remove both together.

## Data (main-side controller, no core changes)

Subscribes to the SAME seams push-notify uses (`agent-status-mirror.ts`): `onNodeStateChange`
(working/needsYou/done edges), `onNodeNowChange` (activity + context%), `onMirrorFlush` (full
table). Joins per node: `workspaceStore.getNodeTitle(nodeId)` (title), `IPC.contextUpdate`
(model, by sessionId), a controller-local `Map<nodeId,lastPrompt>` fed from `emitAgentStatus`'s
`ev.task` on `newTurn`, and subagent sets off the subagent-start/end events. Pushes a debounced
(150 ms) snapshot array to the HUD window via the `getHudWindow()`/`sendToHud()` singleton
(mirroring `main-window.ts`), plus a 60 s sweep so rows age out with no events.

Row shape sent to the HUD:
```ts
{ nodeId, agentId, title, model?, state: 'working'|'needsYou'|'done'|'idle',
  prompt?, activity?, contextPercent?,
  subagents: [{ id, label?, state: 'working'|'done' }] }
```
- **done latch + clear**: `done` state is latched by the mirror already. Clearing is **strictly per
  row**: clicking/Go-ing a row (`hudFocusNode` → `model.noteFocus`) clears THAT node, and reading
  the session inside nodeterm clears it through the mirror's read-ack (`state:'done', ack:true`).
  Opening or closing the panel clears NOTHING — an earlier "the panel was opened, so you looked at
  it" blanket clear meant that with three finished sessions waiting, opening the panel and clicking
  one silently swallowed the other two. Drop a node from the HUD when it's gone + idle > 6 h.
  A `done` first learned about from a MIRROR FLUSH is seeded as already-seen: the mirror keeps
  entries for hours and is re-read at every launch, so without that rule every app start (and every
  re-enable of the setting) resurrected old finished sessions as fresh green blobs. Only a live done
  EDGE — a turn ending while the HUD is running — raises the highlight. A restored `needsYou` still
  shows, because it genuinely still needs you.
- **working watchdog**: a session leaves `working` only when something says so, and some exits say
  nothing — Esc during a tool call, a killed CLI, a slept machine, a dropped SSH. The DECIDER is
  central: `agent-status-mirror`'s `sweepStaleWorking` (window in `shared/agents/stale.ts`,
  `WORKING_STALE_MS` 20 min, well past Claude's ~10 min Bash cap) moves the entry off working and
  fires ONE end edge marked `stale`, which every `onNodeStateChange` consumer honors — the HUD
  drops the row AND the phone's Live Activity ends. The HUD keeps a DISPLAY-ONLY copy of the same
  check so the pill never depends on that edge arriving; nothing is mutated, so any later event
  restores the row instantly, and the 60 s sweep re-pushes so a row can age out with no event at
  all. An **interrupted** done (`NodeStateChange.interrupted`, Esc) never lights the green
  highlight — nothing was accomplished, so there is nothing to go and read (same rule as the
  notification path).
- **dismiss** latches the RAW state, so the watchdog flipping a hidden row's display cannot count
  as "it changed".

## Indicator + panel (hud renderer) — the floating pill

Reuses `src/renderer/lib/mascot.ts` (`CLAUDE_MASCOT` data-URI + `CODEX_MASCOT` geometry +
`pet-codex.webp`) and the walk-cycle CSS from AgentMascot/styles.css — plain DOM, no React.
Master clock 120 ms.

With `hasNotch` always false, the renderer's `.notchless` root class draws a **standalone black
floating pill**: a small `--pill-top-gap` above it, all-corner `--pill-radius`, collapsed height
`--pill-height`, mascots centered inside. The pill IS the click-through hotspot. Hidden entirely
when idle (no empty pill). A slot per agent kind that is working (claude → 2-frame coral pixel
mascot walking; codex → the pet spritesheet first-row crop, `image-rendering: pixelated`), plus a
shimmering green blob for a done-unseen slot and a red "needs you" dot for a waiting session.
Clicking expands the same surface into the panel (width → `--panel-width` 400, height driven by
`max-height` so content of unknown height animates): up to ~6 session rows, newest-active first —
animated mascot/green check + title + `model · reltime` tag + a `You: <prompt>` (or `activity`)
second line + a `▸ N subagents` disclosure. A **Go** button (or row-tap) → IPC → main mirrors the
notification-click handler: `getMainWindow().show()/focus()` + `sendToMain(app:focus-node,
nodeId)` → `Canvas.focusNodeById`, and clears that node's done latch. Hovering a row reveals a `×`
(right-click does the same) → `IPC.hudDismiss` → `model.dismiss(nodeId)` — HUD-local only, the
node/terminal is untouched.

The fused-to-the-notch capsule branch (`hasNotch === true`: square top corners, `--capsule-drop`
bulge below the menu-bar line) still exists in the renderer CSS/logic but is unreachable on
Windows; it is kept because the renderer contract was deliberately left byte-compatible with the
mac era rather than forked.

## Settings + lifecycle

The user-tunable knobs (`NotchHudTunables`, applied live, no restart): `notchHud` (default
**true**), `notchWidth` (default 168, clamped to `NOTCH_WIDTH_MIN/MAX` 100–320 in main — the name
is historical; it now drives the collapsed pill's width hint) and `notchHoverExpand` (default
true; off = click-only, the renderer reads it from the `hoverExpand` push field).
`initNotchHud(deps, tunables)` from `index.ts` — Windows desktop only; `settingsStore.onChange` →
`applyNotchHudSettings(tunables)` creates/destroys the window on the enable toggle and pushes
width/hover into a RUNNING controller (`setTunables`), so the width slider moves the pill as you
drag it.

Three-surfaces: desktop/Windows-only — `src/server` and iOS untouched (pure reader of existing
main state; the no-electron tests stay green because all HUD code is in `src/main` + a renderer
entry). The first-run tour's mac-era "notch step" was ID-keyed precisely so it could be absent per
platform; its Windows fate belongs to the onboarding surface, not this contract.

## Out of scope (v1)

Pet-switching config, a Linux HUD, a full per-row context menu (dismiss is a right-click /
hover ×, not a menu), multi-monitor placement beyond the primary display, the SDK chat node in
the panel.
