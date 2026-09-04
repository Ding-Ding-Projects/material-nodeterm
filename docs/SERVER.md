# nodeterm Server Edition (Phase 2)

## Host-owned planner occurrences

The Server Edition starts the same `PlannerOccurrenceRuntime` as the Desktop shell. Schedules live
in the configured data directory and continue while every browser tab is closed. WS-RPC exposes the
guided Planner surface's load, save, history, export, and occurrence event channels. A headless host
records fired and missed occurrences before broadcasting them, and serializes renderer schedule
edits with host ticks so stale UI state cannot replace durable occurrence history. It does not
pretend it can wake a powered-off computer or show a
desktop notification. Both serving and headless shutdown paths stop the runtime before the host
closes.

The Windows desktop app's top-right device button drives this same deployment automatically. It
obtains Docker Desktop through Windows Package Manager when missing, invokes the validated
`host.bat` path, builds `nodeterm-server:local` when absent, reuses the named data volume, waits for
the container health check, and offers the verified local URL. This route is free and has no Pro,
seat, subscription, or purchase requirement.

The deployment creates `.nodeterm-server-totp` with owner-only permissions and mounts it read-only
at `/run/secrets/nodeterm-totp`. The desktop panel shows the current six-digit code and refreshes it
every second. Enter it in the site's password field. Codes tolerate one 30-second clock step of
drift, pass through the normal per-peer attempt and lockout limits, and an accepted counter is
persisted so the same code cannot be replayed after a process restart.

On phone-sized coarse-pointer browsers, Server Edition resolves every project to the sessions/board
view and omits the Canvas navigation destination. This removes precision pan/zoom interaction while
retaining the rest of the browser application, including sessions, chat/transcripts, files, source
control, tools, alerts, settings and history.

Run nodeterm's canvas in a browser, backed by a headless Node server on your own
machine or box. The server serves the **same** built renderer the desktop app uses
and speaks a WebSocket-RPC protocol to it; a browser-side `window.nodeTerminal`
shim (`src/renderer/bridge/`) stands in for the Electron preload, so the React UI is
unchanged. It boots the same Electron-free core services (`src/core/`) through a
`ServerPlatform`, so terminals get the same tmux session continuity as the desktop app.

