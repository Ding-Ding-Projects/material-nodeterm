# The desktop app's design tokens — the source a design system must derive from

This is the **token source of truth for the Electron app** (`src/renderer/styles.css`), written for
anyone authoring a Material Design 3 system *for the app*.

**Status: the M3 baseline scheme has landed.** `:root` and `:root[data-theme='light']` in
`src/renderer/styles.css` now carry the classic MD3 baseline scheme (seed `#6750A4`, dark register)
transcribed **verbatim** from `design/v2/md3/tokens.css`, plus the app's own pre-existing radii,
motion, git-graph identity colours and legacy compatibility tokens alongside it. This is a second
landing, not the first: an earlier pass (history below) grew the `--md-*` roles OUT of the app's own
hand-picked palette, as aliases; this pass **inverts that relationship**. Read the file, not this
summary, before relying on a token name — see **Verifying anything claimed about these values** at
the end.

## History: two landings, opposite directions

**First landing** (the app's own palette, wearing M3's names). The `--md-*` roles were introduced as
a *naming* exercise over a palette the app already had: a real six-step surface ramp, a real accent,
real status hues — each `--md-*` role was a plain alias onto the corresponding existing token
(`--md-primary: var(--accent)`, `--md-surface: var(--bg)`, …), and a "tonal palette" of `--md-tone-*`
custom properties stood in for a genuine HCT/CAM16 implementation this app does not have, letting a
handful of roles (secondary, tertiary, the neutral ramp) be *derived* from the app's own seed colours
via a hand-rolled Lab/LCH lightness ladder. The whole exercise moved zero pixels — every role
resolved to the exact value it already had.

**Second landing, the one this document now describes** (2026-08, "the M3-baseline re-seed"): the
roles are re-pointed onto `design/v2/md3/tokens.css`'s literal classic-MD3 baseline scheme instead —
real Material palette values, seeded from `#6750A4`, no longer derived from the app's old blue accent
or its hand-rolled tonal ladder. **The `--md-tone-*` ramp is deleted outright**; every `--md-*` role
is now a plain hex or `rgba()` literal, restated per theme, exactly the way `design/v2/md3/tokens.css`
ships it. And because the roles are no longer aliases *of* the app's old tokens, the relationship
**inverts**: `--bg`, `--panel`, `--accent`, `--danger`, `--warn`, `--success`, `--knob`,
`--mono-font`, `--canvas-bg`, `--canvas-dot`, … are now aliases *pointing at* the `--md-*` roles,
preserving every one of their ~1000 existing call sites (component `.tsx` files included — 145 of
them read `var(--accent)` directly) without those call sites changing at all.

## Why a *second* landing, not a tune of the first

The in-progress `nodeterm Design System` bundle (`design/v2/`) is a full Material Design 3 rewrite
of the whole renderer, built against the classic MD3 baseline register — not against the app's old
blue-accent palette the first landing preserved. Its own handoff (`design/v2/md3/HANDOFF.md`) says so
explicitly: *"Delete the old `--md-tone-*` ramps; every role is now a literal from the baseline
scheme."* Keeping the first landing's app-derived roles would have shipped a design built for one
palette against a stylesheet still wearing another — the exact mismatch the FIRST landing's own
history section (preserved below) already warned about when it compared the app's palette to the
*site's* one:

| Bundle foundation | Site value it used to alias | The app's OLD (pre-re-seed) equivalent |
| --- | --- | --- |
| `--md-surface-container-low` → `var(--paper2)` | `#fffdf7` near-white cream | `#1a1a1a` |
| `--md-surface-container-high` → `var(--sunk)` | `#fff1cf` warm yellow | `#242424` |
| `--md-on-surface` → `var(--ink)` | `#2c2036` dark purple | white at 85% over a dark tint |
| `--md-primary` | `#6b4fd8` / `#b197fc` purple | `#0a84ff` systemBlue |

That mismatch is now resolved the other way: the app's tokens moved to match the design bundle's own
baseline scheme, rather than the design bundle being re-derived from the app's old palette a second
time. `#6750A4` — the exact purple the site/bundle comparison above used as the mismatch example — is
now the app's own literal `--md-primary` (light theme).

