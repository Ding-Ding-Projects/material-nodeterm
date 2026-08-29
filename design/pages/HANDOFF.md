# Handoff — nodeterm Day Teet Hui (kindergarten edition)

**File:** `Nodeterm Day Teet Hui.dc.html` (one self-contained Design Component; opens
directly in a browser)
**Assets:** `assets/mark.svg`, `assets/nodeterm.png`, `assets/hero.svg` — copied from
`material-nodeterm/site/assets/`
**Storage key:** `nodeterm.kids.v1` in `localStorage`. That single key holds every piece
of per-visitor state. Clearing it is the reset, and it is what "Start fresh" does.

---

## What this is

A rewrite of nodeterm's GitHub Pages site as a kindergarten-style interactive building.
The entry page is both the **advertising landing page** and the **hallway**: a grid of
coloured doors sits at the top, and the full marketing page (hero, download buttons, stat
tiles, fourteen capability cards, a 1‑2‑3 how-it-works strip, three surfaces, playroom
promo, closing CTA) runs underneath it.

Clicking a door swings it open on its hinge (CSS `rotateY`), then the room mounts with a
walk-in zoom. Inside a room the chrome changes to a sidebar shell with **Back to the
hallway** and **Lock this door behind me**. A locked door rattles, then asks for that
door's own password.

---

## Structure of the file

| Part | Where | Notes |
| --- | --- | --- |
| Tokens, fonts, keyframes | `<helmet><style>` | Two palettes on `:root` / `[data-theme='night']`. Everything else is inline styles. |
| Hallway + landing page | `<sc-if value="{{inHall}}">` | Doors grid, then the ad sections. |
| Room shell | `<sc-if value="{{inRoom}}">` | Header, sidebar, section header, then one `sc-if` per panel kind. |
| Panels | `isHome` / `isList` / `isConverter` / `isExport` / `isPlay` / `isSettings` | Eight of the twelve rooms share the one generic `isList` panel. |
| Overlays | bottom of the template | Context menu, regex builder, jump box, super-confirm gate, toast stack. |
| All behaviour | `class Component extends DCLogic` | `renderVals()` returns every hole. |

### Rooms (`SECTIONS` array)

`home · docs · changelog · notes · history · auth · shop · convert · export · dish ·
coverage · play · settings`

Add a room by pushing one entry to `SECTIONS`; the door, the sidebar item, the jump-box
target and the lockable surface all follow from it. Then either add its id to the
`listSecs` map in `renderVals` (to use the generic list panel, feeding it from
`currentRows()`) or give it its own `sc-if` panel.

---

## Feature wiring — what is real

- **Search everywhere.** Header (whole site), sidebar / door filter, per-room search,
  every context menu, and the jump box. All five compose: the room search and the global
  search are both applied to every list.
- **Regex builder.** The `.*` button beside every one of those fields opens the same
  builder: pattern + flags, eleven coloured token buttons, a live tester over sample text,
  capture-group readout, and Apply, which writes the pattern back into that field and
  flips it to pattern mode. Pattern capped at 200 chars, sample at 2000, every evaluation
  wrapped.
- **Right-click menus.** Header, big search, sidebar, doors, feature cards, stat tiles,
  list rows, settings boxes, and the panel background. Each menu has its own filter field
  and its own `.*` button. Row menus grow extra items by room: open the commit on GitHub,
  copy the six digits, put a model in the basket, undo this log entry.
- **Command palette.** `Ctrl+Shift+F` (or the ✨ Jump button). Indexes every room, every
  capability card, every guide page, every settings control, every checklist row, and the
  actions. Enter runs the first hit.
- **Toy locks.** SHA‑256 of the password via `crypto.subtle`, salt-free by design because
  it is explicitly a toy. Each lock is its own record keyed `<boxId>` or `room:<roomId>`,
  so unlocking one never unlocks another. Unlocked state is in memory only — a reload
  re-locks. Recovery is "Start fresh".
- **Authenticator.** Real TOTP: base32 decode → HMAC‑SHA1 over the 30-second counter →
  six digits, recomputed every second. Secrets stay in `localStorage`.
- **Converter.** Nine input formats, thirteen output formats, a source-type guesser, loss
  notes, copy and download.
- **Export.** Five data sets × ten shapes. Green shapes carry every field and download
  immediately; orange shapes state exactly what they lose and need a second click.
- **Bulk actions.** Pick all / flip picks / throw away, on every list, behind the
  type-the-word super-confirmation gate which previews the exact rows first.
- **Local history.** Every settings write logs an entry. Undo removes that entry as a new
  logged step, so the undo is itself undoable.
- **Changelog.** Five real releases from `CHANGELOG.md` with their real commit ids, a
  native date-range pair plus 30/90/all presets, composed with the text search.
- **Language.** English / Cantonese / both, plus two silliness sliders. The silly line is
  always **appended** to the fact, never substituted — see `voiceLine()`. Cantonese copy
  lives in the `YUE` map.
- **School mode.** Forces plain English at silliness 1, hides the silliness sliders,
  suppresses the dim sum draw, and can be pinned. Nothing is overwritten, so turning it
  off restores the real preferences with no restore step.
- **Narrator.** `speechSynthesis`, with the late-voice-list problem handled by
  re-reading on `voiceschanged`.
- **Appearance.** Day/night, six swatches, four presets, bigger text (really rescales the
  root font size), your own badge picture via a file picker → data URL, save look / load
  look / reset.
- **Timers.** Checks once a second; at the chosen time it switches theme, logs it, posts a
  message and toasts.
- **Sounds.** WebAudio blips on wins, misses and messages. Off by default.
- **Dim sum.** One draw per page load, 10% chance, suppressed in school mode.
- **Playroom.** Memory pairs (8 pairs, counts turns), dumpling maths (add/subtract with
  emoji dumplings, streak scoring), whack-a-block (20 s, misses cost a point). Best scores
  persist and are clearable behind the confirm gate.
- **Checklist room.** Hand-written enumeration of every promise and where it lives, with
  the two partials called out rather than hidden.

## Known gaps (stated, not hidden)

1. **Download-capture demo** shows the three surfaces (start decision → progress →
   completion) but transfers no bytes. A page cannot hand a transfer to an installed
   browser extension.
2. **Fonts load from Google Fonts** (`Baloo 2`, `Nunito`). The project contract wants
   everything local — swap to a system stack, or self-host the two families, to close it.
3. **Regex safety** is bounded, not guaranteed. A hard ReDoS guarantee needs a worker with
   a kill timeout.
4. **Ollama room** is a browser and a shopping list. A static page cannot pull models, and
   the fit verdicts come from what the browser will admit about the machine, rounded hard.
5. **Model catalog and changelog are embedded snapshots.** Regenerate them from
   `CHANGELOG.md` and the Ollama library when they drift.

## Dropping it in

The file is self-contained apart from the three assets and the font link. To ship it as
the Pages site, copy `Nodeterm Day Teet Hui.dc.html` plus `assets/` into `site/`, rename
the HTML to `index.html`, and check the base path — this fork deploys under
`/material-nodeterm/`, so keep every internal reference relative (all of them currently
are; there is no root-absolute `href="/…"` in the file).
