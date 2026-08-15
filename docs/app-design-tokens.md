# The desktop app's design tokens — the source a design system must derive from

This is the **token source of truth for the Electron app** (`src/renderer/styles.css`), written for
anyone authoring a Material Design 3 system *for the app*.

## Why this document exists

The in-progress `nodeterm Design System` bundle derives its foundations from **`site/styles.css`** —
the marketing/docs site. That is a different codebase with a different palette, and the two do not
resemble each other. Adopted literally by the app, the site's tokens would produce this:

| Bundle foundation | Site value it aliases | The app's actual equivalent |
| --- | --- | --- |
| `--md-surface-container-low` → `var(--paper2)` | `#fffdf7` near-white cream | `#1a1a1a` |
| `--md-surface-container-high` → `var(--sunk)` | `#fff1cf` warm yellow | `#242424` |
| `--md-on-surface` → `var(--ink)` | `#2c2036` dark purple | white at 85% over a dark tint |
| `--md-outline-variant` → `var(--line)` | `#2c2036` solid | white at 10% |
| `--md-primary` | `#6b4fd8` / `#b197fc` purple | `#0a84ff` systemBlue |
| `--md-shape-lg` → `var(--round)` | `20px` | the app's *largest* radius is `12px` |

A terminal manager would come out cream-coloured with purple accents and 20px corners. The values
are all real — they are just real values from the wrong project.

**The app has zero `--md-*` tokens today** (verified: `grep -rl -- "--md-" src/` returns nothing).
So an M3 system for the app is a genuine rewrite rather than an extraction, and CLAUDE.md already
requires one — "every user-facing app conforms fully to Material Design 3 … with zero legacy or
original design elements remaining". This work closes a documented gap.

## The good news: the app's ramp is already M3-shaped

It is not a flat palette needing invention. There is a clean six-step surface ramp, a full semantic
set, and a real two-theme system — 46 tokens dark, 33 of them overridden for light. Most of the
work is **naming**, not choosing.

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
container = lighter value" is correct in dark and inverted in light.

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

**`--tint-rgb` is load-bearing.** Text, muted and border are not colours — they are *alphas over a
tint*, which is how the app adapts to both themes and to the user's chosen accent. Replacing them
with literal hex values would flatten a working mechanism into two hard-coded palettes.

### Shape

| token | value |
| --- | --- |
| `--radius-sm` | `6px` |
| `--radius` | `8px` |
| `--radius-lg` | `12px` |

Three steps, theme-invariant. M3 defines six (`xs` → `full`), so the shape scale is one of the few
places that genuinely needs authoring — and it must be authored **around 6/8/12**, not around the
site's `20px`.

## A proposed mapping (surfaces are nearly one-to-one)

| M3 role | app token |
| --- | --- |
| `surface-container-lowest` | `--surface-black` |
| `surface-dim` | `--surface-sunken` |
| `surface-container-low` | `--surface-deep` |
| `surface` | `--bg` |
| `surface-container-high` | `--surface-raised` |
| `surface-container-highest` | `--surface-overlay` |
| `on-surface` | `--text` |
| `on-surface-variant` | `--muted` |
| `outline-variant` | `--border` |
| `primary` | `--accent` |
| `error` | `--danger` |

## Three real decisions, and one thing to leave alone

1. **M3 has no `warning` or `success` role.** It offers primary / secondary / tertiary / error and
   nothing else. The app has both. Either extend the system with custom colour roles — legitimate,
   M3 supports them — or map them deliberately. Do not quietly drop them; `--warn` is doing real
   work in the SSH and permission-mode surfaces.
2. **`secondary` and `tertiary` do not exist yet** and must be chosen, not extracted. They are the
   only genuinely new colour decisions in the whole system.
3. **Elevation has no tokens at all** in the app today. M3's levels need authoring, and dark-theme
   shadows need their own values — a shadow tuned for light surfaces is invisible on `#1e1e1e`.
4. **Leave the git-graph lane colours alone.** `--git-graph-lane-1..5`, `--git-graph-ref`,
   `--git-graph-base-ref`, `--git-graph-remote-ref` are theme-invariant on purpose: they encode
   *data*, not chrome, and CLAUDE.md exempts functional data colours from M3 conformance. Folding
   them into a tonal palette would make two branches indistinguishable.

## The constraint that shapes the implementation

The app ships a **per-element appearance editor** and an **infinite colour picker** that let a user
override these tokens at runtime, persist the result, export it, and reset it. Any rename therefore
has two sides: the stylesheet, and every place that reads or writes a token name from user data.

A rename that only lands in CSS leaves saved themes pointing at tokens nobody defines — and the
failure is silent, because an undefined custom property falls back to whatever it inherits rather
than erroring. Migrate stored appearance state alongside the rename, and keep the old names as
aliases for at least one release.

## Verifying anything claimed about these values

Read them out of the file rather than trusting a summary, this one included:

```bash
grep -oE -- "--[a-z0-9-]+\s*:\s*[^;]+;" src/renderer/styles.css | sort -u
```

Every table above was generated from `src/renderer/styles.css` on 2026-08-15 and reflects the
`:root` and `:root[data-theme='light']` blocks at that commit.
