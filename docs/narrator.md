# Narrator — spoken TTS for app events

A spoken narrator for app events: an agent turn finishing, an agent needing your attention, or an
error. **Off by default** — the end-user opt-in is optional, the implementation is not. Turn it on
in **Settings → Interface → Narrator**.

Implementation: `src/renderer/lib/narrator.ts` (the queue/voice engine), `narratorPhrases.ts`
(bilingual content for the two built-in categories), `canvas/narration-policy.ts` (the two
point-of-use execution boundaries), and `components/settings/sections/NarratorSection.tsx` (the
picker UI). Wired into the existing agent-status alert path and the app-error toast path in
`renderer/canvas/Canvas.tsx`.

## Three surfaces

Uses the **Web Speech API** (`speechSynthesis`), which is available in both the Electron renderer
and the browser **Server Edition** — so this is pure renderer code, with no IPC, no main-process
or server-process involvement at all. Whichever machine renders the UI is the one that speaks
(same rule the browser gives every page: `speechSynthesis` runs on the client, not the server).

The **mobile companion** (nodeterm-ios, a separate app) is out of scope — it has its own
notification sounds and does not run this renderer.

## What gets narrated

Two built-in, hand-translated categories, wired at the same site `soundEffects` and OS
notifications already are (`Canvas.tsx`'s `alert()`, fed by the per-agent hook normalizers):

- **Agent turn finished** — "`<agent>` finished in `<context>`." Fires whether or not the window
  is focused (same reasoning as the chirp: the point is to catch a finish while you're looking at
  a *different* node, not just while the whole app is backgrounded).
- **Agent needs you** — a permission prompt or a question. "`<agent>` needs you in `<context>`."

Plus one dynamic category:

- **App errors** — any `nodeterm:toast` event with `kind: 'error'` (e.g. a failed clipboard copy).
  These are free-text runtime messages with no hand-authored Cantonese translation, so they're
  spoken through the queue with `important: true` (see **Rate limiting**, below) and fall back to
  English even under a Cantonese-only preference — see **Content fallback**.

A future category just calls `narrate()` with a `category` string and English (+ optional
Cantonese) text; the queue/cooldown/voice machinery is generic.

### School Mode boundary

School Mode does not silently turn off a narrator the user enabled; it reduces that narrator to
English. Both Canvas event paths read the live School Mode store at the moment they are about to
speak. Enabled state and unknown/unhydrated state force `language: 'en'`, omit the Cantonese phrase,
and clear the Cantonese voice from the request. Only a successfully hydrated off record may apply
the persisted Cantonese or bilingual preference. The preference is preserved and resumes when the
mode is confirmed off. Each queued track re-checks the live policy immediately before synthesis;
an allowed→suppressed transition invalidates queued/debounced Cantonese and cancels only an active
Cantonese utterance, preserving English and important error narration. A Cantonese-only event
keeps a dormant English copy that becomes eligible only when policy suppresses its Cantonese
track, so the transition reduces the event instead of silencing it. Settings omits the Cantonese
language/voice controls and search entries under the same policy, and a stale Preview click
re-checks before speaking. An invalid hand-edited narrator language also fails closed to English.

## The queue: never overlapping, replace don't stack

Exactly one utterance plays at a time, across every category, through a single shared queue
(`src/renderer/lib/narrator.ts`). Turning the narrator off (`stopNarrator()`) clears the queue,
cancels every pending debounce timer, and cancels whatever's currently speaking.

**A new `narrate()` call for a category that already has a QUEUED (not yet speaking) line REPLACES
it**, rather than adding a second one — a node that flaps through several states before you look
at it says its *latest* state once, not a backlog of stale ones.

### Rate limiting: debounce + per-category cooldown

- **Debounce** (default 600 ms): if another `narrate()` for the same category arrives within the
  window, only the *last* one (after the window elapses) is actually queued.
- **Cooldown** (default 8 s): the minimum time between two narrations of the same category
  actually *starting* to speak. A category still cooling down is simply dropped, not queued for
  later — narration is meant to be infrequent, not delayed.
- **Category is per-node** for the two agent categories (`agent-done:<nodeId>`,
  `agent-needsYou:<nodeId>`) — one busy node's chatter never suppresses another node finishing at
  the same time.

**Errors bypass the rate limiter** (`narrate({ ..., important: true })`): the debounce/cooldown
exist to keep routine chatter infrequent, not to swallow a failure the user needs to hear about.
An important narration still goes through the same serialized queue — it can never *overlap*
another utterance — but it is never *dropped* by cooldown.

### Content fallback (never silently drop information)

`narrate()` takes `en` (always) and an optional `yue`. Every built-in category supplies both.
For dynamic content with no translation (app-error toasts):

- Requested language `'en'` → speaks `en`.
- Requested language `'yue'` → speaks `yue` if given, else **falls back to `en`** rather than
  staying silent. Losing the information is worse than a language mismatch for a one-off error.
- Requested language `'both'` → speaks `en`, then `yue` **only if given** (never repeats `en`
  twice — that reads as a bug, not a feature).

"Both" always speaks English then Cantonese, **strictly serialized**: they're two queue entries
under the same category, so the shared "one at a time" rule already guarantees they never
overlap, and a category-replace removes both halves together.

### Tone vs. content

The app now ships independent `funnyLevelEn` / `funnyLevelYue` settings for localized interface
copy. Narrator phrases do not yet have tone variants, so every category — including errors — still
speaks in one plain, factual voice. The *content* rule holds regardless of future tone variants:
narration names the real failure/event, never a vaguer stand-in, and is never truncated or
simplified to fit rate limiting (see **Content fallback**, which favors "say it in the wrong
language" over "say nothing").

## Voice selection

**One picker per narrated language — English and Cantonese are entirely independent settings**:
`narratorVoiceEn`, `narratorVoiceYue` (both `voiceURI | null`). Choosing an English voice says
nothing about which Cantonese voice should read the other half of a bilingual line.

- Each picker lists the voices the **machine actually has** for that language
  (`voicesForTrack('en' | 'yue')`, filtered by `SpeechSynthesisVoice.lang` prefix — `en-*` /
  `zh-*`), resolved from the platform **at runtime**, plus a **"Choose automatically"** entry —
  the shipped default (`null`). Nothing ships with a named voice as its default; the app cannot
  know what's installed until it asks.
- **Cantonese "automatic" prefers a Hong Kong voice specifically** (`zh-HK`/`zh-yue`/`yue`), not
  just any `zh-*` voice — most stock `zh-*` voices are Mandarin (zh-CN/zh-TW), and reading
  Cantonese narration copy through a Mandarin voice mispronounces every tone. See
  `pickAutomaticVoice` in `narrator.ts`.
- Persisted value is the voice's **`voiceURI`**, never its display `name`. Names are not
  guaranteed unique, and platforms localize them (a "Samantha" on one machine is not necessarily
  the same underlying voice on another) — a profile written by `name` would silently stop matching
  on a different install.

### The late-arrival trap

`speechSynthesis.getVoices()` commonly returns an **empty array** on the very first call and fills
in a moment later, signalled by the `voiceschanged` event — sometimes more than once, as
different voice providers register. A picker that reads the list once and stops looking reports
"no voices installed" on a machine with forty.

`narrator.ts` keeps one shared, lazily-bound `voiceschanged` listener plus a short (≤8 s) poll
fallback, because some Chromium builds are known not to fire `voiceschanged` at all when the list
happened to be ready synchronously. Every subscriber (`subscribeVoices`) gets the *live* list, not
a one-time snapshot, and **must unsubscribe on teardown** (the settings picker does this in a
`useEffect` cleanup).

The settings UI shows **"Looking for installed voices…"** until either a non-empty list arrives or
a short grace period (1.8 s) elapses — after which a genuinely voice-less platform correctly shows
"No voice is installed" instead of spinning forever.

### What's actually in effect (`voiceStatus`)

Beneath each picker, the settings UI states plainly which of four things is true:

1. **Will speak with "`<voice>`" (`<lang>`).** — the normal case.
2. **Your chosen voice isn't installed here — falling back to "`<voice>`". Your choice is kept.**
   — the user picked a specific voice that's no longer present on this machine (a synced
   `settings.json`, a different computer, an OS update that removed a voice). The saved
   `voiceURI` is **never cleared** just because it's momentarily unavailable — reinstalling that
   voice, or opening the app on the original machine, picks it right back up.
3. **Will speak with "`<voice>`" — needs a network connection, and will go quiet offline.** — the
   resolved voice has `localService === false` (a cloud-backed voice some platforms offer).
4. **No `<language>` voice is installed on this computer.** — nothing at all matches; the Preview
   button is disabled and narration for that track silently no-ops (never throws).

### Rate & pitch

Adjustable within `SpeechSynthesisUtterance`'s own documented ranges (rate 0.1–10, pitch 0–2),
shared across both languages (`narratorRate`, `narratorPitch`). The sliders in Settings cap at a
usable window (0.5×–3× rate, 0×–2× pitch) for a sane control surface, but `narrator.ts` always
clamps to the *full* documented range regardless of how a value got into `settings.json` (it's
hand-editable). 100% on each slider is the voice's own normal delivery — the shipped default.

## Assistive technology and quiet settings

- **Yielding to a shared `speechSynthesis` consumer**: before speaking, the queue checks whether
  the browser's `speechSynthesis.speaking`/`.pending` is already true from *something else* (it
  checks this, not our own in-flight utterance, which is tracked separately) and, if so, waits and
  retries rather than forcing its line in ahead of it. This is honestly a narrow signal — it does
  **not** detect a native OS screen reader (VoiceOver, NVDA, JAWS), which speaks through the
  platform's own accessibility APIs entirely outside the browser's `speechSynthesis` — but it does
  mean the narrator will never talk over another page feature, or a browser-extension screen
  reader, that also uses the Web Speech API.
