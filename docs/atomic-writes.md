# Atomic writes

**The honest limit first: `renameAtomic` does not make a write reliable. It makes a write that
would have been lost to a passing antivirus scan land instead.** A disk that is full, a directory
that is read-only, or a file some process holds open indefinitely will still fail — loudly, which
is the point. Nothing here protects against a machine losing power between two saves.

Implementation: [`src/core/fs-atomic.ts`](../src/core/fs-atomic.ts). Tests:
`src/core/fs-atomic.test.ts` (behaviour) and `src/core/fs-atomic.guard.test.ts` (the scan).

## What every store does

A store that persists JSON writes a temp file first and renames it over the target, so a reader
sees either the old bytes or the new ones and never a half-written file:

```ts
await fs.writeFile(tmp, JSON.stringify(store), { mode: 0o600 })
await renameAtomic(tmp, target)
```

That is correct on POSIX, where `rename(2)` is atomic and replaces the destination
unconditionally.

## Why the plain version loses data on Windows

`MoveFileEx` fails with a sharing violation — Node reports it as **`EPERM`**, sometimes `EACCES` or
`EBUSY` — whenever the **destination** is open by anyone at that instant. Not held open for long:
opened. The things that open a file the moment you finish writing it are not exotic:

| What | Why it has the file open |
|---|---|
| Windows Defender real-time scanning | scans each newly written file |
| Windows Search indexer | indexes it |
| OneDrive / a backup client | a user profile is usually synced |
| Our own concurrent writers | two saves racing one destination |

So on Windows a routine save could throw and the data was simply lost — intermittently,
unreproducibly, and **more often on the machines that are best protected**. The stores affected
were not peripheral: the user's canvas layout, their settings, their sealed credentials and their
pinned remote devices.

## Why nothing caught it

Twenty-eight files did this, across three spellings — `fs.rename`, `renameSync`, and a `rename`
destructured from `node:fs/promises`. The first version of the guard below knew only the first
spelling and went green over the other eight, among them `atomic-json-store.ts` — a file named for
the thing it was failing to do. Every one of them reads as a correct atomic write, because on the
platform most of this app was written on it *is* one. The only signal anywhere in a 6,000-test
suite was `src/main/remote/approved-devices.test.ts`, whose deliberate two-overlapping-saves case
had been failing on Windows for as long as that store existed and passing everywhere else.

It was nearly written off as contention flake — several genuine timeout-shaped failures in this
repo are exactly that. What settled it was running the one file alone, at `HEAD`, unmodified, and
reading the actual error rather than the summary line.

## What the helper does, and deliberately does not

**Retries the rename, briefly.** Five attempts over about 310 ms. Each attempt is still one
indivisible rename, so retrying cannot tear a write — it only tries the same operation again once
whoever held the destination has let go. Scanner windows are milliseconds, so the first retry
almost always wins; the tail exists for a sync client mid-upload.

**Does not retry forever.** A genuinely locked file must fail. Several callers have contracts that
depend on a failed save being reported as one — `revocation.ts` returns `persisted: false` and the
UI tells the user their revoke did not stick. A save that eventually lands is worth less than an
accurate answer about whether it did.

**Does not retry every error.** `ENOENT` means the temp file is gone, which is a caller bug;
retrying delays a clearer error by a third of a second and then reports the same thing. `ENOSPC`
will not improve by waiting.

**Does not branch on platform.** The retry is a no-op on POSIX, where these codes do not arise from
this operation. Branching would mean the behaviour under test on a developer's Mac was not the
behaviour shipped to a user on Windows.

**Never swallows the final failure.** The last error is rethrown with its original `code`.

## The second bug at the same sites

Independent of the platform question: a **fixed** temp name (always `<file>.tmp`) shared by
concurrent writers. One writer's rename then publishes the other's half-written bytes, or moves the
temp out from under it so the loser fails with a confusing `ENOENT`.

`writeFileAtomic` generates a per-call unique name (`<target>.<pid>.<seq>.tmp`) — the counter makes
it unique within the process, the pid across processes. A store with more than one un-queued writer
needs this as well as the retry; they fix different things.

## The rule, and how it is enforced

> No store publishes a file with a bare `fs.rename`. Use `renameAtomic`, or `writeFileAtomic` if
> the whole temp-write-publish cycle is what you want.

`src/core/fs-atomic.guard.test.ts` scans `src/core`, `src/main` and `src/server` and fails on any
bare rename in all three spellings. It flags a bare `rename`/`renameSync` only when the file
actually imported that name from `fs`: several stores have a `rename()` method of their own (kids
mode, School mode and the Ollama chat store each rename something), and a guard that cries wolf is
a guard somebody deletes. It is a scan rather than a convention because the convention
is unverifiable by reading: a store added next year gets the retry because the test refuses the
alternative, not because its author read this page.

The guard strips comments before matching, so a file may still *discuss* `fs.rename` in the prose
explaining why it no longer calls one. It also asserts it found a source tree at all — a scan that
matches nothing otherwise reports clean, which is the same class of silent failure as the bug.

## Surfaces

| Surface | Status |
|---|---|
| **Desktop** (Electron) | Covered. Windows is the platform this exists for. |
| **Server Edition** | Covered — the helper is in `src/core`, so both shells get it. Its usual host is Linux, where the retry is inert, but a Windows-hosted server gets the same protection. |
| **Mobile companion** | Not applicable. *nodeterm mobile* holds no local stores of its own; it attaches to sessions over the transport protocol. |
