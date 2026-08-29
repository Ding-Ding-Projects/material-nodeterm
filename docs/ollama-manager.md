# Local Ollama suite manager

A local manager for [Ollama](https://ollama.com) reachable from the Ollama icon in the canvas'
controls cluster, the command palette ("Ollama manager"), or `⌘K`. Everything that *manages* Ollama
talks **only** to Ollama's own documented local HTTP API (`http://127.0.0.1:11434` by default, or
`$OLLAMA_HOST`) — never an unofficial proxy, never a cloud model service, and it never claims Ollama
can launch arbitrary programs. The **one** exception is the model catalog, which the local API
cannot answer at all: it reads Ollama's own first-party library index and registry, read-only and
unauthenticated, and it is switchable off. That is measured and argued in
"[Where the catalog comes from](#where-the-catalog-comes-from)" below. Every HTTP call is made by
the privileged shell (Electron main / the Server Edition process), never the renderer directly —
the panel talks to the active project's session API.

## Architecture

```
src/shared/ollama.ts           pure types + the evidence-based hardware-fit evaluator + the
                                OllamaApi shape (renderer-facing)
src/core/ollama/
  client.ts                    thin wrapper over Ollama's REST API: /api/version, /api/tags,
                                /api/ps, /api/show, /api/delete, /api/copy, streamed /api/pull and
                                /api/chat
  hardware.ts                  best-effort local hardware detection (RAM always; VRAM via
                                nvidia-smi when present; disk via the shared freeDiskBytes helper)
  installation.ts              detectOllamaInstalled (PATH + well-known per-platform install
                                locations, no subprocess) and classifyOllamaHealth — the two pieces
                                that turn a refused connection into 'stopped' vs 'not-installed'
  pull-queue.ts                the batch-pull "cart" — durable, bounded-concurrency, resumable
  chat-store.ts                local chat session persistence + streaming orchestration
  catalog-types.ts             the exhaustive catalog's types (model → tags → facts + state)
  catalog-pure.ts              pure decisions: page parsing, merge, completeness, staleness,
                                fetch planning. No I/O and no clock — fully unit-tested
  registry-catalog.ts          the ONLY non-loopback network in this feature: Ollama's library
                                index/tag pages and the registry manifest endpoint the CLI pulls
                                from, with host pinning, timeouts and format-error detection
  catalog-store.ts             cache + background crawl + the honest snapshot every caller gets
  register-ipc.ts              the ollama:* RPC surface, shared by both shells
src/renderer/components/ollama/
  OllamaManagerPanel.tsx        the whole user-facing panel (Health / Installed / Model store / Chat)
  catalogView.ts                pure boundary parse + filter/sort/paginate + the honest sentences
  troubleshoot.ts               bundled, offline per-platform install/start guidance
```

## Session routing and shipped surfaces

The manager is a global drawer, outside the canvas' project-keyed `SessionProvider`. It therefore
resolves the **active project's** API explicitly; using the root context or
`window.nodeTerminal.ollama` here would manage the viewing computer when a relay tab is selected.
The same routing applies to reads, pulls, chats, and destructive operations such as model deletion.

- **Desktop:** manages the Ollama service on the active local project's machine.
- **Server Edition:** manages the Ollama service on the machine running nodeterm-server, not the
  browser's computer. Hardware and troubleshooting guidance describe that server.
- **Relay project:** Ollama RPC is not carried to the host in this release. The relay namespace
  returns `E_UNSUPPORTED`; the manager shows that refusal and explicitly does not fall back to the
  viewer's Ollama installation.
- **Mobile companion:** not applicable. *nodeterm mobile* is a separate app with no local-process
  management surface, and this feature adds no mobile protocol messages.

## Where the catalog comes from

The Model store lists **every model and every tag in Ollama's own first-party library**
(ollama.com/library), paginated, searchable, filterable and sortable, with each row's revision, size
and (where one exists) timestamp, above a recorded completeness and staleness state. That scoping is
deliberate, not a shortcut — see "Community models are not enumerable" below for why "every published
model" (full stop) is a claim this feature cannot honestly make, and what it does instead. Getting
this far needed an answer to one question first.

