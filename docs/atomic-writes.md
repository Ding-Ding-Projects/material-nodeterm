# Atomic writes

**The honest limit first: `renameAtomic` does not make a write reliable. It makes a write that
would have been lost to a passing antivirus scan land instead.** A disk that is full, a directory
that is read-only, or a file some process holds open indefinitely will still fail — loudly, which
is the point. Nothing here protects against a machine losing power between two saves.

Implementations: [`src/core/fs-atomic.ts`](../src/core/fs-atomic.ts) for publication and
[`src/core/fs-transaction-lock.ts`](../src/core/fs-transaction-lock.ts) for cross-process
read/modify/write transactions. Tests: `src/core/fs-atomic.test.ts` (behaviour),
`src/core/fs-atomic.guard.test.ts` (the scan), and
`src/core/fs-transaction-lock.process.test.ts` (real two-process barriers and crash recovery).

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

Remote-shell writes use the equivalent property with a locally minted random UUID; the remote host
never has to interpolate a nonce.

The same rule applies to SSH and scp staging even though those writes do not call `fs.writeFile`.
`remoteAtomicWrite` mints a bounded `.nodeterm-<uuid>.tmp` sibling before quoting both complete
remote paths, so spaces, apostrophes, literal POSIX backslashes and `~/` expansion keep their
meanings. The bounded leaf is independent of the target: appending `.uuid.tmp` to a valid
`NAME_MAX` filename would exceed the directory's component limit. It preserves the `cat`/`mv`
status while removing exactly that invocation's temp. Uploads likewise use UUID directories rather
than a timestamp plus a per-manager counter, and failed uploads remove only their own directory.
Downloads and media-cache fetches stage through hidden UUID `.part` paths beside the target; the
bounded name avoids lengthening an already maximum-length filename. Ordinary downloads also
reserve the final candidate with an exclusive lock, so two app processes cannot both observe
`report.pdf` as absent and overwrite each other after transferring. Candidate checks use `lstat`:
a dangling symlink is an occupied directory entry, not evidence that the name is free. Atomic
remote stdin sites use
the same helper for filesystem writes, tmux.conf, the credential-bearing hook endpoint and node
tokens, agent status, and pending answers. Generated hook scripts/config merges still have direct
writes and are not covered by this atomicity claim.

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
directory intentionally, including across PID namespaces. `sweepStaleTempFiles` therefore never
auto-deletes any PID-bearing temp. Signal-0/`ESRCH` is namespace-local evidence and cannot prove a
foreign writer is dead. Only the exact historical ownerless `<file>.tmp` shape can be swept after
the conservative 24-hour grace. Current writers remove their own UUID temp immediately when their
write fails; an arbitrary dot-free suffix is not recognized as a current UUID temp.

A credential **Clear** has a stricter reporting contract without a more destructive cleanup
policy. `clearAtomicTarget` removes the canonical file, runs the conservative sweep, inspects for
every recognized legacy/current temp, and finally rechecks the canonical path. It reports
incomplete while a live or failed-to-delete temp remains, the directory cannot be inspected, or a
writer republishes during inspection. PAT/cookie/token callers propagate that failure to the
UI/API. A plausible foreign writer is still preserved; retained bearer bytes can no longer be
reported as a completed clear. Credential stores call this while holding their SQLite transaction,
so another supported process cannot publish between removal, inspection, the final recheck, and
transaction completion.

## A unique temp does not order snapshots

Temp uniqueness and publish ordering solve different races. If two calls snapshot a whole in-memory
store, writer A can capture older state, stall during `renameAtomic`'s transient-sharing retry,
writer B can publish newer state, and then A can wake and atomically overwrite it. Nothing is torn;
the final document is simply stale.

Whole-document writers that can overlap therefore need a FIFO publish chain (or a generation check)
in addition to unique temps. A FIFO is sufficient only when every writer lives in one process.
`agent-status-mirror` is intentionally shared by desktop multi-instance mode and by Server Edition
processes pointed at the same data directory, so two writers also have two independent queues.

The mirror uses a durable two-phase generation protocol in `src/core/mirror-publication.ts`:

This protocol requires the unflagged `node:sqlite` capability. The supported runtime is
`^22.22.2 || ^24.15.0 || >=26.0.0`; Desktop and Server Edition check the version and real `DatabaseSync`
capability before starting services, while the installer and pinned container image enforce the
same boundary. The production module loads SQLite lazily so an incompatible runtime reaches that
diagnostic instead of failing during static dependency evaluation.

1. Briefly acquire an OS-backed SQLite `BEGIN IMMEDIATE` transaction on
   `agent-status.json.publication.sqlite3` and atomically advance
   `agent-status.json.generation`. The number is reserved **before** the process snapshots its
   in-memory mirror. Gaps are valid when a process crashes after reservation.
2. Write that generation's complete document to its own UUID temp without holding the transaction.
3. Reacquire the transaction, read the canonical document's generation, and publish only when it is
   still lower. The bounded Windows rename retry runs inside this final critical section.

The optional `generation` field is additive to the existing v1 document; an older v1 file has
generation zero and older readers ignore the new key. The sidecar write, sidecar read and canonical
read are all part of the ordering proof: malformed or unreadable data fails the local disk flush
instead of being treated as zero, while the live `onMirrorFlush` side-channel still fires. The next
successful flush reserves a later number and retries from current memory.

