# Interactive portal-door construction

The canvas Portal door object is the physical-authoring lane for Multiverse portals. It records five
ordered parts: frame, hinges, panel, handle, and activation core. Each part has a real staged control,
a visible preview change, and a durable completion record.

This lane does not enter a child canvas, authenticate a person, run a recovery game, or navigate. The
activation core is the final construction part, not an entry action. Those behaviors belong to later
portal lanes and are intentionally absent here so a saved door cannot imply capabilities that have
not shipped.

## Durable and portable state

The node stores `portalDoor` in the shared canvas record. Its schema version is `1`, its `doorId` is
stable, and its `targetCanvasId` starts as `pending` until a later portal lane binds the door. Only
the ordered completed-part list and this non-secret metadata are portable. There are no addresses,
credentials, process state, or navigation targets in the record.

## Interaction and accessibility

The next part is the only enabled installation control. Earlier parts show as installed, while later
parts are visibly unavailable and explain that an earlier part is required. The preview exposes the
current stage through an accessible group label and the construction count is announced in a status
region. The node can be collapsed and resized like other canvas objects. Assembly movement uses CSS
transitions and a core pulse, with a `prefers-reduced-motion` path that removes both effects while
keeping the state change visible in text.

## Failure boundaries

Out-of-order or repeated part updates are rejected by the construction reducer. Invalid imported
construction metadata is rejected by the portable projection validator rather than being rendered as
a partial or executable door. A complete construction means all five parts were installed and saved;
it does not mean the door can be entered.

## Verification status

This focused lane intentionally did not run tests, type checking, linting, builds, packaging, UI
interaction, or captures. The implementation is ready for the parent integration lane to verify.

## Suggested articles

- [Portable canvas projection](../../portable-canvas-projection.md)
- [Toy locks](../../toy-locks.md)