## The app's ramp, before this pass

For context (and because the legacy compatibility tokens below still describe SOME of these): the
app had a clean six-step surface ramp, a full semantic set, and a real two-theme system before either
M3 landing touched it. None of the literal values below are current — every one of them has since
been re-pointed at an `--md-*` role's OWN literal, per the mapping later in this document — but the
STRUCTURE (six-step ramp, `--tint-rgb`-driven overlay system, per-theme accent) is what both `--md-*`
landings were layered onto, and is why `--tint-rgb`, `--muted`, `--border`, `--panel*` and friends
still exist as named tokens at all.

| pre-re-seed token | old dark literal | old light literal | now aliases |
| --- | --- | --- | --- |
| `--surface-black` | `#0a0a0c` | `#f5f1ea` | `--md-surface-container-lowest` |
| `--surface-sunken` | `#141416` | `#efeae1` | `--md-surface-dim` |
| `--surface-deep` | `#1a1a1a` | `#e6e0d4` | `--md-surface-container-low` |
| `--bg` | `#1e1e1e` | `#fbf8f3` | `--md-surface-container` (was `--md-surface`) |
| `--surface-raised` | `#242424` | `#fdfbf7` | `--md-surface-container-high` |
| `--surface-overlay` | `#2c2c2e` | `#fdfbf7` | `--md-surface-container-highest` |
| `--accent` | `#0a84ff` (systemBlue) | `#007aff` | `--md-primary` |
| `--danger` | `#ff453a` | `#c62a1f` | `--md-error` |
| `--warn` | `#ff9f0a` | `#a85c00` | `--md-warning` |
| `--success` | `#32d74b` | `#1f7a38` | `--md-success` |
| `--canvas-bg` | `#000000` (literal) | `#f4efe6` (literal) | `--md-surface` (was a bare literal) |

**`--bg` and `--canvas-bg` swap which surface role they point to.** Before this pass, `--bg` aliased
`--md-surface` (the deepest, base layer) and `--canvas-bg` was an independently hand-picked literal.
Under the M3 baseline scheme `--bg`/`--panel` (the content-panel/terminal-chrome layer) now sit on
`--md-surface-container` — one step up the ramp — and `--canvas-bg` (the field BEHIND the nodes)
takes the base `--md-surface` role instead. This matches the actual M3 convention more closely: the
canvas is the deepest structural layer, and content panels are a container ON TOP of it.

**`--tint-rgb` is still the mechanism ~280 overlay rules across the sheet lighten/darken from**, and
the M3-baseline re-seed changes its LIGHT value: it used to be a warm hand-tuned near-black
(`58, 48, 38`), chosen specifically so the light theme read as "warm, not white" rather than glare.
It is now `29, 27, 32` — `--md-on-surface`'s own literal in the light scheme, decomposed — which
still carries a cool violet cast (not pure black) rather than the old brown one. This is a genuine,
deliberate visual change across the whole light theme (borders, hover fills, muted text, gradient
stops — everything mixed from `--tint-rgb`), traded for landing the design's own literal baseline
rather than re-deriving a warm ink from it. See `styles.theme.test.ts`'s "light palette contrast"
suite for the floors this still has to clear (it does, with margin).

## The mapping, as shipped

Every `--md-*` role is a **literal**, transcribed from `design/v2/md3/tokens.css`, restated in both
`:root` and `:root[data-theme='light']` (`styles.css`'s "Material Design 3 — token foundation"
section). Nothing below is derived from an app token any more — see the previous section's table for
what a legacy token now points AT instead.

### Surface roles

