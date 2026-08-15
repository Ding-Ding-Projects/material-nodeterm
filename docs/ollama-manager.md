# Local Ollama suite manager

A local manager for [Ollama](https://ollama.com) reachable from the Ollama icon in the canvas'
controls cluster, the command palette ("Ollama manager"), or `⌘K`. It talks **only** to Ollama's
own documented local HTTP API (`http://127.0.0.1:11434` by default, or `$OLLAMA_HOST`) — never an
unofficial proxy, never a cloud model service, and it never claims Ollama can launch arbitrary
programs. Every HTTP call is made by the privileged shell (Electron main / the Server Edition
process), never the renderer directly — the renderer only ever talks to `window.nodeTerminal.ollama`.

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
  pull-queue.ts                the batch-pull "cart" — durable, bounded-concurrency, resumable
  chat-store.ts                local chat session persistence + streaming orchestration
  register-ipc.ts              the ollama:* RPC surface, shared by both shells
src/renderer/components/ollama/
  OllamaManagerPanel.tsx        the whole user-facing panel (Health / Installed / Model store / Chat)
  troubleshoot.ts               bundled, offline per-platform install/start guidance
```

## Guided, never a dead end

Every model/tag/variant choice comes from **real data**: installed models from `/api/tags`,
running models from `/api/ps`, capabilities/context length from `/api/show` — never invented, never
guessed from a model's name. The one place free text is genuinely needed (pulling a model that
isn't installed yet) is validated (`isValidModelRef`) against the same `name` / `name:tag` shape
Ollama's own CLI accepts, and rejected with a clear message otherwise.

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
  its parameter-count+quantization are both unknown (a model that has never been pulled and whose
  registry metadata we have no way to fetch in this pass — see "Known gaps"), or when neither VRAM
  nor total system RAM could be detected.

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
starting, each item shows its exact reference, its size once Ollama's pull stream reports it (sizes
are genuinely unknown before a pull starts unless the model happens to already be installed — this
pass does not scrape Ollama's registry for pre-pull sizes, see "Known gaps"), and a running
aggregate estimate that is explicit about how many items still have an unknown size rather than
pretending they are zero.

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
a redacted Markdown/JSON export are all real. **Attachment controls are gated by real, verified
model capability** (`/api/show`'s `capabilities` array — e.g. `"vision"` — where the installed
Ollama build reports one) and stay **visibly disabled**, naming the exact unmet condition: not yet
verified, no verified vision capability, or — honestly — "not implemented in this build yet" once
capability *is* verified, since actually wiring an image picker and multimodal payload was out of
scope this pass (see "Known gaps").

## Distinguishing failure modes

The Health tab and every other surface distinguish, rather than collapsing into one generic error:
Ollama not installed, the service stopped (`ECONNREFUSED`), the API unreachable (timeout/abort), the
API answering but unhealthy (a non-2xx response with a body), a stale/offline model catalog, and —
separately — a pull failure or a hardware-fit gap for one specific model. Nothing here shows an
empty spinner or a generic "try again" that erases which of these it actually was.

## Known gaps (deliberately out of scope this pass)

- **The Model Store is a small curated list (`OLLAMA_POPULAR_MODELS`), not an exhaustive, paginated,
  revision-tracked mirror of Ollama's official model catalog.** The full house contract asks for
  every model and every published tag, refreshed and timestamped. Ollama does not expose a simple,
  stable JSON "list every model" endpoint the way `/api/tags` lists *installed* models — building
  a real exhaustive catalog means scraping/parsing `ollama.com/library`'s pages (or a future stable
  API), with pagination, revision tracking and offline caching, which is a substantial follow-up
  project of its own. The panel is explicit in its copy that this list is *not* exhaustive and that
  free-text entry (validated) is the real way to reach any model.
- **Pre-pull size/parameter/quantization is unknown for anything not already installed**, since it
  is not scraped from the registry — this is exactly why so many Model Store fit badges read
  "Unknown" until the model has actually been pulled once. Once the exhaustive-catalog gap above is
  closed, per-variant size/quant metadata from that catalog would let the fit evaluator (and the
  cart's size estimate) be accurate before a single byte is downloaded.
- **Image attachments are gated correctly but not implemented.** The control is real, visible, and
  disabled with the true reason at every step; actually sending an image (a file picker, base64
  encoding, wiring it into the `/api/chat` `images` field) is a follow-up.
- **The search boxes are plain substring search**, not the full anchored regex-builder popover.
- **The chat delete confirmation uses the app's existing `ConfirmDialog`**, not the full two-key
  destructive-action super-confirmation slider.
- **Copying a model** (`ollama.copyModel`) is wired end-to-end in the core/IPC/bridge layer but has
  no dedicated UI control yet in the panel.
- **Relay (remote-desktop) tabs do not route the manager to the host** — same reasoning and same
  `E_UNSUPPORTED` degrade as the file converter.
- **Mobile companion**: not applicable — *nodeterm mobile* has no local-process management surface;
  this is a desktop/Server-Edition feature.
