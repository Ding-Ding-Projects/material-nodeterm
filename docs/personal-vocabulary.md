# Personal vocabulary

Somebody who does not work here decided that a button should say "Settings." Nobody asked you.
This feature is the appeal process, and the ruling is final in your favor.

Upload a small local JSON file mapping any word the app currently shows you to a word you'd
rather see — `"Settings": "Control Room"`, `"Notifications": "The Nag List"`, whatever you like —
and from that point on the app makes the swap on its own prose — settings, dialogs, tooltips,
notifications, menus, the command palette (see "Coverage" below) — quietly, indefinitely, and
without ever asking why. It has no
opinion about your choices. It will not raise an eyebrow, question your judgment, or notice that
it has just rendered your own settings screen unreadable to your future self, your co-worker
leaning over your shoulder, or the poor soul writing your support ticket. It just does the swap,
forever, with the flat loyalty of a machine that has never once been asked to have taste.

Settings → Personal vocabulary carries the control, and it is there before you have ever uploaded
anything — there is no starter dictionary tucked inside the app, no sample file, nothing
pre-loaded that could hint at what anyone else typed into theirs. Until you supply a valid file,
every label reads exactly as shipped. Supply one, and the substitution takes over. Delete it, and
the app forgets your vocabulary ever existed, as if it had never had an opinion to override in the
first place.

The renderer keeps a hand-written producer inventory in
scripts/check-personal-vocabulary-coverage.mjs. It covers settings fields and sections, menus,
dialogs, prompts, notifications, tooltips, canvas and board surfaces, source control, onboarding,
the dim sum notice, publish/find/remote pickers, browser profiles, password management, conversion,
Minecraft panels, authenticator and speech settings, and toy-lock setup. The checker requires an
exact local mapper boundary and an audit row for each producer. It also runs deliberate in-memory
negative regressions for a removed producer row, mapper call, and documentation row.

None of this leaves your machine. The file is read, checked, and applied entirely where it sits —
never uploaded, logged, exported, or synced, not even alongside the rest of your app settings. If
your private dictionary is a joke, a translation, a coping mechanism, or a small act of rebellion
against whoever wrote the original label, it stays exactly that: yours, private, and none of this
project's business. See "Local-only, no network, ever" below for precisely what that promise
covers.

## The data exists only after you supply it

There is **no built-in mapping, sample, or template** shipped with the app. Until a valid file is
uploaded, every surface renders its original, unmodified wording — always. Clearing the file
(the "Clear" button, shown once a file is loaded) purges the cache immediately and restores the
original wording on the next render; there is no partial or lingering state.

## Local-only, no network, ever

Reading, validating, and applying the file happens **entirely in the browser context** — the
Electron renderer or a Server Edition browser tab, identically either way, since the mechanism is
plain web platform APIs (`<input type="file">` + `FileReader`). There is:

- **no IPC call to the main/server process** for any of this,
- **no network request**,
- **no copy of the actual terms, values, filename, or file path** written to logs, exports,
  telemetry, crash reports, prompts, the settings/version-history system, or any other
  destination this project controls.

The validated result is cached in this browser profile's `localStorage`
(`nodeterm.personalVocabulary.v1`) purely so it survives a reload/restart; it is never synced,
exported with the rest of app settings, or sent anywhere. Hydration passes the cached JSON through
the **same complete validator** as a new upload; hand-editing `localStorage` is not a second,
weaker import path.

## The JSON contract (versioned, bounded)

```json
{
  "version": 1,
  "entries": {
    "term the app would otherwise show": "your replacement text",
    "another term": "another replacement"
  }
}
```

One documented shape, enforced completely — a rejected file **never applies partially**:

| Limit | Value | Where |
| --- | --- | --- |
| File size | 256 KB (measured in actual UTF-8 bytes, not JS string length) | `VOCAB_MAX_FILE_BYTES` |
| Schema version | must be exactly `1` | `VOCAB_SCHEMA_VERSION` |
| Max JSON nesting depth | 3 (root object → `entries` object → string value) | `VOCAB_MAX_DEPTH` |
| Max JSON nodes visited | 20,000 | `VOCAB_MAX_NODES` |
| Max entries | 2,000 | `VOCAB_MAX_ENTRIES` |
| Max key length | 200 characters | `VOCAB_MAX_KEY_LENGTH` |
| Max value length | 500 characters | `VOCAB_MAX_VALUE_LENGTH` |

All defined in `src/renderer/lib/personalVocabulary/schema.ts` — the numbers above and the code
cannot drift, because the docs table is copied from the same constants the validator uses.

Rejected outright, with no partial application:

- malformed JSON,
- a value that is not a JSON object at the top level, or an `entries` that is not a flat object,
- an unknown/missing/wrong `version`,
- **duplicate keys** — caught by a real hand-written recursive-descent JSON scanner
  (`jsonScan.ts`), *not* `JSON.parse`. `JSON.parse` silently keeps only the **last** of a
  duplicate key before any application code ever sees the object, so duplicate-key rejection is
  structurally impossible on top of it; the scanner is why this project can actually enforce it.
  Every object the scanner builds has a **null prototype**, so the JSON spelling `__proto__`
  remains an own data property that validation can see instead of invoking JavaScript's legacy
  prototype setter. `version` and `entries` must themselves be own properties — inherited values
  are never schema fields.
- a root or entry key that is `__proto__`, `constructor`, or `prototype` (prototype-pollution
  vectors, rejected unconditionally; the validated entries dictionary also keeps a null prototype
  so a future copy refactor cannot quietly reopen the setter boundary),
- an empty key,
- a key or value over its length limit,
- a non-string value (**only string replacements are allowed** — no nested objects/arrays as
  values; the substitution boundary is a literal text replacement, which has no defined meaning
  for anything else).

## How a replacement is applied

`renderer/lib/personalVocabulary/apply.ts`'s `applyVocabulary(text, entries)`:

- a **literal substring replacement** (`split(term).join(replacement)`) — never a `RegExp` built
  from the uploaded term. The term comes from an untrusted file; turning it into a regex pattern
  would be a catastrophic-backtracking / ReDoS vector for no benefit, since exact substring
  matching is all this feature promises.
- **longest term first**, so a short entry that happens to be a substring of a longer one (e.g.
  `"PR"` inside a longer `"PR review"` entry) never pre-empts the more specific match.

## Where replacements apply today (coverage), and where they deliberately do not

Applied **only at the user-facing text boundary** — prose meant to be read, never anything a user
or another system depends on being exact:

Coverage is deliberately wired at **shared funnels** — the one component or list every caller
already passes through — rather than at individual call sites, so a new dialog or toast inherits
the substitution without anyone remembering to opt in:

- ✅ Every Settings section title and description (`SettingsSection.tsx`)
- ✅ Every Settings field label, description, and note (`FieldRow.tsx` — the shared component
  nearly every Settings row in the app is built from, so wiring it there reaches broadly across
  the Settings surface with one boundary)
- ✅ Every confirmation dialog's message, option label and button labels (`ConfirmDialog.tsx`)
- ✅ Every text prompt's message, placeholder and buttons (`InputDialog.tsx`, and therefore
  `promptDialog()`) — the value the user types is **not** touched; it is what the caller receives
  and usually persists (a rename, a branch name)
- ✅ Every tooltip (`Tooltip.tsx`)
- ✅ Every toast's title, action labels and dismiss control (`NotificationToasts.tsx`)
- ✅ The project-file conflict bar (`ConflictBar.tsx`)
- ✅ The worktree creation/binding dialog (`WorktreeDialog.tsx`), including its title, field labels,
  placeholders, validation guidance and actions; paths, refs and submitted values remain exact
- ✅ The command palette's own rows — label, hint, note, section heading, secondary-button label
  and an inline control's accessible name / option labels (`CommandPalette.tsx`, applied **before**
  the query filter so a visible row can still be typed for)
- ✅ Context menus whose rows are prose, through the `VocabularyContextMenu` wrapper: the kanban
  card menu (including its "Move to" column titles) and the source-control ⋯ menu
- ✅ Node header chrome, dock, kanban cards/columns and the card modal, via the separate
  `useLocalizedVocabularyText` helper (shipped catalog prose → vocabulary → dynamic facts last)

**Never** applied — these stay verbatim regardless of any uploaded file, by design:

- commands, shell text, terminal output
- URLs, file paths, identifiers (node ids, session ids, commit SHAs)
- code, JSON, configuration values
- factual external records (an error message from a tool, a git commit subject)

Named exclusions worth knowing, each for a reason above:

- **A notification's `body`.** Push sites hand it raw machine text — `error.message`, a core
  `assessment.reason`, a git failure line, a clipped agent transcript line. The title and the
  action labels are ours; the body is quoted output.
- **`DestructiveConfirmGate`.** Its own contract already says the funny-level/localization rules
  apply to copy elsewhere and never to that sentence, and its `affected` list names the exact
  items being destroyed.
- **The source-control branch picker and commit menu.** A branch row's label IS the branch name
  handed to `git.merge/rebase/deleteBranch`, and commit rows carry commit identity. A string that
  is both displayed and executed is never translated.
