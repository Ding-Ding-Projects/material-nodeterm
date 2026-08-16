# The desktop app's design tokens — the source a design system must derive from

This is the **token source of truth for the Electron app** (`src/renderer/styles.css`), written for
anyone authoring a Material Design 3 system *for the app*.

**Status: the M3 token foundation has landed.** `:root` and `:root[data-theme='light']` in
`src/renderer/styles.css` now carry a full `--md-*` role set and an extended shape scale, alongside
every token that was already there — nothing existing was renamed or removed. What follows used to
describe a gap and a proposal; it now describes what shipped, why each value was chosen, and what is
still outstanding. Read the file, not this summary, before relying on a token name — see
**Verifying anything claimed about these values** at the end.

## Why this document exists

The in-progress `nodeterm Design System` bundle derives its foundations from **`site/styles.css`** —
the marketing/docs site. That is a different codebase with a different palette, and the two do not
resemble each other. Adopted literally by the app, the site's tokens would have produced this:

| Bundle foundation | Site value it aliases | The app's actual equivalent |
| --- | --- | --- |
| `--md-surface-container-low` → `var(--paper2)` | `#fffdf7` near-white cream | `#1a1a1a` |
| `--md-surface-container-high` → `var(--sunk)` | `#fff1cf` warm yellow | `#242424` |
| `--md-on-surface` → `var(--ink)` | `#2c2036` dark purple | white at 85% over a dark tint |
| `--md-outline-variant` → `var(--line)` | `#2c2036` solid | white at 10% |
| `--md-primary` | `#6b4fd8` / `#b197fc` purple | `#0a84ff` systemBlue |
| `--md-shape-lg` → `var(--round)` | `20px` | the app's *largest* radius is `12px` |

A terminal manager would have come out cream-coloured with purple accents and 20px corners. The
values were all real — they were just real values from the wrong project. This document exists to
be the source that was actually used instead, and it is why the mapping below aliases the app's own
tokens rather than the site's.

## The app's ramp was already M3-shaped

It was not a flat palette needing invention. There was a clean six-step surface ramp, a full
semantic set, and a real two-theme system, so landing M3 roles onto it was mostly **naming**, not
choosing. The underlying ramp is unchanged by the M3 work — every value below still exists exactly
as it did before, and the `--md-*` roles below alias it.

### Surfaces

| token | dark | light |
| --- | --- | --- |
| `--surface-black` | `#0a0a0c` | `#f5f1ea` |
| `--surface-sunken` | `#141416` | `#efeae1` |
| `--surface-deep` | `#1a1a1a` | `#e6e0d4` |
| `--bg` | `#1e1e1e` | `#fbf8f3` |
| `--surface-raised` | `#242424` | `#fdfbf7` |
| `--surface-overlay` | `#2c2c2e` | `#fdfbf7` |

Note the light theme is **warm** (`#fbf8f3`, not `#ffffff`) and its ramp runs the *other way* —
containers get darker as they recede, lighter as they rise. A mapping that assumes "higher
container = lighter value" is correct in dark and inverted in light. The `--md-surface-*` aliases
inherit this inversion for free, because they point at these tokens rather than duplicating values.

### Text, line, accent, semantic

| token | dark | light |
| --- | --- | --- |
| `--text-strong` | `#fff` | `#2b241c` |
| `--text` | `rgba(var(--tint-rgb), 0.85)` | _same_ |
| `--muted` | `rgba(var(--tint-rgb), 0.55)` | `rgba(var(--tint-rgb), 0.7)` |
| `--muted-2` | `rgba(var(--tint-rgb), 0.25)` | `rgba(var(--tint-rgb), 0.4)` |
| `--border` | `rgba(var(--tint-rgb), 0.1)` | `rgba(var(--tint-rgb), 0.14)` |
| `--accent` | `#0a84ff` | `#007aff` |
| `--accent-hover` | `#3a9bff` | `#0a6ed1` |
| `--accent-text` | `#6cb0ff` | `#0060df` |
| `--danger` | `#ff453a` | `#c62a1f` |
| `--warn` | `#ff9f0a` | `#a85c00` |
| `--success` | `#32d74b` | `#1f7a38` |

**`--tint-rgb` is still load-bearing, and the M3 work did not touch it.** Text, muted and border are
not colours — they are *alphas over a tint*, which is how the app adapts to both themes and to the
user's chosen accent. `--md-outline` (below) is authored in the same family for the same reason.
Any future edit that flattens one of these into a literal hex value breaks the mechanism the whole
sheet depends on, `--md-*` roles included.

### Shape (before the M3 work — see below for the shipped scale)

| token | value |
| --- | --- |
| `--radius-sm` | `6px` |
| `--radius` | `8px` |
| `--radius-lg` | `12px` |

These three, theme-invariant, are unchanged. M3 defines six steps (`none` → `full`); the missing
ones were authored **around 6/8/12**, not around the site's `20px` — see **Shape scale, as shipped**
below.

## The mapping, as shipped

