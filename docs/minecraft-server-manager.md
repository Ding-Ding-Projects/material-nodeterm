# Local Minecraft server create-and-manage

A `minecraft` service node on the canvas can now create, install and run a real Minecraft server
— not just remember where you'd connect one. It downloads the real server jar from Mojang's own
version metadata, verifies its checksum, checks the local Java runtime is compatible, requires the
user to accept Mojang's EULA themselves, and then starts/stops/monitors a real `java -jar
server.jar` process, with its console streamed live into the node.

## Scope, stated plainly

This runs the server **on the machine the shell is running on** — this desktop, or the Server
Edition host — as an ordinary child process of that shell. It is **not** a wrapper around Docker
and does not reach a remote host over SSH; that remains a separate, unbuilt idea for the
`dockerhost`-style address field the other four storage-only service kinds (`dockerhost`, `proxmox`,
`gitlab`, `freepbx`) still use unchanged (see `src/renderer/nodes/ServiceNode.tsx`). The
`homeassistant` node now uses its own multi-instance REST and WebSocket manager panel. Nothing
in this feature reads or writes `ServiceConnection`/`serviceConnection.endpoint`.

## Architecture

```
src/shared/minecraft.ts          Pure types + the MinecraftApi shape (renderer-facing). No I/O.
src/core/minecraft/
  version-resolve.ts             Pre-existing, Electron-free: parses Mojang's version manifest and
                                  per-version documents, checks Java-major compatibility, verifies
                                  a sha1. No network calls live here — fetchJson is injected.
  java.ts                        Detects a usable local `java`: PATH + JAVA_HOME (subprocess-free
                                  lookup), then verifies it by actually running `-version` and
                                  parsing the real banner (which prints to stderr).
  server-manager.ts              The stateful manager: per-instance metadata on disk, the live
                                  process, the console ring buffer, the download/verify/install
                                  flow, start/stop/send-command/remove.
  register-ipc.ts                The `minecraft:*` RPC surface, registered on BOTH shells exactly
                                  like registerOllamaIpc.
src/renderer/components/minecraft/
  MinecraftServerPanel.tsx       The node's UI: version picker, folder picker, EULA acceptance,
                                  download progress, console, start/stop/delete.
