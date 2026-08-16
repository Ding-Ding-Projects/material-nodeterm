# Packaging & auto-update

**Category:** [Packaging](./README.md)

How a checkout of this repository becomes an installable build, and how an installed build
finds out about — and applies — a newer one.

## Behaviour

**Building.** The desktop app is packaged with
[electron-builder](https://www.electron.build/): a macOS `.dmg`/`.zip` for both Apple Silicon
and Intel, and a Linux `AppImage` plus a `.deb` for x64. `npm run dist` produces a local,
**unsigned** build for smoke-testing on macOS; `npm run dist:linux` does the same for Linux.
Native modules (`node-pty`, and the speech-recognition dependency) are rebuilt against
Electron's exact ABI as part of installing dependencies, since a native module built for a
system Node.js won't load inside Electron's bundled one.

Windows uses `npm run dist:win` and the x64 Squirrel target. Its supported wrapper regenerates the
committed multi-resolution ICO, derives an immutable raw URL from the full source SHA, verifies the
download byte-for-byte, and passes that URL as Squirrel's Apps & Features `iconUrl`. The package
wrapper is not green until exact package version/ID/product metadata, RELEASES name/size/SHA-1,
exact output inventory, and the Setup/app/execution-stub PE icon frames all agree with the
committed ICO. The local-installer BAT and publication workflow separately accept only exact Setup
Authenticode `NotSigned`. Squirrel's vendor `Update.exe` remains vendor-branded because the pinned
builder plugin has no supported project hook to rewrite it.

**Auto-update** is handled by `electron-updater`. A packaged build checks a self-hosted update
feed on launch and every few hours, downloads an available update in the background, and shows
a non-blocking "Restart to update" banner rather than forcing an interruption — restarting is
always your choice, triggered explicitly.

**Product announcements.** Separately from the update feed, the app periodically fetches a
small news feed and shows the newest message you haven't already dismissed as a banner above
the tab bar. This same check also carries update-policy information (for example, whether a
given version has become unsupported and needs a mandatory update), independent of whether
`electron-updater` itself found a new build.

**Server Edition and the headless notification host** ship differently: there is no installer
at all. `npm run server:dev` builds and runs the browser edition directly from source, and the
headless notification host is installed with a single shell script that builds it and
registers it as a systemd service — re-running the same script is how you update it.

## Configuration

- `npm run make-icon` regenerates the PNG and committed seven-frame Windows ICO from the project's
  source mark. Regeneration must leave the committed ICO unchanged unless the master intentionally
  changed.
- Update-feed and announcement-feed endpoints are configured at build time, not something an
  end user changes; both checks respect `DO_NOT_TRACK` / a telemetry opt-out and are skipped
  entirely in unpackaged development builds.
- **Settings → Privacy** — the separate, explicitly opt-out telemetry ping (version and OS only,
  no usage content) that periodically checks in with the update service.

## Failure modes

- **The update feed is unreachable**: the app simply continues running the current version;
  update checks retry on the normal schedule rather than blocking anything.
- **A download is corrupted or fails partway**: `electron-updater`'s own verification refuses
  to apply it; you stay on the current version with no partial-install state.
- **An unsigned build's OS-level warning**: because these builds are currently unsigned and
  unnotarized, Windows shows SmartScreen/unknown publisher, while macOS Gatekeeper shows a
  first-run "unidentified developer" warning (`.deb` has no equivalent). This is expected and is
  disclosed rather than hidden — see [`README.md`](../../../README.md) for the exact
  workaround.

## Security considerations

- Builds distributed today are **unsigned** — verify a download came from the project's own
  GitHub Releases page (or a Homebrew tap tracking it) rather than trusting an unofficial
  mirror, since an unsigned artifact carries no cryptographic guarantee of its origin on its
  own.
- The auto-updater only ever fetches from the project's own configured feed; it does not read
  update instructions from anywhere else on the system.
- The headless notification host's push mechanism is designed around needing zero open inbound
  ports — see [Server Edition](../remote/server-edition.md) for the security reasoning behind
  that specific choice.

## Verification

- Run `npm run dist` locally and confirm the resulting `.dmg` under `dist/` actually launches
  the app.
- With a packaged build installed, point its update feed at a test build with a higher version
  number and confirm the "Restart to update" banner appears and applying it actually replaces
  the running build.
- Confirm the announcement banner shows a posted message once, and that dismissing it persists
  across a restart (it should not reappear for the same message id).

## Suggested articles

- [Server Edition](../remote/server-edition.md) — the headless install path this article
  references.
- [SSH projects](../remote/ssh-projects.md) — the other remote-machine story, distinct from
  packaging a distributable build.
