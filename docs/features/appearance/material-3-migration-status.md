# Material Design 3 migration — measured status

Written because "the GUI is not fully Material yet" is true but not actionable. These are counts
taken from the tree, and the document has already been wrong once — see the correction at the end,
which is kept because the way it was wrong is the interesting part.

## What is there

`src/renderer/styles.css` defines **89 custom properties**, of which **38 carry the `--md-` prefix**
and are Material colour and shape roles.

The prefix matters when you go looking: they are `--md-primary`, not `--md-sys-color-primary`. A
search for the canonical `--md-sys-` spelling returns **nothing**, which reads as "no Material
tokens exist" and is wrong.

**Thirty of the 38 are defined as aliases onto the app's existing palette**, not as new colours:

```css
--md-surface:                   var(--bg);
--md-surface-container-lowest:  var(--surface-black);
--md-surface-container-low:     var(--surface-deep);
--md-surface-container-high:    var(--surface-raised);
--md-surface-container-highest: var(--surface-overlay);
```

That is the design of the thing, and it is a good one. The Material vocabulary exists and resolves
to what the application already renders, so a component can be moved onto `--md-surface` in one
commit **without changing a pixel** — and the day the palette itself is re-derived from the design's
scheme, every component already speaking Material moves with it. It is a bridge, deliberately built.

`src/renderer/styles.theme.test.ts` guards all 38 with a hand-written inventory, and says why it is
hand-written: a scan cannot notice a role that disappeared entirely, it would just quietly stop
checking it.

## Where the migration actually stands

Of the 38, **24 have a `var()` consumer in the stylesheet** and 14 do not. They are the foreground
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

The 14 without a consumer are the secondary and tertiary families and a few status containers.
The SURFACE ramp is now consumed directly: 86 call sites moved off `--bg`, `--surface-sunken`,
`--surface-deep`, `--surface-raised`, `--surface-overlay` and `--surface-black` onto their Material
names, leaving each base token consumed only by its own alias. That step was appearance-neutral by
construction — the aliases are identities and no scope overrides a surface token locally, which was
checked rather than assumed (0 re-declarations outside `:root`).
The four `--md-primary*` roles are additionally set at runtime from TypeScript
(`renderer/lib/accentTokens.ts`), so a custom accent moves the Material primary family with it.



## Why step one stops at the surface ramp

The obvious next move is to keep going — 1,206 call sites still name a base token that has a
Material alias. **Do not convert them by script.** The surface ramp was safe for a reason that does
not hold for the rest, and the difference is exact:

Each of the six surface tokens is aliased by **exactly one** Material role, so `var(--bg)` has one
correct answer and a substitution cannot be wrong. Six other base tokens are aliased by **two**:

| base | Material roles pointing at it |
|---|---|
| `--text` | `--md-on-surface` · `--md-on-secondary-container` |
| `--muted` | `--md-on-surface-variant` · `--md-secondary` |
| `--danger` | `--md-error` · `--md-on-error-container` |
| `--warn` | `--md-warning` · `--md-on-warning-container` |
| `--success` | `--md-success` · `--md-on-success-container` |
| `--agent-working` | `--md-tertiary` · `--md-on-tertiary-container` |

So "which Material name should this `var(--muted)` become?" has no mechanical answer. It depends on
whether that particular use is a *secondary* colour or an *on-surface-variant* colour — two
different roles that happen to share one value **today**, because both alias the same base.

A script would pick one and freeze it. It would look clean, the tests would stay green, and the
appearance would not change — and then step two re-derives the palette, `--md-secondary` stops
equalling `--md-on-surface-variant`, and every site guessed wrongly takes the wrong colour. The
damage would be invisible until exactly the moment the migration was supposed to pay off, and it
would be spread across 1,206 sites with nothing recording which were guesses.

These need a human deciding, per component, which role each use actually is. That is the same work
step two needs anyway, and it wants the compare tool. What is safe to do mechanically has been done.

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

So the remaining work is not "add Material tokens". It is two separable things:

1. **Point components at the Material names** they already have — mechanical, appearance-neutral
   while the aliases hold, and reviewable component by component.
2. **Re-derive the palette itself** from the design's 30 roles — the step that actually changes how
   the application looks, and the one that wants the compare tool and a capture baseline.

Doing (2) before (1) changes everything at once with nothing to diff against. Doing (1) first is
safe precisely *because* of the aliasing.

The instrument for (2) already exists: the side-by-side compare tool (`nodeterm-design-compare`,
private) puts this design next to real captures and edits CSS live.

## Correction

An earlier version of this document said twenty `--md-` tokens were "defined and referenced
nowhere", called that the defect CLAUDE.md warns about, and reported the inert set as 20.

That was measured by scanning **only `styles.css`**. Across the real corpus — 1,427 CSS, TS and TSX
files — the count of tokens referenced nowhere at all is **9, and none of them is a `--md-` token**
(they are `--git-graph-*` and `--radius-xs`). The Material roles are all defined, aliased, and
guarded.

The distinction that was collapsed: *"has no `var()` consumer in a stylesheet"* is not *"is dead
code"*. The first is a migration that has not reached that component yet; the second is a defect.
Calling a deliberate bridging layer the second was wrong, and wrong about somebody's design work.

## Verifying these numbers

```bash
node -e "const fs=require('fs'),p=require('path');const w=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){if(e.name!=='node_modules')w(f,o)}else if(/[.](css|ts|tsx)$/.test(e.name))o.push(f)}return o};const c=w('src').map(f=>fs.readFileSync(f,'utf8')).join('\n');const d=[];for(const l of fs.readFileSync('src/renderer/styles.css','utf8').split(/\r?\n/)){const m=/^\s+(--[a-z][a-z0-9-]*)\s*:/.exec(l);if(m&&!d.includes(m[1]))d.push(m[1])}const ref=t=>c.split('var('+t).length-1+c.split(String.fromCharCode(39)+t+String.fromCharCode(39)).length-1;console.log('defined',d.length,'| md-',d.filter(t=>t.startsWith('--md-')).length,'| unreferenced anywhere',d.filter(t=>ref(t)===0).length)"
```