- **Reduced-sound / quiet-hours setting**: this app does not currently expose a separate
  "reduced sound" or "quiet hours" setting anywhere (checked: no such setting exists in
  `Settings`). There is nothing to gate on yet. When one is added, the narrator should honor it —
  tracked as a follow-up here rather than silently invented by narrowing an unrelated setting
  (e.g. `prefers-reduced-motion`, which is about *motion*, not *sound*, and would surprise users
  who want less animation but still want narration).

## Failure modes

| Situation | Behavior |
|---|---|
| No speech synthesis in this window at all | `isSynthesisAvailable()` is false; `narrate()` is a silent no-op; Settings shows a plain warning and the picker's Preview buttons disable. |
| Chosen voice not installed on this machine | Falls back to automatic; the choice stays saved (see `voiceStatus`, above). |
| Chosen/automatic voice is network-backed and offline | The utterance is handed to `speechSynthesis` anyway (we don't pre-flight network state); a real synthesis error fires `onerror`, which we treat as "done" and move on to the next queued line rather than getting stuck. The picker warns proactively that this voice needs a network connection. |
| No voice at all for a language on this machine | `resolveVoice`/`pickAutomaticVoice` return `null`; that track's utterances are simply not spoken (never a crash); the picker says so plainly. |
| `speechSynthesis.speak()` throws synchronously | Caught; the queue moves on (`pump()`'s try/catch). |
| Narrator turned off mid-utterance | `stopNarrator()` cancels immediately, clears the queue and every pending debounce timer. |
| Preview button pressed while something is narrating | Interrupts it — an explicit "test this voice" action takes priority over queued chatter. Uses a generation counter internally so the *cancelled* utterance's async `onerror` can never land after the preview starts and incorrectly mark the narrator idle mid-preview (see the `gen`/`myGen` comments in `narrator.ts` — this raced in early testing and is the one subtlety worth re-reading before touching `pump()`). |

## Settings

`narratorEnabled` (default `false`), `narratorLanguage` (`'en' | 'yue' | 'both'`, default `'en'`),
`narratorVoiceEn` / `narratorVoiceYue` (`voiceURI | null`, default `null` = automatic),
`narratorRate` / `narratorPitch` (default `1`). Persisted in `settings.json` like every other
setting (`src/shared/types.ts`, `DEFAULT_SETTINGS`); no schema migration needed since these are
new top-level keys picked up by the existing `{ ...DEFAULT_SETTINGS, ...saved }` merge.

Narrator setting changes participate in the existing local settings history automatically: every
whole-document settings save is snapshotted, and restoring an older revision applies it as a new
save without erasing later history (see [local-history.md](local-history.md)).

## Verification

The queue, voice matching, School Mode decision, and both narration executors have focused
automated Chuts. Platform voice quality, Canvas wiring, and audible output still require this
device check:

1. Settings → Interface → Narrator, toggle **Speak app events aloud** on.
2. Open the two voice pickers — confirm the list is empty-then-populated (or immediately populated,
   depending on the platform) rather than stuck on "no voices", and that **Choose automatically**
   is selected by default.
3. Pick a specific English voice, press **Preview** — hear it, distinct from automatic.
4. Set language to **Both**, trigger an agent turn finishing (or use a spare terminal to simulate
   one) — hear the English line, then the Cantonese line, never overlapping.
5. Trigger two different nodes finishing in quick succession — hear both (per-node category), not
   one silently dropped.
6. Trigger the same node twice within ~1 s — hear one line (debounced), not two.
7. Restart the app — narrator settings (enabled, language, chosen voices, rate, pitch) persist.
8. Pick a voice, then reset your OS/browser voice list (or open on a different machine) so it's
   missing — settings still shows the choice, with the "falling back to automatic" note.
