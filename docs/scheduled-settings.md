# Scheduled settings

A persisted set of rules that automatically overlay the app's own appearance / customization
settings for a date+time window — "dark theme after 22:00", "the presentation font on Fridays",
"switch to the light theme while the office's `input_boolean.daytime` Home Assistant entity is
on". Settings → **Schedule**.

This document is the schema, the source contract, the timezone rules, precedence, fallback, and
the security boundaries the feature has to hold. Code cross-references point at the actual files;
this file is not a copy of the code, it is the contract the code is checked against.

## What can be scheduled

`SCHEDULABLE_SETTING_KEYS` in [`src/shared/scheduled-settings.ts`](../src/shared/scheduled-settings.ts)
is the exact list — the union of what the app's own **Appearance** and **Terminal** settings
sections already treat as appearance/customization (`TERMINAL_RESET_KEYS` +
`APPEARANCE_RESET_KEYS` in `src/renderer/lib/settingsReset.ts`):

`appTheme`, `accent`, `hiddenNodeMenuItems`, `hiddenHeaderButtons`, `fontFamily`, `fontSize`,
`fontWeight`, `fontWeightBold`, `drawBoldTextInBrightColors`, `terminalMinContrast`,
`terminalTheme`, `cursorStyle`, `cursorInactiveStyle`, `cursorBlink`, `terminalLineHeight`,
`terminalLetterSpacing`, `terminalGpuRendering`.

The Settings → Schedule editor's per-field control list (`VALUE_FIELDS` in
`ScheduleSection.tsx`) offers all of these **except** `hiddenNodeMenuItems` /
`hiddenHeaderButtons` — those two are lists of internal menu-item ids with their own bespoke
picker in the Appearance section, and rebuilding that picker a second time inside this editor
wasn't worth it for a first release. They stay in the allowlist because a `kind:'api'` source can
still supply them (see "The `'api'` source" below) — a JSON payload from your own server can set
them even though the local editor doesn't offer a control for them yet.

## The schedule window

Each rule has a `window: ScheduleWindow`:

```ts
interface ScheduleWindow {
  startDate?: string   // YYYY-MM-DD, inclusive
  endDate?: string      // YYYY-MM-DD, inclusive
  startTime?: string    // HH:mm, 24-hour
  endTime?: string       // HH:mm, 24-hour
  days: 'every-day' | Weekday[]   // Weekday = 0 (Sun) .. 6 (Sat)
}
```

**"Every day" is one value, not seven rules.** `days: 'every-day'` means every weekday for the
given time window. An explicit `Weekday[]` restricts to exactly those days; an **empty** explicit
array matches **no** day — a user who unchecked every box in the editor gets "this rule can never
become active", not a silent fallback to "every day". The editor warns inline when this happens.

### Time-of-day semantics (`sameDayTimeMatch` in `shared/scheduled-settings.ts`)

|                              | Result |
|------------------------------|--------|
| neither `startTime` nor `endTime` set | all day (`[00:00, 24:00)`) |
| only `startTime` set        | `[startTime, 24:00)` |
| only `endTime` set          | `[00:00, endTime)` |
| both set, `start < end`     | `[start, end)` — **end is exclusive**, so a rule ending at 09:00 and one starting at 09:00 never overlap |
| both set, `start === end`   | all day. A zero-length window is unusable, so equal bounds are defined to mean "no restriction" rather than "never" |
| both set, `start > end`     | **crosses midnight** — see below |
| a malformed value (persisted-file evaluation only) | treated as absent (that bound is unbounded) |

### Cross-midnight windows

When `startTime > endTime` (e.g. `22:00` → `06:00`), the window is understood as **one instance
per day it starts on**, running through midnight into the next calendar date. The date-range and
day-of-week check is evaluated against the **start day**: a window that begins 22:00 Friday is a
"Friday" rule even though part of it falls on Saturday's calendar date. At any given instant, at
most one of "today's instance" or "yesterday's instance" can contain "now" — they cannot overlap —
so the evaluator checks both and returns true if either does.

### Date boundaries

