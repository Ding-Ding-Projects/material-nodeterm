# The dim-sum surprise

A small, entirely optional delight: at startup, there is a **10% chance** the app shows one
randomly chosen dim-sum dish — its bilingual name plus a small original illustration — in a
non-blocking corner card that dismisses itself.

## What it is

- **10% chance, once per launch.** The draw happens at most once per process lifetime
  (`renderer/lib/dimsum/roll.ts`, `rollDimSumForLaunch`): a fresh `Math.random()` roll decides
  whether this launch shows the surprise, and every later call in the same process (a remount, a
  second window) returns `null` without consuming another draw. It never fires more often than
  stated, and never twice in one launch.
- **Bilingual, always.** Each dish carries an English name and a Traditional Chinese name (e.g.
  "Shrimp dumpling · 蝦餃", `renderer/lib/dimsum/catalog.ts`). The name is a *fact*: it stays
  correct regardless of theme, layout, or any future language/funny-level setting — nothing ever
  reworks the dish's own name, only the surrounding copy.
- **Nine dishes today**: shrimp dumpling (har gow), pork & shrimp dumpling (siu mai), BBQ pork bun
  (char siu bao), egg tart, turnip cake, rice noodle roll (cheung fun), spring roll, sesame ball,
  and sticky rice in lotus leaf (lo mai gai).
- **Bundled, original, local.** Every illustration is an original SVG under
  `src/renderer/assets/dimsum/`, imported the same way the app's existing brand marks are
  (`lib/brandPulse.ts`) — Vite hands back a hashed local asset URL. There is no network fetch, no
  CDN, no stock photo, and nothing here is downloaded at runtime. `<img>`'s `alt` text names the
  dish for screen-reader users.

## Where it shows, and where it never does

The card is a fixed, bottom-right, `role="status"`/`aria-live="polite"` toast
(`components/DimSumSurprise.tsx`, `.dimsum-toast` in `styles.css`) that:

- never gates startup or delays the app becoming usable (it is decided ~3 seconds after boot
  settles, well after the app is already interactive),
- never steals focus,
- auto-dismisses after ~9 seconds (~6 seconds if the OS asks for reduced motion) or on a manual
  ×,
- is re-checked at the moment it would actually appear, not only when the timer starts, so a
  dialog that opened during that settle window still suppresses it.

It is **suppressed entirely** — not shown, not queued for later — when any of these hold at reveal
time:

- **First run.** No project has ever been created yet (the welcome screen owns that moment).
- **A modal dialog is open** (`components/dialog-stack.ts`'s `openDialogCount()` — a confirm, an
  error, onboarding, anything that owns the keyboard).
- **[School mode](school-mode.md) is on.** That mode makes this whole capability behave as if it
  were not installed.

## Cannot be turned off

By design there is **no setting** to disable the surprise — the only thing that suppresses it is
[School mode](school-mode.md), which is itself an explicit, PIN-gated choice with its own reasons.
This is a deliberate, narrow exception to "everything is configurable": the surprise is rare
(10%, once per launch), never blocks anything, and is meant to always be a possibility rather than
a toggle someone forgets they turned off.

## Extending the catalog

Add a dish by dropping a new `<name>.svg` under `src/renderer/assets/dimsum/`, importing it in
`catalog.ts`, and adding one `DimSumDish` entry with its bilingual name. Keep new illustrations
original and simple (flat shapes, no photorealism) so they read clearly at the toast's 40×40 size.

## Verification

- Manual: force a roll locally by temporarily lowering the 0.1 threshold in `roll.ts` (never ship
  that change), or call `rollDimSumForLaunch(() => 0)` from a scratch script to confirm a dish
  comes back.
- The gates above (`hydrated`, an open project, no dialog, School mode off) are read live from
  `useSettings`, `useProjects`, `useSchoolMode`, and `openDialogCount()` — inspect
  `components/DimSumSurprise.tsx` for the exact combination.
- Visual: reduced-motion is honored via `@media (prefers-reduced-motion: reduce)` in `styles.css`
  (the entry animation is dropped, and the auto-dismiss timer shortens).

## Failure modes

- A malformed/missing SVG import would be a build-time failure (Vite resolves the import path at
  bundle time), not a runtime one — there is no "dish with no image" state to handle.
- If `openDialogCount()` or the settings/projects stores are unavailable for any reason, the
  surprise simply never rolls (fails closed to "nothing shown"), never crashes the boot path.
