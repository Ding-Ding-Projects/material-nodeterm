# Language modes, funny levels, and dialog emoji

Every user-facing app carries a persisted language mode (English / playful Hong Kong-style
Cantonese / bilingual) and two independent funny-level sliders — one for each language. This
document covers the architecture, the one rule that governs every string in it, configuration,
failure modes, and how to add a new localized string.

Files:

| Layer | File |
|---|---|
| Types (`LanguageMode`, `FunnyLevel`, …) | `src/shared/i18n/types.ts` |
| String catalogue | `src/shared/i18n/catalog.ts` |
| Pure resolver (`t`, `ts`, `tf`, `tsf`, `formatText`) | `src/shared/i18n/resolve.ts` |
| Barrel export | `src/shared/i18n/index.ts` |
| Renderer hook binding it to live settings | `src/renderer/lib/i18n.ts` (`useI18n()`) |
| Stacked primary/secondary block renderer | `src/renderer/ui/Localized.tsx` |
| Settings fields | `src/shared/types.ts` (`Settings.languageMode` etc.) |
| Settings UI | `src/renderer/components/settings/sections/LanguageSection.tsx` |

Desktop and Server Edition both work identically here: this is pure renderer state (a zustand
store backed by the same `settings.json`/`SettingsStore` every other setting uses), so nothing in
`src/main` or `src/server` needs to know about it. The mobile companion is a separate Swift
codebase and is out of scope for this document — see `CLAUDE.md`'s "Three surfaces" note if you're
adding a localized string there too.

## 1. The rule that matters most

**The funny level changes VOICE, never FACTS.** It applies to every category of message with no
exemptions — including destructive actions, security prompts, accessibility copy, and error text.
At any level 1–5 a message must still name, in unambiguous words, what happened, what is
affected, and what the user's options are: which file, which account, which action is
irreversible, what the error actually was. Wrap those facts in whatever humour the level calls
for; never replace, soften, or omit them.

Cantonese copy stays respectful at every level: humour never mocks the user, their data loss,
their money, or their disability.

This rule is written as a comment at the top of `src/shared/i18n/catalog.ts` — read it again
before adding a string, not just this doc, because that file is where the discipline actually has
to hold.

A worked example, from the catalogue: a destructive confirm dialog's default button reads
`Delete` at every level. At level 5 it might read `Send it to the void` — still unambiguously a
delete action, still the destructive button, still danger-styled. What it must never do is become
`OK` or `Sure!`, because that would hide what the button actually does behind a joke.

## 2. The three language modes

- **`en`** — English only.
- **`yue`** — Cantonese only (falls back to English text if a specific Cantonese variant is
  missing for that id/level — never renders blank).
- **`bilingual`** — both, with English **prominent** (the "primary" text) and Cantonese
  **compact** (the "secondary" text), never a full second row of the same size crowding a narrow
  column. Two rendering strategies are used depending on how much room a surface has:
  - **Stacked** (`<Localized>` / `useI18n().t()`): the secondary renders as a smaller line under
    the primary. Used where there's a real paragraph of room — the Language section's own body
    copy, the welcome screen's tagline.
  - **Joined single line** (`useI18n().ts()`): `"English · 廣東話"` on one line. Used for anything
    that can't stack — button labels, aria-labels, window/dialog titles, the settings sidebar
    (256px wide, ~22 rows — a second line per row would be unusable).

  Which one to use is a per-call-site judgement call, not something the resolver decides for you.
  Read the CSS for the surface you're converting before picking; see `SettingsSidebar.tsx`'s
  comment for a worked example of the reasoning.

## 3. Funny levels

`FunnyLevel = 1 | 2 | 3 | 4 | 5`. Level 1 is fully professional; level 5 is maximum playfulness.
There are **two independent sliders**, `funnyLevelEn` and `funnyLevelYue` — a user can want plain
English with playful Cantonese, or the reverse, and the sliders don't have to agree.

**Default is level 2, not 5.** The reasoning is in a comment beside `DEFAULT_SETTINGS` in
`src/shared/types.ts`: the default install is a developer tool a stranger just downloaded, and a
maximally-playful error message is the wrong first impression for someone who hasn't yet chosen to
have fun with their terminal manager. Level 2 keeps copy mostly plain with a little character.
Users who want more crank both sliders themselves, in Settings → Interface → Language.

