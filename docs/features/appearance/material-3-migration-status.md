# Material Design 3 migration — measured status

Written because "the GUI is not fully Material yet" is true but not actionable. These are counts
taken from the tree, and the document has already been wrong once — see the correction at the end,
which is kept because the way it was wrong is the interesting part.

**Source audit update (2026-08-26):** the complete per-surface inventory is now maintained in
[Material Design 3 desktop surface audit](./material-3-audit.md), with an executable
`scripts/check-material-audit.mjs` check. The audit covers every desktop shell, node, destination,
settings section, overlay, status, empty state, error state, and checked-in site page. It also
records the remaining runtime verification and ownership conflicts rather than treating source
markers as pixel evidence. The documentation and landing site runs in Kids mode by default, so its
existing visual style remains unchanged; only stale site facts or behavior may be corrected.

**Update (palette re-derivation landed):** everything from "What is there" through "Why step one
stops at the surface ramp" originally described the FIRST pass — a pure vocabulary bridge, where
every `--md-` colour role aliased onto the app's pre-existing palette and therefore rendered the
exact same pixel. That bridge is gone. The palette itself has now been re-derived from a seed
(`#0a84ff`, the app's own accent) into real M3 tonal palettes, and the roles below are read FROM
those palettes rather than from the legacy tokens — this is "step two" in the "What the design asks
for" section below, and it is done. The historical numbers in the next two sections are kept
verbatim (correcting only the two figures that were already stale before this pass — see the inline
notes) because the bridge's *reasoning* — why a plain alias is safe and a script cannot resolve a
two-role ambiguity — is exactly what step two had to respect, and reading it first is what makes the
new section ("The palette is re-derived") below legible.

## What is there (as of the first pass — see the update above for what changed)

`src/renderer/styles.css` defines **89 custom properties** at that point, of which **38 carry the
`--md-` prefix** and are Material colour and shape roles. (After the palette re-derivation the
sheet defines **177** — the 38 roles are unchanged in count, plus 78 canonical tonal-palette steps
and 10 extra scale rungs the six-role surface ramp needed; see the new section below.)

The prefix matters when you go looking: they are `--md-primary`, not `--md-sys-color-primary`. A
search for the canonical `--md-sys-` spelling returns **nothing**, which reads as "no Material
tokens exist" and is wrong.

**Thirty of the 38 were defined as aliases onto the app's existing palette**, not as new colours:

```css
--md-surface:                   var(--bg);
--md-surface-container-lowest:  var(--surface-black);
--md-surface-container-low:     var(--surface-deep);
--md-surface-container-high:    var(--surface-raised);
--md-surface-container-highest: var(--surface-overlay);
```

That was the design of the thing, and it was a good one. The Material vocabulary existed and
resolved to what the application already rendered, so a component could be moved onto
`--md-surface` in one commit **without changing a pixel** — and the day the palette itself was
re-derived from the design's scheme, every component already speaking Material would move with it.
It was a bridge, deliberately built to be replaced. **These five lines are now the opposite
direction** — `--md-surface` is a tonal-palette literal and `--bg` reads FROM it
(`--bg: var(--md-surface)`) — see "The palette is re-derived" below.

`src/renderer/styles.theme.test.ts` guards all 38 with a hand-written inventory, and says why it is
hand-written: a scan cannot notice a role that disappeared entirely, it would just quietly stop
checking it. That inventory is unchanged by the re-derivation — the 38 names are exactly the same
custom properties, now pointed at different values.

## Where the migration actually stood (first pass)

**Correction:** this section originally said 24 of the 38 roles had a `var()` consumer and 14 did
not. By the time this second pass started, component adoption had already closed that gap: the real
figure across the whole corpus was **0** roles without a consumer, not 14. The table below is kept
for the per-token counts, which are still informative even though the "14 without a consumer" framing
is stale.

Of the 38, every one has a `var()` consumer in the stylesheet. The heaviest are the foreground
roles — the ones that decide what text and strokes look like — plus the six surface-ramp roles that
the components moved onto:

| token | references |
|---|---:|
| `--md-on-surface` | 41 |
| `--md-on-surface-variant` | 24 |
| `--md-outline-variant` | 21 |
| `--md-outline` | 21 |
| `--md-primary` | 12 |
| `--md-error` | 9 |
| `--md-on-primary` | 5 |
| `--md-shape-*` (5 tokens) | 13 combined |
| remaining container/status roles | 18 combined |

The secondary and tertiary families and a few status containers were the last to gain a direct
consumer, in the ordinary course of component-by-component adoption — no script involved.
The SURFACE ramp is now consumed directly: 86 call sites moved off `--bg`, `--surface-sunken`,
`--surface-deep`, `--surface-raised`, `--surface-overlay` and `--surface-black` onto their Material
names, leaving each base token consumed only by its own alias. That step was appearance-neutral by
construction — the aliases are identities and no scope overrides a surface token locally, which was
checked rather than assumed (0 re-declarations outside `:root`).
The four `--md-primary*` roles are additionally set at runtime from TypeScript
(`renderer/lib/accentTokens.ts`), so a custom accent moves the Material primary family with it.



## Why step one stopped at the surface ramp (and what step two changed about it)

The obvious next move was to keep going — 1,206 call sites named a base token that had a Material
alias. **The reasoning below is why they were not converted by script, and it still holds** — it is
the reasoning step two (the palette re-derivation, done — see the new section below) had to respect,
not something step two made obsolete.

Each of the six surface tokens was aliased by **exactly one** Material role, so `var(--bg)` had one
correct answer and a substitution could not be wrong — which is exactly why the surface ramp's
*alias direction* was safe to reverse mechanically in step two (`--bg: var(--md-surface)` now, not
`--md-surface: var(--bg)`): still one role, one base token, one unambiguous correct answer, just
read the other way. Six other base tokens were aliased by **two**:

| base | Material roles that pointed at it (first pass) | what step two did |
|---|---|---|
| `--text` | `--md-on-surface` · `--md-on-secondary-container` | `--text` now reads FROM `--md-on-surface` only; `--md-on-secondary-container` got its own tonal-palette value (Secondary tone 90/10) instead |
| `--muted` | `--md-on-surface-variant` · `--md-secondary` | `--muted` now reads FROM `--md-on-surface-variant` only; `--md-secondary` got its own Secondary-palette value (tone 80/40) |
| `--danger` | `--md-error` · `--md-on-error-container` | `--danger` stays the authoritative literal (like `--accent`); `--md-error` still aliases it; `--md-on-error-container` got its own Error-palette value (tone 90/10) instead of `var(--danger)` |
| `--warn` | `--md-warning` · `--md-on-warning-container` | **left alone** — still a plain alias pair, see "what did not move" below |
| `--success` | `--md-success` · `--md-on-success-container` | **left alone**, same reason |
| `--agent-working` | `--md-tertiary` · `--md-on-tertiary-container` | `--agent-working` stays the authoritative literal; `--md-tertiary` still aliases it; `--md-on-tertiary-container` got its own Tertiary-palette value (tone 90/10) instead of `var(--agent-working)` |

The original worry was exact: "which Material name should this `var(--muted)` become?" has no
mechanical answer from source text alone — it depends on whether a given use is semantically a
*secondary* colour or an *on-surface-variant* colour, two roles that merely happened to share one
value under the bridge. **Step two did not resolve that ambiguity by guessing** — it resolved it by
making it stop being ambiguous at the base-token level: `--muted` was assigned to be the
*on-surface-variant* reading (the majority, better-established use), and the *secondary* reading
was given its own independent tonal value under `--md-secondary*` rather than continuing to borrow
`--muted`'s. `--md-secondary` and `--md-on-surface-variant` now measurably differ (`#bfc5e3` vs
`#cdc6b8` in dark) — proving the exact divergence this section warned a script-driven guess would
hit blind. The 1,206 call sites that still name `var(--muted)`/`var(--text)`/`var(--border)`
directly all inherited the *on-surface-variant*/*on-surface*/*outline-variant* reading by
construction (that is what `--muted`/`--text`/`--border` now mean); a call site that actually wanted
the *secondary* meaning specifically still needs a human to move it onto `--md-secondary*` by hand —
**that reclassification is exactly as undone as it was before this pass**, and remains the same
future work the original section described, just narrowed from "six ambiguous bases" to whichever
of them (`--warn`/`--success`, still two-role) a future pass takes on.

