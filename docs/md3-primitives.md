# MD3 shared primitives (`src/renderer/ui/md3/`)

**Status:** primitives shipped and ready to import; no application call sites migrated onto them
except `ui/SegmentedPill.tsx` (see [Migration status](#migration-status)).

## Why this exists

The Material Design 3 rewrite (`design/v2/`) landed as fourteen parallel lanes, each shipping its
own scoped BEM classes into `src/renderer/styles.md3.css` (now 8,000+ lines). The result is that
"a filled pill button", "a status chip" and "a floating menu surface" each exist several times
over — `.md3-kids-filled-btn`, `.confirm__btn.primary`, `.term-node__status--busy`,
`.kanban-badge--running` — all describing the same handful of shapes from
[`design/v2/md3/HANDOFF.md`](../design/v2/md3/HANDOFF.md)'s component-recipe table, each with
slightly different literals.

`src/renderer/ui/md3/` is the extraction: one definition per shape, read straight out of that
recipe table and the shipped `.dc.html` prototypes' own `style=""` attributes (the bundle
documents itself that way — see `design/v2/HANDOFF-README.md`, "Recreate pixel-perfectly").
Future work that needs a button, a text field, a status chip, and so on should reach for these
instead of writing a fifteenth scoped class.

## What's in the barrel

```ts
import {
  Button, IconButton, Fab, Switch, TextField, Chip, StatusChip,
  Card, ListRow, Menu, Dialog, Badge, SegmentedButton, Divider
} from '@renderer/ui/md3'
```

Importing anything from the barrel (`index.ts`) also pulls in `primitives.css`, so no separate
stylesheet import is required.

| Component | Recipe | Notes |
| --- | --- | --- |
| `Button` | 40px pill; `filled` / `tonal` / `outlined` / `text`, plus a `danger` colour overlay | New CSS (`.mdx-btn*`) |
| `IconButton` | 44px round (`'dense'` = 40px) | Reuses `.md3-icon-btn` verbatim |
| `Fab` | 56px, r16, `primary-container` (`'small'` = 40px, r12) | Reuses `.md3-fab` verbatim |
| `Switch` | 52×32 track, 16px→24px knob | Re-exports `ui/Switch.tsx` — see below |
| `TextField` | Outlined, 56px, r16, floating notched label, `trailingSlot` | New CSS (`.mdx-field*`) |
| `Chip` | 32px, r8, assist/filter (`selected`) | New CSS (`.mdx-chip*`) |
| `StatusChip` | 28px pill (`'compact'` = 24px), tone map, pulsing dot on `running`/`attention` | New CSS (`.mdx-status-chip*`) |
| `Card` | Generic tonal surface, `tone` × `shape`, optional `interactive` hover | New CSS (`.mdx-card*`) |
| `ListRow` | Icon tile + label/sub + trailing (kbd chip) — menu/palette/list row shape | New CSS (`.mdx-row*`) |
| `Menu` | Floating panel, r28 `surface-container-high` (`compact` = r20) | New CSS (`.mdx-menu*`); positioning is the consumer's job |
| `Dialog` | Centered modal + scrim, r28, Escape/scrim-click/focus-return | New CSS (`.mdx-dialog*`) |
| `Badge` | 16px min-width pill or 8px dot, optional `corner` positioning | New CSS (`.mdx-badge*`) |
| `SegmentedButton` | 40px pill container, selected segment filled `secondary-container` | New CSS (`.mdx-seg*`) |
| `Divider` | 1px `outline-variant` hairline, horizontal/vertical | New CSS (`.mdx-divider*`) |

Every component is a thin wrapper: a root class, a variant class, forwarded DOM props, a
`forwardRef` where the underlying element is one a caller would plausibly need a ref to, and a
`className` escape hatch. None of them own state they don't have to — `Menu` in particular owns
no positioning logic at all; pair it with `ui/AnchoredPopover.tsx` (already used by every existing
menu/palette in this app) the way a consumer already does today.

### `Switch` is a re-export, not a rebuild

`ui/Switch.tsx` already implemented the exact HANDOFF recipe (52×32 track, `.md3-switch` /
`.md3-switch__knob` in `styles.md3.css`) before this lane started. `ui/md3/Switch.tsx` re-exports
it rather than shipping a second, competing implementation — the barrel is complete without
duplicating a control that was already correct.

### Why `mdx-` and not `md3-`

Every class this file *defines* (Button, TextField, Chip, StatusChip, Card, ListRow, Menu, Dialog,
Badge, SegmentedButton, Divider) is prefixed `mdx-`, not `md3-`, even though the rest of the app's
MD3 classes use `md3-`. `primitives.css` isn't imported by anything in the built app today — the
moment something imports the `ui/md3` barrel, its class names become global in the same document
as `styles.md3.css`. Reusing `md3-` risks colliding with a same-named class one of the fourteen
migration lanes already shipped under that prefix, silently changing that lane's visuals the
moment this barrel gets its first real consumer. `mdx-` guarantees that can't happen.

Two components deliberately do **not** follow that rule, because an exact, already-correct shared
class already exists and reusing it beats duplicating the recipe under a second name:

- `IconButton` reuses `.md3-icon-btn` (`styles.md3.css`, commented there as "Shared 44px round
  icon button — every app-bar action").
- `Fab` reuses `.md3-fab` (same file, the nav rail's node-creation FAB).

`IconButton`'s `active` prop applies the class `.is-active`, which `Canvas.tsx` already writes
onto a raw `.md3-icon-btn` for its dictation toggle — but no rule currently exists for that
combination in `styles.md3.css`, so that toggle has no visible active state today. This barrel's
`.mdx-icon-btn.is-active` rule (in `primitives.css`) fixes that retroactively, but only once
something actually imports `ui/md3` — it is inert dead weight in the bundle until then.

### `TextField`'s floating label and its one real limitation

The outlined text field's "notch" (the small gap the label sits in, cut into the top border) works
in every existing implementation of this pattern — including the one already in
`styles.md3.css`'s `.md3-field__label`, and the Clone-dialog prototype it's copied from — by
painting a solid patch behind the label that matches whatever surface the field sits on. CSS
cannot know that surface on its own. `TextField` exposes it as `--mdx-field-surface` (default
`--md-surface-container-high`, the surface every dialog in the design bundle sits on), settable on
the field or an ancestor when it's placed somewhere else. This is a real, stated limitation, not a
bug: get the surface wrong and the label's backdrop patch will show a seam against its true
background.

### `Dialog` is deliberately self-contained

`ConfirmDialog.tsx` / `DestructiveConfirmGate.tsx` share `dialog-stack.ts` and `confirm-key.ts` —
window-level machinery that stacks several open dialogs and is careful about not stealing an Enter
or Escape meant for a terminal or the command palette. `ui/md3/Dialog` does not plug into that
stack; it owns its own portal, scrim, Escape handler and focus-return, scoped to itself. A
primitives lane shouldn't quietly grow into a second, competing dialog-stack implementation. A
consumer that needs the app's shared stacking/Enter behaviour should keep using `ConfirmDialog`
today — wiring `Dialog` into `dialog-stack.ts` is a follow-up for whichever lane actually migrates
a call site onto it.

### `StatusChip` vs. the app's existing status chips

HANDOFF's literal recipe is 28px, 11.5px/700. Two existing, feature-owned peers render something
close but not identical: `TerminalNode.tsx`'s `.term-node__status` (26px, and no `success-container`
"ok" tone) and the kanban board's `.kanban-badge` (24px, the same tone map minus "ok"). `StatusChip`
is the literal-spec canonical version — including a `'compact'` (24px) size that matches
`.kanban-badge`'s footprint — for whichever future lane migrates those call sites onto it. It does
not replace either today.

## Migration status

**Nothing in the running app was migrated onto these primitives in this change**, by design — that
is a separate job, working through 2,458 existing `className=` call sites, that would collide with
every other MD3 lane touching the same files. The one exception, explicitly authorized: `ui/SegmentedPill.tsx`
now re-exports `ui/md3/SegmentedButton`. Its prop shape (`{ value, options, onChange, ariaLabel }`,
generic over `T extends string`) was already byte-identical to `SegmentedButton`'s, so there was no
call site to migrate — every existing `<SegmentedPill/>` usage now renders the MD3 primitive (a
40px pill, `--md-outline` border, `secondary-container` selected segment) instead of the component's
old `.seg-pill` / `.seg-pill-opt` classes in `styles.css`, which were still on the app's pre-MD3
`rgba(var(--tint-rgb), …)` palette rather than the `--md-*` token set the rest of the app moved onto.

## The one bug fixed outside this directory

`ui/Button.tsx`'s `default` variant hover was `hover:bg-[rgba(255,255,255,0.06)]` — a literal
white overlay, expressed as a Tailwind arbitrary value rather than an authored CSS declaration, so
the theme guard (which scans `styles.css`/`styles.md3.css` text, not compiled Tailwind output)
could not see it. It read fine on the dark theme's near-black `panel-header` background and was
nearly invisible on the light theme's near-white one. Fixed to
`hover:bg-[rgba(var(--tint-rgb),0.06)]` — `--tint-rgb` is the app's existing theme-correct ink
tint (white in dark mode, `--md-on-surface`'s literal in light mode; see `styles.css`), already
the established idiom for exactly this kind of overlay elsewhere in the stylesheet. Same opacity,
same visual weight in dark mode, now visible in light mode too.

**Not fixed, and worth a follow-up look:** the same component's `primary` variant renders
`text-white` unconditionally. In the dark theme, `bg-accent` resolves to `--md-primary`'s dark
literal (`#D0BCFF`, a light lavender) with white text on top — low contrast, and not what
`--md-on-primary` (`#381E72`) would give it. This wasn't in this lane's stated scope (the task
named the one hover value specifically) and touching it risks a visual change to every existing
`<Button variant="primary">` call site without a way to eyeball the result from here, so it's
recorded rather than changed.