`startDate`/`endDate` are **inclusive** local calendar dates. Absent = unbounded on that side.
Equal `startDate === endDate` is a normal single-day window — no special case is needed (unlike
the time-of-day equal-bounds case, a single calendar day is a perfectly ordinary, non-degenerate
window). Comparison is a plain string compare (`YYYY-MM-DD` sorts lexicographically exactly as it
sorts chronologically), so no `Date` parsing — and therefore no timezone ambiguity — is involved
in the date-range check itself.

### Invalid / partial input

- **The editor** (`ScheduleSection.tsx`) validates every field inline via
  `validateScheduleWindow()` and reports every problem field at once — it never silently coerces
  or drops a bad value. A native `<input type="date">` / `<input type="time">` is used for entry,
  so a genuinely malformed string essentially can't reach the editor's state in the first place;
  the validator exists for the belt-and-braces case (paste, or a future non-native input path) and
  for the store's own re-validation on save.
- **The stored-file evaluator** (`scheduleWindowActiveAt`) stays tolerant, on purpose:
  `scheduled-settings.json` is a plain, hand-editable JSON file, and a malformed bound there reads
  as *absent* (unbounded on that axis) rather than crashing the evaluator or refusing to boot. This
  is the same "hand-editable, so be forgiving" convention `settings-store.ts`'s `mergeSettings`
  already uses for `settings.json`.
- **An empty schedule** (a rule with no date bounds, no time bounds, `days: 'every-day'`) matches
  **always**. **An empty rule list** (`file.rules.length === 0`) means no override is ever active —
  behaviour is bit-for-bit identical to the feature not existing.

## Storage: schema, versioning, bounds

`scheduled-settings.json` lives in the app's user-data directory (same directory as
`settings.json`), owned by `ScheduledSettingsStore` (`src/core/scheduled-settings-store.ts`) — a
**separate file**, not a field on `settings.json`, because it has its own save cadence (rule edits
are infrequent and deliberate, versus the coalesced per-keystroke settings save) and its own
bounded-schema validation that a plain settings merge doesn't need.

```ts
interface ScheduledSettingsFile {
  version: 1
  timezone: string        // IANA name, e.g. "Europe/London"
  rules: ScheduleRule[]
}

interface ScheduleRule {
  id: string
  label: string
  enabled: boolean
  window: ScheduleWindow
  source: ScheduleSource   // 'local' | 'api' | 'home-assistant' — see below
  values: SchedulableSettingsPatch
}
```

Writes are atomic (temp file + rename, 0600), the same discipline `SettingsStore` uses for
`settings.json`. A `save()` call is **re-validated in the store** before it ever reaches disk —
never trust the caller, even though the editor's own UI should never be able to produce an invalid
file — against explicit bounds (`SCHEDULE_LIMITS` in `shared/scheduled-settings.ts`):

- at most **50 rules**
- a rule's label is at most **120 characters**
- a source URL is at most **2048 characters**
- a Home Assistant entity id is at most **200 characters**, and must match
  `^(binary_sensor|input_boolean)\.[a-z0-9_]+$`

A validation failure returns `{ok:false, error}` — never a thrown exception — so the renderer can
show the reason inline next to the Save button.

### Startup read recovery is a third state

`ENOENT` is the only normal "no schedule yet" result. A corrupt JSON document, a directory at
`scheduled-settings.json`, or a filesystem failure such as `EACCES`/`EIO` is neither an empty
schedule nor a reason to take down the app. `ScheduledSettingsRuntime` is the single boot boundary
used by both Desktop and Server. On one of those failed reads it:

1. leaves the original file or directory untouched;
2. installs an empty in-memory file, so every scheduled override is disabled;
3. returns `ScheduledSettingsLoadState { ok:false, file, error }` over Desktop IPC and Server
   WS-RPC, including the recovery path and a bounded error code when one exists; and
4. refuses every save until the operator repairs or moves the evidence and restarts nodeterm.

Settings → Schedule renders that state as a recovery alert and exposes no editing controls. It
never presents the disabled fallback's empty `rules` array as proof that the original schedule had
no rules. Raw exception text is not sent to the renderer; the error message is static-shaped.

