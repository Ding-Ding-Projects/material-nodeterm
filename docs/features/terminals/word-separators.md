# Word separators (double-click selection)

Which characters end a word when you double-click in a terminal.

**Settings → Terminal → Word selection.** The default keeps hyphens, underscores, dots, slashes,
`@`, `~`, `+` and `:` *inside* a word, so a whole identifier, path, package name or `host:port`
selects in one double-click. Reset returns it to that default.

## Why this needed three writers, not one

The obvious implementation — set xterm's `wordSeparator` — is **a no-op for the common case**, and
that is the whole reason this feature has its own document.

tmux owns the mouse in this app, deliberately (see the "tmux owns the mouse" section of
`CLAUDE.md` and the conf header in `src/core/pty-manager.ts`). A double-click in a normal terminal
node is tmux's `select-word`, bound in the generated tmux config, and governed by tmux's own
`word-separators` option — not by xterm's. And **tmux's default is `" -_@"`**: it breaks on hyphen,
underscore *and* at-sign. That default is precisely the reported problem.

So one user-facing setting reaches three writers, all resolving through the single definition in
`src/shared/word-separators.ts`:

| Writer | Where | What it covers |
| --- | --- | --- |
| xterm | `src/renderer/terminal/terminal-config.ts` | the plain-shell fallback (tmux unavailable), and Option/Shift-forced xterm selections |
| local tmux | `src/core/pty-manager.ts` — `tmuxConf()` | the default path on macOS and Linux |
| remote tmux | `src/shared/ssh.ts` — `remoteTmuxConf()` | SSH projects |

If a fourth writer ever appears it imports the same module rather than restating the string.

## When a change takes effect

The **xterm** half applies live, through the same `applyLiveOptions` path every other appearance
setting uses. It is deliberately *not* part of `metricsChanged`: where a word ends moves no glyph,
so re-fitting on it would report a resize to a pty that other viewers may share, for a change that
cannot alter the grid.

The **tmux** half is written into the generated config, which is sourced once per app run, so an
existing session picks the new value up on restart. The setting's own description says so rather
than implying otherwise. This is the same latency `tmuxScrollback` has always had.

## Security

The value is interpolated into a generated tmux config file — and for an SSH project, into one
written onto somebody else's host. It is therefore **re-validated where it is interpolated**, not
merely where it is typed, on the same reasoning that makes `permissionModeFlag` re-check its mode
at the interpolation site: the value originates in hand-editable JSON, and a compile-time type is
not a runtime guarantee about a file a user can edit.

- Control characters are refused outright. A newline would append an attacker-chosen tmux command
  rather than merely misconfigure selection. Tab is the one exception, because it is a legitimate
  separator.
- Values longer than 64 characters, empty strings and non-strings all fall back to the default.
  Falling back rather than throwing is deliberate: a bad setting must degrade to sane behaviour,
  never break every terminal on the canvas.
- `\`, `"`, `$` and backtick are escaped for the generated conf, because tmux expands all four
  inside a double-quoted string.

## What this is not

It is not iTerm2 parity. iTerm2 uses an inverted "word characters" list plus semantic
smart-selection rules that neither xterm nor tmux has. This is closer to iTerm2's *behaviour* than
either upstream default, and claiming more than that would overstate it.

## Three surfaces

- **Desktop** — full.
- **Server Edition** — full. The renderer half and `src/core/pty-manager.ts` are both booted by the
  server, so nothing about this lives in `src/main`.
- **Mobile companion** — not applicable. _nodeterm mobile_ renders through SwiftTerm, which has its
  own word-selection rules and does not read this setting. Raised as a follow-up in that repository
  rather than silently ignored here.

## Verification

- `npx vitest run src/shared/word-separators.test.ts` — 25 tests: the default keeps every
  identifier character inside a word, the fallbacks, and the control-character refusals (written as
  explicit escapes, never literal bytes, so a copy-paste cannot silently turn one into a space).
- `npx vitest run src/core/tmux-conf.test.ts src/shared/ssh.test.ts` — the line actually lands in
  both generated configs, a custom set passes through, and a forged value with an embedded newline
  is refused at the interpolation site.
- Both were watched failing first: deleting the `tmuxWordSeparatorsLine` interpolation from
  `tmuxConf` turns three tests red; restoring it turns them green.
