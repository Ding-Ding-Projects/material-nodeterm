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
row in the `FEATURES` array names real implementation files, focused behavioural tests,
documentation, and — where the feature has them — localized copy, persistence, built-artifact
interaction, real capture evidence, a settings-sidebar section id, and a sidebar icon key. The
guard **fails** when any required boundary is missing or still marked pending. When a new canonical
feature is added to the desktop app, its row must be added here in the same change, or this guard
will never know to look for it and a codebase that silently dropped the feature would keep passing.

## What each row checks

A feature row can assert up to nine kinds of evidence:

1. **Implementation files exist.** One or more paths under `src/`.
2. **Content checks.** A required substring or regex is present in a named file (e.g. the exported
   function/class name, a required constant).
3. **Focused behavioural tests.** The named test file must exist and retain an exact suite/test
   boundary. A source file that still contains the right words is not a substitute for exercised
   behaviour.
4. **Localized copy and persistence evidence**, where applicable. A profile or setting cannot
   count as complete while its user-facing strings bypass the shipped catalogue or its saved/local
   state boundary is untested.
5. **Settings-sidebar wiring**, for features with a Settings screen: the section id must be placed
   inside one of `nav.ts`'s `SETTINGS_GROUPS` entries (not merely declared in the
   `SettingsSectionId` type union — a union member nothing ever renders is dead), and
   `SettingsIcons.tsx` must define a sidebar glyph keyed by that same id.
6. **Wired-symbol checks**, for components with no settings section: the component must be
   **imported into its real consumer AND referenced outside the import statement** — not merely
   present on disk. See "The wired-symbol check, and the two ways it was wrong" below; this is the
   part of the guard most worth reading before extending it.
7. **Documentation exists**, optionally with a required substring (used when a feature is
   documented as a *section* of a broader article rather than its own file — see Support Tickets
   below).
8. **Built-artifact interaction evidence.** Source/unit coverage does not satisfy this field; the
   installed or packaged application must be driven and its observable consequence recorded.
9. **Real capture evidence.** Required capture ids are exact entries in the manifest, and desktop
   captures must record the approved cheap Lowlevel MCP headless method. A pending marker remains a
   deliberate red result rather than being silently accepted.

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

The original four assertion kinds below were each proven to fail for the right reason, restored,
and re-verified green. They were performed by mutating a file, running the guard, confirming the
exact expected failure line, then restoring the file:

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

The guard now also runs an executable negative self-test over the exact first-class Windows profile
inventory boundary. In memory, it removes the whole `windows-terminal-profiles` row and then each
of its required evidence columns one at a time. The same validator used on the live inventory must
reject every mutant. Removing or renaming the real row or any of `implementation`, `docs`,
`localizedCopy`, `persistence`, `focusedTests`, `builtArtifactInteraction`, or `captures` therefore
turns the live boundary check red; the self-test itself also turns red if any mutant escapes.

## Coverage

The hand-written `FEATURES` array carries one row for every canonical desktop feature known to this
guard. Windows session hosting and first-class Windows terminal profiles are deliberately separate
rows: keeping a PTY alive is not the same contract as detecting, selecting, persisting, resolving,
and securely spawning a named profile. Run the guard for the live row/assertion count; this document
does not pin a number that becomes false whenever a feature or exact evidence boundary is added.

The Windows terminal-profile row is currently expected to stay red while two required evidence
columns are pending: packaged-app interaction and real cheap-headless captures. Its implementation,
persistence, documentation, localized copy, and focused source/unit behaviour can be green without
upgrading those unperformed release gates into claimed evidence.

## The other half: proving controls DO something (`check-app-wired.mjs`)

Everything above is a source scan. It proves a feature's file exists, exports what it should, and
is referenced from somewhere real — and it would pass unchanged on an app whose every control was
inert. So would every screenshot in `docs/assets/shots/`, which is the uncomfortable part: a
convincing mock-up and a working app photograph identically.

`npm run check:wired` drives the BUILT app over CDP and asserts a **consequence** for each case:

| check | what it proves |
|---|---|
| Command palette | a nonsense query **narrows** the result list |
| Settings toggle | a switch flips, **survives a renderer reload**, flips back, and survives again |
| Canvas | a live viewport transform, which a static image cannot have |
| Appearance | changing `--accent` moves a **real app Switch's** computed colour |
| Preload bridge | `settings.load()` **round-trips to the main process** |

Three rules it is built on, each of which it would be worthless without:

1. **Assert a consequence, never the action.** "The click dispatched" is what the capture harness
   already learned to distrust — its first version reported five successes while photographing the
   same screen five times, having implemented "the chord was sent" as "the surface opened".
2. **The before-value is part of the check.** `count > 0` passes on an app that ignored the click
   and already had items. Every case reads state first, acts, then compares.
3. **A check that cannot run is a failure.** "I could not find the control" and "the control does
   nothing" are indistinguishable from outside, and only one is safe to ignore. This fired
   immediately and correctly: the settings case looked for `input[type=checkbox]` and this app's
   toggle is a `role="switch"` button. The harness was wrong, not the app — and it failed anyway,
   which is what let me find out.

**Verified by breaking the real thing.** Making `ui/Switch.tsx`'s `onClick` a no-op and rebuilding
takes the run to 4/5 with the settings case red; restoring gives 5/5 back. That is the whole claim
of this harness — that it can tell a wired control from a painted one — tested rather than asserted.

