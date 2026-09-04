# Portal recovery game

**Category:** [Canvas](./README.md)

Portal recovery is a bounded, offline mini-game for a Multiverse portal node. It gives the user a
small route to practise recovery without pretending to authenticate them.

## Behaviour

Create it from the canvas context menu, the FAB, or the command palette as **New portal recovery
game**. The map is a fixed 12 by 8 grid. The player starts with three energy units and must collect
three energy keys, avoid hazards, then stand on the activation core. Each input moves at most one
cell. A hazard costs one energy and returns the player to the start. Reaching zero energy produces
an honest failed state and requires Restart.

The reducer in `src/shared/portal-recovery.ts` is deterministic and bounded. It has no timer, no
network dependency, no random draw, and no unbounded collection. Progress is a small schema-versioned
record containing only completion, attempts, and the best move count. That record is part of the
portable project node data, so it can travel with the project without carrying a credential.

## Controls and accessibility

- Arrow keys and W/A/S/D move the player one cell at a time after the map receives focus.
- Touch and pointer users can use the four large direction controls or select a nearby map cell.
- Each map cell is a named grid cell, including whether it contains a key, hazard, core, or player.
- The status, energy count, key count, move count, and completion result are readable text. The map
  is not dependent on colour or animation.
- `prefers-reduced-motion: reduce` removes cosmetic cell transitions. Game rules do not change.

## School mode

When School mode is enabled, the game remains available because it is not a dim-sum capability, but
the surface uses English-only copy. No Cantonese or playful recovery copy is rendered in that state.
The shared School mode store is read live, so a running node follows the same mode as the rest of
the app.

## Recovery and security semantics

Winning the game only records local progress. It never clears a lockout, changes a password or
passphrase, grants portal access, creates a session, sets a cookie, or bypasses the normal portal
credential flow. After completion the user must still enter the portal's ordinary numeric code or
passphrase. The game is therefore useful as a recovery exercise while remaining unable to become an
authentication factor.

Malformed or stale progress is replaced with the safe empty progress record. Bounds are enforced on
attempts and best moves, and unknown fields are ignored. No secret, path, account identity, token,
or authentication result is stored in the node.

## Verification status

This implementation lane did not run tests, type checking, linting, builds, packaging, runtime
interaction, or captures. Those checks remain required before the feature can be marked verified in
the roadmap or release evidence.

## Suggested articles

- [Node kinds](./node-kinds.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [School mode](../../school-mode.md)
- [Destructive confirmation](../../destructive-confirmation.md)
