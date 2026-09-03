# The window's minimum size

**The honest limit first: a declared minimum does not mean nothing clips. It means there is finally
a size at which "nothing clips" is a claim somebody can check.** Before this existed the window had
`width: 1400` and no floor at all, so it shrank until something truncated and no rule said that was
wrong.

| Value | Where |
|---|---|
| `MIN_WINDOW_WIDTH = 640` | `src/shared/window-minimum.ts` |
| `MIN_WINDOW_HEIGHT = 540` | `src/shared/window-minimum.ts` |
| Enforced on the window | `src/main/index.ts` (`minWidth` / `minHeight` on the `BrowserWindow`) |
| Asserted | `src/main/window-minimum.test.ts` |

## Why one shared constant instead of two literals

The window, the clipping capture matrix, and its probe receipts all have to agree on one number.
When they do not, a capture proves a width the application never actually permits — which is worse
than having no capture, because it reads as evidence. So the value lives in `src/shared/` (the layer
every side already reads for exactly this reason) and both consumers import it. The test fails on a
bare numeric literal next to the constant, because that is the shape drift takes: both lines look
correct and the two numbers quietly stop matching.

## Why 640x540 and not something more comfortable

`styles.clipping.css` already designs for a narrow tier at `max-width: 720px` and a short tier at
`max-height: 640px`. A minimum above those would leave every rule in them **unreachable** — present
in the stylesheet, passing their own source guard, and never rendered by any window the application
permits. Dead layout code that a test reports as covered is the specific failure this number is
chosen to avoid, so the minimum sits deliberately *inside* the narrow tier.

Nothing in the chrome has a hard floor above it. Every wide fixed width in `styles.css` and
`styles.md3.css` is bounded (`max-width: 100%`, `max-width: 94vw`, or `width: min(1040px,
calc(100vw - Npx))`), so the layout shrinks rather than overflowing.

## The tier boundary

Narrow is `<= 720px` and the mid tier starts at `721px`. This used to be inconsistent: eleven rules
across `styles.css` and `styles.md3.css` used `max-width: 720px`, while `styles.clipping.css` paired
`max-width: 719px` with `min-width: 720px`. At exactly 720px both sides fired — the notification
strip and sessions card took their narrow treatment while the app bar took its mid-tier padding, so
one specific window width got a layout neither tier intended. The two outliers were moved onto the
majority edge rather than editing eleven rules onto the minority one.

`window-minimum.test.ts` asserts `719px` appears nowhere in the clipping sweep and that the mid tier
begins at `721px`, so the overlap cannot come back.

## What this does not cover

The minimum is the *floor*, not proof the floor is clean. Verifying that requires capturing the real
built application at this size across the language modes, both themes, and 100/125/150/200% display
scale — see `docs/clipping-matrix.md` for that, and treat any claim about narrow-width rendering
that is not backed by a validated probe receipt as unverified.