| M3 role | dark | light |
| --- | --- | --- |
| `--md-surface` | `#141218` | `#FEF7FF` |
| `--md-surface-dim` | `#141218` | `#DED8E1` |
| `--md-surface-bright` | `#3B383E` | `#FEF7FF` |
| `--md-surface-container-lowest` | `#0F0D13` | `#FFFFFF` |
| `--md-surface-container-low` | `#1D1B20` | `#F7F2FA` |
| `--md-surface-container` | `#211F26` | `#F3EDF7` |
| `--md-surface-container-high` | `#2B2930` | `#ECE6F0` |
| `--md-surface-container-highest` | `#36343B` | `#E6E0E9` |
| `--md-on-surface` | `#E6E0E9` | `#1D1B20` |
| `--md-on-surface-variant` | `#CAC4D0` | `#49454F` |
| `--md-outline` | `#938F99` | `#79747E` |
| `--md-outline-variant` | `#49454F` | `#CAC4D0` |
| `--md-inverse-surface` | `#E6E0E9` | `#322F35` |
| `--md-inverse-on-surface` | `#322F35` | `#F5EFF7` |
| `--md-inverse-primary` | `#6750A4` | `#D0BCFF` |

Note the light ramp runs the OTHER way from dark: `surface-container-lowest` is `#FFFFFF` in light
(the brightest step) and `#0F0D13` in dark (the darkest). A mapping that assumes "higher container =
lighter value" is correct in dark and inverted in light — the same inversion the app's pre-re-seed
ramp already had, now carried by the literal values themselves rather than by a derivation formula.

### Primary, secondary, tertiary, error

| M3 role | dark | light |
| --- | --- | --- |
| `--md-primary` | `#D0BCFF` | `#6750A4` |
| `--md-on-primary` | `#381E72` | `#FFFFFF` |
| `--md-primary-container` | `#4F378B` | `#EADDFF` |
| `--md-on-primary-container` | `#EADDFF` | `#21005D` |
| `--md-secondary` | `#CCC2DC` | `#625B71` |
| `--md-on-secondary` | `#332D41` | `#FFFFFF` |
| `--md-secondary-container` | `#4A4458` | `#E8DEF8` |
| `--md-on-secondary-container` | `#E8DEF8` | `#1D192B` |
| `--md-tertiary` | `#EFB8C8` | `#7D5260` |
| `--md-on-tertiary` | `#492532` | `#FFFFFF` |
| `--md-tertiary-container` | `#633B48` | `#FFD8E4` |
| `--md-on-tertiary-container` | `#FFD8E4` | `#31111D` |
| `--md-error` | `#F2B8B5` | `#B3261E` |
| `--md-on-error` | `#601410` | `#FFFFFF` |
| `--md-error-container` | `#8C1D18` | `#F9DEDC` |
| `--md-on-error-container` | `#F9DEDC` | `#410E0B` |

**Primary is no longer derived from `--accent`.** Under the FIRST landing, `--md-primary` was
`var(--accent)` and a custom user-chosen accent flowed into the M3 role for free through the CSS
cascade. Under the re-seed, `--md-primary` is the design's own literal, and `--accent` is now the
ALIAS (`--accent: var(--md-primary)`) — direction inverted. A user-chosen custom accent no longer
reaches the primary family through the cascade at all; it works ONLY because
`renderer/lib/accentTokens.ts`'s `applyAccentTokens()` sets every member of the primary family
(`--accent`, `--accent-hover`, `--accent-text`, `--accent-rgb`, `--md-primary`, `--md-on-primary`,
`--md-primary-container`, `--md-on-primary-container`) explicitly, inline, whenever the persisted
accent differs from the shipped default. `accentTokens.test.ts`'s "a custom accent republishes the
whole primary family" is the test that guarantees this — see that file, not a stylesheet pattern, for
the invariant.

**Tertiary is no longer `--agent-working`.** The FIRST landing pointed `--md-tertiary` at the app's
"agent is mid-turn" clay accent (`#d97757`/`#b04a28`) as its one genuine new colour DECISION, on the
grounds that inventing an arbitrary hue would be worse than reusing a real one already live in the
product. The design bundle's own component recipes use tertiary/tertiary-container as the RUNNING
status colour on Board and Canvas status chips — a literal design decision distinct from the app's
own busy-indicator hue — so `--md-tertiary` is now the design's own pink/mauve literal, and
`--agent-working` stays completely independent: same value, same direct call sites
(`.ss-group__sig--working`, the busy-glow node border), untouched by either M3 landing.