- **A command's `id` and `content`**, and a select control's option `value` — an identifier, a
  searchable output body, and a value that gets written to `settings.json` when the row is cycled.
- **Menu `shortcut` tokens.** They are re-emitted verbatim through `aria-keyshortcuts`; rewriting
  one would announce a chord no key listener answers.
- **The command palette's file results and transcript hits** (`fileCommands` / `extraCommands`) —
  basenames, directories, and a conversation's own text.

`useVocabularyMapper` (`renderer/lib/personalVocabulary/useVocabularyText.ts`) is the hook this
boundary is meant to be reached through for loose strings — `useVocabularyText` is the
single-string form built on it, and `useVocabularyMenuItems` / `useVocabularyCommands`
(`useVocabularySurfaces.ts`, pure decisions in `surfaces.ts`) are the two structured forms for
surfaces built as data rather than JSX. Wrapping arbitrary application prose in one of these is a
correct extension; wrapping any of the categories above would be a bug.

**Known gap, honestly stated:** the canvas's own right-click menus (node and pane) and the canvas
command palette's *mount point* live in `Canvas.tsx` and `ContextMenu.tsx`. The palette is covered
because the substitution happens inside `CommandPalette` itself; the canvas context menus are
**not** — closing that gap is a one-line swap of `ContextMenu` for `VocabularyContextMenu` at
`Canvas.tsx`'s single render site, deliberately left out of the change that widened the rest.

## School mode

While [School mode](school-mode.md) is on, this whole capability behaves as if it were not
installed:

- the Settings upload control is **omitted** from the page entirely (not shown disabled) —
  `PersonalVocabularySection` returns `null` while the mode is enabled,
- any already-uploaded vocabulary's substitutions are **skipped everywhere**, not deleted —
  `useVocabularyMapper` (and therefore every hook and surface helper built on it) short-circuits to
  the original text while the mode is on and resumes the moment it is turned off. The cached file
  is never touched by entering or leaving School mode.

The gate is `schoolModeAllowsOptionalFeatures`, so an **unknown** mode (the pre-hydration
`enabled: false` placeholder, or a failed read) suppresses the substitution too. Note that
`useLocalizedVocabularyText` still reads `enabled` alone and does not fail closed on an unhydrated
record — a pre-existing inconsistency, not something this boundary introduced.

## Accessibility

The file picker is a real, native `<input type="file">` (with an associated `<label>`/`htmlFor`)
— keyboard-operable, exposed to assistive technology with its own accessible name, and carrying
the browser's own adequate touch target. Status is announced through ordinary text, not color
alone: "No file loaded — original wording is shown everywhere.", "Loaded — *n* usable pairs
applied to…", or "Rejected: *the exact reason*." The loaded line counts **usable pairs**, not
substitution hits: a dictionary export's prose/documentation rows are skipped by the validator, so
a 41-row file legitimately loads fewer than 41 pairs, and saying "terms replaced" made that read
like the feature had barely done anything. Every one of the four states (no file / loaded / invalid /
about to replace) reads as plain text, never an icon-only indicator.

## Verification

- Upload a valid minimal file (`{"version":1,"entries":{"Settings":"Options"}}`) → the Settings
  page's own section title changes to reflect it (careful: only future navigations/re-renders of
  already-mounted text pick it up, per React's normal re-render rules — the hook is reactive, so
  this happens live).
- With `{"version":1,"entries":{"terminal":"shell box"}}` loaded: ⌘K shows "New shell box" AND
  finds it when you type "shell box"; a card's right-click menu on the kanban board reads the
  replacement; a toast's title does and its `body` does not.
- Upload an oversized file → rejected with the exact byte count and limit.
- Upload a file with a duplicate key → rejected with `duplicate key "…"`.
- Upload a file with `"__proto__"` as a key → rejected.
- Upload a file with a non-string value → rejected, no entries applied (verify the PREVIOUS valid
  cache, if any, is untouched — a rejected upload never overwrites a working one).
- Clear a loaded file → every surface reverts to original wording immediately.
- Turn School mode on with a file loaded → the upload section disappears from Settings, and
  wording reverts to original everywhere the hook is wired, while the cached file survives.
- Turn School mode off again → both come back exactly as they were.

## Failure modes

- `localStorage` full/blocked/unavailable (private browsing, disabled storage): the current
  session's in-memory state still applies; only "survive a restart" degrades, silently and
  non-fatally (`writeCache`'s catch).
- A corrupted `localStorage` entry (hand-edited, truncated) is treated as "no cache" on the next
  hydrate — it never partially loads.