> **Phase 2 scope: terminals only.** This is a real, usable terminal canvas over the
> network, but it is deliberately narrow — see [Limitations](#phase-2-limitations).

## Remote OAuth localhost callbacks

When a CLI running in a remote session starts OAuth, its `redirect_uri` may point at a loopback
listener on the Server Edition host. The browser completing authorization is usually on another
machine, so opening that URL directly would reach the wrong loopback interface.

The Server Edition detects only authorize URLs observed in the active terminal output when they
contain a loopback `redirect_uri` and a provider `state`. It creates a short-lived, memory-only
ticket bound to the session, provider host, callback port, callback path, and state. The browser
opens the authorize URL, then the panel asks for the complete callback URL from the browser address
bar. The server validates that URL and fetches it on its own loopback interface. No arbitrary host,
port, or user-provided request target is accepted.

The callback ticket expires after five minutes, is consumed before the loopback request begins, and
cannot be replayed. A wrong host, port, path, or state is refused without a request. A failed fetch
is reported as incomplete, and the user starts a new sign-in flow. Callback URLs, authorization
responses, and response bodies are never logged, persisted, exported, or placed in project data.

On the Desktop SSH path, the same detector arms a temporary `ssh -O forward -L` mapping on the
existing ControlMaster and opens the authorize URL in the local browser. The mapping is cancelled
on expiry, project disconnect, or explicit cancellation, so the user does not need to prepare
`ssh -L` manually.

The manual recovery remains available for older builds or unsupported session types: run
`ssh -L <port>:localhost:<port> user@server` before starting OAuth, or copy the failed
`localhost:<port>/callback?...` URL and request it on the session host. These routes should be used
only for the exact loopback port printed by the provider flow.

## Quickstart

```bash
npm run server:dev
```

`server:dev` runs `npm run build` (renderer + core) then `npm run server:build`
(bundles `src/server/main.ts` → `out/server/main.cjs` via esbuild) and finally
`node out/server/main.cjs`. On a repeat run where the renderer is already built you
can skip straight to `npm run server:start`.

### First run (setup token)

With no password configured yet, the server prints a **one-time setup URL** to stdout:

```
Setup: http://127.0.0.1:8443/setup?token=<32-hex>
nodeterm-server listening on http 127.0.0.1:8443
```

Open that URL, choose a password (min 8 chars), and you're signed in. The setup
token is single-use and lives only in memory (never written to disk), so it's
regenerated if the process restarts before setup completes.

### Headless setup (no interactive setup URL)

Seed the password out-of-band with an env var — useful for containers / CI where
nobody is watching stdout:

```bash
NODETERM_SERVER_PASSWORD='choose-a-strong-one' npm run server:start
```

When `NODETERM_SERVER_PASSWORD` is set **and** no password is configured yet, the
server writes the scrypt hash on boot and skips the setup URL entirely — go straight
to `/login`. It is ignored once a password already exists (it never overwrites).

### Manual build + run

```bash
npm run build         # electron-vite build → out/renderer, out/core
npm run server:build  # esbuild → out/server/main.cjs
npm run server:start  # node out/server/main.cjs
```

## Configuration

Precedence: **CLI flag > environment variable > default.**

| Flag | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `--port <n>` | `NODETERM_PORT` | `8443` | TCP port to listen on. |
| `--host <h>` | `NODETERM_HOST` | `127.0.0.1` | Interface to bind. |
| `--data-dir <path>` | `NODETERM_DATA_DIR` | `~/.nodeterm-server` | Where auth, sessions, workspace, settings, and scrollback live. |
| `--renderer-dir <path>` | `NODETERM_RENDERER_DIR` | `out/renderer` (resolved from cwd) | Directory of the built renderer (`index.html` + hashed assets). |
| `--insecure-http` | — | off | Acknowledge serving plain HTTP directly on a non-loopback interface (see below). |
| — | `NODETERM_SERVER_PASSWORD` | — | Seed the password headlessly on first boot (see above). |
| `--trust-proxy-header <name>` | `NODETERM_TRUST_PROXY_HEADER` | — (off) | Reverse-proxy SSO trust: identity header asserted by your proxy (see [Reverse-proxy SSO](#reverse-proxy-sso-header-trust)). |
| `--trust-proxy-nets <list>` | `NODETERM_TRUST_PROXY_NETS` | `127.0.0.0/8, ::1/128` | Comma-separated IPs/CIDRs (IPv4+IPv6) whose requests may use the trust header. Only meaningful with the header set. |

Binding a **non-loopback** host (anything other than `127.0.0.1` / `localhost` /
`::1`) **without** `--insecure-http` is refused at startup — plain HTTP on a public
interface would leak the session cookie. The intended deployment is loopback-bound
behind a TLS-terminating reverse proxy (see [TLS](#tls-reverse-proxy)).

## Headless notification host

The Server Edition doubles as a **headless notification host**: a background process on any
Linux box that gives a phone SSHing into it full push / Live-Activity coverage — **without
serving the browser UI and without opening a single port**.

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/eneskirca/nodeterm/main/scripts/install-server.sh | bash
```

The installer (`scripts/install-server.sh`) is idempotent — re-run it any time to update. It:

- needs only `git`, `curl` and `tar` on the host — **Node.js is no longer a prerequisite**: if a
  system Node matching `^22.22.2 || ^24.15.0 || >=26.0.0` (with npm and a working `node:sqlite`
  `DatabaseSync`) is present it's used as-is, otherwise the installer downloads pinned Node
  v24.15.0 from nodejs.org into `~/.nodeterm-server-app/runtime/node` and uses it for the
  build and the systemd service (nothing is installed system-wide; Alpine/musl hosts still need a
  distro `nodejs`). A downloaded runtime must report that exact pin and pass the SQLite capability
  probe before npm or systemd runs. It also warns (with the apt/dnf one-liner) if the C toolchain
  (`make`/`gcc`/`python3`) node-pty's native build needs is missing;
- clones (or `git pull`s) the repo into `~/.nodeterm-server-app`;
- installs deps (`npm ci --ignore-scripts`, then `npm rebuild node-pty` against Node's ABI —
  the same trap the [Docker](#docker--dokploy) build documents) and builds the renderer +
  server bundle;
- installs a **systemd** service (`NODETERM_HEADLESS=1`, `Restart=on-failure`, journald logs):
  a system unit at `/etc/systemd/system/nodeterm-server.service` when run as root, or a
  per-user unit + `loginctl enable-linger` otherwise — then enables and (re)starts it;
- writes **`<data-dir>/install-meta.json`** (`{version, commit, installedAt}`, where `<data-dir>`
  defaults to `~/.nodeterm-server`). The server reads it at boot and surfaces it to a paired phone
  through the agent-status mirror's top-level `server` block, so a connection can show which version
  this install is on — the answer to "how does an installed Server Edition learn about updates?";
- installs a **daily auto-update timer** (unless you opt out — see below).

Follow the logs with `journalctl -u nodeterm-server -f` (add `--user` for a non-root install).

### Auto-update

The installer also installs a `nodeterm-server-update.service` (a `oneshot`) plus a
`nodeterm-server-update.timer` (`OnCalendar=daily`, `RandomizedDelaySec=3600`, `Persistent=true`),
with the **same root/user split** as the main service (a system unit under
`/etc/systemd/system/`, or a per-user unit under `~/.config/systemd/user/`). When it fires, the
service:

1. `git pull --ff-only` in `~/.nodeterm-server-app` — updating the checkout **including this
   updater script**, so the updater logic keeps itself current;
2. re-execs the freshly-pulled `scripts/install-server.sh`, which rebuilds and restarts the
   service. The installer is idempotent, so an already-current pull just no-ops through a harmless
   rebuild.

**Opt out:** run the installer with `NODETERM_NO_AUTOUPDATE=1` — it skips the timer, and (so a
re-run can turn auto-update off) **removes an existing** timer/service. The installer prints the
timer status (`systemctl list-timers`) in its summary so you can confirm the next run.

Check or trigger it manually:

```bash
systemctl list-timers nodeterm-server-update.timer      # add --user for a non-root install
systemctl start nodeterm-server-update.service          # run an update now
```

### Per-user installs (one per Unix user)

An install covers **only the Unix user it runs as** — its systemd unit, `~/.nodeterm-server-app`
checkout, and `~/.nodeterm-server` data dir are that user's. A box with several server users
(`root`, `customerservice`, …) needs **one install per user**; the phone offers this per
connection (it installs under whichever user its SSH session logs in as). Non-root installs rely on
`loginctl enable-linger <user>` (the installer runs it) so the user's systemd manager — and thus
both the service and the auto-update timer — keep running without an active login session.

### `NODETERM_HEADLESS`

Set `NODETERM_HEADLESS=1` (also accepts `true`, case-insensitive) to boot in headless mode.
Everything boots **exactly as usual** — the loopback hook server, the agent-status mirror, the
usage poll, the granted push senders (push-notify + Live-Activity), and the pending-approvals
sweep — **except** the public HTTP/WS listener, which is **never bound**. There is no renderer
serving and no auth surface. `NODETERM_HOST` / `NODETERM_PORT` are ignored (nothing binds), and
`platform.broadcast` is a no-op while no browser UI is attached. Its shutdown owns the same core
service lifecycle as the serving path: in particular the scheduled-settings poller is stopped
before PTY/hook teardown. This matters in a container too — `node` is PID 1, `docker stop` delivers
SIGTERM, and `NODETERM_HEADLESS=1` must not leave that interval/store listener running while close
is in flight.

### Security rationale: zero open ports

The whole point of this mode is that it adds **no network attack surface**:

- **No public listener at all.** The HTTP/WS server is never created, so there is no port to
  expose, no login page to brute-force, and no session cookie in flight.
- **The hook server stays loopback-only.** Agent CLIs POST their lifecycle hooks to
  `127.0.0.1` (a per-session bearer token, fail-open) — it never leaves the host.
- **Push is outbound-only.** Notifications reach the phone over **outbound HTTPS**, authorized
  by a signed, device-scoped **grant** the phone itself drops at
  `~/.nodeterm/push-grants/<deviceId>.grant` when it reaches the host over SSH. No inbound
  connection, no standing relay identity — a grant a phone never dropped simply means no push.

The phone's own SSH session into the host is the trust boundary; nodeterm adds nothing listening
beside it.

### Session budget (idle-session reaper)

tmux sessions deliberately outlive their clients (that is the continuity contract), so a host that
serves many SSH projects slowly accumulates **detached** agent sessions nobody will ever come back
to — a field report counted 95 sessions holding 34 GB of idle `claude` processes. Every
nodeterm-server (headless or serving) runs a **session budget** (`src/core/session-budget.ts`, the
tmux counterpart of the renderer's WebGL budget): every 10 minutes it sweeps the local
`node-terminal` **and** SSH-remote `nodeterm-rmt` sockets and reaps the **least-recently-active
detached** `nt-*` sessions when

- host **available memory** drops below a watermark (default 10% of RAM, floor 1 GB) — the
  primary, pressure-driven trigger; or
- the **detached session count** exceeds a cap (default 48) — the accumulation backstop.

**Attached sessions are never touched**, a grace window (default 6 h since last activity) protects
recent work, kills are re-verified against a fresh listing, and each sweep reaps at most a small
batch (default 8) so convergence is gradual. A reaped session is indistinguishable from a reboot
to its node: on next open it **cold-restores** (scrollback snapshot + `claude --resume`). Tuning /
kill switch via env: `NODETERM_SESSION_MIN_AVAILABLE_MB`, `NODETERM_SESSION_MAX_DETACHED`,
`NODETERM_SESSION_GRACE_HOURS`, `NODETERM_SESSION_REAP_BATCH`, `NODETERM_SESSION_REAP_DISABLED=1`.

### Session memory (the RAM pill + per-session panel)

The reaper's counterpart for a human: `startSessionMemoryService` (`src/core/session-memory-service.ts`)
is booted here too, beside the reaper in `src/server/index.ts`, and `window.nodeTerminal.sessionMemory`
has a **real** ws-bridge implementation (not a stub). So the browser gets the bottom-left RAM pill and
the per-session breakdown, and both describe **the machine the server is served from**: its
`/proc/meminfo`, its `node-terminal` / `nodeterm-rmt` tmux sockets, its process table. Full write-up:
`docs/session-memory.md`.

**An SSH project's scope answers `ok:false` — "could not measure" — and that is deliberate.** The
server has no ControlMaster, so it cannot read the other host; answering with its own sessions would
publish this machine's memory under that host's name. Same degrade as remote usage, one step
stricter:

- The service is given **`isRemoteProject` but no `run`**. Knowing which projects are somebody
  else's machine and being able to read them are different capabilities, and the option pair is
  asymmetric to say so (`run` optional, `isRemoteProject` required).
- The refusal is decided **by identity**, not by trusting the renderer's `remote` flag:
  `sshScopePredicate({ sshProjectIds: () => workspaceStore.sshProjectIds() })`. A query arriving
  without that flag — a client that has not learned the project is an SSH one yet — would otherwise
  fall through to the LOCAL sweep, which is exactly the misattribution the refusal exists to prevent.
- **That predicate depends on the boot-time `await workspaceStore.load(...)`** in `startServer` (a
  line documented there as being for Context Link). Drop it — or stop awaiting it before
  `server.listen()` — and every SSH project silently reads as local again;
  `test/server/session-memory-e2e.test.ts` fails if that happens. What is **not** load-bearing is
  where that load sits relative to the service boot: `isRemoteProject` is a closure evaluated per
  QUERY, and no query can arrive before `startServer` reaches `listen()`. The requirement is that
  the load completes before the server *serves*, not that it precedes any particular boot line.

A **headless** host boots the service like every other core service, but with no UI attached nothing
queries it.

## Security model

### OAuth callbacks from remote sessions

An OAuth flow started by a CLI on this server can print a localhost callback URL while the browser
is on another computer. The renderer detects only authorize URLs containing an explicit HTTP
localhost redirect, then arms a host-local callback completer for the observed port and path. After
the browser redirects, paste the complete callback URL into the notice shown by the renderer. The
server fetches the URL locally, with a bounded timeout, only when it still matches the observed
loopback host, port, and path.

The arm is scoped to the authenticated browser connection, consumed before the fetch, expires after
ten minutes, and is never written to disk. Callback URLs and response bodies are not logged or
returned to the browser. A malformed URL, changed port or path, non-loopback host, expired arm,
redirect, or unavailable listener is refused and requires starting the sign-in flow again.

Single-user auth. There is one password; sessions are per-browser.

- **Password hashing:** scrypt (`N=16384, r=8, p=1`, 32-byte key, per-password random
  salt), stored as `auth.json` (mode `0600`) in the data dir. Login comparison is
  constant-time (`crypto.timingSafeEqual`). The HTTP path uses asynchronous scrypt, at most two
  active proofs and 32 pending proofs process-wide, with at most five pending for one TCP peer.
  Same-peer proofs execute FIFO and re-check lockout after every wait, so requests that arrived
  before the fifth failure cannot keep hashing or reset the resulting lockout. The persisted
  salt/hash shape and cost parameters are validated at use time before scrypt starts; a hand-edited
  cost cannot escape those resource bounds. The app never stores the plaintext.
- **Session cookie:** on successful login the server sets `nt_session=<random>` with
  `HttpOnly; SameSite=Strict; Path=/` (and `Secure` when served over HTTPS). Sessions
  are persisted (`sessions.json`, mode `0600`) with a 30-day TTL and swept lazily.
  `/auth/logout` deletes the presented token from that file before clearing its cookie, so replaying
  the old bearer after logout or a server restart fails while other browsers stay signed in.
  `revokeAll()` remains the programmatic logout-everywhere operation.
- **Origin check on WS upgrade:** the WebSocket endpoint requires a valid session
  cookie **and**, when the browser sends an `Origin` header, that its host matches the
  request `Host`. A malformed Origin is rejected (never throws). This blocks
  cross-site WebSocket hijacking. (Non-browser clients without an Origin still must
  present a valid cookie.)
- **Login rate limit / lockout:** 5 failed password/passkey attempts from one kernel-observed TCP
  peer trip that peer's 60-second lockout (further attempts get `429 too_many_attempts`); a success
  resets only that peer. `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, cookies, user-agent and source
  port never select this bucket because clients can spoof or churn them. A reverse proxy therefore
  shares one password bucket for its TCP address; proxy-authenticated requests bypass the password
  path normally. Peer state is bounded to 1024 entries: locked or pending-password-proof entries
  are never evicted, while the oldest unlocked inactive source can be replaced so a distributed
  one-shot flood cannot create a permanent global lockout. Password proof concurrency/backlog
  limits above remain the process-wide distributed-work backstop.
- **Passkey challenge bounds:** WebAuthn freshness challenges live for two minutes, are single-use,
  bound to both the TCP peer and ceremony purpose (`login` versus `register`), and capped at eight
  per peer / 256 process-wide. Expiry is one complete bounded O(n) pass, including after a backward
  system-clock adjustment. Repeated unauthenticated option requests therefore cannot grow memory
  or cleanup work beyond that strict 256-entry bound.
- **Unlock challenge bounds:** each locked peer can retain at most eight ladder nonces and all peer
  ladders share a 256-nonce ceiling. A full ledger refuses refreshes until capacity genuinely frees,
  and grading one answer invalidates every sibling nonce before the climb advances or exhausts.
- **Auth gate:** every route except the login/setup pages and their POST handlers
  requires a valid session — HTML navigations redirect to `/login`, API/WS get `401`. The raw
  browser upload route is behind this same gate; an unauthenticated request cannot create a staging
  file.

### Reverse-proxy SSO (header trust)

Deployments that front the server with an SSO reverse proxy (Cloudflare Access,
Tailscale, oauth2-proxy, Authelia…) already authenticate every request before it
reaches nodeterm, and the proxy asserts the identity in a request header. Setting
`NODETERM_TRUST_PROXY_HEADER` makes such requests count as authenticated — no
password, setup token, or session cookie needed:

```bash
# Cloudflare Access
NODETERM_TRUST_PROXY_HEADER=Cf-Access-Authenticated-User-Email node out/server/main.cjs
# Tailscale (tailscale serve / funnel with identity headers)
NODETERM_TRUST_PROXY_HEADER=Tailscale-User-Login node out/server/main.cjs
# oauth2-proxy / Authelia / most others
NODETERM_TRUST_PROXY_HEADER=X-Forwarded-User node out/server/main.cjs
```

A request is trusted only when **both** hold:

1. its **TCP peer address** is inside `NODETERM_TRUST_PROXY_NETS` (default:
   loopback only — the same-host proxy deployment). If your proxy reaches the
   container over a private network, list it explicitly, e.g.
   `NODETERM_TRUST_PROXY_NETS=127.0.0.1,10.0.0.0/8`;
2. it carries the configured header with a **non-empty value**.

The header **content is not validated** (no JWT verification) — the trusted-network
boundary is the trust statement. That makes two things non-negotiable: only the
proxy may be reachable from the trusted networks, and the proxy must
**strip/overwrite** the header on incoming client requests (Cloudflare Access,
Tailscale and oauth2-proxy all do). A typo'd nets entry fails the boot rather than
silently changing who is trusted; setting nets without a header is likewise refused.

Everything else stays intact: password/cookie auth keeps working beside it (e.g.
for loopback ops access), the WS upgrade still enforces the same-host Origin check,
and a proxy-authed visit to `/login` or `/setup` just redirects home. The boot log
prints a `⚠️ Proxy header trust ENABLED` line naming the header and networks —
verify it matches what you meant to trust.

### TLS (reverse proxy)

The server speaks **plain HTTP** by design. For anything beyond `localhost`, run it
bound to loopback and put a TLS-terminating reverse proxy (nginx, Caddy, Cloudflare
Tunnel, a VPN, etc.) in front. The `Secure` cookie flag is set automatically when the
proxy forwards HTTPS (detected via `X-Forwarded-Proto` / the request being TLS).
`--insecure-http` only exists as an explicit, eyes-open escape hatch for trusted
private networks — prefer the proxy.

### Docker / Dokploy

The repo ships a multi-stage `Dockerfile` (root) that builds the renderer + server bundle and
produces a slim runtime image with `tmux`, `git` and `curl` (the managed hook scripts POST
through curl). Any Dockerfile-based PaaS (Dokploy, Coolify, plain compose) can deploy it:

```bash
./host.sh             # macOS / Linux
host.bat              # Windows
```

Both wrappers generate a random first-boot password into the ignored root `.env`, restrict that
file to the current user (`0600` or a Windows ACL), build through Compose, and wait for the image's
real `/login` health check. They refuse an inherited `NODETERM_SERVER_PASSWORD`, because Compose
would let it silently override the credential the wrapper just advertised from `.env`. To drive the
image directly, pass a password of at least eight characters through an owner-only `--env-file`
(never as a literal command-line argument), or omit it and use the one-time setup URL from
`docker logs`. The wrappers require a local Docker socket: their loopback URL, TLS readiness probe,
and SSH hint all refer to the machine on which the wrapper itself runs. They also pin the Compose
file, project name, env file and profiles, then export exactly the loopback bind, port and password
they validated; inherited Compose controls are rejected rather than allowed to redirect the stack.

On Dokploy specifically: create an app from this repo (Dockerfile build), attach a volume at
`/data`, set `NODETERM_SERVER_PASSWORD`, and point a domain at container port `8443` — Traefik
terminates TLS and forwards `X-Forwarded-Proto`, so the session cookie gets its `Secure` flag
and the clipboard runs in a secure context.

Things the image decides for you (see the Dockerfile comments for the full why):

- **Every stage pins Node 24.15.0.** The status mirror's OS-backed cross-process lock uses
  unflagged `node:sqlite`, and the locked dependency graph has a stricter patch floor; a floating
  Node major can conceal either runtime break.
- **Both native addons are compiled against Node's ABI, not Electron's.** The repo's `postinstall`
  runs `electron-rebuild`, which targets Electron — every install in the image uses
  `--ignore-scripts` plus an explicit `npm rebuild node-pty smart-whisper`. Rebuilding only
  node-pty leaves terminals healthy but browser dictation unable to load its native binding.
- **The server process is unprivileged.** The entrypoint starts as root, repairs only root-owned
  uid/gid entries on the literal `/data` filesystem for compatibility with the older image, then
  immediately `exec`s Node as uid 1000. It never follows an operator-supplied `NODETERM_DATA_DIR`.
- **node-pty and smart-whisper are compiled against Node's ABI, not Electron's.** The repo's
  `postinstall` runs `electron-rebuild`, which targets Electron — every install in the image uses
  `--ignore-scripts` plus an explicit `npm rebuild node-pty smart-whisper`. Don't "simplify" that
  away.
- **`--insecure-http` is passed** because the container must bind `0.0.0.0` for the proxy to
  reach it, and TLS lives in the proxy. Never publish the port directly on a public interface.
- **A container restart/redeploy kills the tmux server** (it lives inside the container). The
  cold-restore path bridges it — scrollback replays from the `/data` snapshot and resumable
  agents relaunch with `--resume` — but running processes die with each deploy. This is the one
  behavioral difference from a long-lived host install, where only a machine reboot does that.
- **Reuse a `/data` volume across replacements** — auth, sessions, workspace and scrollback
  snapshots live there. A same-container restart keeps its writable layer, but a replacement or
  redeploy without the same volume loses the password and canvas.

Agent CLIs (`claude` etc.) are not baked into the image — install them into the running
container (or extend the image) and authenticate inside a terminal node; their config lives
under the container user's home, so consider a volume there too if you rely on them.

Run the full repeatable image check after Docker/Compose/host changes:

```bash
node scripts/test-docker-host.mjs
# Or select an SSH-backed daemon without changing the current Docker context:
node scripts/test-docker-host.mjs --docker-host ssh://docker@example.test
```

It builds the real image, checks `/login`, both renderer/server bundles, `node-pty` and
`smart-whisper`, verifies PID 1 is uid 1000, observes a clean SIGTERM exit, then proves auth and a
data marker survive a restart and complete container recreation. It creates uniquely named test
resources and removes only those resources when it finishes.

The smoke is safe to aim at a shared SSH daemon: its recovery journal pins the daemon identity,
and every image, volume, server, and helper has a
cryptographic run id plus role and source-commit labels; every container is recorded by immutable
id; and cleanup rechecks those identities and labels before removing anything. Runtime containers
have no published host port, use `network=none`, run under bounded CPU/memory/swap/PID and capability
limits, and probe HTTP/auth/assets from inside the server container. Passwords enter the probe over
stdin and never appear in Docker arguments. Inherited Docker context, host, TLS, and builder
environment controls are cleared after the selected endpoint is resolved.

SSH uses the account's normal persistent host-key inventory. Configure that inventory to accept a
new key non-interactively and to reject a changed key; the smoke never disables key comparison or
rewrites global SSH settings. A recovery journal is written outside the repository before resources
are created. If interruption leaves owned resources behind, run:

```bash
node scripts/test-docker-host.mjs --cleanup-run <run-uuid>
```

Recovery still requires the recorded daemon identity, immutable resource identities, and ownership
labels to match. Cleanup residue is a failed smoke result, not a warning.

### Tailscale (reach it without publishing a port)

`docker-compose.yml` also ships a `tailscale` Compose profile — off by default, exactly like
`tls` — that joins the `nodeterm` container directly to your own [Tailscale](https://tailscale.com)
network (a "tailnet"). Once it's running, any device on that tailnet can open the app at this
container's tailnet address on port `8443`, **with nothing published to the Docker host and
nothing exposed to the public internet.** `docker compose up` with no `--profile` flag is
completely unaffected — the service doesn't exist until you ask for it.

**What this does and does not protect.** It turns "no exposure at all" into "reachable from your
tailnet only" — a real reduction in attack surface, and for a lot of self-hosted setups that's all
you need instead of a public domain and a certificate. **It is not authentication.** The app is
served over plain HTTP inside the container, exactly as it is for the `tls` profile's Caddy leg,
and every request still has to pass the server's own sign-in (see [Security
model](#security-model) above) — anyone who can reach the tailnet can reach the login page; they
still need the password (or a passkey) to get past it. If you also want Tailscale's own identity
on each request, layer `NODETERM_TRUST_PROXY_HEADER=Tailscale-User-Login` in front of `tailscale
serve` (see [Reverse-proxy SSO](#reverse-proxy-sso-header-trust)) — that's a separate, opt-in
decision from simply joining the tailnet.

**Setup:**

1. Create a Tailscale auth key at <https://login.tailscale.com/admin/settings/keys>. A reusable,
   tagged key is easiest for a long-running host you'll redeploy; an ephemeral key is fine for a
   one-off test.
2. Start the stack with that key and the `tailscale` profile:

   ```bash
   TS_AUTHKEY=tskey-auth-xxxx docker compose --profile tailscale up -d --build
   ```

   `TS_AUTHKEY` is a **secret**: set it as a real environment variable or in an owner-only
   `--env-file`, the same way you'd hand the host wrappers a password. It is never baked into the
   image, never committed, and the compose file's own default for it is empty, so a plain
   `docker compose up` never reads it.
3. Confirm the node actually joined:

   ```bash
   docker compose logs tailscale | grep -i "success\|machine name"
   # or, once it's up:
   docker compose exec tailscale tailscale status
   ```

   The node registers under the container's hostname (`nodeterm` by default — change the
   `hostname:` field on the `tailscale` service if you want a different tailnet name). From
   another device on the same tailnet, open `http://nodeterm:8443` (MagicDNS) or the `100.x.y.z`
   address `tailscale status` prints.
4. **Turn it off again**: `docker compose --profile tailscale down` stops and removes the sidecar
   container; `nodeterm` itself keeps running loopback-only, unaffected. The node's Tailscale
   identity is kept in the `tailscale-state` named volume, so restarting the profile later
   reconnects as the *same* device instead of registering a new one and piling up duplicates in
   your tailnet's device list. To deregister for good, either remove that volume (its name is
   prefixed with the Compose project name, e.g. `docker volume rm
   material-nodeterm_tailscale-state`) or remove the machine directly from
   <https://login.tailscale.com/admin/machines>.

**How it works:** the `tailscale` service is a sidecar that shares the `nodeterm` container's
network namespace (`network_mode: service:nodeterm`) instead of getting its own, so once
Tailscale brings up its `tailscale0` interface there, the app — already listening on
`0.0.0.0:8443` inside the container, the same bind the `tls` profile relies on — is reachable
through it with no `ports:` entry of its own. It needs the capabilities Tailscale documents for
that kernel-networking mode (`NET_ADMIN` + `NET_RAW`, plus a `/dev/net/tun` device) and nothing
broader: no `--privileged`, no host networking, no other devices.

### CSP

The inline login/setup pages carry a strict CSP. The built `index.html` ships with a
`default-src 'self'` marker that the server **rewrites** at serve time to
`default-src 'self'; connect-src 'self' ws: wss:;` so the browser can open the
WebSocket. If that marker is ever missing, the server logs a loud warning (the WS
would otherwise be blocked) — rebuild the renderer or update the rewrite.

### Dictation

Voice-to-text input works in the browser via the **same core speech service** the desktop app uses. Dictate with ⌘⌥D (or the dock mic button); transcribed text goes into the overlay's editable field and is sent only via explicit Send/Insert into the node that was selected when the overlay opened — nothing auto-submits. **Browser constraints:** `getUserMedia` requires a **secure context** — HTTPS or `localhost`; the microphone permission prompt is the browser's own. **Model storage:** Downloaded models (tiny free tier; larger Pro models) are stored on the **server's data dir** under `speech-models/`, persisted across sessions and server restarts.

## Documented deviations from the spec

Two intentional departures from `docs/superpowers/specs/2026-07-10-server-edition-design.md`:

1. **`node:http` + `ws`, not Fastify.** The HTTP/WS surface is tiny (a handful of
   routes + one WS endpoint); the built-in `http` module plus `ws` keeps the
   dependency footprint minimal and avoids a framework for no gain.
2. **scrypt, not argon2.** scrypt is in Node's standard library (`crypto`), so there's
   no native dependency to build/ship. Parameters follow the OWASP baseline.

## Phase 2 limitations

- **Desktop phone pairing is intentionally unavailable.** The Server Edition browser is already
  attached to this host and has no desktop one-shot LAN listener or local OS SSH-key store. Its
  bridge declares `pairing.supported = false`; the quick action is hidden and Settings → Phone
  shows the deliberate desktop-only route. Headless mobile push uses the separate SSH-possession
  grant flow documented above.
- **"Transfer conversation to…" is unavailable.** The handoff file that a transfer hands the target
  agent is rendered by `src/main/handoff` behind the `handoff:build` IPC channel, which is
  registered in `src/main` only — no core service, no server handler, so the bridge has nothing to
  call. The bridge declares `handoff.supported = false` and the node context-menu section is
  **absent** rather than an enabled item that silently does nothing (which is exactly what it was
  until this was gated: the stub's rejection threw past the call site's resolved-`{ error }` check
  into a `void`ed promise, so clicking it produced no file, no toast and no console entry).
  `buildTransferHandoff` in `renderer/lib/transferGates.ts` keeps that second boundary — any route
  that still reaches a rejection now reports it in the normal "Transfer failed" toast. Branching a
  conversation is unaffected; transferring is done from the desktop app on the host. Wiring it
  properly means moving the builder into `src/core` behind `CorePlatform` so both shells register
  it — the ordinary route for a deferred feature here.
- **Terminal-only.** Terminal nodes work (spawn, I/O, resize, tmux continuity). The
  git panel, source control, Monaco editor/diff nodes, SDK chat node, agent-status
  badges/hooks, and the folder picker are **not** wired into the server bridge yet —
  their `window.nodeTerminal` methods are stubbed. Deferred to Phase 3.
- **Reconnect = full-page reload.** When the WebSocket drops, the bridge shows an
  overlay and the recovery path is to reload the page; on reload each terminal
  warm-reattaches to its still-running tmux session and tmux redraws. (The spec's
  lighter "thin reconnect strip" is recorded as a v1 tradeoff.)
- **Initial-connect failure showed a blank screen** *(resolved in Phase 3c).* If the
  server was unreachable at the very first page load (as opposed to a mid-session drop),
  the reconnect overlay did not appear — you got a blank page. The bridge now shows the
  reconnect overlay on a failed first connect instead of booting the app, and reloads on
  reopen. See [Phase 3c](#phase-3c-follow-up-hardening).
- **No backpressure / flow-control auto-trigger.** The `pty.setFlow` plumbing exists
  end-to-end, but nothing automatically pauses a flooding PTY based on WebSocket
  `bufferedAmount` yet. Deferred to Phase 3.
- **Single user.** One password, no accounts/roles.

## Phase 3a: files, editor, diff & source control

Phase 3a widens the browser surface from terminals-only to the file-and-git
workflow. The server now registers the core **fs**, **git**, and **commit-message**
handlers and the browser bridge exposes real `fs` / `git` / `files` / `context`
APIs, so several node kinds and panels that were stubbed in Phase 2 now work in the
browser:

- **Editor & diff nodes** — Monaco editor nodes read/write files over `fs:read` /
  `fs:write` (⌘S saves), and diff nodes render `git:show-file` + `fs:read` — both
  now function unchanged in the browser.
- **Source Control panel** — stage / unstage / discard, diff, branch switch/create,
  commit + push, and the ✦ AI commit message (BYO local agent CLI on the staged
  diff) all run against the server's `git` service.
- **Explorer** — the file tree lists the project `cwd` via `fs:list`.

### Bounded browser uploads

Browser-held files no longer travel as base64 inside `files.saveUpload` WebSocket RPC calls. A
7 MiB raw file becomes roughly 9.3 MiB after base64 expansion, which exceeds the socket's deliberate
8 MiB `WS_MAX_PAYLOAD` and used to disconnect every feature multiplexed over that connection.

The Server Edition bridge now sends raw `application/octet-stream` bytes to the authenticated,
same-origin `POST /upload?name=…` endpoint. The receiver streams the request into a private staging
file and atomically publishes it only after the body completes. A selected `File` is passed directly
to `fetch` as its Blob body — the renderer does not materialize an ArrayBuffer, base64 string,
decoded binary string, and second byte array first. Both sides share a 64 MiB raw-byte ceiling: the
browser checks `Blob.size` before fetch (and legacy base64 callers check encoded length before
decoding), while the server checks `Content-Length` when present and counts the body again while
receiving it, so chunked or dishonestly-labelled requests cannot bypass the limit. Over-limit
requests receive `413` with the same human-readable limit and leave no partial file. The WebSocket
ceiling remains 8 MiB — upload capacity is not bought by weakening the socket's memory/backpressure
boundary. When a chunked sender crosses the limit, the server sends the refusal immediately but
continues discarding that request to natural EOF. Returning early from Node's default async
iterator destroys the request stream, resets a slow client before it can reliably read the `413`,
and prevents keep-alive reuse. Upload roots/directories request mode `0700` and files `0600` on
POSIX (the mode flags are harmless on Windows); failed writes remove only their own random staging
directory. Before a new upload, POSIX hosts also tighten a legacy permissive staging tree left by an
older build. That migration opens the managed root, token directories, and immediate single-link
files with `O_NOFOLLOW` and applies `0700`/`0600` through the opened descriptor; it skips symlinks,
hard-linked files, nested directories, and anything outside the upload root.

Authentication remains mandatory for non-browser clients that omit `Origin`. When an `Origin`
header is present, its host must also match the request `Host`; malformed or cross-host origins are
rejected before a staging directory is created, matching the WebSocket's cross-site request guard.

The following affordances change shape in the browser (no native OS is reachable):

- **Folder / file picker** — there is **no native dialog**. "Open folder…" and file
  pickers use an **in-app server-directory browser** (built on `fs:list`) that lets
  you navigate and pick a path on the server's filesystem.
- **`shell.openExternal`** — opens the URL in a **new browser tab** rather than a
  desktop-side default browser.
- **"Reveal in Finder" / "open with default app"** — **inert** in the browser
  (there is no desktop file manager to reveal into); these actions are hidden or
  no-op rather than erroring.
- **Clipboard (copy)** — the browser's `navigator.clipboard` only exists in a **secure
  context** (https or `localhost`). Over plain http on a LAN it is `undefined`, so the
  bridge falls back to a hidden-textarea `document.execCommand('copy')`. That fallback
  only works **inside a user gesture**: the copy shortcut and the click-driven copy
  buttons are fine, but an `OSC 52` write driven by terminal *output* (`vim "+y`, `gh`,
  `yazi`) is not — it fails and raises a **banner** ("the browser blocks clipboard access
  over plain http"). The bridge awaits both routes and resolves a truthful boolean. A caller with
  one more fallback can defer the bridge's banner; the final exhausted route raises exactly one,
  so a later success is never contradicted by an earlier error. Copy never fails silently, but if
  you want it to work properly,
  **serve over https (or localhost)** — that is one more reason for the TLS proxy above.
  Note also that **Ctrl+Shift+C** (advertised as copy on Linux/Windows) additionally opens
  Chromium's element inspector and a page cannot suppress that; **Ctrl+Insert** is the
  browser-safe copy chord.

The **backpressure / flow-control** gap noted in the Phase 2 limitations is now
closed: a flooding PTY is automatically paused based on the WebSocket
`bufferedAmount` and resumed when it drains, so the WS is protected.

> **Loose coordination (follow-up).** The server-side WS backpressure and the
> renderer's terminal (xterm) flow control coordinate only **loosely** over a shared
> pause actuator (`ptyManager.setFlow`) — full two-master coordination is a follow-up.
> Because either side can resume the pty independently, the server **re-asserts** its
> pause on every send while the socket buffer stays above the high-water mark (rather
> than latching on a single rising edge), so a renderer-side resume cannot silently
> latch the server's protection off.

**Still deferred to Phase 3b:** the SDK **chat node** and the **agent-status
badges/hooks** are not yet wired into the server bridge.

## Phase 3b: agent status, subagents & the context meter

Phase 3b brings the agent-observability surface — the same code path the desktop app
uses — to the browser. The server boots the loopback **hook server**
(`hookServer.start()`, on its own `127.0.0.1` port) and installs the managed hook
scripts, so every agent CLI the server spawns POSTs its lifecycle hooks back to the
host. `wireAgentStatus` installs the hook server's normalized + raw listeners and
routes each event over `platform.broadcast`, so the existing renderer badge / subagent
/ context code now works unchanged in the browser:

- **Agent-status badges** — an agent's own hooks (not output parsing) drive the shared
  4-state model; the normalized event is broadcast over `agent:status` and the header
  shows the pulsing **RUNNING** (working) / **NEEDS YOU** (waiting/blocked) badge, plus
  the unread dot and completion notification (as a Web Notification — see Phase 2).
- **Subagent visualization** — subagent start/end drive ephemeral **SubagentNode** cards
  over `agent:subagent-activity`; the main-process subagent tail streams each card's live
  transcript to the browser.
- **Context-window meter** — the per-node context tail streams `context:update` so the
  meter fills as the session's transcript grows (this channel was already real in 3a; 3b
  feeds it from the hook pipeline).

Because the hook POST carries a `transcript_path`, a forged POST is defended by jailing
that path to the system-default `~/.claude/projects` or a managed account dir
(`isSafeLocalTranscriptPath`) before any tail reads it.

### Context Link

Context Link works in the Server Edition. The feature itself lives entirely in core
(`src/core/context-link.ts`) and writes everything under `dataDir`; what it needs from a
shell is the **link map** — who is linked to whom.

The desktop gets that from its renderer, because React Flow holds the live canvas. That
does not fit here: agents and their tmux sessions keep running with the browser closed,
and a headless deployment may never have one attached. So the server derives the same map
from the **persisted** `bridges[]` of every canvas (`workspaceStore.persistedCanvases()` →
`buildBackgroundLinkMaps`, in `src/server/context-link.ts`). A workspace save re-derives
immediately; a 15 s sweep also catches transcript paths, which arrive from the hooks
rather than from any canvas change, and skips the write when nothing moved.

Consequences worth knowing:

- **Boot reads the workspace once** (`load({ sideline: false })`) so links are live before
  the first browser connects. Read-only on purpose — sidelining a conflicted
  `project.json` stays a renderer/probe decision.
- **Boot also writes into agent configuration directories** when managed hook installation
  is on: the `get-linked-context` Claude skill, plus marker-delimited instruction blocks in
  `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md` and opencode's `AGENTS.md`. The blocks are
  idempotent and preserve surrounding content. Set **`installHooks: false`** to skip every
  one of those writes — the Context Link read handler still works, agents simply have to be
  told about the shim some other way.
- **Local-only, deliberately.** No remote deps are injected (`initContextLink(pty, {})`):
  the server runs ON the host whose transcripts and tmux it reads, and SSH projects are a
  desktop-only concept.
- `contextLink.info()` is still unsupported in the browser bridge, so the canvas note that
  announces a new link cannot quote the shim path. The boot-installed instructions cover
  discovery independently.

**Deliberate scope skips (Phase 3b):**

- The SDK **chat node** is still **deferred** — it is not wired into the server bridge.
- **Canvas-control** (`agent:control`, the Claude-only `nodeterm` CLI verbs) is **not
  wired** over the server, and since the strict-verb work it says so **by name**:
  `/control/<verb>` answers HTTP 400 with `error: control-unsupported-on-this-edition`
  and a sentence containing the literal *"do not retry"*. The old generic
  `control unavailable` read to an agent like a transient outage, and an agent retries an
  outage. `browser` additionally names why it is **structural** rather than unimplemented —
  a browser node on this edition renders in the **viewer's own** browser tab, which this
  server has no debugger for, and never can. See `src/server/control-unsupported.ts`.
  server has no debugger for, and never can. The whole `browser` drive set shipped over
  S8 (nav/read/click/type/press/scroll/wait/screenshot/cookies) is therefore **desktop-only**:
  it needs Electron's `<webview>` + CDP, which this edition has none of, so there is no
  browser driving here at all. See `src/server/control-unsupported.ts`.
  The agent-messaging verbs (`send`/`reply`/`notify`) are additionally **verified-only at
  the route** on every edition, so on this one an unverified caller gets the flat 403
  messaging refusal and a verified caller gets the same
  `control-unsupported-on-this-edition` — both terminal, neither an invitation to retry.
- The **`ptyDestroy` tail-teardown** — *resolved in Phase 3c.* Phase 3b left this skipped
  (agent tails self-cleared only on `SessionEnd`, so a node closed *without* one left an
  idle file-tail); the server now untracks agent tails on node close, at desktop parity.
  See [Phase 3c](#phase-3c-follow-up-hardening).
- **SSH-remote agent tails are N/A** — the server has no SSH-project manager, so the
  SSH branch of the desktop hook-wiring block is dropped (the raw listener falls straight
  through to the local logic).

## Phase 3c: follow-up hardening

Phase 3c closes two follow-ups left open by Phase 3b, bringing the browser bridge to
desktop parity on agent-tail cleanup and first-connect behavior:

- **`ptyDestroy` tail-teardown (desktop parity).** When a node is closed the server now
  **untracks its agent tails** (the per-node context/subagent session state plus the
  context tail and subagent tail) on `ptyDestroy`, exactly as the desktop app does — no
  more idle file-tail lingering for a node closed *without* a `SessionEnd` (e.g. the ×
  button). This was enabled by making `platform.on` **multi-listener** (matching Electron's
  `ipcMain.on`): the new teardown listener runs **alongside** `PtyManager`'s own
  `ptyDestroy` destroy handler instead of clobbering it.
- **Clean boot on a failed initial connect.** A failed *first* WebSocket connect no longer
  boots the app into a broken/blank state — the bridge shows the standard reconnect overlay
  and the app reloads on reopen, so first-load failure now behaves like a mid-session drop.

**Still deferred** (unchanged from Phase 3b): the SDK **chat node**, **canvas-control**
(`agent:control` / the `nodeterm` CLI verbs — now a *named, non-retryable* refusal rather
than a generic failure, see above), full **two-master flow-control coordination**
(the server still re-asserts its WS backpressure pause on each send rather than co-managing
a single actuator with the renderer), and the web folder picker's **hardcoded start
directory**.

### Managed Claude accounts

Managed Claude accounts (several logged-in Claude identities side by side, each with its own
`CLAUDE_CONFIG_DIR`) **work in the browser**. Selecting one always did — env injection, the
transcript readers, the usage rows and the account pickers are all `src/core` — but the
*lifecycle* was welded to `ipcMain`, so a browser-only deployment could pick an account it had no
way to create (issue #313).

- **The lifecycle is core.** `src/core/claude-accounts-service.ts` owns the four
  `claude-accounts:*` channels (add / wait-login / cancel-wait / remove) and registers them
  through the platform seam, so **both shells serve them**: `src/main/claude-accounts.ts` is now a
  thin desktop wrapper, and `registerCoreHandlers` calls the same `registerClaudeAccountsIpc()`.
  The browser reaches them through a real `buildClaudeAccountsApi` in the ws-bridge instead of the
  old `E_UNSUPPORTED` stub. `waitLogin` is a straight passthrough of a poll that runs up to five
  minutes — safe because the WS RpcClient has no request timeout, so a pending request rejects
  only when the socket drops.
- **Per-account hooks are installed at boot and at add.** A managed account carries its own
  `settings.json` (Claude Code resolves it relative to `CLAUDE_CONFIG_DIR`), so the managed status
  hook has to be written there too or that account reports no agent status at all. `startServer`
  runs the same per-account loop the desktop does right after `installManagedAgentHooks()`, and
  `add` installs into the fresh dir up front.
- **The canvas skill is desktop-only.** Canvas control is not wired on this edition at all (the
  hook server answers `control unavailable` by name), so the service takes the skill installer as
  an optional dep and the server passes none — a per-account `SKILL.md` here would point at
  nothing.
- **No remote (SSH) accounts.** The Server Edition has no SSH-project manager, so an account
  context carrying a `projectId` takes the **local** path — the same degrade the desktop takes
  before its manager exists.

### Managed Codex accounts (S6)

The Server Edition **arms the Codex record-signing secret** but does **not** host the
account-management IPC — that surface is desktop-driven over SSH.

- **Arms the record secret (Decision 1).** At boot `armServerNodeIdentity`
  (`src/server/node-identity-arm.ts`) loads the raw node-auth secret and calls
  `setCodexThreadIdentityAuthSecret(...)` with it, so a managed Codex account's thread→node→account
  ownership records can **sign and verify on a headless host**. Headless Linux has no OS keychain, so
  the secret is 32 **raw bytes** at `node-auth-key.bin`, mode `0600` — the same both-shells channel the
  desktop seals via `safeStorage`. This only makes the record layer *able to sign*; it is orthogonal to
  the shared-app-server degrade (Codex nodes still launch bare here, exactly as before).
- **Does NOT host the account-management verbs.** `initCodexAccounts` registers its IPC over Electron's
  `ipcMain` with WebContents-owner authorization, which the headless bridge does not provide, so
  `startServer` never calls it. This is **not** a silent gap: managed Codex logins **on an SSH host**
  are driven by the **desktop** over SSH (the remote account-add / device-login / import legs + the
  relay) — the host runs the relay + import, not its own copy of the account IPC.
- **Fail-closed, both ways.** With no secret armed (unwritable key file), the record layer throws
  rather than writing anything unsigned, and Codex nodes keep working bare. A machine with **no** managed
  accounts is byte-for-byte the pre-S6 layout (a bare-root record per thread).
- **A browser-only deployment therefore cannot manage Codex accounts** — the case issue #313 is
  about. Managed **Claude** accounts moved into core (above); Codex did not follow, and the reason
  is not effort: its switch verbs (`switchThread` / `commitSwitch` / `finishSwitch` /
  `rollbackSwitch`) authorize the owning window by Electron **WebContents id**, which has no
  meaning over a WS connection where every browser tab is an equally anonymous socket. Hosting
  them headless needs a connection-identity redesign first, not a handler port. Until then the
  `codexAccounts` namespace stays an `E_UNSUPPORTED` stub in the bridge and the Settings section
  says so by name rather than failing silently — an unhandled rejection there previously stopped
  the spinner and showed nothing.

## Manual browser smoke checklist

Run against a real browser (this is the human-verified path; the automated harness
only exercises the HTTP/auth surface). With `npm run server:dev` running:

1. **Setup / login** — open `http://127.0.0.1:8443`. On first run you're redirected to
   `/setup` (or use the printed setup URL); choose a password. On later runs you land
   on `/login`; sign in.
2. **Add a terminal** — click the dock `+` and add a terminal node. It should spawn a
   shell and show a prompt.
3. **Terminal I/O** — type `echo hi` and confirm `hi` prints.
4. **Resize** — drag the node's resize handle; the terminal should re-fit (cols/rows
   update) without garbling.
5. **Refresh the page** — reload. The terminal must **warm-reattach** to its tmux
   session and redraw its current contents (running processes survive).
6. **Restart the server** — stop `node out/server/main.cjs`, start it again, reload the
   page. Same warm-reattach: the tmux server outlived the app, so state is intact.
7. **Lockout** — sign out (or open a fresh session), enter the wrong password 5 times;
   the 6th attempt should be rejected with a "too many attempts" lockout for ~60s.
8. **Open a folder (Phase 3a)** — use "Open folder…"; the **in-app server-directory
   picker** appears (no native dialog). Navigate to a git repo on the server and pick
   it; a project opens on its `cwd`.
9. **Edit & save a file (Phase 3a)** — open a file (Explorer or picker) into an editor
   node, make an edit, press ⌘S; the dirty dot clears and the change lands on disk.
10. **Source Control (Phase 3a)** — open the Source Control panel; your edit shows as a
    change. Click it to see the **diff**, **stage** it (+), type a message, and
    **commit**; the file leaves the change list and the commit appears in recent commits.
11. **Agent status (Phase 3b)** — open a **Claude** terminal node, run a prompt; the header
    should show the pulsing **RUNNING** badge while it works and clear (with an unread dot
    if the tab is unfocused) when it's done.
12. **Subagent card (Phase 3b)** — from a Claude node, run a prompt that dispatches a
    subagent (e.g. a `/task`); an ephemeral **subagent card** appears connected to the
    parent node; click it to watch its live transcript stream.
13. **Context meter (Phase 3b)** — as a Claude session accumulates transcript, the node's
    **context-window meter** should fill.
14. **Converter upload transport** — open the File converter and add a 7 MiB browser file; it
    should stage successfully without the WebSocket reconnect overlay appearing. An upload above
    64 MiB should show the upload-limit refusal, keep the socket connected, and create no queue
    item or partial staging file.
