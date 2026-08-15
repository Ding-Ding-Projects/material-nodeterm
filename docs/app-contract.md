# Desktop app feature contract (completeness guard)

This document describes `scripts/check-app-contract.mjs` — a hand-written completeness guard for
the desktop app's user-facing feature contract. It is the desktop-app counterpart of
[`docs/site-features.md`](./site-features.md)'s `scripts/check-site-contract.mjs` for the GitHub
Pages site, and deliberately follows the same shape. Read that document first if you have not —
this one assumes it and only explains where the desktop app's guard differs.

```
node scripts/check-app-contract.mjs
# or
npm run check:app-contract
```

Not wired into any GitHub Actions workflow — this project runs no gating checks in CI by policy
(see `CLAUDE.md`'s "Continuous integration and releases" section). This is a **local tool**: run
it yourself before considering a desktop-app feature change finished.

## Why it is hand-written rather than pattern-derived

A guard that only validates whatever it happens to find already existing passes cleanly on a
codebase that implements **none** of the required features, because it never looked for anything
by name — it can only be surprised by a match, never by an absence it didn't think to check. Every
row in the `FEATURES` array names a real, specific file, an exported symbol, a documentation
article, and — where the feature has one — a settings-sidebar section id and sidebar icon key, and
the guard **fails** when any one of them is missing. When a new canonical feature is added to the
desktop app, its row must be added here in the same change, or this guard will never know to look
for it and a codebase that silently dropped the feature would keep passing.

## What each row checks

A feature row can assert up to five kinds of evidence:

1. **Implementation files exist.** One or more paths under `src/`.
2. **Content checks.** A required substring or regex is present in a named file (e.g. the exported
   function/class name, a required constant).
3. **Settings-sidebar wiring**, for features with a Settings screen: the section id must be placed
   inside one of `nav.ts`'s `SETTINGS_GROUPS` entries (not merely declared in the
   `SettingsSectionId` type union — a union member nothing ever renders is dead), and
   `SettingsIcons.tsx` must define a sidebar glyph keyed by that same id.
4. **Wired-symbol checks**, for components with no settings section: the component must be
   **imported into its real consumer AND referenced outside the import statement** — not merely
   present on disk. See "The wired-symbol check, and the two ways it was wrong" below; this is the
   part of the guard most worth reading before extending it.
5. **Documentation exists**, optionally with a required substring (used when a feature is
   documented as a *section* of a broader article rather than its own file — see Support Tickets
   below).

## The wired-symbol check, and the two ways it was wrong

This is the one part of the guard that took real iteration, and it is worth recording in full
because both broken versions *looked* correct and both passed a casual read.

**Version 1 — count `\b<Symbol>\b` anywhere in the consumer file, require at least 2.** The theory:
an import line supplies one occurrence, a real JSX/call usage supplies a second, so `<2` means "only
imported, never used". This is **toothless** in this codebase specifically, because almost every
import here is shaped `import { Foo } from '../path/Foo'` — the module-path *string* repeats the
symbol name a second time, all by itself, regardless of whether `Foo` is ever actually used
anywhere else in the file. Deleting the real `<CommandPalette` JSX call from `Canvas.tsx` and
leaving the import untouched left the count at exactly 2 (one from `{ CommandPalette`, one from
`'../components/CommandPalette'`) — a probe that should have gone red stayed green.

**Version 2 — strip lines that literally start with `import`, then require the symbol survives once
in what's left, and separately require `import` and the symbol to co-occur on one line.** This fixes
version 1's false negative, but breaks on this codebase's **multi-line named imports** —
`lazyPanels.tsx`'s consumers pull several components from one destructured import:

```ts
import {
  SettingsPage,
  SourceControlPanel,
  ExplorerPanel,
  ...
} from '../components/lazyPanels'
```

The continuation line `  SourceControlPanel,` does not start with `import`, so it survives the
per-line strip and gets miscounted as a "real use" — while the single-line
`` `\bimport\b[^\n]*\b${symbol}\b` `` check fails, because `import` and `SourceControlPanel` are now
several lines apart and `[^\n]*` cannot cross a newline. Net result: three genuinely, correctly
wired lazy-loaded panels (`SourceControlPanel`, `FileConverterPanel`, `OllamaManagerPanel`, all
imported from `lazyPanels.tsx` this exact way) were reported **"not imported at all"** — a false
failure, caught only by actually running the guard and reading why it went red rather than trusting
that the logic looked right.

