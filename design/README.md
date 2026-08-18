# Design sources

The interactive design prototypes this app is being built toward, and a small tool for holding
them next to the running app.

| File | What it is |
| --- | --- |
| `Nodeterm MD3.dc.html` | The Material Design 3 target. Open it in a browser — everything is clickable. |
| `Nodeterm Today.dc.html` | The current-state reference it was designed against. |
| `pages/` | The published-site design, its `HANDOFF.md`, and the brand assets. |
| `compare/` | An Electron tool that shows the prototype and the running app together. |

## Comparing

```bash
npm run dev            # start the app (serves the renderer on :5173)
npm run design:compare # in a second terminal
```

Two modes, because they catch different things:

- **Side by side** finds layout drift — a control in the wrong place, a missing affordance.
- **Overlay** cross-fades the two panes with a blend slider. This is what finds the drift
  side-by-side hides: a few pixels of padding, a slightly wrong surface tone, a radius that does
  not match. Comparing two windows by eye reliably misses those.

The tool is a separate Electron entry point on purpose. It must never ship inside nodeterm, and
keeping its own `main.js` means it cannot accidentally acquire the product's IPC or preload bridge.

## The tokens are the contract

The prototype defines its palette as CSS custom properties, and they are the source of truth for
the app's own theme:

| Role | Dark | Light |
| --- | --- | --- |
| `--surface` | `#111318` | `#F9F9FF` |
| `--sc-low` / `--sc` / `--sc-high` | `#191C20` / `#1D2024` / `#282A2F` | `#F3F3FA` / `#EDEDF4` / `#E7E8EE` |
| `--on-surface` | `#E2E2E9` | `#1A1B21` |
| `--on-surface-var` | `#C3C6CF` | `#43474E` |
| `--outline` / `--outline-var` | `#8D9199` / `#43474E` | `#74777F` / `#C3C6CF` |
| `--primary` / `--on-primary` | `#AAC7FF` / `#0A305F` | `#005AC1` / `#FFFFFF` |

Note the naming difference: the prototype uses the short form (`--sc`, `--outline-var`) while
`src/renderer/styles.css` uses `--md-surface-container*` / `--md-outline-variant`. They describe
the same Material roles; the app's names are the ones to keep, because the whole stylesheet and
`styles.theme.test.ts` already speak them.

**Known divergence:** the app's current palette is warm (neutral hue ~88°, e.g. `--md-surface`
`#201d18`) while this prototype is a cool blue-tinted neutral (`#111318`). Reconciling them means
re-seeding the app's tonal ramps from these values — do that from the table above rather than by
eye.