Catalogue entries carry **five variants per language** (`FiveVariants`, a fixed-length tuple), one
per level. A level may repeat a neighbour's text verbatim when a distinct joke would add nothing —
a plain noun like "Terminal" has no meaningfully funnier level-5 form — but the array must always
have all five entries so a slider move never resolves to nothing. `flat(text)` in `catalog.ts` is
the helper for that case.

## 4. The resolver

`t(id, fallback, mode, levels, catalog?)` in `src/shared/i18n/resolve.ts` is the pure core:

```ts
import { t } from '@shared/i18n'

const { primary, secondary } = t('welcome.tagline', 'A canvas of terminals. Start a project to begin.', 'bilingual', { en: 2, yue: 3 })
// primary:   the English text at English level 2
// secondary: the Cantonese text at Cantonese level 3, or null if 'en'/'yue' mode,
//            or if bilingual mode but the Cantonese text happens to equal the English text
```

Fallback rules:

- **Unknown id** (no catalogue entry at all) → resolves to the caller-supplied `fallback` for
  every mode. There's no Cantonese text to show for an untranslated string, so bilingual mode just
  shows the fallback with no secondary line. This is intentional, not a bug — it's what lets the
  foundation ship without every string in the app being translated on day one (see §7).
- **Known id, missing Cantonese variant at that level** (an empty string in the `yue` tuple) →
  falls back to the **English** variant at that same level, never a blank string.

`ts(id, fallback, mode, levels)` is the same resolution joined onto one line ("English · 廣東話" in
bilingual mode) — see §2 for when to use it over `t()`.

`formatText(text, params)` fills `{token}` placeholders. **Never bake a live value — a version
number, a filename, a count — into the catalogue text itself.** The catalogue holds the template;
the call site holds the fact:

```ts
t('update.body.downloading', 'nodeterm v{version} is downloading.', mode, levels, undefined)
// then interpolate: formatText(resolved.primary, { version: status.version })
```

`tf()`/`tsf()` do the resolve-then-format in one call. The renderer hook's `t()`/`ts()` accept an
optional third `params` argument that does this for you.

## 5. Renderer usage

```tsx
import { useI18n } from '@renderer/lib/i18n'

function MyDialog() {
  const { t, ts, emoji, mode, funnyLevelEn, funnyLevelYue, showEmojiInDialogs } = useI18n()

  return (
    <button aria-label={ts('welcome.close', 'Close')}>
      {emoji('👋')} {ts('welcome.close', 'Close')}
    </button>
  )
}
```

`useI18n()` reads `languageMode` / `funnyLevelEn` / `funnyLevelYue` / `showEmojiInDialogs`
straight off the `useSettings` zustand store, so **it applies live** — moving a slider in Settings
re-renders every subscriber immediately. Nothing here waits for a restart.

For block-level bilingual rendering, use `<Localized id="…" fallback="…" as="p" className="…" />`
(`src/renderer/ui/Localized.tsx`) instead of calling `t()` and building the stacked markup by
hand.

## 6. The emoji toggle

`showEmojiInDialogs` (default **off**) — when on, each dialog / message box carries a relevant,
**non-semantic** emoji decoration; when off, the identical factual copy remains without it.

Hard rule: **emojis never appear in buttons, action labels, field labels, accessible names, or
other control text.** `useI18n().emoji(char)` returns the given emoji only when the toggle is on,
and `''` otherwise — it's meant to be spliced into a `<p>`/heading/message body wrapped in
`aria-hidden="true"`, never into a `<button>`'s own label. `ConfirmDialog.tsx` is the reference
implementation: the emoji sits in a `aria-hidden` span ahead of the message text, and the
Cancel/Delete/OK buttons never receive one.

The toggle itself lives in Settings → Interface → Language, is localized, and is keyboard-
accessible (it's an ordinary `Switch`, same as every other settings toggle).

## 7. What's converted today, and what isn't

This is a foundation, deliberately not a full sweep of every string in the app. Converted:

- The Language settings section itself (its own copy — the one feature that would be
  embarrassing to ship unlocalized).
- The settings sidebar's group headings and a representative subset of section headings (the rest
  still route through `t()`/`ts()` — they just don't have catalogue entries yet, so they fall
  back to their English label, which is the documented "unknown id" behaviour, not a bug).
