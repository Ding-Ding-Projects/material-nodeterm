# Rehearsal and review notes

## Method

The pass followed the Stageshow skill (`benjitaylor/skills`, folder `stageshow`, commit
`ccb6a382ae0bd3c9bdfc010d7fdfaec23ee2be21`, from a pinned local copy because a fresh install was
not possible in the build environment). References read: `SKILL.md` and `references/review.md`.
The closest gold examples for real app screens are `window-row` and `dark-hero` (depth from
surface steps on a dark ground, one lit colour, status on its own pill).

Every artboard was rendered to a still in headless Chrome at its own size, using the app's
shipped Outfit and Roboto Mono files and the full Material Symbols Rounded font. The stills are in
`frames/`. Each still was reviewed for framing, then hierarchy and density, then polish.

## Findings and fixes

| Finding | Frame | Fix |
| --- | --- | --- |
| Root width plus padding overflowed fixed-size boards; right columns cut at the edge | `Main`, `Safety`, `History`, `AppearanceDeep` | `box-sizing: border-box` on the `.v3` root |
| Centred overlays drifted left because the arrival animation replaced their centring transform | `Palette`, `Workspace`, `Board` | Centred with layout instead of `transform`, toolbars in a centring dock |
| Lower 40% of the workspace canvas was an empty band | `Workspace` | Taller nodes with real content, a larger worktree group |
| Version line on the first screen had no seconds | `Workspace` | Build time with seconds and timezone |
| Menus had no filter field | `Main`, `Board` | Filter field with regex affordance at the head of every menu |
| Boards taller than their content | `Main`, `Coverage`, `SettingsYou`, `Tools`, `Status` | Heights trimmed to content |
| Private wording in sample copy | `Workspace`, `Overlays`, `Safety` | Replaced with ordinary words and `your-account` |

## Rules recorded as not applicable

Stageshow is written for marketing illustrations. These rules did not apply to real app screens:
cursor choreography and loop seams (the artboards are screens, not demos), satellites straddling
a hero, and the 358 px compact variant (the narrow layout is covered by `Compact.dc.html` at the
app's own minimum width).

## Not checked

- The light theme is not drawn, so light contrast was checked only from the generated roles.
- Interaction on the hosted canvas (Play mode) was not exercised from this environment; the local
  renders show the initial state of each interactive artboard.
