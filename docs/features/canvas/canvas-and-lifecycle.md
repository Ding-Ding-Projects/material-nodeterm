# Canvas & node lifecycle

**Category:** [Canvas](./README.md)

The canvas is an infinite, pannable, zoomable surface. Nodes on it are React Flow nodes, and
React Flow's live node state is the single source of truth for the *active* project — there is
deliberately no separate store mirroring it, because an earlier design with dual sources caused
sync bugs.

## Behaviour

**Interaction.** Left-drag on empty space box-selects; middle-drag or a trackpad two-finger
gesture pans; pinch zooms. Right mouse is reserved for the context menu, which offers different
actions depending on whether you clicked empty space, a single node, or a multi-selection
(group, color, duplicate, align-to-grid, collapse, restart an agent in place, delete, and more).
A bottom-left canvas lock freezes the *camera* only — nodes stay draggable, resizable, and
usable while locked; the point is to stop the map itself from sliding, not to freeze your work.

When **Scroll wheel zooms** is enabled, a plain wheel zooms toward the pointer. High-resolution
ratchet wheels may report one physical detent as several packets, so the handler gives all packets
inside one 40 ms burst one shared ±50 delta budget. A later click receives a fresh budget. This
keeps one detent from becoming several compounded zoom steps while leaving the existing modifier
wheel and trackpad-pinch routes intact.

The adjacent **Wheel zoom speed** setting is persisted from 0.2× through 2.0×. The historical
wheel feel is 1.0×. It changes only the plain-wheel exponent, so tuning a chunky mouse does not
alter modifier zoom or pinch. Values loaded from hand-edited settings are clamped at point of use;
invalid or missing values fall back to 1.0×. The setting's provenance line identifies the compiled
default, a saved override, or an active scheduled value. Its label and explanation follow the
same language mode and funny-level controls as the rest of Settings, with the numeric value kept
factual.

**Undo/redo** is a debounced snapshot of the node array taken whenever a drag or edit settles,
with independent past/future stacks per project. It's suspended while you're typing into an
input, a terminal, or Monaco, so `⌘Z` in a terminal reaches the shell, not the canvas.

**Memory management.** A canvas can hold far more terminals than a browser can afford to give a
full WebGL rendering context to at once, and a browser physically caps how many contexts can
exist simultaneously. nodeterm handles this in layers rather than as a single on/off switch:

1. **Parking.** Switching away from a project doesn't destroy its terminals — their process and
   xterm instance stay alive, just detached from the DOM. Switching back within a short window
   re-attaches instantly, with scrollback and terminal modes intact.
2. **WebGL budget.** Each terminal that *is* visible competes for a shared, budgeted pool of
   GPU rendering contexts. A per-node visibility observer requests a context only after a short
   dwell (so a fast pan-through never grabs one just to lose it a frame later), and if the pool
   is full, the least-recently-visible holder is reclaimed rather than letting the browser
   force-evict one at random (which otherwise shows up as a terminal flashing to a dead "lost
   context" placeholder mid-pan).
3. **Offscreen release.** A node that's been fully outside the viewport for longer than a
   configurable window has its terminal view torn down entirely — the node stays on the canvas
   as a placeholder, and the underlying tmux session is untouched — freeing memory for a canvas
   with dozens of terminals open at once.

None of these layers ever kill a session that's doing real work without your instruction to;
each one only decides whether a *view* of that session is currently instantiated.

## Configuration

- **Settings → Canvas / tmux** — grid snapping, default node size, pan-hover delay (how long
  you must dwell over a terminal before it starts capturing your input instead of letting a
  drag move the node), double-click-to-focus behaviour, plain-wheel zoom, wheel zoom speed, and
  the offscreen-release timeout (`0` disables release entirely). The speed slider is available
  directly below **Scroll wheel zooms** and is inactive only when the toggle is off.
- **Settings → Appearance** — which context-menu items and header buttons are shown.

Desktop and Server Edition use the same renderer wheel handler and the same persisted settings
record, so the 40 ms budget, point-of-use clamping, and plain-wheel-only speed multiplier behave
identically on both surfaces. The mobile companion has no wheel input and does not expose this
mouse setting.

## Failure modes

- **A GPU context is lost externally** (for example, the system sleeps and wakes): affected
  terminals fall back to the non-GPU renderer and are re-granted a context under the same
  budget rules the next time they're visible, rather than staying permanently blank.
- **A node's size can't be measured yet** (the very first tick after a project loads): a
  "jump to node" action deliberately does nothing rather than guessing and landing the camera
  at the canvas origin — the camera holds still until the node's real size is known.
- A hand-edited wheel speed is missing, non-numeric, or outside 0.2–2.0: the renderer clamps it
  at the point of use and uses 1.0× for an invalid value. The persisted file is not rewritten as
  a side effect of reading it, so the user can inspect and correct the source value deliberately.

## Security considerations

Canvas state (positions, sizes, colors, node kind, and kind-specific data like an editor's file
path) is stored in the project file described in
[Projects & tabs](../projects/projects-and-tabs.md); nothing about canvas layout itself is
transmitted anywhere beyond that.

## Verification

- Open a canvas with several dozen terminal nodes, pan across it quickly, and confirm no
  terminal shows a dead/blank rendering surface.
- Leave a node fully offscreen past the configured release window, then pan back — it should
  redraw from the live session rather than restarting.
- Undo a drag, a color change, and a delete in sequence, confirming each step reverts cleanly
  and that undo does nothing while a terminal or input has focus.
- Enable **Scroll wheel zooms**, send several packets within 40 ms, and confirm one detent spends
  only one shared budget. Wait beyond the burst window and confirm a later click gets a fresh
  budget. Change the speed to 0.2× and 2.0×, reload, and confirm the plain-wheel distance changes
  while modifier zoom and pinch retain their fixed step. Inspect missing, invalid, and out-of-range
  hand-edited values and confirm the point-of-use fallback is 1.0×.

## Suggested articles

- [Node kinds](./node-kinds.md) — what's actually being rendered on the canvas.
- [Session continuity](../terminals/session-continuity.md) — what a "parked" or "released"
  terminal's underlying session is doing while its view is torn down.
- [Projects & tabs](../projects/projects-and-tabs.md) — how a whole canvas is saved and
  switched.
