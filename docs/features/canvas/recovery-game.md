# Top-down recovery game

The recovery game is a small, local canvas node with one clear objective: energize the northwest,
northeast, and southeast keys, avoid hazards, then move onto the central activation core and turn it
on. It does not launch a process, connect to a provider, or require a host binding.

## Guided controls

Choose **Tools → Recovery game** in the Node Catalog. The board exposes real buttons for every cell
that is one step from the player, plus four directional controls. Focus the board and use the arrow
keys or `W`, `A`, `S`, and `D` to move. The core button remains disabled until all three keys are
energized and the player is standing on the core. Its status region explains the exact remaining
condition, so keyboard and screen-reader users do not have to infer why activation is unavailable.

The **Find a board location** field keeps plain text as its default and has an adjacent anchored
regex builder. Matching cells receive a visible highlight while the full board remains available.
The field reports the number of matching locations and preserves the same bounded, local search
behavior as the rest of the canvas.

## Hazards and progress

Stepping on a hazard returns the player to the start and increments the hazard-contact count. Keys
already energized remain energized, so a mistake costs position rather than all progress. Reaching a
new key announces a non-blocking notification. When the core is ready, the node announces that state;
activating it marks the run complete and prevents further movement. **Reset game** starts a fresh
run and is available at all times.

## Portability

The node stores only its bounded board snapshot in the schema 3 project projection:

- player coordinates;
- the set of energized key ids;
- the core activation flag; and
- the hazard-contact count.

The projection validates coordinates, key ids, duplicate keys, activation consistency, and the
bounded counter before import. It contains no credentials, provider sessions, absolute paths,
process state, host identifiers, caches, or generated runtime data. Importing the project therefore
reopens the same game state without making a network request, launching a process, or mutating an
external service. A malformed or hand-edited game snapshot is rejected rather than partially
applied.

## Accessibility and visual behavior

The board uses a labelled grid with row and column indices, live status text, visible focus rings,
keyboard shortcuts, explicit disabled-state descriptions, and touch-sized controls. Hazard, key,
player, and core states use the shared Material Design 3 role tokens, with text and accessible names
carrying the meaning in addition to color. The layout wraps its key and action controls at narrow
widths and respects reduced-motion settings.

## Verification boundary

This implementation lane intentionally did not run tests, type checks, lint, builds, packaging,
installer execution, runtime interaction, reviews, security or accessibility checks, or UI captures.
The feature and its portability wiring are source changes only until the integration lane performs
those checks against the built Windows desktop application.

## Suggested articles

- [Node Catalog](./node-catalog.md)
- [Node kinds](./node-kinds.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
