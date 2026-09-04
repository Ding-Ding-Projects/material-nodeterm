# The clipping matrix

**The honest limit first: this finds clipping. It does not prove its absence anywhere it did not
run.** Every tuple that was skipped is skipped in the report too, because a matrix that quietly
narrows its own coverage reads as "we checked everything" when it did not.

## What was wrong before

`scripts/capture-shots.mjs` pinned every capture to `1600x1000` at `deviceScaleFactor: 1`, in the
default theme and English. One width, one scale, one theme, one language, across 24 surfaces. So it
only ever photographed the comfortable case, and no clipping defect could appear in its output
however badly the app clipped — the harness was structurally unable to see one. Meanwhile
`ROADMAP.md` recorded narrow-width and 100/125/150/200% verification as "pending" for the layout
sweep, the Material Design audit, the ADHD modes, and the worktree picker, which is the same fact
stated from the other side.

The window made it worse: it opened at `width: 1400` with no minimum at all, so there was no size
at which "nothing clips" was even a checkable claim. See
[the minimum window size](./window-minimum-size.md).

## The tuple

A capture's identity is the conditions it was taken under. `scripts/lib/capture-tuple.mjs` resolves
and labels them:

| Axis | Values | How it is applied |
|---|---|---|
| viewport | `min` (the declared minimum) or `normal` (1600x1000), or explicit `WxH` | `Emulation.setDeviceMetricsOverride` |
| display scale | `1`, `1.25`, `1.5`, `2` | `deviceScaleFactor` in the same override |
| theme | `dark` (shipped default), `light` | `appTheme` written into the profile **before launch** |
| language | `en`, `yue`, `bilingual` | `languageMode` written into the profile **before launch** |

```bash
npm run shots -- --launch                                             # the default comfortable tuple
npm run shots -- --launch --viewport min --scale 2 --lang bilingual --theme light
```

Three properties are deliberate, and each exists because of a way this goes wrong:

- **The minimum is read from source, never restated.** `capture-tuple.mjs` parses
  `MIN_WINDOW_WIDTH` / `MIN_WINDOW_HEIGHT` out of `src/shared/window-minimum.ts` and **throws** if
  either is missing, renamed, commented out, or non-numeric. Two copies of that number are two
  numbers that disagree eventually, and the failure is nasty: a capture would prove a width the
  application never permits, which reads as evidence rather than as a mistake.
- **Theme and language are written before the app boots.** They are persisted settings. Forcing them
  afterwards through the renderer would capture the app mid-transition and would only prove that an
  attribute can be set — not that the saved setting is honoured, which is the thing the capture is
  for. `--attach` therefore **refuses** a non-default theme or language rather than filing the
  attached profile's own settings under this tuple's label.
- **A non-default tuple writes to `docs/assets/shots/matrix/<label>/`.** The default tuple still
  writes exactly where it always did, so the committed evidence and the site assets are untouched.
  Two tuples can never share an output path; the loser would be silently overwritten while the run
  reported both.

## Running it, and what to run first

The full cross is 26 scenes x 2 viewports x 3 languages x 2 themes x 4 scales = **1,248 captures**.
Running that blind is waste. Start where clipping concentrates — the minimum viewport, bilingual
(the longest strings), 200% (the largest text), both themes — then widen to the full cross on every
scene that produced a finding plus a sample of those that did not.

Fix smallest-change-first, rebuild, and re-run the **identical** tuple. Changed measurements plus the
expected pixels are the fix evidence; a green source check is not, and neither is a stylesheet that
declares the right thing — only the running artifact shows which rule won.

## What a capture is not

A screenshot shows that something looks wrong. It does not say why, and it cannot be reasoned
backwards into a cause: a max-height with hidden overflow, a flex basis measured on the other axis,
and a duplicate selector winning on load order all look identical in a picture. For the cause,
measure the element — `getBoundingClientRect()` plus the winning computed values — and keep the
probe receipt beside the image.

`capture-manifest.json` records the tuple alongside the commit, so a capture with no recorded
viewport, scale, theme and language cannot be filed as evidence at all: it could not be re-taken,
and a fix could not be re-proved at the conditions that found the defect.
