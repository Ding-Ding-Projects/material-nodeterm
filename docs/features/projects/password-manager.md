# Password managers

A **password manager** is real credential storage that lives inside a project — as many of them
as you want, one project-scoped by default and optionally one per canvas group frame. It is
deliberately a different feature from [toy locks](../../toy-locks.md): a toy lock says outright
"this is not security"; a password manager is the opposite of that. Every secret half of a
credential — username, password, TOTP seed — is authenticated-encrypted under a key derived from
one password per project, and never appears in cleartext outside one deliberate decrypt path.

Source: `src/shared/password-manager.ts` (the wire types), `src/core/password-manager/{crypto,
vault,vault-store,password-manager-handlers}.ts` (the core implementation), and
`src/renderer/components/passwordManager/` (the panel UI).

## Where it lives on disk

A vault is `<cwd>/.nodeterm/vault.json` — a **sibling** of `project.json`, not a field inside it.
This is a deliberate choice, not an oversight: `project.json`'s own header states that it "carries
CONTENT ONLY. Nothing in here may be state two machines opening the same repo would legitimately
disagree about," and it comes with a monotonic `rev` counter, SSH mirror/reconcile machinery, and
content diffing that a vault has no use for — its AEAD envelopes are already tamper-evident, so
layering a rev/merge story on top of them is risk for no benefit. `core/board-log.ts`'s own
sibling file (`<cwd>/.nodeterm/board-log.jsonl`) already established the pattern of per-project
state that travels with a project without living inside `project.json`'s schema; the vault follows
the same shape.

Everything written to `vault.json` is either non-secret metadata (manager/credential names, ids,
timestamps, the KDF parameters, the salt) or an authenticated-encryption envelope nobody can read
without the project password — which is exactly what makes committing it to git no more dangerous
than committing `project.json` itself. A teammate who clones the repo and knows the project
password can unlock the same vault; one who doesn't sees only opaque ciphertext.

## Key derivation and encryption

`core/password-manager/crypto.ts` derives the AES-256-GCM key from the project password with
`scrypt` at `N=131072, r=8, p=1` — **128 MiB of memory cost** (`128 * N * r`), tuned so deriving a
key takes on the order of a few hundred milliseconds on ordinary hardware and an attacker has to
pay that memory cost in full per guess, not just CPU time. This is deliberately a stronger, and
completely separate, contract from the toy-lock service's own scrypt parameters (that module's own
comment says "THIS IS NOT SECURITY"; a password manager's own words are the opposite).

Node's `crypto.scryptSync` defaults `maxmem` to 32 MiB — smaller than what these parameters cost
(128 MiB) — so `deriveVaultKey` raises `maxmem` explicitly on every call. Skipping that would mean
either scrypt silently refusing to run, or (worse) some future edit "fixing" the refusal by
quietly weakening the parameters until they fit under the default. The salt is per-project random
bytes stored alongside the KDF params in `vault.json`, both non-secret and git-shared, which is
what lets the same password on a different machine derive the same key.

Each credential secret (`CredentialSecret`: username, password, optional base32 TOTP seed) is
sealed with `encryptPayload`/`decryptPayload` — AES-256-GCM with a fresh random 12-byte nonce per
call and a 16-byte auth tag. **A wrong password and a tampered ciphertext are deliberately
indistinguishable.** `decryptPayload` throws one generic `VaultCryptoError` on any failure,
because node's GCM implementation refuses to release any plaintext once authentication fails —
there is nothing left to inspect once `decipher.final()` throws, no partial output, no timing
signal worth trusting, so the module never tries to tell "wrong password" apart from "corrupted
data." Distinguishing them would require either exposing more of the failure than GCM safely can,
or maintaining a separate unauthenticated check that itself becomes an oracle.

Whether a candidate password is *right* is checked the same way, without ever touching a real
credential: `vault.json` carries a `verifier` — an empty-plaintext payload encrypted with the
vault's own key at creation time. Unlocking derives a key from the supplied password and attempts
to decrypt `verifier`; success means the key is right, failure means it (indistinguishable) either
wasn't or the file was tampered with.

