# Dictation

**Category:** [Speech](./README.md)

Voice-to-text input for any terminal or agent node, transcribed entirely on-device with
[Whisper](https://github.com/openai/whisper) — nothing you say is ever sent off your machine.

## Behaviour

Hold the dictation chord (or tap the dock's mic icon), speak, and an overlay shows the live
transcription as it becomes available. Nothing auto-submits: you always get **Send** (appends
the text and presses Enter, as if you'd typed and submitted it) and **Insert** (drops the text
into the terminal without submitting, so you can keep editing it) as two distinct, deliberate
actions.

Transcription runs against a locally downloaded Whisper model. The smallest model tier is free
and always available; larger, more accurate tiers are a paid feature. Only one model is kept
loaded in memory at a time, loaded lazily on first use.

Model downloads publish atomically: each store instance writes an exclusively-reserved
`<model>.part.<store-id>.<part-id>` and renames it only after the stream closes. The model directory
can be shared by a desktop app, Server Edition, or containers, so cleanup removes an inactive part
owned by the current store immediately but preserves another store's part until it has not been
modified for 24 hours. A second process may duplicate the network transfer, but it cannot unlink a
live first process's fragment; both completed downloads contain the same model bytes.

This works identically on the desktop app and in the browser (Server Edition) — the audio
capture path differs (a native microphone prompt on desktop, the browser's own
`getUserMedia` permission prompt in a browser), but the transcription and terminal-delivery
behaviour is the same either way.

## Configuration

- **Settings → Speech** — which model tier to use, and (Pro tiers) triggers the model download.
- The dictation chord itself is one of the app's standard keyboard shortcuts; see the
  shortcuts panel (`⌘/`) for the exact binding on your platform.

## Failure modes

- **No microphone permission granted**: dictation shows a clear consent/permission prompt
  rather than silently capturing nothing; on the browser, this is the browser's own
  permission UI, which nodeterm doesn't (and can't) bypass.
- **Model not yet downloaded**: the first use of a given tier triggers a visible download with
  progress, rather than failing silently or blocking indefinitely.
- **Browser without HTTPS/localhost**: browser microphone access requires a secure context —
  running Server Edition over plain HTTP on a non-localhost address will have the browser
  itself refuse the permission prompt; this is a browser platform constraint, not something
  nodeterm can work around.

## Security considerations

- Transcription happens entirely on the machine running nodeterm (desktop, or the Server
  Edition host) — no audio or transcript is sent to a third-party transcription API.
- Nothing dictation produces is ever auto-submitted to a terminal; **Send** and **Insert** are
  both explicit user actions, which matters specifically for a shell where an accidentally
  submitted command could do something irreversible.
- Downloaded models are cached under the app's own data directory (or, for Server Edition,
  the server's data directory, shared across sessions), never a location a project's own
  repository would pick up and commit.
- Partial model names use independent cryptographic store/download identifiers and exclusive file
  creation, so even a repeated candidate cannot truncate an existing fragment. Cross-owner cleanup
  is age-gated; a failed metadata read preserves the fragment rather than guessing that its writer
  is dead.

## Verification

- Hold the dictation chord over a plain terminal node, say a short sentence, and confirm the
  overlay shows the transcribed text before you choose Send or Insert.
- Use Insert, confirm the text lands in the terminal without a newline being submitted, then
  edit it and submit manually.
- On Server Edition, load the page over `http://` on a non-localhost address and confirm the
  browser itself blocks the microphone prompt (expected browser behaviour, not a nodeterm bug).

## Suggested articles

- [Node kinds](../canvas/node-kinds.md) — the terminal/agent nodes dictation writes into.
- [Kanban board](../kanban/kanban-board.md) — dictation is also available inside a card modal.
- [Server Edition](../remote/server-edition.md) — the browser-hosted surface this feature also
  runs on.