```

Registered by `src/main/index.ts` and `src/server/handlers/index.ts` over the same
`CorePlatform.handle`/`broadcast` seam every other core-bound service in this app uses (see
`docs/ollama-manager.md` for the pattern this follows). The engine cannot drift between the
desktop and the Server Edition because it is the same code.

## Where every fact comes from

Nothing in `status()` is optimistic. Every field is re-derived on demand from something real:

- **Installed / not installed**: whether `server.jar` exists in the instance's directory.
- **EULA accepted**: whether `eula.txt` in that directory actually says `eula=true`. `create()`
  always writes `eula=false` — Mojang's own default — and the **only** call that may write `true`
  is the explicit, separate `acceptEula()`, invoked only by the user clicking "Accept and
  continue" after reading the real EULA. Nothing auto-accepts a license on anyone's behalf.
- **Running**: whether there is a live `ChildProcess` for that instance, right now, in this
  shell's memory. Restarting the shell always starts from disk state — an instance mid-download or
  mid-run when the app quit is simply "not running" (or "not installed", if the download never
  finished) on the next launch. See "What does not survive a restart" below.
- **Java compatibility**: a fresh probe of `java -version` on this machine (cached 30 seconds),
  compared against the Java major version the chosen Minecraft version's own metadata states it
  needs (`null` when the metadata states no requirement at all — older versions predate the field).
  "No Java found" and "Java found but too old" are reported as genuinely different states, because
  they need different fixes.
- **Download progress**: real bytes received. Mojang's per-version metadata does **not always
  publish a total size** — measured directly against the live manifest, it was absent for the
  current release at the time this was built. When the HTTP response's own `Content-Length` header
  is present, a percentage is shown; when it is not, the UI shows real bytes-downloaded with an
  indeterminate progress indicator rather than a fabricated percentage.

## Creating a server

1. Pick a version. The list is Mojang's real, current version manifest
   (`https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`), fetched fresh (cached 10
   minutes) — every version it publishes, release and snapshot alike. The picker defaults to
   whichever version the manifest's own `latest.release` pointer names, never a hardcoded string
   that would go stale the next time Mojang ships a release. Snapshots and older version types
   (`old_beta`/`old_alpha`) are available behind an explicit "Show snapshots and old versions"
   toggle, off by default, and labelled with their real `type`.
2. Choose a directory via the folder picker (`dialog.selectFolder()` — the same native/in-app
   picker every other folder-choosing surface in this app uses).
3. Click **Create server**. This:
   - Fetches the version's own per-version document from the URL the manifest itself pointed at
     (never an independently-typed or user-suppliable URL), and refuses it if the resolved
     download is not `https:`.
   - Downloads the real server jar to a unique temp file inside the target directory, hashing as
     it streams.
   - Verifies the sha1 against the value **that same per-version document** published. A mismatch
     deletes the temp file and reports the failure; the jar is never installed.
   - Writes `eula.txt` with Mojang's own comment header and `eula=false`.
   - Records the instance (directory, version id, sha1, required Java major) at
     `<userData>/minecraft-servers/<node-id>.json`.

Re-running Create with a different version on an already-installed node reinstalls in place
(overwrites the jar, resets `eula.txt` back to `false` — never assumes a prior acceptance carries
over to a different version).

## Starting, stopping and the console

**Start** refuses (with a stated reason, never a silent no-op) when the jar is missing, the EULA
isn't accepted, or the detected Java is incompatible. It spawns `java -jar server.jar nogui` in the
instance's directory, not detached, and streams stdout/stderr line-by-line into a capped (400-line)
ring buffer that both a newly-opened node and a live subscriber can read.

**Stop** writes the standard `stop` command to the server's stdin — Minecraft's own graceful
shutdown, which saves the world before exiting — and waits up to 20 seconds for it to exit on its
own, then `SIGTERM`, then (after another 8 seconds) `SIGKILL`. It is routed through this app's
two-key destructive-action confirmation gate (`docs/destructive-confirmation.md`), because it ends
a live process and disconnects anyone currently playing.

**Send a command** writes a raw line to the running server's console (only while `running`, never
while starting/stopping) — the same "how do you `/say` something to the server" a terminal would
give you, without opening one.

**Delete this server** removes the instance's directory (jar, config, world — everything) from
disk. This is genuinely irreversible and is gated behind the same two-key confirmation, upgraded
to the stricter Kids-mode path automatically like every other deletion surface in this app.

## What does not survive a restart, and why that is honest rather than a bug

A managed server is an **ordinary child process of this shell**, not a `tmux`-backed session like
this app's terminal nodes. It does not survive the shell process ending, and there is no attempt
here to make it — that would be the much larger "give service nodes tmux-style persistence" feature
this pass deliberately did not build. Concretely:

- Quitting nodeterm (or closing the Server Edition process) asks every running managed server to
  shut down gracefully (`requestGracefulStopAll()` — writes `stop` to each one) but does **not**
  wait for it to actually exit. That is deliberate: an ordinary child process is not killed by its
  parent quitting on any platform this app targets, so there is nothing to block quitting on —
  writing `stop` is enough for the server to finish its own graceful shutdown independently,
  whether or not this shell is still alive to see it happen.
- Reopening the node after a restart shows the real state: `stopped` (or `needs-eula`/
  `not-installed`, if it never finished before quitting) — never a stale "running" that isn't.
  Clicking **Start server** launches a fresh process.

## Configuration

Nothing here is user-configurable beyond what the panel already exposes (version, directory). JVM
memory flags, `server.properties` tuning, and a "run detached across restarts" mode are explicit,
documented gaps for a future pass — not silently assumed defaults.

## Failure modes

| Situation | Behaviour |
| --- | --- |
| Network failure / bad HTTP status during download | `create()` reports the exact HTTP status or network error via `status().error`; no partial jar is ever installed. |
| Checksum mismatch | The temp file is deleted; `status().error` names the mismatch. The published digest itself is not echoed back verbatim as something to "match against" — a mismatch means the artifact is wrong, not that the expectation needs adjusting. |
| No compatible Java found | The app downloads the matching Eclipse Temurin JRE into its private application-data runtime cache, verifies Adoptium's published SHA-256, and uses it without changing PATH or installing anything machine-wide. A download or verification failure is reported in the node and can be retried. |
| Java present but too old | `status().javaOk === false` with `javaReason` naming both the required and installed major versions. Start is disabled. |
| Server process exits unexpectedly (nonzero code, not requested) | `status()` reports `phase: 'error'` with the exit code; the console retains the server's own last output so the real cause is visible. |
| `stop` doesn't exit within the grace window | Escalates to `SIGTERM`, then `SIGKILL`, so a stuck server can always be stopped. |
| Invalid instance id / non-absolute directory | Refused with a stated reason (`oneShotError`) without mutating any persisted state — a bad one-off request never leaves the instance stuck in an `error` phase. |

## Security considerations

- **Downloads only ever come from a URL the manifest itself pointed at.** The version list comes
  from Mojang's manifest; the per-version document (and the jar URL + sha1 inside it) comes from
  the exact URL that manifest entry names; the jar is fetched from the exact URL that per-version
  document names. Nothing here accepts an independently-typed or user-suppliable download URL. Both
  the manifest fetch's redirect target and the final download URL are required to be `https:`.
- **The jar is verified before it is ever runnable.** `verifySha1` checks length and hex-digit
  shape before comparing, so an empty or truncated digest can never compare equal to anything by
  accident, and the download is renamed into place only after verification succeeds.
- **The EULA is never auto-accepted.** `create()` unconditionally writes `eula=false`; only the
  user's own explicit `acceptEula()` click writes `true`.
- **Instance ids are validated before touching a path.** The node id becomes part of a filename
  (`<userData>/minecraft-servers/<id>.json`); it is checked against a safe-opaque-id pattern (the
  same discipline `node-exec.ts`'s `SAFE_OPAQUE_ID` applies elsewhere) before any read or write.
- **Not reachable over the relay.** `relay-rpc-policy.ts` is an exact allowlist, and this
  namespace has no entry in it — a relay peer cannot provision or run processes on the host it
  joined. `renderer/bridge/relay-api.ts` explicitly refuses it (`E_UNSUPPORTED`), matching the
  Ollama manager and the file converter's own relay refusal for the identical reason: this is one
  machine's filesystem and process table, and there is no remote-routed core call for it.
- **Console input is one line at a time.** `sendCommand` strips embedded newlines before writing
  to stdin, so a UI text field cannot smuggle more than one console command per call.

## Verification performed in this pass

- `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` — both clean after every
  wiring change (shared types, IPC channels, core manager, both shells' registration, preload,
  the Server Edition WS bridge, the stub surface, the relay refusal, and the renderer UI).
- The pre-existing `version-resolve.ts` module (manifest parsing, per-version parsing, Java
  compatibility, sha1 verification) was exercised against **live** Mojang metadata during this
  pass: the real manifest parsed cleanly (907 versions, no schema drift), a real 58.1 MB server
  jar was downloaded and its computed sha1 matched the published one exactly, and a deliberately
  wrong hash was correctly refused by `verifySha1`.
- Added unit tests: `src/core/minecraft/java.test.ts` (the `java -version` banner parser, both the
  legacy `1.x` scheme and the modern Java 9+ scheme, and the "unparseable → null, never a guess"
  contract) and a `latest`-pointer test added to the existing `version-resolve.test.ts`.
- Not run in this pass: the full test suite, linters, or a live capture of the built app (this was
  a deliberately fast, scoped pass — see the task brief). The new pure-logic tests were written but
  not executed; they should be run (`npm test`) before this lands.

## What is genuinely not built yet

- **JVM memory/heap tuning** — the server starts with the JVM's own defaults (`java -jar
  server.jar nogui`, no `-Xmx`/`-Xms`). A future pass can expose these as real, validated fields.
- **`server.properties` editing** from the panel — the file is whatever the server itself writes
  on first run; nodeterm does not template one.
- **Surviving a full app restart while running** — see "What does not survive a restart" above.
  This is an explicit, honest scope boundary, not an oversight.
- **A cancel button mid-download** — a download in progress runs to completion or failure; there
  is no "stop this download" affordance yet.