Renderer writes have their own one-owner barrier (`ScheduledSettingsSaveQueue`). A new edit made
while an IPC/WS save is in flight remains pending. Success **or failure** releases the owner in a
`finally` path and arms the newest pending edit; a rejected bridge promise therefore shows its
inline error without wedging all later saves.

**Migration**: `normalizeScheduledSettingsFile()` merges a possibly-partial, legacy, or
hand-edited file over a fresh default, field by field and rule by rule — one bad rule never sinks
the whole schedule, and one malformed field within a rule never sinks the whole rule (it just
drops that field back to "unset"). A rule with no `id` is dropped entirely: an id-less rule cannot
be addressed by the editor, the Home Assistant token store, or the "which rule is active" push, so
minting one silently would change what the file *means* rather than merely tolerate a defect.

## Precedence: which rule wins

**Array order — first enabled, currently-matching, currently-satisfied rule wins.** Every later
rule is ignored whether or not it *also* matches. This is the same "order decides" contract this
codebase already uses for project tab order and kanban column order — reordering rules in the
editor (the ↑/↓ buttons on each rule card) changes precedence directly and visibly.

A rule is a candidate to win when, in this order:

1. `rule.enabled` is `true`.
2. `scheduleWindowActiveAt(rule.window, now, file.timezone)` is `true` — its date/time window
   currently matches.
3. Its **source** is currently satisfied:
   - `'local'` — always satisfied.
   - `'api'` — satisfied once at least one fetch has EVER succeeded (see "retain the last valid
     state" below); the values applied are the last successfully fetched ones, not the rule's own
     stored `values` (that field is only ever a UI fallback for an `'api'` rule — see below).
   - `'home-assistant'` — satisfied once at least one fetch has ever succeeded **and** the last
     known state is `on`.

If no rule is a candidate, no override applies: the app renders exactly the user's saved (`base`)
settings.

`resolveActiveSchedule()` in `shared/scheduled-settings.ts` is the pure function that implements
this; it takes the current instant and the already-resolved external-source states rather than
reading a clock or the network itself, so precedence is deterministic and trivially re-computable.

## Base settings remain recoverable

**A scheduled override never touches the user's saved settings, and is never written to
`settings.json`.** In the renderer, `useSettings` (`src/renderer/state/settings.ts`) keeps two
fields:

- `base: Settings` — the persisted preference. Every settings-editing control in the app (the
  Terminal and Appearance sections, and the section-reset buttons) reads and writes `base`; only
  `base` is ever passed to `settings.save()`.
- `settings: Settings` — `base` merged with the currently-active override, if any. Every other
  consumer in the app (real terminal rendering, Monaco, the app chrome theme resolver, …) reads
  this field, unchanged from before this feature existed — which is what lets an override reach
  the whole renderer without touching each of the many places a setting is read.

`applyScheduleOverride(patch | null)` is the ONLY thing that ever writes to `settings` without
also writing to `base`. When the active rule changes (or becomes `null`), `settings` recomputes
from `base` immediately and in-memory only — there is no persistence step to "undo", because there
was never a write to undo. The moment a rule's window (or its Home Assistant entity) ends, the
next resolution is `null`, and the app is back to the user's exact base settings.

One deliberate consequence: while an override is active, the Terminal/Appearance editors and their
live preview still show and edit `base`, not the override — see `TerminalPreview.tsx`'s use of
`useXtermVisualSettings('base')`. Opening Settings while dark mode is scheduled on doesn't show you
"dark mode" as your saved theme; it shows you what you actually saved, so a slider drag starts from
the right place and the Reset button's "is this pristine?" check answers the right question.

## The `'api'` source

```json
{ "version": 1, "settings": { "appTheme": "dark", "accent": "#0a84ff" } }
```

- Fetched via `GET`, `Accept: application/json`, over HTTPS (or `http://localhost` /
  `http://127.0.0.1` for local development — see "Security boundaries" below).
- `version` must equal `1` exactly, `settings` must be an object; anything else is a validation
  failure, not a partial application.
- Every field of `settings` is run through the **same per-field validator** the local editor's
  bounds use (`FIELD_VALIDATORS` in `shared/scheduled-settings.ts`) — an unknown field is dropped,
  an out-of-range or wrong-typed value is dropped, never coerced to "the nearest legal value".
- Response body is capped at **64 KiB** (`SCHEDULED_SETTINGS_API_MAX_BYTES`) and the request times
  out after **8 seconds** (`SCHEDULED_SETTINGS_API_TIMEOUT_MS`) by default (a rule may set a
  shorter/longer `timeoutMs`).
- The rule's own stored `values` are shown in the editor as a **local fallback** (what's shown
  before the first successful fetch) but are **never** what actually applies — the live value is
  always whatever the source's last successful fetch produced.

