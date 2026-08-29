# The paste-frame duplicate (`src/core/paste-injection.ts`)

`src/core/paste-injection.ts` is a **deliberate, vendored duplicate** of
`agent-whip/packages/paste-frame/src/index.ts` (a sibling repository, not a dependency of this
one). It implements the bracketed-paste framer that keeps an injected payload from becoming raw
key input in the receiving TUI — see the file's own header comment for the full security
rationale.

## Why it is a copy and not a shared dependency

This repository is **public**. `@agent-whip/paste-frame` is **not published to any registry**.

A `file:`-protocol (or path/git) dependency pointing at a sibling checkout resolves correctly on
the machine that authors it and **dangles for everyone else**: `npm install` reports success (a
symlink is created to a path that does not exist on their machine), and the first `import` at
runtime fails with a confusing `ERR_MODULE_NOT_FOUND` pointing at a path the user never had any
reason to know about. That is a worse failure mode than the duplication it would remove — install
green, runtime broken, with no signal at the point where the mistake was made.

So the implementation is vendored here as a real file instead. **This is a mitigation, not the
fix.** It does not remove the duplication; it makes the duplication loud instead of silent.

## The drift guard

`scripts/check-paste-frame-parity.mjs`, wired into `npm run typecheck`, compares this file's
normative content (comments, semicolons, and blank lines stripped) against agent-whip's copy
**whenever the sibling `agent-whip` checkout is present** next to this repository. It:

- **passes** when the two implementations agree after normalization;
- **fails loudly**, printing both paths and the first differing normalized line, when they
  disagree;
- **skips cleanly**, printing why, when the sibling checkout is absent — so a standalone clone of
  this repository still builds. This is the common case for anyone who is not actively developing
  both projects side by side.

## The real fix

Publish `@agent-whip/paste-frame` to a registry once rights exist, then have this repository
depend on the published package and delete `src/core/paste-injection.ts` and the drift guard.
Until then, any change to the sanitizer must land in **both** files, and the guard exists so that
forgetting one is a failing check rather than a silent divergence.