**Secondary is no longer `var(--muted)`.** Under the first landing there was no real secondary hue —
`--md-secondary: var(--muted)` meant "chrome, not colour". The re-seed gives secondary a real literal
(a low-chroma lavender-grey) from the baseline scheme; nothing in the app currently targets it, but it
is available for component work that wants a genuine second-tier accent rather than plain neutral
text.

### Custom roles M3 has no name for — success / warning

| custom role | dark | light |
| --- | --- | --- |
| `--md-success` | `#89D88C` | `#226C33` |
| `--md-success-container` | `#0B5219` | `#A8F5B4` |
| `--md-on-success-container` | `#A4F5A6` | `#00210A` |
| `--md-warning` | `#E7C26C` | `#785900` |
| `--md-warning-container` | `#5B4300` | `#FFDF9E` |
| `--md-on-warning-container` | `#FFDF9E` | `#261A00` |

M3 defines primary / secondary / tertiary / error and nothing else. The app genuinely needs both
success and warning (SSH status copy, permission-mode copy), and both are now design-harmonized
literals rather than aliases of `--success`/`--warn` — direction inverted, same as primary/error:
`--success: var(--md-success)` and `--warn: var(--md-warning)` are the aliases now.

### Scrim and shadow

- **`--md-scrim`**: `rgba(0, 0, 0, 0.6)` dark, `rgba(0, 0, 0, 0.32)` light — the design's own literal,
  landed verbatim (there was never an app scrim token to derive it from).
- **`--md-shadow`**: `rgba(0, 0, 0, 0.55)` dark, `rgba(0, 0, 0, 0.19)` light — **NOT** a design value.
  The design ships "tonal elevation only" (no drop-shadow ramp at all), but the app's own
  pre-existing `box-shadow` rules still scale off `--md-shadow` via the `--shadow-k` multiplier
  (`1` dark, `0.35` light), so this stays exactly what it was before either M3 landing, kept until
  the last such rule is retired.

### Shape scale — unchanged by this pass

| M3 role | token | value |
| --- | --- | --- |
| `--md-shape-none` | `--radius-none` | `0px` |
| `--md-shape-extra-small` | `--radius-sm` | `6px` |
| `--md-shape-small` | `--radius` | `8px` |
| `--md-shape-medium` | `--radius-lg` | `12px` |
| `--md-shape-large` | `--radius-xl` | `16px` |
| `--md-shape-extra-large` | `--radius-xxl` | `28px` |
| `--md-shape-full` | `--radius-full` | `999px` |

The app's three pre-existing radii (6/8/12) already sat exactly on this scale's extra-small/small/
medium anchors — the same 6/8/12/16/28 progression `design/v2/md3/tokens.css` ships as
`--md-shape-xs/sm/md/lg`. Those four short names are deliberately **not** added as a second,
redundant spelling of a scale the app already has under different names.

### Motion and type — new with this pass

- **`--md-motion-spatial`**: `500ms cubic-bezier(0.38, 1.21, 0.22, 1)` — apply to movement/scale on
  entrances and discrete state changes only, never to a continuous gesture (node drag, canvas
  pan/zoom, scroll-follow).