## The Home Assistant source

```ts
{ kind: 'home-assistant', baseUrl: 'https://homeassistant.example.com', entityId: 'input_boolean.evening_mode' }
```

- Links a rule to a **boolean** entity — `binary_sensor.*` or `input_boolean.*` only, validated by
  regex before anything is ever fetched.
- `GET <baseUrl>/api/states/<entityId>`, `Authorization: Bearer <token>`. `on` activates the
  rule's own stored `values`; `off` leaves the base settings (or another matching rule) in effect
  — the entity is a **gate**, not a value source (unlike `'api'`, which supplies the values
  themselves).
- The access token is a Home Assistant **long-lived access token**, pasted once per rule into a
  write-only password field in the editor and stored via `setHomeAssistantToken(ruleId, token)`
  (`src/core/scheduled-settings-secrets.ts`) — see "Where the token lives" below. There is
  deliberately no IPC channel that can read a token back; the editor only ever asks "does this
  rule have a token" (a boolean).

## Refresh + failure (fail-safe, never blocking)

`ScheduledSettingsService` (`src/core/scheduled-settings-service.ts`) runs a 30-second tick in the
main process (or the Server Edition's equivalent process):

- **On activation**: the moment a rule's window transitions from inactive to active, its external
  source (if any) is refreshed immediately — the tick tracks each rule's previous window state
  (`windowWasActive`) and detects the edge.
- **On a bounded interval**: every enabled rule with an external source is otherwise refreshed
  every 5 minutes (`SCHEDULED_SETTINGS_REFRESH_INTERVAL_MS`) while it stays enabled.
- **On demand**: the editor's "Retry" button next to a failing source (`IPC.scheduledSettingsRefreshRule`).

**Generation + ownership guards.** Each fetch for a rule is tagged with a per-rule monotonic
generation and the complete source identity (kind, URL/entity and timeout). Exactly one check owns
one rule/source generation: a later 30-second tick joins that promise instead of launching an
overlap. Deleting or retargeting a rule — including changing a URL/entity without changing the
source kind — invalidates its cached value and owner. Clearing/replacing a Home Assistant token is
also a generation change and removes a cached `on` synchronously before the IPC reply resolves.
A stale completion checks the generation, owner identity and current live source before publishing;
its `finally` may release only its own slot, never a newer source's slot.

**"Retain the last valid state."** A network failure, malformed response, offline machine, `401`
from a bad token, or a rate limit is **never** treated as "the rule is now off" or "apply nothing
special" — it is treated as "nothing changed". `RuleSourceState.hasValue`/`values`/`on`/
`lastSuccessMs` are updated **only** on a successful fetch and are otherwise left exactly as they
were; `lastAttemptOk`/`lastAttemptMs`/`error` independently track the most recent attempt, so the
UI can show (and offer a retry for) a live failure while still correctly applying an older
successful value. A source that has **never** synced successfully can never satisfy its rule —
"no answer yet" is never silently treated as "on" or "valid".

**Never claims success it didn't have.** The push to the renderer
(`ScheduledSettingsActiveState`, `IPC.scheduledSettingsActiveChange`) always carries the real
`ok`/`error`/`lastSuccessMs` per source; the Settings → Schedule editor renders a status line per
external-source rule ("Home Assistant last synced 3m ago." / "API error: Request timed out. Still
applying the value synced 12m ago.") and the retry button. Nothing here dresses up "did not run"
as "succeeded".

## Security boundaries

All of this runs in the **main process** (`src/main/index.ts`) or the **Server Edition's**
process (`src/server/index.ts`) — never the renderer/browser — via the shell-agnostic
`src/core/scheduled-settings-*.ts` modules talking only through `platform()`
(`src/core/platform.ts`). The renderer only ever reads the resolved result over IPC/WS.

- **Scheme allowlist.** Only `https:` is unconditionally allowed. `http:` is allowed **only** for
  an explicitly loopback host (`localhost` / `127.0.0.1` / `::1`) — the "bounded loopback
  development route" — so a real API or Home Assistant instance anywhere on a LAN or the internet
  must be reached over HTTPS. Anything else (`file:`, a custom scheme, …) is refused outright,
  which is what closes the "arbitrary file access" hole.
- **No redirects.** Every fetch uses `redirect: 'manual'`; a 3xx status or an opaque-redirect
  response is treated as a failure, never followed.
- **No credentials in the URL.** A URL containing `user:pass@host` is refused before any request is
  made — that syntax would leak the credential into the URL string that later shows up in a status
  row's error text, which the token vault exists specifically to avoid.
- **Bounded size and time.** Every response body is capped (64 KiB) and every request has a
  timeout (8 s default); the byte cap is enforced by reading the response stream chunk-by-chunk and
  aborting the instant it is exceeded, not by buffering an unbounded body first.
- **No unbounded refresh loop.** The interval is fixed (5 minutes) and generation-guarded; an
  in-flight fetch is never restarted by a subsequent tick for the same rule.
- **Where the token lives.** A Home Assistant token is sealed at rest via the platform's
  `sealSecret`/`unsealSecret` hooks (Electron: Keychain-backed `safeStorage`) when the shell can
  seal, else stored as a raw 0600 file — the Server Edition's documented "headless, no OS keychain"
  degrade (see `core/platform.ts`'s doc on those two hooks; the exact same pattern
  `agents/node-auth-secret.ts` already uses). Tokens are keyed by **rule id**, one file per rule,
  under `<userData>/scheduled-settings-secrets/`. Deleting a rule (or changing its source away from
  `'home-assistant'`) deletes its token file. Rule ids at this filesystem boundary must be exact
  lowercase RFC 4122 v4 UUIDs; lossy filename replacement is forbidden because two hand-edited ids
  could otherwise alias one credential.
- **Token mutation is one directory transaction.** Set, Clear, sealed/raw format cleanup, and
  orphan prune enter one ordered FIFO and one SQLite `BEGIN IMMEDIATE` transaction for the secret
  directory. This prevents a prune from missing a parked Set or waking after a newer Set and
  deleting it. A Clear/prune awaits removal of both canonical formats plus every recognized temp;
  a PID-bearing temp is preserved as potentially live and produces a truthful incomplete-cleanup
  result. Only `ENOENT` is absence. Malformed, wrong-format, or unreadable token evidence makes its
  status unknown and keeps Clear available rather than reporting “not stored.”
- **Schedule publication and credential cleanup have separate truth.** The schedule file is already
  durable when post-save orphan cleanup runs. The store awaits every change listener, continues
  sibling listeners, and returns “The schedule was saved, but related credentials could not be
  fully cleared.” if cleanup fails; it does not roll back or mislabel the disk write. Startup and
  periodic retries collect crash-gap orphan residue only when `scheduled-settings.json` loaded
  successfully. During corrupt/unreadable recovery, the safe empty in-memory schedule is not
  evidence that every credential is orphaned, so token bytes remain untouched.
- **Never logged.** No fetch in `scheduled-settings-network.ts` ever logs a response body or an
  access token; every failure reported to the caller (and, from there, to the renderer) is a short,
  static-shaped reason string, never the raw text a server sent back — a broken or hostile server
  cannot get its own content echoed into a notification or a screenshot.
- **No token ever crosses IPC in the read direction.** `setHomeAssistantToken(ruleId, token |
  null)` is write-only; `tokenStatus()` returns only `Record<ruleId, boolean>`. There is
  deliberately no "get token" IPC channel anywhere in this feature.

## Timezone

Every rule's window is interpreted in **one** IANA timezone for the whole schedule file
(`ScheduledSettingsFile.timezone`), not per-rule — a single, statable clock rather than each rule
silently keeping whatever zone the machine that created it happened to be in. It defaults to the
runtime's own resolved zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) the first time the
file is created, and is user-editable in Settings → Schedule; the editor states this in the field's
own hint text. Daylight-saving transitions are handled automatically for zones that observe them —
`localClock()` resolves wall-clock date/time/weekday via `Intl.DateTimeFormat`, which already
accounts for DST in the named zone; the app performs no DST arithmetic of its own. An unrecognized
zone name falls back to the machine's own local zone (`Intl` throws synchronously on construction
for an invalid name).

## Local version history

This app does not yet have a general local Git-backed version-history system for settings changes
of any kind — no setting, anywhere in the app, is currently recorded that way. When one is added,
a scheduled-settings rule edit should route through it exactly like any other settings change
(create/edit/delete as append-only commits, restore-as-new-revision); this feature deliberately
does not invent a bespoke, one-off history mechanism of its own to fill that gap in the meantime.
Recorded here as an honest, known gap rather than a silent omission.

## Verification

Automated coverage now lives in:

- `src/shared/scheduled-settings.test.ts` — strict raw-save validation, normalization and pure
  resolution boundaries;
- `src/core/scheduled-settings-service.test.ts` — source identity generations, one-owner in-flight
  fencing, retarget/removal/token invalidation, stale-completion mutation guards, and recovery-gated
  startup/periodic orphan cleanup;
- `src/core/scheduled-settings-secrets.test.ts` and `fs-transaction-lock.process.test.ts` — strict
  rule/token reads, set/Clear/prune ordering, retained-evidence errors, and real process barriers;
- `src/core/scheduled-settings-store.test.ts` and `scheduled-settings-runtime.test.ts` — ENOENT,
  corrupt JSON, directory-at-path, EACCES/EIO, disabled fallback and evidence-preserving save lock;
- `src/renderer/state/scheduled-settings-save.test.ts`, `scheduledSettings.test.ts`, and the
  Schedule section Chuts — the rejected-save barrier, visible error/later-save recovery, owning-rule
  flush before token mutation, unknown token status, draft retention, and truthful Clear errors; and
- `test/server/scheduled-settings-startup.test.ts` — a real Server boot plus authenticated WS-RPC
  traversal for every startup read state and the recovery overwrite refusal.

Run those focused suites plus `npm run typecheck`; release verification still owes the built
Desktop interaction and the real external integrations below. What to verify by hand, in priority
order:

1. **Precedence and windows**: two overlapping rules, confirm array order wins; a cross-midnight
   window (e.g. 22:00–06:00) straddling a day boundary; equal start/end time (should be "all day");
   an explicit empty weekday selection (should never activate, with the inline warning showing).
2. **Base recoverability**: turn a rule on, confirm the canvas/terminals repaint; open Settings →
   Terminal/Appearance while it's active and confirm the controls and the live preview show your
   SAVED values, not the override; edit an unrelated setting and confirm it saves correctly without
   disturbing the active override; let the rule's window end and confirm the app reverts to exactly
   the saved settings with no leftover override.
3. **`'api'` source**: point a rule at a small local HTTPS (or `http://localhost`) server serving
   `{"version":1,"settings":{...}}`; confirm a redirect, an oversized body, a timeout, and a
   malformed payload each report a clear status line and leave base settings alone (or, once a
   fetch has succeeded once, keep applying the last good value through a later failure).
4. **Home Assistant source**: a real (or mocked) `binary_sensor`/`input_boolean` entity; confirm
   the token entry, status dot, retry button, and the `on`/`off` gating behavior; confirm the
   token is never visible again after saving and that clearing it removes the file under
   `scheduled-settings-secrets/`.
5. **Both shells**: exercise the whole flow once under the Desktop app and once under the Server
   Edition (`npm run server:dev`) — the store/service/network code is shell-agnostic and is wired
   identically into both `src/main/index.ts` and `src/server/index.ts`.