### Ollama's local API cannot enumerate the catalog. Measured, not assumed.

`/api/tags` lists what is **installed**. There is no local endpoint for "every model that exists",
and the registry `ollama pull` itself talks to does not implement the Docker-Registry-v2 discovery
endpoints either. Probed 2026-08-18:

| Request | Result |
|---|---|
| `GET registry.ollama.ai/v2/_catalog` | `404 page not found` |
| `GET registry.ollama.ai/v2/library/llama3.2/tags/list` | `404 page not found` |
| `GET registry.ollama.ai/v2/library/llama3.2/manifests/1b` | **200**, a real OCI manifest |
| `GET ollama.com/library` | **200**, 234 model links |
| `GET ollama.com/library/llama3.2/tags` | **200**, 63 tag links, each with a size and short digest |

So the enumeration this feature needs exists in exactly one place — Ollama's own website — and the
exact per-tag facts exist in exactly one machine-readable place: the manifest endpoint the CLI
downloads from. **A hardcoded list was never an option** (the previous `OLLAMA_POPULAR_MODELS` seed
is gone from this surface), and neither was inventing sizes.

### The two sources, and which fact comes from which

1. **`ollama.com/library`** → every model name. **`ollama.com/library/<model>/tags`** → every
   published tag for that model, plus the rounded size ("1.3GB") and the 12-hex short revision the
   page prints. This is an HTML page, i.e. a scrape, so it is parsed defensively: by **link target**
   (`href="/library/<name>"` — the page's contract with its own router) and by **value shape** (a
   12-hex digest followed by a number and a byte unit), never by CSS class or column position. A
   restyle degrades to "tag listed, size unknown", not to a wrong number.
2. **`registry.ollama.ai/v2/<namespace>/<model>/manifests/<tag>`** → the **exact** download size
   (config + every layer) and the full revision digest, computed as sha256 over the exact bytes
   received (the registry sends no `Docker-Content-Digest`, and a digest we computed beats one the
   server asserts). This is the same document `ollama pull` fetches.

### Community models are not enumerable. Measured, not assumed.

Ollama's first-party library (above) is only half the picture: `ollama pull huihui_ai/qwen3.5-abliterated`
works today, and that model appears nowhere in `ollama.com/library` — community models are published
under a **namespace** (`ollama.com/<namespace>/<model>`), and this app already handles pulling one
by exact reference (`splitRef` keeps the slash; `registry-catalog.ts`'s `manifest()` branches on
`model.includes('/')` to build `v2/<namespace>/<model>/manifests/<tag>` instead of
`v2/library/<model>/manifests/<tag>`). The open question was whether that namespace is *enumerable*
the same way the library is. It is not — measured live 2026-08-18:

| Request | Result |
|---|---|
| `GET ollama.com/search` (empty query) | **200**, exactly 20 model links |
| `GET ollama.com/search?q=abliterated` | **200**, exactly 20 model links, **zero** under `/library/` — all namespaced (`babar_jamali/…`, `huihui_ai/…`, `feadxus/…`, …) |
| `GET ollama.com/search?q=llama` | **200**, exactly 20 model links (a common query is capped exactly like a rare one) |
| `GET ollama.com/search?q=llama&page=2` | **`303 See Other`**, `Location: /search?q=llama` — redirects back to page 1 instead of paging |
| `GET ollama.com/search?q=llama&o=newest` | **200**, still exactly 20 links — `o` is a **sort** key (`popular` / `newest`), read from a hidden `<input name="o">` in an HTMX form; it reorders the same 20-result window, it does not expand it |
| form fields on `/search` | `q` (query text), `c` (a capability checkbox: `cloud`/`embedding`/`thinking`/`tools`/`vision`), `o` (sort) — no offset, limit, or page-size parameter exists at all |

So `ollama.com/search` is a capped relevance/recency search (~20 results, two sort orders, one
capability filter), not an index: there is no parameter that returns result 21 of any query, and the
one that looks like it (`page`) is rejected by a redirect back to page 1. Nothing else on
ollama.com's public surface enumerates the namespace either (there is no `/users` or `/namespaces`
listing, and the registry's own `_catalog`/`tags/list` discovery endpoints are 404, per the table
above). **A crawl that tried to "get to the end" of community models would never terminate on a
list — it would terminate on a search API's hard cap, having seen an arbitrary, unlabeled subset.**
Presenting that subset as part of "the catalog" would be worse than not having it: a user paging to
the end would reasonably read the absence of their model as "Ollama doesn't have it," when the truth
is just "the search box didn't surface it in the top 20."

