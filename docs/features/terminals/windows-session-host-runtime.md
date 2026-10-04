# Windows session host: staged runtime, updates and messaging

**Category:** [Terminals](./README.md)

On Windows, persistent terminals run inside nodeterm's standalone session host. This article
covers how that host is launched in an installed build, how it behaves across an update, how
agents message each other through Windows panes, and what the update card says when a build has
no update channel. The design write-up with every invariant is
[`docs/windows-session-host.md`](../../windows-session-host.md).

## Behaviour

- **Staged runtime.** An installed build never runs the host from Squirrel's replaceable
  `app-<version>` directory. Before launching it, nodeterm copies the runtime the host needs (the
  Electron executable as `session-host-runtime.exe`, its DLLs, ICU data, resource paks, locales and
  the session-host bundle with its own node-pty) into
  `%LOCALAPPDATA%\node-terminal-session-host-runtime\app-<version>-<fingerprint>`, verifies every
  file by SHA-256, smoke-runs the copy, writes a marker last and publishes the directory with one
  atomic rename. Old copies are removed only when nothing runs from them.
- **Updates keep sessions.** A Squirrel update installs while every session keeps running. The
  running host keeps its older version until it stops.
- **Prepare for update.** The command palette entry "Prepare for update…" and the update card's
  link of the same name end the host on purpose: busy agents block the flow (with a Go button),
  idle agents are asked to exit cleanly where possible, a confirmation lists what will stop, and
  the app quits only after the host confirms it has shut down. Canvas nodes are never deleted;
  agents resume from their saved conversations on the next launch.
- **Shared session sizing.** A session viewed from more than one place (a canvas node and a phone
  over Relay) follows the most recently active viewer, clamped to any viewer that cannot adapt to
  another grid. Every viewer is told the size the session really runs at.
- **Agent messaging on Windows panes.** Agent-to-agent messages reach direct Windows PTYs and
  session-host panes: the receiving process is re-attested (including its process birth time)
  immediately before typing, the envelope is pasted as one block and submitted in a second write
  once it has rendered, and a paste whose submit cannot be confirmed is never pasted again.
- **No update channel.** A package built with updates switched off answers "Check for updates"
  with "No update channel" and a link to the download page, never "You're up to date".
- **Owed update button.** A staged, download-only or required update shows a persistent
  "Update" button in the top app bar until it is installed; dismissing the update card does not
  remove it.

## Configuration

- Persistent sessions follow **Settings → tmux → Persistent sessions**; with it off there is no
  session host and "Prepare for update…" is hidden.
- The staging root is fixed (`%LOCALAPPDATA%\node-terminal-session-host-runtime`) and supplied only
  to a packaged Windows build. A development checkout runs the host from the repository.

## Failure modes

- **Staging fails** (no `%LOCALAPPDATA%`, a missing required file, a failed hash, a smoke run that
  does not answer within 60 s, an application-control policy blocking executables under the
  profile): the launch is refused with a named reason, the node falls back to a non-persistent
  shell, and `session-host.log` records the failing step. The host is never launched from the
  install directory instead.
- **First launch of a new version takes longer than 45 s to stage:** that launch is refused; the
  finished copy serves the next one.
- **The host cannot end every session:** the shutdown fails by name, the host keeps serving and the
  app does not quit. A shutdown the host does not confirm is reported as unconfirmed, also without
  quitting.
- **A host started by an older build** cannot shut itself down; the dialog shows the manual steps.
- **An older host** refuses the messaging verbs; messaging to that pane reports the refusal and
  never falls back to raw keystrokes.

## Security considerations

- The prepare-for-update IPC channels refuse every sender except the main window and are listed in
  `HOST_ONLY_CHANNELS`, so no relay peer can end the host's sessions or quit the app.
- There is no kill fallback: the app never terminates a host process by name, and never ends a
  session by deleting its node.
- A staged directory without a valid marker is never launched; old copies are removed only after a
  successful process query proves nothing runs from them.
- Messaging re-attests the exact receiving process before typing, so a replaced process that reused
  the PID, or a shell that took the console back, is refused.

## Surfaces

- **Desktop (Windows):** everything above.
- **Server Edition:** no session-host staging and no updater; the bridge answers `unsupported`
  for prepare-for-update and the update surfaces stay hidden. Shared-session sizing and messaging
  apply wherever a server runs the session host.
- **Mobile companion:** not applicable to staging and updates. A phone mirroring a session-host node
  benefits from the shared-session sizing answer it already reads as `Resized`.

## Verification

- `src/core/session-host-runtime.test.ts`, `src/core/session-host-launcher.test.ts`: staging,
  verification, collection and the fail-closed launch.
- `src/session-host/shutdown-host.test.ts`, `src/core/session-host-client-shutdown.test.ts`:
  the negotiated shutdown command and the client's confirmation.
- `src/renderer/lib/updatePrep.test.ts`, `src/renderer/components/PrepareUpdateDialog.test.tsx`,
  `src/main/update-prep.test.ts`: the plan, the dialog and the IPC gating.
- `src/core/native-windows-pane.test.ts`, `src/core/windows-delivery-safety.test.ts`,
  `src/session-host/message-pane.test.ts`: messaging delivery and identity.
- `src/core/session-host-client-geometry.test.ts`, `src/session-host/geometry-host.test.ts`:
  shared-session sizing.
- `src/main/updater.no-channel.test.ts`, `src/renderer/state/pendingUpdate.test.ts`: the
  no-channel answer and the owed-update button.
- The Windows device checklist in `docs/windows-session-host.md` lists what has not run on a
  Windows machine yet.