Only SQLite's `SQLITE_BUSY` contention result is retried, with a bounded wait. Exhausting that wait
abandons this best-effort flush instead of stealing the lock: a live process paused for an arbitrary
time still owns its transaction. An abrupt process exit closes its database handle in the OS and
therefore releases the lock immediately; there is no stale threshold, heartbeat, or lock-directory
cleanup that can fence incorrectly. A missing/inaccessible parent or corrupt lock database keeps
the established immediate best-effort failure. The lock target resolves the parent directory even
before `agent-status.json` exists, so symlink aliases of one data directory do not create separate
locks. Generation-aware peers are the supported sharing contract during a release; a pre-generation
binary does not know the transaction or field and must not be left running against the same
directory during an upgrade.

The generation reservation is the protocol's linearization point, not the JavaScript call's
wall-clock start. It orders complete publication attempts and rejects a lower generation that wakes
after a higher one; it intentionally does not merge independently disagreeing in-memory stores or
guess which one is semantically fresher. A process that reserves later is a later writer under this
contract, so every caller remains responsible for flushing its current authoritative state.

The behavior test bundles and runs two real Node processes. Generation 1 is parked after writing its
complete temp, generation 2 publishes, and only then is generation 1 released; the canonical file
must remain generation 2. Removing the final generation comparison makes that test deterministically
red. A second process test starts a peer while a live owner holds the real SQLite transaction,
proves it cannot publish, aborts the owner without JS cleanup, and proves the waiting peer
immediately acquires and publishes.

## Credential transactions hold the lock across the strict read

The mirror deliberately writes its complete temp outside the short generation transaction.
Credential documents have a different contract: Desktop and Server Edition may share one data
directory, and their read → mutation → publish/clear/prune decision must be indivisible.
`withCrossProcessLock` holds SQLite's kernel-backed `BEGIN IMMEDIATE` transaction across that whole
decision. A process-local FIFO still preserves invocation order and queue recovery in one process,
but it is not the cross-process proof.

A suspended writer keeps the OS lock and process death releases it. There is no timestamp lease,
PID probe, stale-owner deletion, or successor fence that a resumed old writer can bypass. Only
SQLite busy contention is retried, using a monotonic bounded deadline; exhaustion fails with
`lock-timeout`. The lock rendezvous realpaths the existing parent and canonicalizes the basename so
directory symlink/junction aliases converge on one physical resource. A corrupt, unreadable, or
unsupported sidecar remains untouched evidence and fails closed with `lock-evidence-unreadable`.

Every supported writer enqueues before its strict read and retains the same turn through mutation
and publication. `readAtomicFileSnapshot` treats only `ENOENT` as absent. Publication compares the
exact SHA-256 revision read inside the transaction before rename, rejecting an out-of-protocol edit
already visible at publication time. This is not rolling-downgrade compatibility: an older binary
that ignores the transaction must not share the directory.

`SecureStore.mutate` applies the physical-file-global rule across independent instances and
processes. Corrupt/unreadable input, duplicate IDs, and non-v4 IDs reject instead of becoming an
empty credential list; `save()` validates the same schema before publishing. Scheduled Home
Assistant set, clear, alternate-format cleanup, and orphan prune operations share one
directory-wide transaction. Provider cookies, shared-mode credentials, and Desktop/Server GitHub
token stores preserve the same strict-read evidence. GitHub Save also enters a controller-local
FIFO before network validation so a later Clear in that controller cannot finish first and be
resurrected. Separate processes have no shared pre-validation invocation clock; their durable
mutations are ordered when they enter the SQLite transaction.

The process Chut runs real bundled peers and proves a second writer cannot read a stale snapshot,
crash-released ownership, bounded busy timeout, local queue recovery, physical-directory alias
convergence, and exact preservation of corrupt sidecar bytes. Temporarily replacing
`BEGIN IMMEDIATE` with `BEGIN` makes the two-process barrier red.

The guard checks the temp-name PROPERTY, not the helper: an inline `randomUUID()` path is also
correct. Publication ordering is behavior-tested separately because a source-text scan cannot prove
which snapshot wins.

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
typed/multiline `path.join` calls, plus fixed string-concatenated temp paths. It does not parse
generated remote-shell paths or transfer `.part` conventions; those
need behavior gates at their own shell/transport boundary rather than pretending a TypeScript regex
understands the remote program.

The guard strips comments before matching, so a file may still *discuss* `fs.rename` in the prose
explaining why it no longer calls one. It also asserts it found a source tree at all — a scan that
matches nothing otherwise reports clean, which is the same class of silent failure as the bug.

## Surfaces

| Surface | Status |
|---|---|
| **Desktop** (Electron) | Covered. Windows is the platform this exists for. |
| **Server Edition** | Covered for core stores — the helper is in `src/core`, so both shells get it. Its usual host is Linux, where the retry is inert, but a Windows-hosted server gets the same protection. The ControlMaster/scp manager is desktop-only. |
| **Mobile companion** | No client change. It holds no local stores of its own, but the agent-status mirror it reads from an SSH host now arrives through the unique remote temp path. The transport shape is unchanged. |