The honest answer, and what this app actually does:

- The catalog's **completeness claim covers the library only**, and says so in its own words —
  `deriveCompleteness`'s `'complete'` state always appends a scope note (`COMMUNITY_SCOPE_NOTE` in
  `catalog-pure.ts`) explaining that community models have no enumerable index, and the panel's
  headline itself now reads **"Complete first-party library: all *N* models and all *N* tags on
  ollama.com/library. Community models aren't enumerable — add one by exact reference."** — never
  "every published model", which claimed a scope this source cannot support. This was the central
  defect an adversarial live-site review found (2026-08-18): the code already handled namespaced
  refs correctly end-to-end, but the completeness sentence claimed a scope — "every published
  model" — that only the library enumeration could ever back up.
- **Community models remain fully reachable** — just not by browsing. The exact-reference field
  (Model store tab, and the free-text `isValidModelRef` path everywhere else in the panel) takes any
  `namespace/model[:tag]` reference and pulls it exactly like the CLI would; nothing about "not
  enumerable" means "not supported."
- If Ollama ever ships a real enumeration surface for the namespace (an offset/cursor that actually
  advances, or a `_catalog`-equivalent), it is a **second index source** to add alongside the library
  one in `registry-catalog.ts`/`catalog-store.ts`, merged with its own pagination and staleness
  state so a partial community crawl can never downgrade or inflate the library's own completeness
  — the two sources must stay independently honest.

### The trade-off, stated

This widens the manager's network surface from "loopback only" to "loopback **plus Ollama's own
first-party website and registry**". It is read-only, unauthenticated, and carries no credential, no
prompt, no chat content and no private-namespace model name. It runs **only when the user opens the
manager** (the catalog handler is what triggers it — nothing is fetched at boot), and
`NT_OLLAMA_NO_REGISTRY=1` (or `NT_OFFLINE=1`) disables it outright — in which case the panel says the
catalog is **unavailable**, never that it is empty. If a deployment cannot accept that egress, that
switch is the supported answer, and the exact-reference field still reaches any model.

Cost control, because "every tag" is thousands of rows: a refresh fetches the index plus **every
model's tag page** (~234 requests, 4 at a time — this is the coverage the feature promises, and it
is not throttled), while exact manifest facts are **refinement** and are fetched at most 200 per
refresh with a 60 s cooldown, prioritising installed references and tags with no size at all. Until
a tag's manifest has been fetched, its size is the page's rounded figure and the UI shows `≈`. The
whole thing is cached at `<userData>/ollama/catalog.json` (atomic write, 12 h freshness) and every
pass saves, so a quit mid-crawl resumes instead of restarting.

### Completeness and staleness are recorded, never assumed

`deriveCompleteness` (pure, tested) returns exactly one of:

- **complete** — the index resolved *and* every model in it has a resolved tag list. Only this state
  is allowed to say "every model and every tag" — and even then, scoped explicitly to Ollama's own
  library (see "Community models are not enumerable" above); it is never allowed to say "every
  published model" unqualified, because community models are structurally outside what this state
  can measure.
- **partial** — some of it is here and we know it is not all of it, with the counts and the reason
  (models still pending, tag lists that failed, a stale index refresh that failed).
- **unavailable** — we have nothing to show *and could not look*. The panel prints "this is a load
  failure, not an empty catalog".

Staleness is `never` / `fresh` / `stale` — "we have never looked" is deliberately a different state
from "what we have is old", because they need different sentences. A failed index refresh keeps the
previously crawled models and records the error; a failed tag fetch keeps that model's known tags; a
failed manifest keeps the rounded size; an unreadable cache file is **quarantined** (`.corrupt-<ts>`)
and reported rather than presented as an empty cache; and an Ollama that is down leaves the
`installed` marks alone instead of claiming nothing is installed.

### Tests