The launched app never uses the operator's real profile. The harness creates a disposable
`NT_USER_DATA` directory and sets `NT_MULTI=1`, so the settings round-trip can persist and reload a
real value without touching the user's settings, workspace, identity, or sessions. Attach mode is
the explicit exception: the caller selected that already-running target and owns its state.

**It cleans up after itself, and that mattered.** On Windows the app spawns a session host that
outlives its parent *by design*. So a harness that only kills the app leaves one behind holding
`node_modules\electron\dist\electron.exe` — and because `npm ci` deletes `node_modules` BEFORE
installing, the next install failed and left the checkout gutted: no vitest, no react, no ws. The
harness now snapshots this repo's Electron PIDs before launching and stops only the ones that
appeared. Not "all Electron for this repo", which would take the developer's own running app with
it. Launch, CDP setup, and every interaction run inside one `try`/`finally`; a failed CDP connection
therefore cleans up too, and an unprovable cleanup makes the gate fail rather than reporting green.

Cleanup is literal, not wildcard-shaped. The repo directory is passed to PowerShell as environment
data with a trailing path separator and compared with case-insensitive `String.IndexOf`; it is
never interpolated into a `-like` expression. A checkout named `oak[prod]?*` otherwise makes `[]`,
`?`, and `*` pattern syntax: the harness can miss its own process and select an unrelated one for
`Stop-Process`. Failure to inventory processes aborts the launch instead of becoming an empty
snapshot, and candidates are revalidated immediately before termination to reduce PID-reuse risk.

**Launching the gate must not launch against the developer's home.** `NT_USER_DATA` moves only
Electron's profile. App boot also installs managed hooks, skills, and instruction blocks through
`os.homedir()`, `XDG_CONFIG_HOME`, and `GROK_HOME`; on Windows, Node resolves `os.homedir()` from
`USERPROFILE`, not `HOME`. An owned launch therefore creates one disposable root and redirects
HOME/USERPROFILE/HOMEDRIVE/HOMEPATH, AppData, temp, XDG, Claude, Codex, Grok, and Kimi roots into it.
Before interactions it asks the running main process for `userDataDir()` and verifies that the real
boot created every managed hook/config artefact inside the sandbox. Exact real-home targets are
fingerprinted before and after the run; an unreadable sentinel aborts rather than being treated as
absent, and any changed path makes the run fail. The sandbox is removed only after this run's
literal-matched Electron processes are stopped. `--attach` deliberately does not claim this
isolation because the harness does not own the attached app.

The helper gates execute both boundaries rather than scan their source: a real child Node process
must resolve and write only inside the disposable home, the sentinel must turn red on both a changed
and a newly-created config file, and real Windows PowerShell must distinguish literal `[?*`
checkout names from wildcard lookalikes and sibling prefixes.

Cleanup is literal, not wildcard-shaped. The repo directory is passed to PowerShell as environment
data with a trailing path separator and compared with case-insensitive `String.IndexOf`; it is
never interpolated into a `-like` expression. A checkout named `oak[prod]?*` otherwise makes `[]`,
`?`, and `*` pattern syntax: the harness can miss its own process and select an unrelated one for
`Stop-Process`. Failure to inventory processes aborts the launch instead of becoming an empty
snapshot, and candidates are revalidated immediately before termination to reduce PID-reuse risk.

**Launching the gate must not launch against the developer's home.** `NT_USER_DATA` moves only
Electron's profile. App boot also installs managed hooks, skills, and instruction blocks through
`os.homedir()`, `XDG_CONFIG_HOME`, and `GROK_HOME`; on Windows, Node resolves `os.homedir()` from
`USERPROFILE`, not `HOME`. An owned launch therefore creates one disposable root and redirects
HOME/USERPROFILE/HOMEDRIVE/HOMEPATH, AppData, temp, XDG, Claude, Codex, Grok, and Kimi roots into it.
Before interactions it asks the running main process for `userDataDir()` and verifies that the real
boot created every managed hook/config artefact inside the sandbox. Exact real-home targets are
fingerprinted before and after the run; an unreadable sentinel aborts rather than being treated as
absent, and any changed path makes the run fail. The sandbox is removed only after this run's
literal-matched Electron processes are stopped. `--attach` deliberately does not claim this
isolation because the harness does not own the attached app.

The helper gates execute both boundaries rather than scan their source: a real child Node process
must resolve and write only inside the disposable home, the sentinel must turn red on both a changed
and a newly-created config file, and real Windows PowerShell must distinguish literal `[?*`
checkout names from wildcard lookalikes and sibling prefixes.

## Deliberately not done here

- **The live interaction pass remains manual.** `npm test` includes only the fast isolation and
  PowerShell-fixture gates; it does not launch Electron. The built-app pass remains
  `npm run check:wired` so its native-runtime and process-cleanup prerequisites stay explicit.
- **No exhaustive "every settings section" sweep.** The guard checks the settings-sidebar wiring
  only for rows that name a `settingsSection` — it does not separately assert that every id in
  `SettingsSectionId` (including ones with no dedicated feature row here, like `presence` or
  `phone`) is placed in `SETTINGS_GROUPS`. That would be a different, narrower guard (a settings-nav
  completeness check) and is out of scope for a feature-contract guard.
