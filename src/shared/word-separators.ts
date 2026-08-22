/**
 * Which characters end a word when you double-click in a terminal.
 *
 * Upstream issue #349: double-clicking breaks on hyphens, so selecting a full identifier or a URL
 * is impossible. The reporter asked for something closer to iTerm2's smart selection.
 *
 * **The naive fix is a no-op, and that is the whole reason this module exists.** Setting xterm's
 * `wordSeparator` alone changes almost nothing in this app, because tmux owns the mouse by
 * deliberate design (see the "tmux owns the mouse" section of CLAUDE.md and the conf header in
 * `pty-manager.ts`). A double-click is tmux's `select-word`, governed by tmux's own
 * `word-separators` option — and tmux's default is `" -_@"`, which breaks on hyphen, underscore
 * AND at-sign. That default is precisely what the issue is about.
 *
 * So one user-facing setting has to reach three writers, and this module is the single definition
 * all three share:
 *
 *   - xterm            — `terminal-config.ts`, for the plain-shell fallback and forced selections
 *   - local tmux       — `pty-manager.ts` `tmuxConf()`
 *   - remote tmux      — `ssh.ts` `remoteTmuxConf()`
 *
 * If a fourth writer ever appears, it imports from here rather than restating the string.
 */

/**
 * The shipped default: whitespace, brackets and quotes only.
 *
 * Deliberately EXCLUDES `-`, `_`, `.`, `/`, `~`, `+`, `@` and `:` — every one of those is a
 * character that lives *inside* the things people double-click: identifiers (`nodeterm-abc123`),
 * paths (`src/shared/word-separators.ts`), URLs, package names (`@xterm/addon-webgl`) and
 * host:port pairs. Keeping them inside a word is the entire point of the change.
 *
 * This is closer to iTerm2's behaviour than to either upstream default. It is not identical to
 * iTerm2, which uses an inverted "word characters" list plus semantic smart-selection rules that
 * neither xterm nor tmux has; claiming parity would overstate it.
 */
export const DEFAULT_WORD_SEPARATORS = ' \t()[]{}<>\'"`|'

/** Longest value we will accept. A separator set is a handful of punctuation, not a document. */
const MAX_LENGTH = 64

/**
 * Sanitize a user-supplied separator set.
 *
 * Falls back to the default rather than throwing: this value comes from hand-editable settings and
 * a bad one must degrade to sane behaviour, never break every terminal on the canvas.
 *
 * Control characters are refused outright. They cannot usefully be word separators, and this
 * string is interpolated into a generated tmux config file — for an SSH project, one that is
 * written onto somebody else's host — so a newline here would append an attacker-chosen tmux
 * command rather than merely misconfigure selection.
 */
export function resolveWordSeparators(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return DEFAULT_WORD_SEPARATORS
  if (value.length > MAX_LENGTH) return DEFAULT_WORD_SEPARATORS
  // Tab is the one control character that is a legitimate separator, so it is allowed explicitly
  // and everything else below 0x20, plus DEL, is refused.
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (ch !== '\t' && (code < 0x20 || code === 0x7f)) return DEFAULT_WORD_SEPARATORS
  }
  return value
}

/**
 * The `word-separators` line for a generated tmux config.
 *
 * Re-validates rather than trusting its caller. The type says `string`, but the value originates
 * in hand-editable JSON and ends up in a config file on a remote host — the same reasoning that
 * makes `permissionModeFlag` re-check its mode at the interpolation site instead of relying on the
 * compile-time type. A type is not a runtime guarantee about a file a user can edit.
 *
 * Emitted double-quoted with `\`, `"`, `$` and backtick escaped, because tmux performs expansion
 * inside double quotes.
 */
export function tmuxWordSeparatorsLine(value: unknown): string {
  const safe = resolveWordSeparators(value)
  const escaped = safe
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    // A literal tab inside a quoted tmux string is fragile to read and easy to mangle when the
    // conf is copied by hand; \t is unambiguous and tmux understands it.
    .replace(/\t/g, '\\t')
  return `set -g word-separators "${escaped}"`
}