`catalog-pure.test.ts` drives the parsing/merge/completeness/staleness/planning decisions against
**verbatim** excerpts of the live pages, `catalog-store.test.ts` drives the state machine against a
real temp directory and fake sources (failed index, failed tag list, failed manifest, unreadable
cache, Ollama down, lookups disabled), `registry-catalog.test.ts` drives the network module through
an injected fetch, and `catalogView.test.ts` + `OllamaManagerPanel.test.tsx` cover the boundary
parse, paging and the panel copy. Sixteen of those guards were mutation-checked by reintroducing the
mistake and confirming the red — nine from the original build-out, plus seven from an adversarial
live-site review pass (2026-08-18) that fixed: the false "every published model" completeness claim
(now scoped to the library, with the community-search evidence above); the fit-evaluation storm and
the progress-poll dying on one transient failure (both `OllamaManagerPanel.tsx`, see "The channel it
rides on" above); a dead `name.includes(':')` guard in `parseLibraryIndex` whose comment described a
regex that was never actually there (`catalog-pure.ts`); an installed row's local pull date rendered
as an unlabeled "publish date" (now `"installed <date>"`); and an inverted ellipsis marker on the
revision cell (a truncated 64-hex digest had none, a complete 12-hex one had one — swapped).

The only check that can catch Ollama redesigning its own pages is opt-in and makes real requests:

```bash
NT_OLLAMA_LIVE_CATALOG=1 npx vitest run registry-catalog catalog-store
```

Run it when touching the parsers. Last green 2026-08-18 (234 models, 63 tags for `llama3.2`, exact
manifest sizes).

### The channel it rides on, and the follow-up that owes

The snapshot is served over the **existing, argument-less** `ollama:popular-models` channel, because
this change does not own `src/shared/ipc.ts`, `src/shared/ollama.ts` or the preload, so it could not
add one. Consequences, all deliberate and all owed a follow-up in those files:

- `OllamaApi.popularModels()` still *declares* `Promise<{name, note}[]>` while the core now answers
  with a `CatalogSnapshot`. The renderer therefore treats the payload as untrusted input and parses
  it (`catalogView.ts`), and still understands the legacy array — which it labels "completeness
  unknown" rather than showing as a catalog.
- There is no push event for crawl progress, so the panel **polls** the same channel every 3 s while
  the core reports a refresh in flight, and stops once a load reports the refresh idle.
- There is no settings toggle for the egress, only the environment switch above.

Widening the declared type, adding a dedicated `ollama:catalog` channel with paging arguments (so a
9,000-row snapshot need not cross the bridge whole), and a Settings → Ollama toggle are the three
follow-ups.

**The poll loop is self-perpetuating, not re-armed by a state change.** An earlier version keyed the
polling `useEffect` on the `catalog` object itself — which only a *successful* load replaces — so one
transient rejection (a dropped connection, a session hiccup) left `catalogError` set, `catalog`
untouched, and the loop permanently dead: the panel showed a stale "Still fetching…" counter until a
manual Reload. `OllamaManagerPanel.tsx`'s poll effect now schedules its own next attempt from inside
each attempt's completion (`catalogPollShouldContinue`/`catalogPollDelayMs`, pure and tested in
`catalogView.ts`), with a small capped exponential backoff on consecutive failures; only a
successfully-parsed view reporting the refresh idle — or the component unmounting — stops it.

**Hardware-fit evaluation is keyed on the visible refs, not on `catalogPage`'s object identity.**
`selectCatalogPage` produces a fresh object every time a catalog poll lands, even when the page's
rows did not actually change — the channel above returns a brand-new snapshot object on every
successful load. An effect keyed on that object therefore re-fired every 3 s during a first-time
crawl that can run for minutes, and each firing spawns `nvidia-smi` (2.5 s timeout) plus a disk probe
plus a full `/api/tags` read for no new information. The fit effect is now keyed on a primitive
string built from the sorted, deduplicated set of visible refs (installed models + the current
catalog page + the cart); two computations landing on the same refs produce the same string VALUE,
and React's dependency comparison treats equal primitives as unchanged regardless of how many
intermediate objects were rebuilt to get there.

### Surfaces

