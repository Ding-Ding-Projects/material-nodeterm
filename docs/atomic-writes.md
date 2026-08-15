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
suite was `src/main/remote/approved-devices.test.ts`, whose former two-overlapping-saves case had
been failing on Windows for as long as that store existed and passing everywhere else. That store
now also serializes its complete read-modify-write decisions; rename retry remains necessary for
scanners, indexers and independent processes.

It was nearly written off as contention flake — several genuine timeout-shaped failures in this
repo are exactly that. What settled it was running the one file alone, at `HEAD`, unmodified, and
reading the actual error rather than the summary line.

## What the helper does, and deliberately does not

**Retries the rename, briefly.** Five attempts over about 310 ms. Each attempt is still one
indivisible rename, so retrying cannot tear a write — it only tries the same operation again once
whoever held the destination has let go. Scanner windows are milliseconds, so the first retry
almost always wins; the tail exists for a sync client mid-upload.

**Does not serialize application decisions.** Unique temps and rename retry guarantee complete
bytes, not correct ordering between two snapshots loaded before either write. A shared store with
multiple read-modify-write callers still needs one mutation funnel (or an equivalent revision/CAS
protocol). The approved-device store is the reference: approval and revoke enqueue their
`pinDevice` / `unpinDevice` functions, so the later decision reads the result of the earlier one
instead of publishing a stale replacement.

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

`writeFileAtomic` and `tempNameFor` generate a per-call unique name
(`<target>.<pid>.<seq>.<uuid>.tmp`). The UUID is the uniqueness guarantee. PID and sequence remain
because they make ownership/liveness cleanup and diagnostics possible, but they are not globally
unique: containers can both be PID 1, worker isolates share a PID with independent module counters,
and an OS can reuse a PID while crash litter remains.

Five sites had a shared name, and each had a reason it was thought safe — "only one instance
exists", "the write queue serializes this". Every one of those was true within one process and
silent about a second, and a second is not hypothetical: the Server Edition takes a `--data-dir`,
so two servers can be aimed at one directory and a desktop app can share it. `scrollback-store`
had a counter and no pid, which is that gap precisely.

**A unique name owes cleanup.** A fixed name self-healed — the next save simply overwrote the
litter. A unique one does not, so every caller must remove its own temp on failure.
`writeFileAtomic` does that for you; three of the five sites built their own sequence and had no
cleanup at all, so it was added with the rename.

`Date.now()` does **not** make the name unique. Two bridge calls, shutdown flushes, or WS clients can
enter a save inside one millisecond. Nor is pid-plus-counter globally unique across PID namespaces,
worker isolates, or PID reuse. A safe local temp name therefore carries random UUID entropy;
`tempNameFor` supplies it and retains pid/sequence metadata. The guard deliberately rejects
pid-plus-clock and pid-plus-counter names, including the historical
`<file>.tmp-<pid>-<clock>` suffix form rather than scanning only templates that end in `.tmp`.

Cleanup must not reverse the fix. A different pid only means “another process,” not “a dead
process”: desktop multi-instance mode and two `nodeterm-server --data-dir X` processes can share a
directory intentionally. All cross-run collection goes through `sweepStaleTempFiles`, which keeps
fresh files, probes pid-bearing files with signal 0 after a 24-hour grace, and removes only when the
owner pid is no longer visible in this process's namespace (`ESRCH`). That is deliberately not
described as global proof of death: a mounted directory can cross PID namespaces, so the long age
grace remains part of the evidence. `EPERM`/unknown results preserve the file. The legacy fixed
`<file>.tmp` has no owner to probe, so only the same conservative age grace is available. Current
writers still remove their own temp immediately when their write fails.

A credential **Clear** has a stricter reporting contract without a more destructive cleanup
policy. `clearAtomicTarget` removes the canonical file, runs the conservative sweep, then inspects
for every recognized legacy/current temp. It reports incomplete while a young, live, unjudgeable,
or failed-to-delete temp remains (or the directory cannot be inspected), and PAT/cookie/token
callers propagate that failure to the UI/API. A plausible foreign writer is still preserved; the
important distinction is that retained bearer bytes can no longer be reported as a completed
clear. This is a point-in-time result, not a cross-process lock, so a later foreign publisher keeps
the documented last-publisher semantics.

## A unique temp does not order snapshots

Temp uniqueness and publish ordering solve different races. If two calls snapshot a whole in-memory
store, writer A can capture older state, stall during `renameAtomic`'s transient-sharing retry,
writer B can publish newer state, and then A can wake and atomically overwrite it. Nothing is torn;
the final document is simply stale.

Whole-document writers that can overlap therefore need a FIFO publish chain (or a generation check)
in addition to unique temps. `agent-status-mirror.flush` uses FIFO. Its test blocks the first rename,
records a newer state, starts the second flush, and proves the newer generation is final; removing
the queue makes that test deterministically red.

The guard checks the PROPERTY, not the helper: an inline `randomUUID()` path is also correct.

## The rule, and how it is enforced

> No store publishes a file with a bare `fs.rename`. Use `renameAtomic`, or `writeFileAtomic` if
> the whole temp-write-publish cycle is what you want.

`src/core/fs-atomic.guard.test.ts` scans `src/core`, `src/main`, `src/server` and the standalone
`src/session-host`, and fails on any bare rename in all three spellings. The only helpers exempted
are `core/fs-atomic.ts` and `session-host/state-file.ts` (the standalone host cannot import core).
It flags a bare `rename`/`renameSync` only when the file
actually imported that name from `fs`: several stores have a `rename()` method of their own (kids
mode, School mode and the Ollama chat store each rename something), and a guard that cries wolf is
a guard somebody deletes. It is a scan rather than a convention because the convention
is unverifiable by reading: a store added next year gets the retry because the test refuses the
alternative, not because its author read this page.

The temp-name half inventories local Node filesystem `.tmp` templates assigned directly or through
`path.join`. It does not parse generated remote-shell paths or transfer `.part` conventions; those
need behavior gates at their own shell/transport boundary rather than pretending a TypeScript regex
understands the remote program.

The guard strips comments before matching, so a file may still *discuss* `fs.rename` in the prose
explaining why it no longer calls one. It also asserts it found a source tree at all — a scan that
matches nothing otherwise reports clean, which is the same class of silent failure as the bug.

## Surfaces

| Surface | Status |
|---|---|
| **Desktop** (Electron) | Covered. Windows is the platform this exists for. |
| **Server Edition** | Covered — the helper is in `src/core`, so both shells get it. Its usual host is Linux, where the retry is inert, but a Windows-hosted server gets the same protection. |
| **Mobile companion** | Not applicable. *nodeterm mobile* holds no local stores of its own; it attaches to sessions over the transport protocol. |
