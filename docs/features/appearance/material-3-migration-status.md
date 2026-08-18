# Material Design 3 migration — measured status

Written because "the GUI is not fully Material yet" is true but not actionable, and because two
plausible readings of the gap are both wrong. These are counts taken from the tree, not estimates.

## What is actually there

`src/renderer/styles.css` defines **89 custom properties**, referenced **1,954 times**. Of those,
**38 carry the `--md-` prefix** and are Material colour/shape roles.

The prefix matters when you go looking: they are `--md-primary`, not `--md-sys-color-primary`. A
search for the canonical `--md-sys-` spelling returns **nothing**, which reads as "no Material
tokens exist" and is wrong.

## The half that is real

Eighteen `--md-` tokens have readers, and they are the FOREGROUND roles — the ones that decide what
text and strokes look like:

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
| `--md-primary-container`, `--md-on-primary-container` | 5 combined |
| `--md-success`, `--md-error-container`, `--md-warning`, `--md-success-container` | 8 combined |

## The half that is declared and inert

**Twenty `--md-` tokens are defined and referenced nowhere.** They are not a random scattering —
they are precisely the surface system and the secondary/tertiary families:

```
--md-surface            --md-surface-dim           --md-scrim
--md-surface-container-lowest / -low / -high / -highest
--md-secondary          --md-secondary-container   --md-on-secondary-container
--md-tertiary           --md-tertiary-container    --md-on-tertiary-container
--md-on-error-container --md-on-success-container
--md-warning-container  --md-on-warning-container
--md-shadow             --md-shape-none
```

Surfaces are still drawn from the original macOS HIG palette — `--bg`, `--panel`, `--panel-header`,
`--surface-sunken`, `--surface-raised`, `--surface-overlay` — which is a coherent, carefully
documented elevation ramp in its own right, not sloppiness. It simply is not Material's.

**This is the state CLAUDE.md warns about by name.** A token with no reader is the same defect as a
density control that swapped five properties of which four nothing consumed: the value is stored,
the migration looks under way, and nothing renders differently. Twenty inert tokens will also
silently answer "yes, we have Material surfaces" to anyone who greps for one.

## What the design actually asks for

The design export (`Nodeterm MD3.dc.html`) carries **30 colour roles, each with a light and a dark
value** — a canonical M3 scheme (its `--primary` pair is `#AAC7FF` / `#005AC1`, Material's baseline
blue). It uses short names: `--primary`, `--sc` / `--sc-low` / `--sc-high`, `--outline-var`.

Mapping its names onto the app's:

| design | app | state |
|---|---|---|
| `--surface`, `--sc*` ramp | `--md-surface*` | defined, **inert** — app draws from `--bg` / `--panel*` |
| `--on-surface`, `--on-surface-var` | `--md-on-surface`, `--md-on-surface-variant` | **live** (65 refs) |
| `--outline`, `--outline-var` | `--md-outline`, `--md-outline-variant` | **live** (42 refs) |
| `--primary` family | `--md-primary` family | **live** (22 refs) |
| `--secondary`, `--tertiary` families | defined | **inert** |
| `--error`, `--success`, `--warning` families | partly live | containers mostly inert |
| `--scrim`, `--shadow` | defined | **inert** |
| `--canvas-dot` | no equivalent | missing |

## Why this is not finished here

Completing it means moving the surface ramp, and the surface ramp is what `--tint-rgb` (434
references — the single most-used token in the sheet) exists to serve: nearly 300 rules lighten a
dark surface with `rgba(var(--tint-rgb), α)` and darken on light. Repointing surfaces at Material's
containers without deciding what happens to that overlay system would change the appearance of most
of the application in one commit, with no screenshot baseline to compare against.

The tooling for that decision already exists and is the right next step: the side-by-side compare
tool (`nodeterm-design-compare`, private) puts this design next to real captures and edits CSS live.

## Verifying these numbers

```bash
node -e "const c=require('fs').readFileSync('src/renderer/styles.css','utf8');const d=[];for(const l of c.split(/\r?\n/)){const m=/^\s+(--[a-z][a-z0-9-]*)\s*:/.exec(l);if(m&&!d.includes(m[1]))d.push(m[1])}const u=d.map(t=>[t,c.split('var('+t).length-1]);console.log('defined',d.length,'| md-',d.filter(t=>t.startsWith('--md-')).length,'| inert md-',u.filter(([t,n])=>t.startsWith('--md-')&&n===0).length)"
```
