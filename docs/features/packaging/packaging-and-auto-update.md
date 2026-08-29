# Packaging & auto-update

**Category:** [Packaging](./README.md)

How a checkout becomes an installable desktop build, and how an installed build safely applies a
newer one.

## Behaviour

**Building.** The desktop app uses
[electron-builder](https://www.electron.build/). The active Windows delivery target is one
unsigned Squirrel.Windows set: `Setup.exe`, `RELEASES`, one full `.nupkg`, and any delta package
Squirrel emits for the candidate. ZIP, NSIS-only, MSI-only, MSIX-only, and portable-only Windows
outputs are not supported parallel release routes. Native dependencies are rebuilt against the
Electron ABI during installation.

Source builds use the exact Node 24.19.0 runtime and SHA-256 recorded in
`dependencies.manifest.json`. `download-dependencies.bat` checks that manifest pin before its first
PATH runtime is accepted, so a different compatible application runtime is replaced by the pinned
portable build runtime before `npm ci`. The root `devEngines` requirement also refuses direct npm
source operations under a different Node version before dependency lifecycle scripts run. This is
separate from the wider Node range supported by the installed Server Edition. The runtime probe and
portable URL/SHA record are validated by one JavaScript contract before any manifest value returns
to the batch bootstrap.

The separation prevents toolchain metadata from leaking into native add-ons. In particular, Node
26.4.0 reports Clang thin LTO with two linker jobs; its downloaded `common.gypi` maps those values to
`-flto=thin` and `/opt:lldltojobs=2`. MSVC does not accept that inherited linker option when
building `smart-whisper`. The package itself does not declare those flags, so patching generated
`node_modules` is neither necessary nor a supported fix.

The C++ bootstrap similarly binds discovery, preflight, and node-gyp to one installation. It reads
each supported Visual Studio instance's declared default toolset, prefers an already complete
instance with matching x86/x64 Spectre libraries, and returns that exact installation through
`VCINSTALLDIR` before npm starts. Preflight then checks the active default toolset at that path.
An older mitigated toolset elsewhere on the machine cannot hide missing libraries in the instance
MSBuild will actually use, and the bootstrap does not modify an unrelated complete installation.

The supported Windows entry point is `npm run dist:win`. Its wrapper starts from a clean checkout,
regenerates the committed seven-frame ICO, proves that the bytes match the current commit, derives
an immutable raw URL from that full source SHA, and verifies the public download byte-for-byte.
Each phase writes synchronous start, completion, or failure diagnostics, and the command awaits
the complete phase chain before setting its exit status. A post-icon failure therefore names the
exact phase instead of appearing as a silent early exit.
The production immutable icon download uses a bounded Node HTTPS stream with a refed 15-second
request deadline, status 200 and redirect refusal, optional content-length validation, streaming
byte limits before buffering, exact byte comparison, and ICO validation. Tests may still inject
the existing fetch-style transport seam without changing production transport.
After packaging, it requires the exact expected output inventory, semantic nupkg ID/version/title,
bidirectional `RELEASES` name/size/SHA-1 agreement, the same nuspec `iconUrl`, and matching icon and
version resources in Setup, the installed app, and its execution stub. The local-installer BAT and
publication workflow separately accept only exact Setup Authenticode `NotSigned`. Squirrel's vendor
`Update.exe` remains vendor-branded because the pinned builder exposes no supported project hook
for rewriting it.

The packaged-runtime check also requires `sharp/package.json` and exactly one Windows x64 Sharp
native module under `app.asar.unpacked`. Sharp is a production dependency only, never duplicated
under `devDependencies`; npm otherwise marks the package and its platform binary development-only,
and electron-builder removes both. Image conversion resolves Sharp lazily at the point of use, so
a future package-layout failure is reported by that converter instead of terminating desktop
startup before a window exists.

The tiny desktop startup entry remains independent of the normal application graph. If any early
bootstrap import still fails, it writes only a sanitized failure category and opens a native
recovery dialog before exiting. The dialog explains whether a packaged component is missing,
states that reinstalling the same incomplete release cannot repair it, directs the user to a newer
repaired release, and confirms that settings and projects were not removed. Local paths and raw
exception messages never enter that dialog.

The asynchronous `app.whenReady()` registration chain has the same recovery boundary. A duplicate
IPC owner or a rejected startup service cannot leave a windowless or black host process running:
the chain reports the sanitized category through the shared startup reporter, shows a native
recovery dialog, and exits with status 1. Electron's duplicate handler error is classified as
`DUPLICATE_HANDLER`; the internal channel name is never copied into the log or dialog. The
reporter remains injectable so dialog failure and exit behavior are tested together. Shared
provider services own the portable-binding channels exactly once; the desktop shell does not
register a competing copy after that shared registrar returns.

**Windows auto-update.** Packaged Windows builds use Electron's built-in Squirrel updater. On
launch and every six hours, it reads the stable release asset root at
`https://github.com/Ding-Ding-Projects/material-nodeterm/releases/latest/download`, downloads a
newer package in the background, then shows a non-blocking **Restart to update** card. Restart is
an explicit way to apply it immediately and is accepted only once after the download-ready event.
A successfully downloaded Squirrel update can also apply on the next normal app launch even when
that button was never used.

Squirrel does not expose byte-level progress through Electron's built-in updater. The card
therefore shows an honest indeterminate download, not an invented `0%` or a made-up version.
Duplicate checks are coalesced while one check/download is active. Squirrel's install, updated,
uninstall, and obsolete command-line events run before the normal application graph loads; a
first-run launch waits briefly before its automatic check so Update.exe can release its package
lock.

**One-time `0.3.0` migration.** Installed Windows `0.3.0` cannot discover `0.4.0`: that build asks
`electron-updater` for NSIS metadata at the old generic feed, which does not serve the Squirrel
release set. A user must download and run the `0.4.0` Setup manually. Until the production path is
proved on real Windows, closing `0.3.0` first is only a provisional recommendation. Because that
build lacks the new `--squirrel-obsolete` startup handling, the final proof must exercise manual
Setup with the old app both closed and running, then publish the supported sequence. This
production-identity `0.3.0` → `0.4.0` proof is separate from the isolated `.1` → `.2` fixture
below, which proves only the updater code first shipped in `0.4.0`.

**Release authority.** The updater does not decide whether a GitHub release came from the right
branch by parsing release metadata in the app. Instead, the stable feed is controlled at its
source: the release workflow accepts pushes to `main` and manual dispatch, refuses refs other than
`main`, and publishes one uniquely versioned stable release after the complete Squirrel asset set
has been checked. Feature-branch and prerelease packages must never be made the latest stable
release. Publication still does not claim installed-app interaction proof; that remains a separate
verification boundary.

**Other platforms.** Linux deliberately retains `electron-updater` and its existing
feed/manual-download behavior. The Server Edition has no desktop installer, and the separately
maintained mobile companion does not consume Squirrel packages, so this updater is explicitly not
applicable to those two surfaces.

## Configuration

- `npm run make-icon` regenerates the desktop icons from the project's source mark.
- `npm run dist:win` produces the unsigned Windows Squirrel set without publishing it. It requires
  a clean commit that is already reachable in the public GitHub repository so its exact-SHA icon URL
  can be proved before packaging.
- The stable Windows feed is fixed to the project's GitHub Release asset root; it is not an
  end-user setting. Squirrel consumes the HTTPS `RELEASES` metadata and its recorded package
  hashes; the app does not add a second competing feed parser. The release is intentionally
  unsigned, so Windows may show an unknown-publisher warning during installation.
- Only a build whose version is in the `fixture` prerelease channel may honor
  `NODETERM_SQUIRREL_FIXTURE_URL`, and that override accepts only loopback HTTP(S). Stable and
  unrelated prerelease builds refuse it.

## Failure modes

- **The feed is offline or returns 404:** the installed version keeps running and scheduled checks
  retry normally. A user-requested check reports the problem non-blockingly; a failed read is
  never presented as proof that no update exists.
- **A check is already active:** another request joins the existing lifecycle instead of starting
  a second download.
- **A package is corrupt or the download fails:** Squirrel refuses to mark it ready, so restart
  cannot invoke installation and the current version remains intact.
- **A required main-process runtime package is missing:** packaging fails before publication. The
  Sharp check verifies both JavaScript package metadata and the Windows x64 native module. This
  prevents the `0.4.142` failure mode where reinstalling succeeded but every normal launch exited
  with `MODULE_NOT_FOUND` before Chromium logging or a window could start.
- **The downloaded release name parses as non-newer or wrong-channel:** the card diagnoses the
  mismatch and refuses the immediate-restart action. This is not an install barrier: Squirrel may
  still apply a successfully downloaded package on the next normal launch. The manual `main`-only
  stable publisher must keep such a package out of the stable feed in the first place.
- **The build is unsigned:** Windows SmartScreen warns on the first downloaded installer. Signing
  is permanently out of project scope; releases disclose this rather than suggesting the artifact
  is signed.

## Security considerations

- Stable Windows packages come only from the project's stable GitHub Release. Verify the release's
  target commit, asset inventory, and hashes because the artifact itself is intentionally unsigned.
- The app delegates `RELEASES` selection and download to Squirrel. It does not prefetch and parse a
  second copy, avoiding a time-of-check/time-of-use gap between policy and installation.
- Fixture builds use temporary identity `name` `node-terminal-squirrel-fixture`, `productName`
  `nodeterm Squirrel Fixture`, and `appId` `com.nodeterm.squirrel-fixture`, and run only in a
  disposable Windows Sandbox/VM. They must not share any production name/product/application id.

## Verification

Controller checks cover feed/protocol selection, strict version advancement, wrong-channel
diagnostics/immediate-restart refusal, duplicate checks and installs, progress truth,
ready-before-restart, and offline/404 degradation. Those deterministic checks do not replace a
packaged interaction.

The previously documented disposable-checkout commands are intentionally not presented as a
supported packaging recipe now. They changed `package.json` and `package-lock.json` in place and
then called `npm run dist:win`, but the production wrapper now correctly refuses a dirty source tree
and requires the current commit's icon to be publicly reachable. A dedicated fixture-only
provenance route must be designed and reviewed before creating `0.4.0-fixture.1` and `.2`; the
production wrapper must not gain a broad dirty-tree exception. When that route exists, the runtime
versions remain dotted while `electron-winstaller` normalizes their NuGet package versions to
`0.4.0-fixture1` and `0.4.0-fixture2` in package names and `RELEASES`.

Then perform the installed interaction:

1. Confirm the generated pair has exactly the fixture name, product name, application id, and
   `.1`/`.2` versions above. No production name, productName, appId, or install directory may be
   reused.
2. Keep the fixture server command running and record the feed URL it prints, but do **not** set
   `NODETERM_SQUIRREL_FIXTURE_URL` for the installer-created first run.
3. Install `.1` with the feed variable absent. Its `--squirrel-firstrun` launch is the normal app,
   so it does not exit by itself: wait at least 10 seconds for Update.exe's lock to clear, use the
   fixture app's **Quit** action, and verify that process exited. Resolve its installed executable
   from the exact fixture registration, then set the printed feed URL and launch that installed
   executable—not the unpacked build:

   ```powershell
   $fixtureRegistrations = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'nodeterm Squirrel Fixture')
   if ($fixtureRegistrations.Count -ne 1) { throw "Expected exactly one fixture registration, found $($fixtureRegistrations.Count)" }
   $updateMatch = [regex]::Match([string]$fixtureRegistrations[0].UninstallString, '^"?(?<path>.+?Update\.exe)"?(?:\s|$)')
   if (-not $updateMatch.Success) { throw 'Fixture registration did not identify Update.exe' }
   $fixtureUpdateExe = $updateMatch.Groups['path'].Value
   $fixtureInstallRoot = Split-Path -Parent $fixtureUpdateExe
   $fixtureExecutables = @(Get-ChildItem -LiteralPath $fixtureInstallRoot -Recurse -Filter '*.exe' | Where-Object { $_.VersionInfo.ProductName -eq 'nodeterm Squirrel Fixture' -and $_.Name -notlike '*_ExecutionStub.exe' })
   if ($fixtureExecutables.Count -ne 1) { throw "Expected exactly one installed fixture executable, found $($fixtureExecutables.Count)" }
   $env:NODETERM_SQUIRREL_FIXTURE_URL = '<feed URL printed by the fixture server>'
   & $fixtureExecutables[0].FullName
   ```

   This discovers the fixture install dynamically; it never assumes a fixed `%LOCALAPPDATA%`
   path.
4. Change one harmless setting, then verify an indeterminate download appears, immediate restart
   is unavailable before ready, and **Restart to update** is accepted only once. Repeat the full
   `.1` install/update/uninstall trial with a fresh fixture install for the normal-next-launch path:
   leave the downloaded update ready, quit normally without using the button, and prove `.2` opens
   on the next launch. One installed pair cannot simultaneously prove both mutually exclusive
   restart choices.
5. After `.2` launches, verify Settings → Updates / `app.getVersion()`, the installed executable
   and package version metadata, and that the changed setting persisted. Stop the server and verify
   an explicit check reports an error while the installed app remains usable.
6. Use the fixture app's **Quit** action, wait for every process whose executable is under the exact
   fixture install root to exit, then re-read the exact `nodeterm Squirrel Fixture` registration
   and invoke only the resolved update executable from step 3:

   ```powershell
   $fixtureRootPrefix = [IO.Path]::GetFullPath($fixtureInstallRoot) + [IO.Path]::DirectorySeparatorChar
   $deadline = [DateTime]::UtcNow.AddSeconds(15)
   do {
     $fixtureProcesses = @(Get-Process | Where-Object {
       try { $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($fixtureRootPrefix, [StringComparison]::OrdinalIgnoreCase) }
       catch { $false }
     })
     if ($fixtureProcesses.Count -eq 0) { break }
     Start-Sleep -Milliseconds 250
   } while ([DateTime]::UtcNow -lt $deadline)
   if ($fixtureProcesses.Count -ne 0) { throw "Refusing cleanup: exact fixture process is still running ($($fixtureProcesses.Id -join ', '))" }

   $fixtureRegistrations = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'nodeterm Squirrel Fixture')
   if ($fixtureRegistrations.Count -ne 1) { throw "Refusing cleanup: expected one exact fixture registration, found $($fixtureRegistrations.Count)" }
   Start-Process -FilePath $fixtureUpdateExe -ArgumentList '--uninstall' -Wait
   $fixtureRegistrationsAfter = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'nodeterm Squirrel Fixture')
   if ($fixtureRegistrationsAfter.Count -ne 0 -or (Test-Path -LiteralPath $fixtureInstallRoot)) { throw 'Fixture uninstall did not finish cleanly' }
   ```

   Never remove a directory by a guessed path, and never remove or overwrite the production
   identity.

This change designs and tests that fixture but does not install either package. Two real Windows
interactions remain pending: the production-identity `0.3.0` → `0.4.0` manual Setup migration,
and the isolated `0.4.0-fixture.1` → `.2` automatic-update proof for the new code. Manual release
publication remains pending both.

## Suggested articles

- [Windows support](../../windows-support.md) — Windows packaging and installed-runtime proof.
- [Server Edition](../remote/server-edition.md) — the intentionally separate headless install path.
