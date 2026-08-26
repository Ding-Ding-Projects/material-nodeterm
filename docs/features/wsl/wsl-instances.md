# WSL instances

A group frame on the canvas can be **bound to a WSL distribution**. Every terminal created inside
that frame opens in that distribution, which makes "one agent per Linux environment" the same
gesture as "one frame per environment" — the same shape the worktree binding already uses.

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

## Surfaces

| | |
| --- | --- |
| **Desktop (Windows)** | Full. |
| **Desktop (macOS / Linux)** | WSL does not exist; every call refuses with that reason. |
| **Server Edition** | The server's own machine answers. On Linux that is an honest "WSL is not installed". |
| **Relay tabs** | Refused. WSL management stays on the machine sitting in front of you — a peer who joined your canvas must not be able to enumerate or terminate your Linux environments. |
| **Mobile companion** | Not applicable: it attaches to sessions and has no canvas. |