- **Desktop:** the catalog is fetched by the main process of the machine that owns the active
  project, and cached in that machine's `userData`.
- **Server Edition:** fetched by the **server**, not the browser — same as every other Ollama call
  here. An air-gapped server sets `NT_OLLAMA_NO_REGISTRY=1` and gets the honest "unavailable".
- **Relay project:** unchanged — the Ollama namespace is not carried to the host, the panel shows
  `E_UNSUPPORTED`, and it does not fall back to the viewer's machine.
- **Mobile companion:** not applicable; no Ollama surface there and no new protocol messages.

## Guided, never a dead end

Every model/tag/variant choice comes from **real data**: installed models from `/api/tags`,
running models from `/api/ps`, capabilities/context length from `/api/show`, and the published
catalog from Ollama's own library index and registry — never invented, never guessed from a model's
name. Free text is still fully supported and is still the fallback whenever the catalog is
incomplete or unavailable: it is validated (`isValidModelRef`) against the same `name` / `name:tag`
shape Ollama's own CLI accepts, and rejected with a clear message otherwise.

When Ollama itself is missing, stopped, or unreachable, the **Health** tab shows a bundled, fully
offline troubleshooter (`troubleshoot.ts` — no network fetch, so it works even though the thing it's
helping you start is exactly what's unreachable): the platform-appropriate install command, how to
start the service, how to verify it, and a **"I've done this — check again"** button that re-runs
the same status probe. The platform used for the guidance is the one Ollama would actually run on
— the *server's* platform in the Server Edition, not the browser's OS, since that's the machine that
needs `ollama serve` running.

## Hardware fit — evidence, never a promise

`evaluateFit()` (`src/shared/ollama.ts`, pure and unit-testable) returns one of four verdicts:

- **Runs well** — estimated need is comfortably under the available budget.
- **Runs with limits** — estimated need is close to the budget (>75%).
- **Unlikely** — estimated need exceeds the budget, or free disk is less than the model's size
  (the pull itself would fail).
- **Unknown** — evidence is missing. This is the honest default whenever the model's size **and**
  its parameter-count+quantization are both unknown (a model that has never been pulled and that the
  catalog has no published size for either), or when neither VRAM nor total system RAM could be
  detected.

A model that is **not installed** now usually does get a real verdict, because the catalog knows its
published download size (see [Where the catalog comes from](#where-the-catalog-comes-from)). That
size is passed to the same evaluator, with a leading evidence line naming the reference as not
installed and stating whether the number is the exact manifest figure or the library page's rounded
one — `evaluateFit`'s own wording calls the number an on-disk size, which is only true for an
installed model. Nothing is ever inferred from the reference text: no published size still means
`unknown`.

Every verdict carries its `evidence` (the exact numbers it was computed from — on-disk size or the
estimated-from-parameters figure, the RAM/VRAM budget compared against, free disk) and its
`assumptions` (e.g. "size estimated from 7B parameters at ~0.55 bytes/param for Q4_K_M — not the
model's real blob size", "unified/CPU memory is shared with the OS and every other running app").
**A model's name is never consulted for capability** — only these facts. Hardware detection itself
(`hardware.ts`) is equally honest: total/free RAM is always real (`os.totalmem/freemem`); VRAM is
real only when `nvidia-smi` is present and answers (Windows/Linux with an NVIDIA driver) — anywhere
else (AMD/Intel GPUs, Apple Silicon's unified memory, no GPU) it is `null`, and the evaluator falls
back to comparing against total system RAM instead of guessing a number.

## The cart is downloads only — never money

Adding a model schedules a local `ollama pull`. There is no price, purchase, checkout, account,
payment, or subscription anywhere in this surface — the copy in the panel says so explicitly. Before
starting, each item shows its exact reference, its size once Ollama's pull stream reports it, and a
running aggregate estimate that is explicit about how many items still have an unknown size rather
than pretending they are zero. (The cart's own estimate still counts only sizes Ollama's pull stream
has reported; wiring the catalog's published sizes into the *cart* total, as they now are into the
fit verdict, is listed under "Known gaps".)

Pulls run with bounded, configurable parallelism (default 1, up to `OLLAMA_PULL_MAX_CONCURRENCY =
3` — deliberately low; each pull can saturate bandwidth and disk on its own). Progress is
byte-accurate straight from Ollama's own NDJSON pull stream (`completed`/`total`). Durable per-item
state persists to `<userData>/ollama/pulls.json` (the same atomic-write, crash-quarantine discipline
as the converter's queue), so cancel/retry/resume work across app restarts. **Resume is essentially
free**: Ollama's pull is itself content-addressed and resumable — re-issuing a pull for a
partially-downloaded model picks up from whatever blob layers are already on disk, so this app only
needs to call `pull()` again, which `retryItem` does. A failed item never marks the whole batch
green, and never touches (let alone deletes) an already-successfully-installed model.

## Chat

Explicit model choice (installed models only — never a model that isn't actually pulled), an
editable system prompt, and three documented, validated parameters (temperature, top-p, context
window — `OLLAMA_CHAT_DEFAULT_PARAMS`). Responses stream token-by-token over `/api/chat`'s NDJSON
stream; **Stop** aborts the underlying fetch. Sessions persist as one JSON file per session under
`<userData>/ollama/chats/<id>.json`; the list surface, rename, delete (behind a confirm dialog), and
a redacted Markdown/JSON export are all real. Whole-document mutations for one session are
serialized: a send appends its user message, streams outside that short persistence queue, then
re-reads the newest session and merges the assistant reply so a rename made during generation is
not overwritten. A second send for the same session is refused immediately while its generation is
live rather than queued behind it; different sessions may stream concurrently. Delete aborts the
owned generation before its queued unlink, and a late completion cannot resurrect the file. This
ordering is process-local; deployments must not run two server processes against the same data
directory without an external single-writer/locking boundary. **Attachment controls are gated by real, verified
model capability** (`/api/show`'s `capabilities` array — e.g. `"vision"` — where the installed
Ollama build reports one) and stay **visibly disabled**, naming the exact unmet condition: not yet
verified, no verified vision capability, or — honestly — "not implemented in this build yet" once
capability *is* verified, since actually wiring an image picker and multimodal payload was out of
scope this pass (see "Known gaps").

## Distinguishing failure modes

The Health tab and every other surface distinguish, rather than collapsing into one generic error:
Ollama not installed, the service stopped (`ECONNREFUSED`), the API unreachable (timeout/abort), the
API answering but unhealthy (a non-2xx response with a body), and — separately — a pull failure or a
hardware-fit gap for one specific model. Nothing here shows an empty spinner or a generic "try
again" that erases which of these it actually was.

The catalog adds its own set, all of them distinct in both the snapshot and the panel copy: never
fetched, fetched and stale, index fetch failed (previous models retained), one model's tag list
failed (its known tags retained), one tag's manifest failed (its rounded size retained), catalog
lookups switched off by the operator, the on-disk cache unreadable and quarantined, the session
answering with the legacy short list, and the session answering with something unparseable. None of
those is ever rendered as "the catalog is empty".

**"Not installed" and "stopped" both start life as the same refused TCP connection, so telling
them apart needs a second signal.** `client.ts`'s `ping()` reports a `code` alongside the free-text
`detail`; `installation.ts`'s `classifyOllamaHealth(code, detail, checkInstalled)` only calls
`checkInstalled` — `detectOllamaInstalled()`, a synchronous, subprocess-free walk of PATH plus
well-known per-platform install locations (the same reasoning `tmux-hint.ts`'s
`findCommand`/`findFixedTmux` use for tmux: a packaged GUI app's PATH is routinely narrower than an
interactive shell's) — on an actual connection refusal. Found ⇒ `'stopped'`; not found in any
inspected location ⇒ `'not-installed'` (the Health tab's copy says "does not appear to be
installed", never a flat "is not installed", because absence-from-a-few-checked-locations is not
certainty). A timeout/abort never calls the installed-check at all — Ollama is plainly there in
that case, just slow.

**The one Node-specific trap worth recording, because it silently defeated the previous version of
this classifier:** Node's `fetch` collapses every network-level failure's top-level `.message` to
the generic string `"fetch failed"` — the real OS error code (`ECONNREFUSED`) lives one level down,
on `.cause.code`. Text-matching `detail` alone for `"econnrefused"` (what this classifier used to
do) therefore never fired against a real Node 24 fetch to a refused port, and every stopped-or-
never-installed Ollama silently fell through to `'unhealthy'` ("Ollama answered but reported a
problem: fetch failed") — actively wrong, since Ollama never answered at all. `client.ts` now reads
`e.cause.code`/`e.cause.message` (via `toUnreachableError`, used by every fetch call site: `req()`,
`pull()`, `chatStream()`) and carries the real code forward as `OllamaUnreachableError.code`, so
`classifyOllamaHealth` can key off the structured code and only falls back to text-matching as a
second, redundant signal. `client.test.ts` proves this against a genuinely refused loopback
connection rather than a mock, specifically because a mock can only prove the mock matches what its
author believed — which is exactly the belief that was wrong here.

The Health tab's troubleshooter (`troubleshoot.ts`) reads this distinction too: `'stopped'` (real
evidence the binary is already on disk) skips the install step and shows only "start it" +
"verify"; every other non-ok health shows the full install-then-start-then-verify sequence, since a
timeout or a bad response genuinely doesn't tell us whether the binary is there.

## Known gaps (deliberately out of scope this pass)

- **No publish timestamp exists for a catalog-only tag.** Neither the registry manifest endpoint nor
  the library pages expose a machine-readable publish date — the tag page prints a relative "1 year
  ago" and nothing else. Rather than converting that into a fabricated ISO date, `publishedAt` stays
  null for anything not installed. The only real timestamp this field ever carries is an installed
  model's `/api/tags` `modified_at` — i.e. a **local pull/touch date**, not a publish date — so the
  panel labels it as such: an installed row reads `"installed <date>"`, never a bare date that could
  be mistaken for when the model was published; everything else reads `"no published date"`.
- **Most listed sizes are the library page's rounded figures until their manifest is fetched.** They
  are shown with `≈`, and exact byte counts arrive a few hundred per refresh (installed references
  and sizeless tags first). A full exact-size sweep of every tag would be thousands of registry
  requests in one go.
- **The catalog's model/tag enumeration is a scrape.** It is parsed by link target and value shape,
  never by CSS class, and a page that answers 200 with nothing parseable is reported as a format
  error rather than an empty catalog — but a sufficiently large redesign of `ollama.com` will still
  break enumeration, and the opt-in live tests (`NT_OLLAMA_LIVE_CATALOG=1`) are the only thing that
  can catch that. If Ollama ever ships a real enumeration API, `registry-catalog.ts` is the one file
  to change.
- **The catalog rides the existing argument-less `ollama:popular-models` channel.** Three follow-ups
  in files this change did not own: widen `OllamaApi.popularModels()`'s declared return type, add a
  dedicated paged `ollama:catalog` channel (a full snapshot is ~9,000 rows and crosses the bridge
  whole today, and progress is observed by 3 s polling because there is no push event), and add a
  Settings → Ollama toggle for the catalog egress, which is currently only `NT_OLLAMA_NO_REGISTRY`.
- **The cart's aggregate size estimate still ignores the catalog.** The fit evaluator uses published
  sizes now; the cart total still counts only what a running pull has reported.
- **`OLLAMA_POPULAR_MODELS` still exists in `src/shared/ollama.ts` but nothing reads it any more.**
  Deleting it belongs to whoever owns that file next.
- **Image attachments are gated correctly but not implemented.** The control is real, visible, and
  disabled with the true reason at every step; actually sending an image (a file picker, base64
  encoding, wiring it into the `/api/chat` `images` field) is a follow-up.
- **The search boxes are plain substring search**, not the full anchored regex-builder popover.
- **The chat delete confirmation uses the app's existing `ConfirmDialog`**, not the full two-key
  destructive-action super-confirmation slider.
- **Copying a model** (`ollama.copyModel`) is wired end-to-end in the core/IPC/bridge layer but has
  no dedicated UI control yet in the panel.
- **Relay (remote-desktop) tabs do not route the manager to the host.** The visible
  `E_UNSUPPORTED` refusal is intentional until the Ollama core namespace is carried over the relay.
