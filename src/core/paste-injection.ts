// Injected prompts (context-link notes, note pushes, slash commands, dictation insert) are
// delivered through `tmux send-keys`. Sending the text and the Enter as two separate keystroke
// writes races the receiving TUI's paste heuristics: a composer that treats a rapid unmarked
// burst as a paste can absorb an Enter arriving milliseconds behind it as pasted content
// instead of a submit — observed with Claude Code hosted inside the herdr multiplexer (#47),
// whose input pipeline re-chunks the byte stream. When the target application has REQUESTED
// bracketed-paste mode (tmux tracks this per pane as `bracket_paste_flag`), deliver the
// injection the way paste-aware apps expect: the text framed in paste markers and the Enter
// appended in the SAME write, so the composer sees a definitive paste boundary and the Enter
// can never be re-chunked into the paste. Apps that never requested bracketed paste keep the
// legacy two-step delivery.
//
// MAINTENANCE — this file is a deliberately vendored duplicate.
// The canonical implementation lives in `agent-whip/packages/paste-frame/src/index.ts`
// (a sibling checkout, not a dependency of this repo). It was copied rather than shared
// because material-nodeterm is a public repository and `agent-whip` is not published to any
// registry, so a `file:`-protocol or path dependency would resolve on the machine that made
// the copy and dangle for everyone else who clones this repo on its own.
//
// This is a mitigation, not the fix. `scripts/check-paste-frame-parity.mjs` (wired into
// `npm run typecheck`) compares this file's normative content against agent-whip's copy
// whenever that sibling checkout is present, and fails loudly the moment the two disagree.
// The real fix is publishing `@agent-whip/paste-frame` to a registry once rights exist, at
// which point this file is deleted and both projects depend on the one package.
export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'

/**
 * SECURITY — the payload must not be able to become structure.
 *
 * A frame built as `ESC[200~ + text + ESC[201~` promises the receiving app that everything
 * between the markers is CONTENT. A payload that itself contains `ESC[201~` breaks that promise:
 * the app ends the paste early and reads the rest as raw KEY INPUT — Enter, ctrl-u, ctrl-c, any
 * escape sequence the author chose. That is not only a human pasting a terminal transcript; the
 * canvas-control `write` verb hands an AGENT's text to the same framer, and the confirm dialog a
 * human approves it in renders ESC as nothing at all, so the escape is invisible to the approver.
 * The same shape is live in the herdr multiplexer (`api_helpers.rs`), so treat it as real. A
 * payload loaded from a file on disk reaches the same framer in agent-whip, which is the same
 * risk one level removed: whichever caller hands text to this framer, the guarantee must hold.
 *
 * The rule is one line and it removes ESC (and its 8-bit C1 equivalent U+009B), not the marker
 * string:
 *
 *  - Removing the literal `ESC[201~` only would leave `ESC[200~` (a second paste-start, which
 *    re-opens or nests the frame in apps that track a boolean) and a payload ending in a bare
 *    `ESC` (which a lenient parser can join with the marker's own ESC that follows it) still
 *    live. All three fall out of the one rule, and no fourth trick has to be enumerated: with
 *    zero ESC bytes in the payload, no byte of it can express paste structure at all.
 *  - It is not lossy the way dropping the marker string is. ESC has no glyph; every printable
 *    character of the payload survives, in order. A pasted transcript that documents bracketed
 *    paste still reads as `[201~` — which is what real terminals do with clipboard content
 *    (xterm's `disallowedPasteControls`, VTE) rather than an invention of ours.
 *  - Splitting and re-framing around the marker was rejected: emitting the literal `ESC[201~`
 *    *outside* a frame is the injection, just performed by us.
 *  - Refusing the write was rejected for the callers that matter: `sendText` answers a boolean,
 *    so a refused note push or dictation insert — the two payloads most likely to carry a real
 *    transcript — would fail silently, and the sequence appears in legitimate text.
 *
 * Applied to the legacy (non-bracketed) delivery too, so `sendText`'s contract does not depend on
 * a runtime probe of the receiver: the same payload must land as content whichever way it is
 * delivered. Nothing nodeterm sends through `sendText` — slash commands, note pushes, dictation
 * transcripts, launch commands, chat messages — carries ESC on purpose, so in practice this
 * changes no byte anyone was sending.
 *
 * NOT in scope, and still open: a payload carrying `\r`/`\n` into a caller that believed it was
 * sending ONE line (`/rename <title>` built from an agent-supplied title). Newlines are legitimate
 * paste CONTENT — the multiline injection the tests pin depends on it — so that belongs at those
 * call sites, not here. agent-whip's profile validator is one such call site and rejects
 * multiline payloads there.
 */
export function sanitizePasteText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x1b\u009b]/g, '')
}

/** The single-write injection body for a bracketed-paste-aware target. */
export function bracketedInjection(text: string, enter: boolean): string {
  return PASTE_START + sanitizePasteText(text) + PASTE_END + (enter ? '\r' : '')
}

/**
 * The legacy two-step body, for a target that never requested bracketed paste. Returned as a pair
 * rather than a single string so a caller cannot accidentally concatenate them into one write and
 * believe it has bracketed-paste safety it does not have.
 */
export function legacyInjection(text: string, enter: boolean): { text: string; enter: string } {
  return { text: sanitizePasteText(text), enter: enter ? '\r' : '' }
}
