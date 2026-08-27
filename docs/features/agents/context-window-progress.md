# Context-window progress

Every agent-backed surface shows a context-window meter at the top of the node or session card.
The same meter appears in the canvas node header, session list rows, Kanban cards, and the card
modal. It remains mounted when a node is collapsed, minimized, grouped, restored, or reopened.

## Telemetry sources

The meter uses local transcript telemetry when the provider records a trustworthy input count and
context limit:

| Provider | Source | What is known | Limitation |
| --- | --- | --- | --- |
| Claude | The latest assistant usage record in the local JSONL transcript | Input tokens, model, and the model-family context limit | A session with no usage record stays not reported |
| Codex | The latest `token_count` event in the local rollout | `last_token_usage.input_tokens` and `model_context_window` | A rollout without both finite values cannot produce a percentage |
| Gemini | The latest `tokens.input` record in the local chat transcript | Input tokens and the verified model-family limit | A transcript without a recognized model limit stays unknown |
| Grok, OpenCode, Devin, custom agents, and resumed sessions without a readable transcript | No supported local source yet | The meter stays visible with an unavailable or not-reported state | No number or percentage is estimated |

The first resumed read is bounded. Codex resolution honours `CODEX_HOME`, and Gemini header reads
are capped. Concurrent locator requests for one session are coalesced.

## States and arithmetic

The meter shows exact used tokens, total tokens, remaining tokens, and percent only when the provider
has supplied finite non-negative values for both used and total. It never rounds a missing value into a
percentage.

- **Known** means both token values were received and the percentage is calculated from the raw
  values.
- **Not reported** means the provider session exists but no telemetry has arrived.
- **Unknown** means telemetry arrived but the provider did not state a usable context limit.
- **Stale** means the last known sample is older than the shared two-minute freshness window.
- **Unavailable** means the session or provider cannot supply a local reading.

The display rounds only the visible percent. Warning thresholds use the raw percent: healthy below
60%, warning from 60% through 85%, and critical above 85%. Threshold color is repeated in state text,
ARIA value text, and the detail surface, so color is never the only signal. Thresholds are non-blocking
and never interrupt generation.

## Concurrency and privacy

Every telemetry producer carries a provider source key, a process source epoch, and a monotonic
generation. The renderer rejects older generations only within the same source epoch, so a fresh
process generation 1 sample is accepted after restart. Local and SSH sources are separate keys, so
a same-named session on another host cannot overwrite the local sample.

The renderer persists only a bounded, machine-local cache of the last known numeric sample. Generation
and source-epoch fencing values are deliberately omitted from that cache. Telemetry is not copied into
portable project data, ordinary exports, provider prompts, logs, or captures. A source read failure
keeps the last sample and marks it stale rather than claiming a new value.

## Accessibility and layout

The meter is a real button with a visible focus ring and an anchored details surface. The details
surface is viewport-bounded and scrolls internally. Its progress bar exposes an accessible value text
for known and unknown states, and the exact numeric facts are repeated as text. Narrow layouts grow
the target to a touch-sized control and move the details surface inward. Reduced-motion preferences
disable meter transitions and animations.

## Verification boundary

The ultra-speed implementation lane intentionally did not run tests, lint, type checks, builds,
packaging, debugging, runtime interaction, reviews, security checks, or screen captures. The next
integration lane must run the project's required verification against the exact commit and record
the result here and in the handoff.

## Suggested articles

- [Agent support](./agent-support.md)
- [Linked-agent inbox notifications](./linked-agent-inbox-notifications.md)
- [In-app documentation](../help/in-app-documentation.md)