Every `--md-*` token below now exists in `src/renderer/styles.css`, in the `:root` block (dark) with
literal values restated in `:root[data-theme='light']` where the light block's own values differ
(see the file's comment at the top of the M3 section for exactly which rule decides that — a token
whose value is only ever another `var(...)` reference needs no light-block restatement, because it
already flips with whatever it points at).

### Surface roles — plain aliases

| M3 role | app token |
| --- | --- |
| `--md-surface-container-lowest` | `--surface-black` |
| `--md-surface-dim` | `--surface-sunken` |
| `--md-surface-container-low` | `--surface-deep` |
| `--md-surface` | `--bg` |
| `--md-surface-container-high` | `--surface-raised` |
| `--md-surface-container-highest` | `--surface-overlay` |
| `--md-on-surface` | `--text` |
| `--md-on-surface-variant` | `--muted` |
| `--md-outline-variant` | `--border` |

### `--md-outline` — the one genuinely new neutral

No existing token sat between `--muted-2` (0.25) and `--muted` (0.55), and M3's `outline` role wants
a boundary a user actually notices (an input's edge, a divider that carries meaning) — stronger than
`--border`/`outline-variant`, quieter than body text. It was authored as one more step in the same
`--tint-rgb` alpha family the rest of the sheet already uses:

```
--md-outline: rgba(var(--tint-rgb), 0.35);
```

Because it is built entirely from `--tint-rgb`, it needs no separate light-theme value — the tint
flip already carries it, the same way `--text` needs none.

### Primary — the app's one existing accent, under M3's name

| M3 role | value |
| --- | --- |
| `--md-primary` | `var(--accent)` (alias) |
| `--md-on-primary` | `#fff` (literal, both themes — same call as `--knob`: white on a saturated accent fill needs no flip) |
| `--md-primary-container` | `rgba(var(--accent-rgb), 0.16)` (authored tint of the real accent, not a neutral surface) |
| `--md-on-primary-container` | `var(--accent-text)` (alias) |

At runtime, a user-selected accent expands into the whole primary family in
`renderer/lib/accentTokens.ts`: `--accent-hover`, `--accent-text`, `--accent-rgb`,
`--md-primary`, `--md-on-primary`, `--md-primary-container`, and
`--md-on-primary-container`. CSS cannot split a hex custom property into an RGB triple or derive a
readable foreground by itself. The resolver keeps the selected hue, mixes toward the current
theme's readable pole only as far as the 4.5:1 text floor requires, and re-runs when the app theme
changes. This prevents a green/red/yellow custom primary from leaving blue text or a blue container
behind. The persisted default systemBlue and an invalid hand-edited value both remove the inline
family and restore the stylesheet's separately authored dark/light defaults.

### Secondary and tertiary — chosen, not deferred

These did not exist before the M3 work and were the only two genuinely new **colour decisions** in
the whole landing (as opposed to new alpha steps or container tints of an existing hue). Both were
resolved, not left open:

- **Secondary is authored neutral**: `--md-secondary: var(--muted)`, with
  `--md-secondary-container: var(--surface-overlay)` and `--md-on-secondary-container: var(--text)`.
  The reasoning recorded in the stylesheet: the app has exactly one identity accent (blue), and
  inventing an arbitrary second hue with no real call site would just be a stray colour in a
  terminal app. Secondary here means "chrome", not "a second brand colour".
- **Tertiary reuses `--agent-working`** (`#d97757` dark / `#b04a28` light — the clay used for every
  "agent mid-turn" indicator: node glow, sidebar dot, project-header badge), because it is the app's
  actual second hue already live in the product, not an invention:
  `--md-tertiary: var(--agent-working)`, with `--md-tertiary-container` an authored 0.18-alpha tint
  of that same hue per theme and `--md-on-tertiary-container: var(--agent-working)`.

If a future design wants a *different* secondary or tertiary — an actual second brand hue, say —
that is a real design decision to make deliberately, not a token to "fix": the ones shipped are a
considered choice, not a placeholder.

### Error, and the two custom roles M3 has no name for

| M3 role | value |
| --- | --- |
| `--md-error` | `var(--danger)` (alias) |
| `--md-error-container` | `rgba(var(--danger-rgb), 0.16)` (authored tint) |
| `--md-on-error-container` | `var(--danger)` (alias) |

M3 defines primary / secondary / tertiary / error and nothing else — no `warning`, no `success`. The
app genuinely needs both (SSH status copy, permission-mode copy), so they were **extended as custom
colour roles** rather than dropped or awkwardly folded into `error`/`tertiary`:

| custom role | value |
| --- | --- |
| `--md-success` | `var(--success)` (alias) |
| `--md-success-container` | authored 0.16-alpha tint of `--success`, per theme |
| `--md-on-success-container` | `var(--success)` (alias) |
| `--md-warning` | `var(--warn)` (alias) |
| `--md-warning-container` | `rgba(var(--warn-rgb), 0.16)` (authored tint) |
| `--md-on-warning-container` | `var(--warn)` (alias) |

### Scrim and shadow — no app equivalent existed

Neither a translucent wash nor a drop-shadow colour existed as a named token before this. Two
different sourcing decisions were made, and they differ on purpose:

- **`--md-shadow`** was **derived from the app's own `--shadow-k` multiplier** rather than the
  design doc's numbers: `rgba(0, 0, 0, 0.55)` dark (the sheet's base weight, `--shadow-k: 1`) and
  `rgba(0, 0, 0, 0.19)` light (`0.55 × 0.35`, `--shadow-k`'s light weight). This keeps the M3 shadow
  role in step with every existing `box-shadow` in the sheet, which is already scaled by
  `--shadow-k`.
- **`--md-scrim`** has no app analogue to derive from at all, so the design doc's own values were
  landed as-is: `rgba(0, 0, 0, 0.62)` dark, `rgba(0, 0, 0, 0.32)` light. This is the one pair of
  values in the whole landing that did **not** come from the app's existing palette — worth knowing
  if a later audit is checking "does everything trace back to an existing app token".

### Shape scale, as shipped

The app's three existing radii were kept **byte-for-byte** as this scale's small/medium anchors —
`--radius-sm` (6px) and `--radius` (8px) and `--radius-lg` (12px) are unchanged tokens, not new
values that happen to match. The steps around them were authored **for this app**, not around the
design doc's site-derived `20px`:

| M3 role | token | value |
| --- | --- | --- |
| `--md-shape-none` | `--radius-none` | `0px` |
| `--md-shape-extra-small` | `--radius-sm` | `6px` (existing) |
| `--md-shape-small` | `--radius` | `8px` (existing) |
| `--md-shape-medium` | `--radius-lg` | `12px` (existing) |
| `--md-shape-large` | `--radius-xl` | `16px` |
| `--md-shape-extra-large` | `--radius-xxl` | `28px` |
| `--md-shape-full` | `--radius-full` | `999px` |

`--radius-none`, `--radius-xs` (4px — not wired into a `--md-shape-*` role; kept for a step M3 does
not name between "none" and "extra-small"), `--radius-xl`, `--radius-xxl` and `--radius-full` are
all new tokens.

## What is still outstanding

The token *foundation* is done; two things named in the earlier version of this document are not:

1. **Elevation has no dp/level scale.** `--md-shadow` and `--md-scrim` (above) are colour values —
   what a shadow or scrim is *tinted* — not the M3 elevation *levels* (0–5, each with its own
   shadow recipe and, in M3's tonal-elevation model, a surface-tint overlay). The app's existing
   `box-shadow` rules and `--shadow-k` multiplier are the closest thing to an elevation system today,
   and they were left alone. Authoring real `--md-elevation-0` … `--md-elevation-5` tokens (or the
   app's own equivalent scale) is unstarted.
2. **Secondary and tertiary were chosen, not deferred** — see above. What remains open is only
   whether a *different* pair is wanted later; nothing is missing or placeholder-valued today.
3. **Nothing consumes these tokens yet.** The ~280 existing call sites in `styles.css` (and every
   other stylesheet/component in the app) still read the original bare tokens (`--accent`, `--bg`,
   `--border`, …), not the new `--md-*` names. Wiring components onto the M3 roles is a separate,
   not-yet-started piece of work — see the constraint below before starting it.

## Leave the git-graph lane colours alone

`--git-graph-lane-1..5`, `--git-graph-ref`, `--git-graph-base-ref`, `--git-graph-remote-ref` are
theme-invariant on purpose and were correctly left untouched by the M3 landing: they encode *data*,
not chrome, and CLAUDE.md exempts functional data colours from M3 conformance. Folding them into a
tonal palette would make two branches indistinguishable. No `--md-*` role aliases them, and none
should.

## The constraint that shapes any future component migration

The app ships a **per-element appearance editor** and an **infinite colour picker** that let a user
override tokens at runtime, persist the result, export it, and reset it. Because nothing reads or
writes a `--md-*` token name from user data yet (see "Nothing consumes these tokens yet" above),
this constraint has not bitten anyone during the landing just described — but it is not optional for
whatever wires components to these roles next.

Any rename or re-point of a token that user-facing appearance state can reference has two sides: the
stylesheet, and every place that reads or writes a token name from stored data. A rename that only
lands in CSS leaves saved themes pointing at tokens nobody defines — and the failure is silent,
because an undefined custom property falls back to whatever it inherits rather than erroring.
Migrate stored appearance state alongside any such rename, and keep the old names as aliases for at
least one release.

## Verifying anything claimed about these values

Read them out of the file rather than trusting a summary, this one included:

```bash
grep -oE -- "--[a-z0-9-]+\s*:\s*[^;]+;" src/renderer/styles.css | sort -u
```

To see only the M3 additions:

```bash
grep -n -- "--md-" src/renderer/styles.css
```

And to confirm nothing existing was renamed alongside them — the M3 landing should be a pure
addition:

```bash
git diff --stat src/renderer/styles.css   # if the change is still uncommitted
```

`src/renderer/styles.theme.test.ts` is the executable version of the "every literal colour token
must be restated in the light block" rule referenced throughout this document — run it rather than
trusting that a table above still matches the file.
