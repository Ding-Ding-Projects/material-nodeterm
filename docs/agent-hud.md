# Agent HUD

The Agent HUD is a Windows desktop status tool for live agent sessions. It is a separate frameless
tool window that stays above ordinary windows, avoids the taskbar, and does not take focus when it
appears. It is enabled by default through the Agent HUD setting.

## Window behavior

The main process creates a fixed 560 by 460 pixel tool window inside the primary display work area.
It places the window near the upper-right edge with a small inset. Display changes reposition the
window, but no hardware cutout, menu-bar inset, traffic-light control, or display-wide geometry is
read or assumed. The window remains independent of the size or shape of the display.

The window is frameless, transparent outside its painted surface, non-resizable, non-movable,
always-on-top, non-focusable, and excluded from the taskbar. It starts click-through. The renderer
temporarily accepts pointer input while the pointer is over the painted HUD surface, then restores
click-through behavior when the pointer leaves.

## Indicator and session panel

The collapsed surface is a centered black Material-styled pill. It is hidden when there are no
active rows. It shows one working mascot per active agent type, a red needs-you indicator, and a
green indicator for a completed session that has not been viewed. The animation is CSS-driven and
respects `prefers-reduced-motion`.

Clicking the pill expands the same surface into a scrollable session panel. When enabled, a short
hover dwell also expands it. The panel shows up to six rows initially and adds a counted overflow
row when more exist. The overflow action reveals the complete pushed list without changing session
state.

Each row includes the session title, state, model when known, relative time, context usage when
available, the first prompt line or activity line, and a disclosure for child sessions. Selecting
a row or its Go action restores and focuses the main window, centers the matching session, and marks
only that session's completed state as viewed. Dismiss removes one row from this HUD only. A real
state change makes it visible again. Dismiss is available through the row close action and the row's
context action.

## Data model

`src/main/agent-hud-model.ts` is Electron-free and folds these sources into the row list:

- state edges for working, needs-you, and completed sessions
- activity and context updates
- the persisted agent-status mirror
- normalized agent events for prompts and child-session grouping

Rows are ranked by needs-you, unseen completed, working, and idle state. Within a tier, first sight
order is stable, so activity ticks cannot make the visible panel reshuffle. Working rows use the
shared stale-session interval as a display-only watchdog. The mirror sweep remains the authoritative
state transition, and a later event restores a temporarily quiet display row.

## Settings and migration

Settings are persisted in the normal settings store and apply while the HUD is running:

| Setting | Default | Description |
| --- | ---: | --- |
| `agentHud` | `true` | Enable or disable the Agent HUD. |
| `agentHudWidth` | `168` | Width of the collapsed indicator, clamped to 100 to 320 pixels. |
| `agentHudHoverExpand` | `true` | Expand after a short hover dwell when enabled. |

Existing settings using `notchHud`, `notchWidth`, or `notchHoverExpand` are read once during desktop
startup. The values are copied to the corresponding Agent HUD settings, new values win if both
generations are present, and the old keys are removed before the migrated record is saved. If the
save cannot complete, the migration is retried on the next launch without preventing the app from
opening.

## Accessibility and safety

The HUD does not interrupt typing, steal focus, or use a blocking dialog for status updates. State
is represented by text as well as color and animation. The reduced-motion media query disables
continuous indicator motion. All row actions have accessible names, keyboard-equivalent button
routes, and focus restoration through the main window.

School mode state is included in every HUD update, so private text mapping remains disabled until
the shared record is hydrated and permits it. The HUD never sends session content to a network
service and never changes the terminal or session when a row is dismissed.

## Implementation map

- `src/main/agent-hud.ts`: Windows tool-window lifecycle, geometry, event feeds, and IPC handlers
- `src/main/agent-hud-model.ts`: pure status aggregation and persisted-setting migration
- `src/preload/hud.ts`: isolated HUD bridge
- `src/renderer/hud/`: indicator, panel, CSS, and focused model helpers
- `src/renderer/components/settings/sections/AgentHudSection.tsx`: live settings controls
- `src/renderer/components/settings/nav.ts`: Windows settings navigation registration
- `src/shared/types.ts`: Agent HUD settings and defaults
- `src/shared/ipc.ts`: HUD channel contract

The obsolete hardware-bound onboarding scene and the old settings section are intentionally absent.
The old file and setting names are retained only inside the bounded migration implementation so
existing installations can move forward safely.