## Lock state and the in-memory key

`VaultStore` (`core/password-manager/vault-store.ts`) holds the unlocked key **only in process
memory**, keyed by the resolved vault file path. It is never written anywhere and never persists
across a restart — a fresh process starts every project **locked**, and there is no "remember my
password" option. This is by design: there is nowhere safe on the machine alone to keep a key that
would let a stolen laptop skip re-deriving it from the actual password.

`VaultLockState` is one of three states: `uninitialized` (no password has ever been set for this
project), `locked` (a password is set, this process hasn't supplied it), `unlocked`. A caller can
always read manager metadata and each manager's `credentialCount` regardless of lock state
(`VaultStatus`/`PasswordManagerSummary`) — only the credentials' secret halves require the
unlocked key.

## Managers, and group binding

A `PasswordManagerRecord` is a named container of credentials. It optionally carries a `groupId`
binding it to one canvas **group frame** — the same convention `GroupWorktree`
(`shared/worktree.ts`) already uses for binding a git worktree to a frame. With no `groupId` a
manager is project-scoped and shown everywhere in the project; with one, it's associated with that
specific frame.

When a bound group is ungrouped or deleted, the manager and its credentials are **never deleted**
along with it — `core/password-manager/vault.ts`'s `releaseGroupBinding` only clears the
`groupId`, demoting the manager back to project scope. This mirrors `Canvas.tsx`'s
`releaseWorktreeBinding` for worktrees: losing the frame that happened to reference something
never destroys the thing itself. A credential vault is exactly the kind of state you do not want
silently deleted because someone reorganized a canvas.

## The TOTP viewer

A credential may carry a base32 TOTP seed (`CredentialSecret.totpSecretBase32`, RFC 4648 base32 —
the same convention `core/toylocks/totp.ts` already uses). Revealing a credential's live code goes
through `credentialCode`, which returns the current code, the next code, the period start, and the
period length — the panel polls this while a credential row is open and renders a countdown ring
plus the next code so nobody starts typing a code with the period about to roll over. A credential
with no configured seed answers `no-totp` and the panel shows that plainly rather than guessing.

## Known gap: no `listCredentials`

The exposed API (`shared/password-manager.ts`) has no call that lists a manager's credentials.
`status()` returns only a manager's `credentialCount`; individual credential rows are surfaced only
by the create/rename/remove/reveal calls themselves. `PasswordManagerPanel.tsx` therefore keeps a
**local echo** of the rows it has itself touched this session — a credential created, renamed, or
edited in the current session shows up; one from an earlier session stays represented only by the
count until something brings it into view. This is a stated v1 limitation, not a bug: the panel
shows the credential count is higher than the rows it currently has, and adding a
`listCredentials(managerId)` call is the natural follow-up if that proves annoying in practice.

## Relay refusal

The whole `passwordManager:*` namespace is refused over a relay connection, before the handler is
ever entered. `src/main/relay-rpc-policy.ts` is a **default-deny** allowlist for every inbound
relay RPC request — an unlisted method answers `E_FORBIDDEN` before the recorded CorePlatform
handler is even looked up. Password-manager methods are deliberately absent from that allowlist,
alongside the other machine-global credential/control namespaces (the authenticator's live TOTP
codes, licensing, usage credentials): a mutually-approved relay peer gets shell-equivalent access
to the shared project, but it must never be able to unseal this machine's stored credentials
merely by having registration exist for a method name. `platform-electron.test.ts` drives a raw
encrypted relay frame against `passwordManagerRevealCredential` and asserts the refusal happens
before the vault is touched at all — this is a test proving the policy gate itself, not just the
handler's own input validation.

## Suggested articles

- [Toy locks](../../toy-locks.md) — the deliberately *not* security counterpart; read both to see
  why this feature exists as a separate, stronger contract.
- [Projects and tabs](projects-and-tabs.md) — how a project's `<cwd>/.nodeterm/` directory and its
  sibling files (this vault, the board log) relate to `project.json`.
- [Group picker](../canvas/group-picker.md) — the searchable "move into group" surface a manager's
  optional group binding is set through.
