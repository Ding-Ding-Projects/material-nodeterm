# WSL instances

A group frame on the canvas can be **bound to a WSL distribution**. Every terminal created inside
that frame opens in that distribution, which makes "one agent per Linux environment" the same
gesture as "one frame per environment" — the same shape the worktree binding already uses.

Creating a new instance is one canvas transaction: after `wsl.exe` confirms the instance, the
renderer publishes the bound group first and one selected terminal child in the same state update.
The child uses bounded in-frame geometry, the active project's cwd, and the exact distribution
profile id. A saved WSL frame from an older version with no child is not auto-spawned during load.
Instead, its header exposes **Open terminal**, which performs the same live revalidation and creates
one child only after the user asks. If the distribution or its profile cannot be revalidated, the
action stays closed and reports the unavailable reason rather than falling back to another shell.

## The one rule that matters

**nodeterm never sleeps, wakes, or deletes a distribution it did not create.**

Your own distributions are visible, and a terminal can be opened in them like any other shell.
What is refused is every action that *changes* one: terminate, start, unregister. A machine
routinely carries distributions that have nothing to do with this app — Docker Desktop installs
`docker-desktop`, and a developer's own `Ubuntu` may predate the feature by years.

Ownership is recorded **durably at creation time**, in a machine-local ledger, and is never
inferred from a name, an age, a prefix or a naming convention. A distribution called
`nodeterm-anything` is still not ours unless the ledger says so, because anyone can name a
distribution anything. Unknown or unreadable ownership state **refuses**; it is never read as
permission.

That rule is enforced twice, independently:

- the canvas will not **offer** sleep/wake/delete for a distribution the ledger does not claim;
- the core will not **perform** one, and issues no command at all when it refuses.

The second is not redundancy for its own sake. The first can be bypassed — a stale snapshot, a new
call site that forgets the gate, a message that skips the UI entirely — and the second is what
holds when it is.

## Where a binding lives, and why it proves nothing

`.nodeterm/project.json` travels with git, so a cloned repository hands your machine a canvas
somebody else wrote. A frame in it can claim to be bound to any distribution name at all,
including one that really exists here.

So the binding is **content, not authority**: it says which distribution this frame *wants*, and
nothing more. Before it is used for anything it is re-validated against a fresh enumeration of the
machine's real distributions, and ownership is asked for separately. A binding naming a
distribution that no longer exists, or never existed here, is exactly as untrustworthy as a
directly forged one.

## Deleting

Deletion is irreversible and takes the distribution's whole filesystem with it, so it sits behind
three independent gates: an explicit confirmation flag the type system will not let a computed
value satisfy, the distribution's name typed back by hand, and a fresh ownership check.

## Failure is never silence

If distributions cannot be enumerated, the app says so and shows the reason. It does **not** show
an empty list — "we could not look" and "there is nothing here" are different sentences, and the
second one is invisible once it has been rendered as the first: a name that really does collide
would look free, and a live bound frame would look gone.

The dialog keeps one hand-written copy inventory in `src/renderer/wsl/wslCopy.ts`. Each rendered
label, status, validation message, and progress explanation names its catalogue id and English
fallback exactly once. The coverage check compares that inventory with the WSL catalogue entries,
their ten English and Cantonese levels, and the dialog's use sites, so removing a row is a visible
failure rather than a silently smaller check. Its negative regression removes the first parsed row
by exact key, catalogue id, and fallback after normalizing CRLF or LF line boundaries, then asserts
that the source changed and that the row is absent. Authored copy is passed through the local vocabulary
mapper. Runtime facts from `wsl.exe`, distribution names, instance names, and operation ids are
typed separately and remain byte-for-byte intact while vocabulary replacements may apply to the
authored text around them. The host progress channel sends a phase id plus bounded placeholder
facts, never an already-rendered English sentence, and the renderer localizes it at the active
language and funny level. Catalogue failures likewise carry a typed code, an authored template id,
and exact executable or parser facts, so a failed read cannot become an empty catalogue or a
rewritten diagnostic. School mode disables the mapper and restores the shipped wording.

## Creating an instance

The **New WSL instance** surface is a guided Material Design 3 dialog. It loads the live online
catalogue into a searchable listbox, keeps the exact distribution name in the selected row, and
validates the new local name before enabling **Create instance**. The distribution selector and
the name field are separate from the Linux ISO VM installer, which uses QEMU and has a different
lifecycle.

Creation is an observable, cancellable operation rather than a promise hidden behind a spinner.
The dialog reports validation, availability checking, installation, ownership recording, and
completion as a bounded four-step phase indicator with elapsed time. Installation is explicitly
indeterminate because `wsl.exe` provides no byte or percentage telemetry. While the operation is active,
the submit control is disabled and the handler rejects a duplicate operation id. **Cancel** sends
that id to the local service, which aborts the child process and returns a cancellation result;
the service also fences progress by operation id so a late result cannot repaint a newer dialog.
If cancellation arrives after `wsl.exe` has finished but before the ownership record is complete,
the result says that the instance was created and no canvas frame was bound, because the app does
not unregister a distribution as a cancellation side effect.
Operation ids use the UUID v4 shape emitted by `crypto.randomUUID()`; another UUID version is
rejected at the core boundary rather than entering the cancellation map.
Timeouts remain bounded by the WSL command deadline, and failures stay in the dialog with an
actionable retry path. The progress surface respects reduced motion and exposes status and
progressbar roles for keyboard and assistive-technology users.

Every dialog label, action, validation message, status, accessibility name, and progress heading
resolves through the shared `wsl.create.*` catalogue ids. The catalogue stores templates with
placeholders such as `{brand}` and `{exe}`; the dialog fills those placeholders only after the
personal-vocabulary mapping has run. This keeps machine facts such as distribution names,
instance names, paths, operation ids, `wsl.exe` output, and parser details verbatim while still
allowing the user-supplied vocabulary to rename authored wording. Incoming catalogue and service
errors are displayed as authored prefixes plus the original factual detail. School mode disables
the optional vocabulary layer and restores the shipped copy live.

The validation phase uses `wsl.create.progress.validating`. Its first English and Cantonese
variants are the factual fallback, while the remaining variants add bounded voice changes without
changing the selected distribution, instance name, or operation state. Bilingual mode resolves the
same phase through both language arrays, with English primary and Cantonese secondary copy.

## Surfaces

| | |
| --- | --- |
| **Desktop (Windows)** | Full. |
| **Desktop (macOS / Linux)** | WSL does not exist; every call refuses with that reason. |
| **Server Edition** | The server's own machine answers. On Linux that is an honest "WSL is not installed". |
| **Relay tabs** | Refused. WSL management stays on the machine sitting in front of you — a peer who joined your canvas must not be able to enumerate or terminate your Linux environments. |
| **Mobile companion** | Not applicable: it attaches to sessions and has no canvas. |
