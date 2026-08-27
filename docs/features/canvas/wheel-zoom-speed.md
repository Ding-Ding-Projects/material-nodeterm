# Bounded wheel zoom and speed

**Category:** [Canvas](./README.md)

The canvas can zoom from a plain wheel when **Scroll wheel zooms** is enabled. This article
describes the bounded burst behavior and the persisted speed control shared by Desktop and Server
Edition.

## Behaviour

High-resolution ratchet wheels can deliver one physical detent as several pixel-mode packets a
few milliseconds apart. The renderer uses one `WheelZoomBurstLimiter` for the capture-phase wheel
listener. Every packet inside a 40 ms burst spends from one shared ±50 `deltaY` budget, so packets
cannot compound several full zoom steps. A packet arriving after the window starts a fresh budget.
If a burst is already exhausted, a reversal returns no free counter-step because that movement is
treated as device jitter.

The speed multiplier is applied only to plain-wheel zoom. Cmd/Ctrl+wheel and trackpad pinch keep
the historical fixed exponent. A speed of 1.0× therefore preserves the previous feel exactly,
while 0.2× through 2.0× lets the user make plain-wheel movement gentler or stronger.

## Configuration

Open **Settings → Behavior** and enable **Scroll wheel zooms**. The **Wheel zoom speed** slider
appears directly below it, with a 0.2× minimum, a 2.0× maximum, 0.1× steps, and a persisted 1.0×
default. The setting uses the app's language mode and independent funny-level controls. Its
provenance line identifies the compiled-in default, the saved settings value, or a temporary
scheduled value while keeping the numeric multiplier factual. The copy consumes the shared funny-
level 1–10 types and catalogue; this feature defines no local funny-level range.

The setting is part of the shared `Settings` record. Desktop and Server Edition load and save the
same shape through their existing settings bridges, so a saved value survives restart and the
renderer behavior is identical on both surfaces. The mobile companion has no wheel input.

## Failure modes

The settings file is hand-editable. A missing, non-finite, or non-numeric speed is treated as the
historical 1.0× value. A finite value below 0.2 is clamped to 0.2, and a value above 2 is clamped
to 2. Clamping happens where the canvas consumes the value, rather than rewriting the file while
reading it. This keeps recovery inspectable and prevents malformed settings from producing an
unbounded zoom exponent.

The burst budget is local to the mounted canvas wheel listener. Remounting the canvas starts a new
burst window, and a timestamp gap of at least 40 ms refills the budget. The limiter never changes
the scroll behavior of native `.nowheel` surfaces, which retain their own scrolling.

## Security and privacy

The multiplier is ordinary local settings data. It contains no credentials, paths, session data,
network values, or user content. Wheel packets are consumed in the renderer and are not sent over a
network or written to telemetry. The Server Edition receives only the same bounded settings value;
it does not receive raw wheel events.

## Verification

The source lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, audits, or UI captures. The owning integration lane should verify the pure
limiter with a single oversized packet, a multi-packet high-resolution detent, a split-budget
burst, a post-window refill, a reversal after exhaustion, and a small smooth pinch stream. It
should also verify speed values at 0.2×, 1.0×, and 2.0×, malformed hand-edited values, persistence
after reload, and unchanged modifier/pinch behavior in the built Desktop and Server Edition
surfaces.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md) — canvas input, persistence, and memory
  behavior.
- [Projects and tabs](../projects/projects-and-tabs.md) — how each canvas viewport is stored and
  restored.
- [Language modes](../../language-modes.md) — the language and funny-level behavior used by the
  settings control.
