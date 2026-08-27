# Material Design 3 full desktop audit

Status: source audit and remediation completed in the `feat/material3-full-audit` line at source
baseline `727287b8`. Built-artifact launch, runtime measurement, tests, and captures are pending a
separate permitted verification pass.

## Objective

Issue #91 asks for a complete audit of every Windows desktop surface and every user-facing
documentation or landing page. The audit must identify legacy controls and custom lookalikes,
repair nonconforming desktop code, and fail closed when a named surface disappears.

## Scope

- Inventory every desktop shell, node, destination, settings section, dialog, menu, dropdown,
  picker, tab, overlay, status, empty state, error state, and pseudo-state.
- Record implementation files, source markers, style or primitive markers, accessibility and motion
  expectations, and the honest verification state for each surface.
- Keep the site in Kids mode by default and preserve its current visual style. Site work is limited
  to stale facts, data, releases, links, features, accessibility, and broken behavior.
- Do not run broad tests, builds, launches, or captures in this lane.

## Delivered source work

1. `docs/features/appearance/material-3-audit.md` records 201 exact surface rows.
2. `scripts/check-material-audit.mjs` validates the independent identifier list, implementation
   markers, style markers, shared primitive exports, site-preservation wording, and its own
   deleted-row mutation.
3. `ui/NumberField` now uses the shared Material Design 3 field recipe instead of legacy utility
   classes.
4. Shared `Radio`, `Progress`, and keyboard-roving `Tabs` primitives were added and adopted by the
   audited worktree, toy-lock, authenticator, speech, converter, Ollama, Minecraft, clone, History,
   and browser-tab surfaces.
5. Tooltip focus, Escape handling, semantic naming, bounded text, and shape-token styling were
   repaired. Reviewed desktop one-off shape values now use named Material shape tokens.
6. Older `sc-btn`, `mc-button`, and `toylock-btn` controls are normalized in the final desktop
   style layer without changing their behavior hooks.
7. The checker is wired as `npm run check:material-audit` and runs in the local build contract.
8. The stale site packaging article now names v0.4.117 and the push-triggered release workflow.

## Ownership conflicts

- Comments & Activity remains inventoried, but its CardModal source is reserved for p80.
- The existing-worktree picker remains inventoried, but its WorktreeDialog source is reserved for
  p81.
- The supplied WSL creator clipping evidence is inventoried as a nonconforming overlapping state;
  its source is reserved for p79.

## Verification and next step

The source checker is the only check run in this lane. The next owner must run the approved hidden
desktop capture and measurement route against the exact integrated source commit, then update the
inventory rows with real pixel and clipping evidence. A source marker or a passing source checker
must not be presented as runtime proof.
