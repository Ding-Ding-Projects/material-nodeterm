# Door-only universe navigation

Universe canvases use paired doors rather than tabs or direct canvas shortcuts. An entry door on
the containing canvas names one child canvas. Its matching return door lives on that child canvas
and leads back to the exact containing canvas. Entry is refused when the pair is missing or does
not point back symmetrically.

## Behavior

- Only an activation whose source is `door` can change between universe canvases.
- Tab, command-palette, history, and direct-selection requests are refused with an action that
  points the user to the visible door on the current canvas.
- A successful activation returns the exact matching exit-door id, so the destination shell can
  focus the correct return control rather than inventing a generic back action.
- Door identifiers are unique without case collisions. Each pair is reciprocal, uses one `entry`
  and one `return` role, connects two distinct known canvases, and records `access: door-only`.

## Portability and privacy

Schema 3 stores only safe intent: door id, containing and target canvas ids, pair id, role, label,
and the door-only access marker. A door may also carry a schema 3 entry policy naming numeric-code
or passphrase rules, but never the value itself. It stores no credential, passphrase, process state, navigation
history, machine path, provider session, host identity, cache, or generated runtime data. Import
validates the full pair before publishing the projection and performs no external action.

## Failure and recovery

An unknown door, a door activated from the wrong canvas, a target mismatch, or a missing reciprocal
pair is refused without changing canvas state. The recovery action identifies whether to choose a
visible local door or repair the missing pair. Importers can therefore leave a malformed universe
unopened instead of silently providing a tab bypass.

## Interface integration

Door construction and visual rendering are owned by their respective Multiverse lanes. Every shell
must call `decideUniverseDoorNavigation` before changing the active universe canvas and must not
mount child canvases as ordinary tabs. The visible door controls remain responsible for Material
Design 3 styling, keyboard activation, visible focus, screen-reader names and state, reduced motion,
and supported display scales.

## Verification boundary

This ultra-speed lane did not run tests, type checks, lint, reviews, security or accessibility
checks, builds, packaging, installer execution, runtime interaction, or UI captures. The source and
documentation record the intended policy, but runtime correctness remains unverified.

## Suggested articles

- [Unified Node Catalog](./node-catalog.md)
- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