- `ConfirmDialog`'s default button labels (Cancel/Delete/OK) and its emoji decoration. A caller-
  supplied custom label (e.g. `"Remove worktree"`) is that caller's own copy and is untouched.
- `WelcomeScreen` (tagline, the four action cards, "Recently closed", the close button).
- `UpdateCard` (every status line and button across all seven update states).
- `AnnouncementBanner`'s chrome ("Learn more" / "Dismiss" — the announcement title/body text
  itself comes from a remote feed and isn't localized).

**Not** converted: the body copy of most individual settings sections, most dialogs elsewhere in
the app, node context menus, the command palette, and so on. Converting a surface means: give its
static strings catalogue ids, call `t()`/`ts()` for them, and — if the surface is a settings
section — decide whether stacked or joined bilingual rendering fits its layout (§2). Do this
incrementally as real work touches those surfaces; don't attempt a one-shot conversion of the
whole app in a single change.

## 8. Adding a new string

1. Pick a dotted id: `surface.element.purpose` (e.g. `settings.language.emoji.label`,
   `update.body.ready`). Ids are looked up as plain object keys — there's no namespacing magic,
   just convention.
2. In `src/shared/i18n/catalog.ts`, add an entry with five English variants and five Cantonese
   variants. Use the `flat(text)` helper for a plain label that has no meaningfully funnier form;
   write real level-by-level variants for anything that's actually a *message* (see §1's example).
   If the string carries a live value, use a `{token}` placeholder — never a template literal with
   the value baked in.
3. Re-read the string against §1 before committing it: does it still say the fact plainly at
   every level? Does the Cantonese stay respectful?
4. Call it from the component: `t()`/`ts()` (single components) via `useI18n()`, or the pure
   `t()`/`ts()` from `@shared/i18n` directly for non-React code (there is none of that yet, but the
   resolver doesn't assume React).
5. If the id doesn't exist yet elsewhere, the `fallback` argument you pass is what every mode
   shows until the catalogue entry lands — so always pass real English text as the fallback, never
   a placeholder like `"TODO"`.

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Catalogue id not found | Resolves to the caller's `fallback` in every mode; bilingual mode shows no secondary line. |
| Cantonese variant empty at the active level | Falls back to the English variant at that same level. Never renders blank. |
| `funnyLevelEn`/`funnyLevelYue` outside 1–5 in a hand-edited `settings.json` | Not defended against at the type level (the setting is typed `FunnyLevel`); an out-of-range number falls through to `entry.en[levels.en - 1] || entry.en[0] || fallback`, so an invalid index reads `undefined`, the `||` chain falls through to `entry.en[0]` (level 1), never to nothing. |
| `languageMode` set to something other than `en`/`yue`/`bilingual` | Not merge-guarded specially (unlike, say, `terminalGpuRendering`'s legacy-boolean migration) — an unrecognized mode reaching the `switch` in `resolve.ts`'s `t()` has no matching case and TypeScript's exhaustiveness check would catch a *new* mode at compile time, but a hand-edited garbage string in `settings.json` falls through with `undefined` return, which the caller's optional-chaining / `?? fallback` sites do not currently guard against. If you hit this, treat it as a settings-store validation gap worth closing rather than a resolver bug — see the `terminalGpuRendering` migration in `src/core/settings-store.ts` for the pattern to copy. |
| Placeholder token with no matching `params` entry | `formatText` leaves the literal `{token}` in the string (see the regex replacer's fallback branch) rather than silently dropping it — a visible bug beats an invisible one. |

## 10. Not yet done — recorded honestly

- Settings search (`SearchableRow`'s `keywords`/`title`) is still keyed off the **English**
  section titles from `nav.ts`, not the localized text. Typing a Cantonese word into the settings
  search box won't find anything yet, even in `yue`/`bilingual` mode. This is a real gap, not an
  oversight to paper over — searching localized *and* English text at once needs its own design
  (do you search the currently-displayed language, or always both?) rather than a quick patch.
- The command palette, node context menus, and most per-node dialogs are entirely unconverted.
- There's no runtime validation of `languageMode`/`funnyLevelEn`/`funnyLevelYue` in
  `SettingsStore.mergeSettings` the way there is for `terminalGpuRendering`'s legacy boolean — see
  the failure-modes table above.
