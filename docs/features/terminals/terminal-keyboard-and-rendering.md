# Terminal keyboard and rendering fixes

A set of small fixes to how a terminal node handles keys and draws itself, ported from upstream.
The key decisions live in `terminalKeyAction` (`src/renderer/terminal/terminal-config.ts`); the
canvas node and the kanban card modal both act on its answer.

## Behavior

- **Cmd/Ctrl+1–9 from a focused terminal.** The jump-to-project chord now bubbles out of the
  terminal to the window dispatcher instead of being cancelled there. The terminal still never
  receives the control byte the chord would otherwise type, and the switch happens from the canvas
  node and from the card modal alike.
- **Ctrl+V pastes on Windows.** xterm turns Ctrl+V into the byte `\x16` and cancels the key event,
  which also suppressed the platform's own paste. On Windows the chord is now left uncancelled, so
  the ordinary paste reaches the terminal with bracketed-paste framing, exactly like ⌘V on macOS.
  Linux and macOS are unchanged: there Ctrl+V is a byte people really send (for example Vim's
  block selection), and Ctrl+Shift+V or ⌘V paste as before.
- **Caps Lock with an input method.** Toggling Caps Lock while an input method composes no longer
  commits the composition twice; the commit is left to the composition's own end event.
- **DOM renderer row spacing after a reattach.** A DOM-rendered terminal built while its node
  was not measurable (parked, or inside a hidden wrapper) measured a zero-width cell and drew an
  extra blank cell between rows. The spacing is re-derived at the first fit after the node becomes
  measurable, and the screen is repainted only when it actually changed.

## Configuration

None. The Windows paste rule follows the platform; the others always apply.

## Failure modes

- A remapped keybinding still wins over the paste rule only when the registry owns the chord.
- If the input-method patch cannot find the xterm internals it expects, it installs nothing and
  the stock behavior remains.

## Security considerations

Paste goes through the platform's normal paste event; no clipboard content is read by the app on
this path.

## Verification

`terminal-config.test.ts` covers the jump bubbling and the Windows-only paste predicate;
`ime-mode-switch.test.ts` and `dom-renderer-spacing.test.ts` cover the two helpers.

## Surfaces

Desktop and Server Edition share the renderer; in a browser the jump chord is usually reserved by
the browser itself. The mobile companion is not applicable.

Ported from upstream `19032d1f`, `90257bdc`, `397c09db`, `24597cbf` and `9e450603`.