### What did not move, and why

Not every base token was repointed. Three groups were deliberately left as-is:

- **`--accent`, `--danger`, `--agent-working`** stay the authoritative literal, with their `--md-`
  role (`--md-primary`, `--md-error`, `--md-tertiary`) still aliasing them, not the other way
  round. `--accent` is user-configurable at runtime (`lib/accentTokens.ts` expands whichever accent
  the user picks into the whole primary family, and asserts the authored default equals that
  computed value byte-for-byte) — tone-mapping it would break that contract. `--danger` and
  `--agent-working` follow the same "live identity colour" pattern by choice, so a future accent-like
  feature for status colours would have the same seam ready.
- **`--warn` / `--success`** were left as plain two-role-aliased pairs, untouched. They are minor
  status hues with a handful of call sites each; the task this pass executed named primary,
  secondary, tertiary, neutral, neutral-variant and error as the palettes to derive, and inventing a
  seventh/eighth tonal palette for two small status hues was judged out of proportion to the value —
  the same restraint the original secondary-hue decision showed ("inventing an arbitrary second hue
  ... would just be a stray colour in a terminal app").
- **`--panel`** was left a literal, unrepointed. It sits between two ramp steps (`--surface-raised`/
  container-high and `--surface-overlay`/container-highest) with no single honest Material role to
  read from, and forcing it onto one would have meant adding a seventh surface-container role plus
  updating the two other places `--panel`'s exact hex is depended on
  (`lib/accentTokens.ts`'s `PANEL` contrast baseline and its own test) for a value that would only
  have shifted by a couple of RGB steps. Judged not worth the coordination for this pass.

These need a human deciding, per component, which role each remaining ambiguous use actually is.
That is still the same work a future pass would need, and it still wants the compare tool.

## The site carries the same bridge

CLAUDE.md's scope rule is that every user-facing surface carries these contracts, so the site was
measured too — 66 files under `site/`.

`site/styles.css` uses the **same aliasing strategy**, arrived at independently:

```css
--md-on-surface:         var(--ink);
--md-on-surface-variant: var(--ink2);
--md-outline-variant:    var(--line);
--md-shape-lg:           var(--round);
```

| surface | Material roles declared | with a `var()` consumer | inert |
|---|---:|---:|---:|
| app (`src/renderer/styles.css`) | 38 | 24 | 14 |
| site (`site/styles.css`) | 10 | **10** | **0** |

The site's layer is much smaller and **entirely consumed** — nothing declared-and-unread anywhere on
it. So the two surfaces are not one migration at two stages; they are two coherent bridges of
different sizes, and the pattern being reached for twice is the strongest evidence that it was a
deliberate design decision rather than an accident of one file.

Neither surface has a dead-token problem. The app has 14 roles nothing asks for yet, which is a
migration frontier; the site has none.

## What the design asks for

The design export (`Nodeterm MD3.dc.html`) carries **30 colour roles, each with a light and a dark
value** — a canonical scheme, its `--primary` pair `#AAC7FF` / `#005AC1`, Material's baseline blue.
It uses short names: `--primary`, `--sc` / `--sc-low` / `--sc-high`, `--outline-var`.

So the remaining work is not "add Material tokens". It was two separable things:

1. **Point components at the Material names** they already have — mechanical, appearance-neutral
   while the aliases hold, and reviewable component by component. **Ongoing** — this is the
   "1,206 call sites" work in the section above; the palette re-derivation did not require or wait
   for it to finish.
2. **Re-derive the palette itself** — the step that actually changes how the application looks, and
   the one that wanted the compare tool and a capture baseline. **Done, this pass** — see "The
   palette is re-derived" below. It deliberately did **not** take the design export's literal 30
   roles (`--primary` `#AAC7FF`/`#005AC1`): the follow-up task that did this work was instructed to
   keep the app's own accent (`#0a84ff`) as the seed specifically so the result reads as "nodeterm,
   done in Material" rather than a different product wearing this app's chrome. The design export's
   own primary pair was Material's generic baseline blue, not this app's blue.

Doing (2) before (1) changes everything at once with nothing to diff against. Doing (1) first is
safe precisely *because* of the aliasing — this is why the palette re-derivation was still safe to
do without every component having moved onto the Material names first: any call site still naming a
base token (`--bg`, `--text`, `--border`, …) moved with the palette by construction (the token-layer
re-pointing in the new section below), and any call site already naming a Material role moved with
it directly. Nothing needed to wait.

There was no capture baseline and no automated before/after screenshot for this pass — the compare
tool below is private tooling this environment does not have access to, and the agent that did this
work cannot see the running app (see "What was not verified" below). The verification for this pass
is measured contrast ratios (styles.theme.test.ts) and the CIE L*-matching described below, not a
visual diff.

The instrument for (2), when a capture baseline is available: the side-by-side compare tool
(`nodeterm-design-compare`, private) puts a design next to real captures and edits CSS live.

## The palette is re-derived

**Seed:** `#0a84ff`, the app's own dark-theme accent — per instruction, kept rather than the design
export's generic Material blue, so the result stays recognizably nodeterm.

**Method:** this app has no CAM16/HCT implementation (`renderer/lib/color/convert.ts` — the infinite
colour picker's math — covers Lab/LCH/OKLab/OKLCh but not CAM16), and pulling one in was out of
scope for a CSS-and-test-file change. Material's own definition of HCT's "tone" axis is the same
quantity as CIE Lab's L\* (google/material-color-utilities), so each seed was converted to CIE LCH
(hue + chroma), and each of the 13 canonical tonal steps (0/10/20/…/90/95/99/100) was produced by
holding that hue/chroma and setting L\* to the tone, tapering chroma smoothly to zero at the
extremes so no tone asks for an out-of-gamut colour. This is a faithful, reproducible, but
**approximate** stand-in for real HCT — the same tone/hue/chroma numbers run through Google's actual
CAM16 math would not produce byte-identical hex values, though for this app's fairly moderate
chromas the visual difference should be small. Flagged explicitly as something nobody has verified
against the reference implementation — see "What was not verified".

**Seeds used, one per palette:**

| palette | seed | hue | chroma | why |
|---|---|---:|---:|---|
| primary | `#0a84ff` (`--accent`) | 283.5° | 71.0 | the instructed seed |
| secondary | same as primary | 283.5° | 16.0 | M3's own "same identity, quieter" convention — capped at 16 rather than primary's 71, so a second hue is never invented (matches the original bridge's own reasoning for keeping secondary neutral) |
| tertiary | `#d97757` (`--agent-working`, dark) | 44.2° | 49.3 | the app's actual second identity colour (the working/busy clay accent) — kept as the key colour from the original bridge, not a new invention |
| error | `#ff453a` (`--danger`, dark) | 35.2° | 84.2 | the app's status red |
| neutral | measured `88°` from the app's OWN existing light-theme surfaces (`--bg` light was already hue≈87°, chroma≈2.8 — "warm, not white", see styles.css's light-block comment) | 88° | 4.0 | **not** the primary's hue — see below |
| neutral-variant | same as neutral | 88° | 8.0 | same reasoning |

The neutral/neutral-variant choice is the one place this pass diverged from M3's own default (which
derives Neutral from the primary key colour). The light theme's warm cream surfaces were a
deliberate, contrast-tested design decision (styles.css: "WARM, not white… reads as glare…", and
styles.theme.test.ts's whole "light palette contrast" describe block exists to hold that warmth
safe). Seeding Neutral from the blue primary instead would have fought that with an unrelated cool
cast — computed and rejected during this pass (`--panel` would have gone from `#f3efe7`, warm cream,
to a cool-tinted `#eceef3`, while `--panel-header`/`--menu-rgb`/other untouched warm tokens stayed
cream, producing a visibly inconsistent light theme). M3 itself treats Neutral as an independently
choosable seed for exactly this reason (Material Theme Builder exposes it as its own colour input).

**Role re-pointing** — the `--md-*` roles that used to alias the legacy palette now read from the
tonal steps above (all in `src/renderer/styles.css`, `:root` / `:root[data-theme='light']`):

| role family | before (this pass) | after |
|---|---|---|
| surface ramp (6 roles) + on-surface + on-surface-variant + outline + outline-variant | aliased `--bg`/`--surface-*`/`--text`/`--muted`/`--border`/a `--tint-rgb` mix | literal `var(--md-tone-neutral-N)` / `var(--md-tone-neutral-variant-N)`, tone `N` chosen per role by matching the ORIGINAL hex's own CIE L\* (so the six-step ramp keeps its existing elevation feel and every contrast floor, but is genuinely hue-derived instead of nine independently-picked greys) |
| `--md-secondary` / `-container` / `on-…-container` | aliased `--muted` / `--md-surface-container-highest` / `--text` | literal `var(--md-tone-secondary-N)`, N = 80/30/90 dark, 40/90/10 light (M3's baseline tone assignment) |
| `--md-tertiary-container` / `on-…` | a hand-picked `rgba(217,119,87,0.18)` wash / `var(--agent-working)` | `var(--md-tone-tertiary-N)`, N = 30/90 dark, 90/10 light — `--md-tertiary` itself is unchanged (still `var(--agent-working)`) |
| `--md-on-error-container` | `var(--danger)` | `var(--md-tone-error-90)` dark / `var(--md-tone-error-10)` light — `--md-error` / `--md-error-container` are unchanged (still `var(--danger)` / `rgba(var(--danger-rgb), 0.16)`, guarded by styles.theme.test.ts's "themed container roles" test) |
| `--md-primary*` (all four), `--md-success*`, `--md-warning*` | aliased `--accent` / `--success` / `--warn` | **unchanged** — see "what did not move" above |

**Legacy base tokens re-pointed at the roles** (the step that moves the ~90% of the sheet that
was never migrated component-by-component, done in the token layer — no call site was touched):

```css
--bg:            var(--md-surface);
--surface-black: var(--md-surface-container-lowest);
--surface-sunken: var(--md-surface-dim);
--surface-deep:  var(--md-surface-container-low);
--surface-raised: var(--md-surface-container-high);
--surface-overlay: var(--md-surface-container-highest);
--text:  var(--md-on-surface);
--muted: var(--md-on-surface-variant);
--border: var(--md-outline-variant);
```

That is the exact set the alias direction reverses for; `--accent`/`--danger`/`--agent-working`/
`--warn`/`--success`/`--panel`/`--tint-rgb`/`--muted-2` stay authored literals, per "what did not
move" above.

**Reference scale as real tokens, not copy-pasted hex:** every role above reads a
`var(--md-tone-<palette>-<tone>)` reference, not a duplicated literal — 78 tokens for the canonical
13-tone ladder across the six palettes, plus 10 extra rungs (`--md-tone-neutral-3/6/9/11/14/18/89/
93/97/98`) the surface ramp's CIE-L\*-matched tones needed and the canonical ladder does not carry
(same pattern as `--radius-xs` completing the shape scale, per the "no dead token" section below).

**Material-share, before → after** (measured the way the top of this doc measures it — `var(--md-*)`
occurrences vs all other `var(--…)` occurrences across `src/**/*.{css,ts,tsx}`): **194 vs 1,693
(10.3%) → 202 vs 1,678 (10.7%)**. This number barely moves, and that is expected, not a sign the
pass did little: it counts **call-site vocabulary** (how many places literally say `var(--md-…)`),
and this pass deliberately worked in the **token layer** — no call site was edited. The number that
actually moved is which PIXEL 1,206+ existing `var(--bg)`/`var(--text)`/`var(--muted)`/`var(--border)`/
`var(--surface-*)` call sites now render: previously an alias resolving to the exact legacy hex
(same pixel by construction); now a literal tonal-palette value carrying the seed's hue (a
genuinely different, Material-derived pixel). The migration doc's own thesis — "the day the palette
itself is re-derived, every component already speaking Material moves with it" — undersold the
result slightly: components that were never migrated onto `--md-*` names at all moved too, because
the legacy names they still use are now the ones reading from the palette.

**Contrast verification** (styles.theme.test.ts, all passing after this pass — see "Verification"
below): every new on-surface/on-surface-variant/outline pairing was checked against WCAG floors
before being committed to styles.css (body text ≥4.5:1, secondary text ≥4.5:1, outline ≥3:1,
against `--bg`/`--panel`/`--canvas-bg` in both themes), and the light theme's own
"no light surface is pure white" (<0.97 relative luminance) floor caught one tone choice
(`--md-surface` at tone 98/99 measured 0.948/0.975 — tone 97, 0.923, was used instead) during this
pass, live, rather than after the fact.


## There is no dead token to remove — and the way that was got wrong twice

An earlier pass reported **9 tokens referenced nowhere** (`--git-graph-*` and `--radius-xs`) and
treated them as removable. All nine are fine, for two different reasons, and both reasons defeat a
static scan.

**Second correction, ahead of the palette re-derivation pass:** by the time that pass started, the
real count (same verification command, run against the unmodified tree) was **1**, not 9 — the
`--git-graph-*` tokens had since gained a literal quoted-string match from
`styles.theme.test.ts`'s own hand-written `GIT_GRAPH_TOKENS` inventory (added after this section was
written, to guard exactly the runtime-constructed `var()` this section describes), which the
verification command's quote-based half also counts. Only `--radius-xs` remained unreferenced. The
palette re-derivation pass then added its own set of genuinely-unreferenced-so-far tokens on top —
see the "Verifying these numbers" section at the end for the current count and why it grew.

**Eight are consumed by a `var()` built at run time.** `GitHistoryGraphSvg.tsx` line 17:

```ts
return `var(--${color})`
```

The component carries colour NAMES as bare strings — `'git-graph-lane-1'`, with no `--` prefix —
and assembles the reference when it paints. Every one of the eight `--git-graph-*` tokens is live,
and no grep for `var(--git-graph-lane-1)` or `'--git-graph-lane-1'` will ever find it. Deleting
them would have removed the git history graph's colours behind a clean-looking diff and a green
suite. It is the only runtime-constructed `var()` in the codebase, which is exactly what makes it
easy to forget.

**The ninth is a rung of a scale the Material mapping deliberately skipped.** `--radius-xs` is 4px
and nothing aliases it, because the shape scale maps Material's names onto the radii the app
ACTUALLY ships:

```css
--md-shape-extra-small: var(--radius-sm);  /* 6px, existing */
--md-shape-small:       var(--radius);     /* 8px, existing */
--md-shape-medium:      var(--radius-lg);  /* 12px, existing */
```

Those `existing` comments are the decision: Material's canonical steps were not adopted where the
app already had its own, and the surrounding comment names the design document's site-derived 20px
as wrong for this app specifically. `--radius-xs` completes the declared scale; it is the rung
nobody has needed yet, not litter.

**The rule this yields**, since a dead-token guard would fall into the same hole: a scan that finds
no references is evidence about the SCAN first and the code second. Before believing one, check
whether the value can be assembled at run time, and whether the thing sits in a declared set whose
other members are used.

## Correction

An earlier version of this document said twenty `--md-` tokens were "defined and referenced
nowhere", called that the defect CLAUDE.md warns about, and reported the inert set as 20.

That was measured by scanning **only `styles.css`**. Across the real corpus — 1,427 CSS, TS and TSX
files — the count of tokens with no literal reference is **9, and none of them is a `--md-` token**
(they are `--git-graph-*` and `--radius-xs`). The Material roles are all defined, aliased, and
guarded.

The distinction that was collapsed: *"has no `var()` consumer in a stylesheet"* is not *"is dead
code"*. The first is a migration that has not reached that component yet; the second is a defect.
Calling a deliberate bridging layer the second was wrong, and wrong about somebody's design work.

## Verifying these numbers

```bash
node -e "const fs=require('fs'),p=require('path');const w=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){if(e.name!=='node_modules')w(f,o)}else if(/[.](css|ts|tsx)$/.test(e.name))o.push(f)}return o};const c=w('src').map(f=>fs.readFileSync(f,'utf8')).join('\n');const d=[];for(const l of fs.readFileSync('src/renderer/styles.css','utf8').split(/\r?\n/)){const m=/^\s+(--[a-z][a-z0-9-]*)\s*:/.exec(l);if(m&&!d.includes(m[1]))d.push(m[1])}const ref=t=>c.split('var('+t).length-1+c.split(String.fromCharCode(39)+t+String.fromCharCode(39)).length-1;console.log('defined',d.length,'| md-',d.filter(t=>t.startsWith('--md-')).length,'| unreferenced anywhere',d.filter(t=>ref(t)===0).length)"
```

**Current output, after the palette re-derivation pass:** `defined 177 | md- 126 | unreferenced
anywhere 64`. (Immediately before that pass, on the unmodified tree: `defined 89 | md- 38 |
unreferenced anywhere 1`, matching the "second correction" above.)

The jump from 1 to 64 is not a regression of the same kind the two corrections above describe — it
is arithmetic, and the same "check before believing a scan" rule this section teaches applies to it
too:

- **`--radius-xs`** — unchanged, still the one genuine pre-existing case.
- **61 of the 78 new `--md-tone-*` tokens** — the canonical 0–100 tonal-palette ladder was generated
  in full for all six palettes (per the task's instruction to derive the standard steps), but only
  the tones an actual `--md-*` role picks (17 of them, now wired through `var(--md-tone-…)`
  references rather than copy-pasted hex — see "The palette is re-derived" above) are consumed
  today. The other 61 are rungs of a declared, complete scale that nothing has needed yet — the
  **exact same shape** as `--radius-xs` itself, which this document already spent a whole section
  establishing is not litter. `styles.theme.test.ts`'s `themeIndependent` predicate documents why
  they need no light-theme restatement (a tonal SCALE has no "light value", only which tone a role
  reads from it changes) — extended and mutation-tested as part of this pass.
- **`--surface-black` and `--surface-sunken`** — these two are new to the unreferenced list and are
  the one genuinely-worth-flagging change: before this pass they were referenced by their own
  `--md-surface-container-lowest`/`--md-surface-dim` alias (`--md-surface-container-lowest:
var(--surface-black)`); this pass reversed that alias direction (`--surface-black:
var(--md-surface-container-lowest)`), so nothing reads `var(--surface-black)`/`var(--surface-sunken)`
any more — they are still fully functional custom properties (declared, correctly themed, and kept
  rather than deleted per this task's constraint), just no longer *read* by anything else in the
  sheet. The other four surface tokens (`--surface-deep`, `--surface-raised`, `--surface-overlay`,
  and `--bg` itself) still have direct call sites, so they did not become unreferenced.