- **`--md-motion-effect`**: `200ms cubic-bezier(0.34, 0.80, 0.34, 1)` — colour/hover transitions.
- **`--md-font-ui`**: `'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
  — the design's own choice (`Outfit`) with the app's pre-existing Apple system-font stack kept
  BEHIND it, not dropped: `shared/i18n/catalog.ts` carries hundreds of CJK glyphs for the Cantonese
  language mode, and Outfit ships none, so a fallback chain is load-bearing here, not decorative.
- **`--md-font-mono`**: `'Roboto Mono', ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace`.

### Fixed, non-theme roles

- **`--term-bg`**: `#0F0D13` in both themes — terminal bodies stay dark regardless of app theme.
  This is a real `:root` default now (it was not declared anywhere before this pass, relying purely
  on `App.tsx`'s runtime `setProperty` call plus a per-call-site CSS fallback); `App.tsx` remains the
  live, authoritative source and republishes it from the user's chosen terminal theme.
- **`--md-canvas-dot`**: `#322F38` dark / `#D8D0DE` light — the canvas grid-dot colour. The
  pre-existing `--canvas-dot` token (consumed directly by `Canvas.tsx`'s `<Background color=…>`
  prop) is now an alias onto this role, so that component needed no change.

## Leave the git-graph lane colours alone

`--git-graph-lane-1..5`, `--git-graph-ref`, `--git-graph-base-ref`, `--git-graph-remote-ref` are
theme-invariant on purpose and untouched by either M3 landing: they encode *data*, not chrome, and
CLAUDE.md exempts functional data colours from M3 conformance. Folding them into a tonal scheme would
make two branches indistinguishable. No `--md-*` role aliases them, and none should.

## What is still outstanding

1. **Elevation has no dp/level scale.** `--md-shadow` and `--md-scrim` are colour values — what a
   shadow or scrim is *tinted* — not the M3 elevation *levels* (0–5, each with its own shadow recipe
   and, in M3's tonal-elevation model, a surface-tint overlay). The app's existing `box-shadow` rules
   and `--shadow-k` multiplier are the closest thing to an elevation system today. The design bundle
   itself ships "tonal elevation only" (surface-tone steps, no shadow recipe at all), so a real
   `--md-elevation-0…5` scale is not part of it either — this remains unstarted either way.
2. **Component migration is a separate, ongoing effort.** Landing the token foundation (this
   document) does not by itself repaint anything: a rule still reading `var(--bg)` or
   `var(--accent)` keeps working exactly as before (that is the whole point of the legacy
   compatibility shim), but it is not yet reading the `--md-*` role directly. Wiring components onto
   the M3 roles — and, per the design bundle's structural changes (nav rail, project-switcher menu,
   full Settings screen; see `design/v2/md3/HANDOFF.md`), onto the new markup those roles are meant
   for — is separate, ongoing work this document does not track.

## The constraint that shapes any future component migration

The app ships a **per-element appearance editor** and an **infinite colour picker** that let a user
override tokens at runtime, persist the result, export it, and reset it. This constraint has not
bitten either M3 landing yet — no `--md-*` token name has been read from or written into user data —
but it is not optional for whatever wires components (or user-saved appearance state) to these roles
next.

Any rename or re-point of a token that user-facing appearance state can reference has two sides: the
stylesheet, and every place that reads or writes a token name from stored data. A rename that only
lands in CSS leaves saved themes pointing at tokens nobody defines — and the failure is silent,
because an undefined custom property falls back to whatever it inherits rather than erroring.
Migrate stored appearance state alongside any such rename, and keep the old names as aliases for at
least one release. **The M3-baseline re-seed did not rename or delete any existing token name** — the
legacy compatibility shim exists specifically so it did not have to — but a future pass that DOES
retire one of them (once every component reads `--md-*` roles directly and the shim is no longer
load-bearing) inherits this same obligation.

## Verifying anything claimed about these values

Read them out of the file rather than trusting a summary, this one included:

```bash
grep -oE -- "--[a-z0-9-]+\s*:\s*[^;]+;" src/renderer/styles.css | sort -u
```

To see only the M3 additions:

```bash
grep -n -- "--md-" src/renderer/styles.css
```

And to compare against the design bundle's own literals directly:

```bash
diff <(grep -oE -- "--md-[a-z0-9-]+:\s*#[0-9A-Fa-f]{6}" design/v2/md3/tokens.css | sort -u) \
     <(grep -oE -- "--md-[a-z0-9-]+:\s*#[0-9A-Fa-f]{6}" src/renderer/styles.css | sort -u)
```

`src/renderer/styles.theme.test.ts` is the executable version of the "every literal colour token must
be restated in the light block" rule referenced throughout this document — run it rather than
trusting that a table above still matches the file.