**The fix in the shipped guard:** find the real import *statement(s)* with a regex that spans
newlines (`import\s+[\s\S]*?\bfrom\s+['"][^'"]+['"]`, not a per-line filter), confirm the symbol is
named inside one of them, then strip those whole statements out of the file text and require the
symbol survives **at least once** in what remains. That is a real reference outside the import, not
a second sighting of the same statement — and it does not care whether the import is single-line or
spans a dozen lines of destructuring.

## Two more probe lessons, both about needles that don't actually disappear

Breaking a row on purpose is how the two bugs above were found — and breaking *this* guard's own
`requireFileContains` probe the first time revealed a third, smaller version of the same shape.

Renaming the doc heading `## Support Tickets` to `## Support Tickets RENAMED FOR PROBE` was meant to
make the "documentation covers this feature" check fail. It didn't — because the needle
`'## Support Tickets'` is still a **substring** of the renamed heading; `.includes()` doesn't care
what comes after it. The probe had to rename the heading to something that does not contain the
original substring at all (`## Recovery Desk`) before the guard actually went red. This is the exact
"renamed/removed symbol still matches" trap `check-site-contract.mjs`'s header comment already
warns about, showing up a second time in a completely different check.

## The Support Tickets row: a doc that is a section, not a file

Support Tickets (`CLAUDE.md`'s "Support Tickets" contract — the joke recovery-desk flow reached from
a toy lock's "Forgotten your password?" link) has **no standalone doc file**. It is documented as a
`## Support Tickets` section inside `docs/toy-locks.md`, because that is genuinely where the feature
belongs: it exists to recover a forgotten toy-lock credential, and CLAUDE.md itself describes it as
reached "from the unlock prompt's `Forgotten your password?` link, from the lock setting, and from
Help". The guard's Support Tickets row therefore points its doc check at
`docs/toy-locks.md` with the required substring `## Support Tickets`, rather than asserting a
`docs/support-tickets.md` file that would never be created and would permanently fail. This was
verified by grepping the whole `docs/` tree for "Support Ticket" first — the honest result was "yes,
documented, just not where a naive per-feature-file convention would expect it".

## Verified: the guard actually turns red

Every check in this guard has been proven to fail for the right reason, restored, and re-verified
green. Four probes, across four different assertion kinds, each performed by mutating a file,
running the guard, confirming the exact expected failure line, then restoring with
`git checkout --` (the guard's own script is the only file left modified — everything it points at
was returned to its original state, confirmed with `git status --porcelain` after every probe):

1. **File existence** — renamed `src/renderer/nodes/DiffNode.tsx` out of the way. Guard reported
   `missing required file src/renderer/nodes/DiffNode.tsx`. Restored, green.
2. **Settings-sidebar wiring** — removed the `{ id: 'authenticator', ... }` entry from
   `SETTINGS_GROUPS` in `nav.ts` (leaving the type-union declaration and the icon in place). Guard
   reported `settings section 'authenticator' is not placed in any SETTINGS_GROUPS entry`. Restored,
   green.
3. **Wired-symbol check** — deleted the real `<CommandPalette` JSX usage in `Canvas.tsx`, leaving
   its import untouched. Guard reported `CommandPalette is imported ... but never referenced outside
   the import statement`. Restored, green. (This is also the probe that caught both broken versions
   of the check described above, before the shipped version was written.)
4. **Documentation content check** — renamed the `## Support Tickets` heading in
   `docs/toy-locks.md` to `## Recovery Desk`. Guard reported `docs/toy-locks.md does not contain
   expected content (## Support Tickets)`. Restored, green.

## Coverage

The guard's `FEATURES` array carries 36 rows, matching the feature list this document's companion
task named: terminal sessions and tmux continuity, the Windows session host, projects/tabs, node
kinds, agent support, the canvas, source control and worktrees, the kanban board, remote/SSH, the
Server Edition, speech/dictation, packaging and auto-update, language modes, funny levels, the emoji
toggle, the regex builder, School mode, personal vocabulary, the narrator, notifications, the
notification centre, the command palette, the destructive-confirmation gate, scheduled settings,
the appearance editor, the infinite colour picker, app rename, app logo, toy locks, the
authenticator, Support Tickets, exports, bulk actions, local history, the file converter, and the
Ollama manager. All 36 rows currently pass (358 individual assertions).

## Deliberately not done here

- **No test suite integration.** This is a standalone Node script, matching the site guard's
  pattern, run manually.
- **No exhaustive "every settings section" sweep.** The guard checks the settings-sidebar wiring
  only for rows that name a `settingsSection` — it does not separately assert that every id in
  `SettingsSectionId` (including ones with no dedicated feature row here, like `presence` or
  `phone`) is placed in `SETTINGS_GROUPS`. That would be a different, narrower guard (a settings-nav
  completeness check) and is out of scope for a feature-contract guard.
