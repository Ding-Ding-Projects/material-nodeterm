# Building nodeterm from source

Three scripts live at the repository root, each with a Windows `.bat` and a POSIX `.sh` sibling.
They are shipped surfaces, not conveniences: a checkout with nothing installed should reach a
running app (or a real installer) by running one of them, and a broken one is worse than none.

| Script | Windows | macOS / Linux | What it does |
| --- | --- | --- | --- |
| Dependencies | `download-dependencies.bat` | `download-dependencies.sh` | Installs Node.js, Windows Python/native build tools, and every npm dependency the project needs. |
| Build | `build.bat` | `build.sh` | Runs the dependency script, builds `out/`, then offers to launch the app. |
| Installer | `build-installer.bat` | `build-installer.sh` | Runs the dependency script, then packages and verifies the platform installer. |

None of the three ever installs a secret, a credential, or a code-signing certificate. None of
them weakens the machine's persistent execution policy or requires administrator/sudo rights when
a user-scoped install path exists. Visual Studio Build Tools is the one Windows dependency with no
user-scoped installation. The root BAT never continues under an Administrator token: when Build
Tools needs work, it prints one helper-only command to run in an Administrator Command Prompt; close
that prompt afterward and rerun the root BAT normally.

## Flags

All three scripts accept the same silent-mode contract:

- Windows: `/s` or `--silent` as the first argument, or a `SILENT=1` environment variable.
- macOS/Linux: `-s` or `--silent` as an argument, or a `SILENT=1` environment variable.

Silent mode means **no prompts and no interactive pause of any kind**, and the script **exits
non-zero on the first real failure** so a caller (CI, another script) can branch on the exit code.
Without the flag, the scripts are still fully automatic except for `build`'s one prompt at the very
end (see below) — installing dependencies and building never pause to ask anything.

Every phase is re-runnable: a warm run re-verifies what is already present and skips it rather than
reinstalling, and an interrupted run never leaves anything half-written that the next run cannot
recover from.

## Invoking the `.bat` files: always by absolute path

`NoDefaultCurrentDirectoryInExePath=1` is a common hardened default on Windows. With it set,
`cmd /c download-dependencies.bat` fails with:

```
'download-dependencies.bat' is not recognized as an internal or external command,
operable program or batch file.
```

even though the file exists right there — cmd refuses to search the current directory for it. This
is not hypothetical: it reproduces on a stock developer machine, not only a locked-down one.

Always invoke these files by **absolute path** from automation:

```bat
cmd /c "C:\path\to\repo\download-dependencies.bat" /s
```

Running a script directly from an interactive prompt that is already sitting in the repository
root is unaffected. `build.bat` and `build-installer.bat` always call
`download-dependencies.bat` by absolute path (`%~dp0download-dependencies.bat`) for exactly this
reason, so the three scripts can never drift into calling each other by a relative path that
silently stops working on a hardened machine.

## `download-dependencies.bat` / `.sh`

Obtains every dependency needed to build, run and test nodeterm from canonical upstreams. It uses
per-project or user-scoped locations wherever the dependency supports one; Visual Studio Build
Tools is necessarily machine-wide.

**Node.js.**
1. On Windows, a `node` already on `PATH` is reused only when it runs and satisfies
   `^22.22.2 || ^24.15.0 || >=26.0.0`. A missing, broken, malformed, or unsupported candidate is
   not handed to npm; the BAT falls back to the manifest-pinned portable runtime.
2. Otherwise, on Windows: tries `winget install --id OpenJS.NodeJS.LTS --source winget --scope user` (a **user
   scope** install, no administrator rights). On macOS: tries `brew install node` if Homebrew is
   present. On Linux: tries `apt-get install nodejs npm` through a non-interactive `sudo -n` (skipped
   entirely if that would need a password prompt). A Windows winget result is subjected to the
   same supported-version gate before use.
3. If the package manager is unavailable, fails, or returns an unsupported Windows Node, falls
   back to a **portable extract**: downloads
   the exact Node.js build pinned in `dependencies.manifest.json` for the current OS/architecture,
   verifies its SHA-256 against the value recorded there, and extracts it into a user-scoped
   toolchain directory (`%LOCALAPPDATA%\nodeterm\toolchain` on Windows, `~/.nodeterm/toolchain` on
   macOS/Linux). A file that does not match its recorded hash is deleted and treated as a failure —
   it is never used. Before extraction, the BAT removes the exact manifest-version destination and
   refuses to continue if it cannot; a stale `node.exe` cannot make an empty or broken archive look
   successful. The extracted executable must report the manifest's exact version and satisfy the
   root range.
4. **Windows C++ build toolchain.** Once Node is callable,
   `scripts/ensure-windows-build-toolchain.mjs` checks for the complete C++ workload and real x86/x64
   libraries below `VC\Tools\MSVC\*\lib\spectre`. If an instance is incomplete, it runs the
   installed `setup.exe modify --installPath ... --add
   Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`. On a machine without Visual
   Studio, it downloads the exact Microsoft bootstrapper pinned in
   `dependencies.manifest.json`, verifies its recorded SHA-256 in Node, stages it below protected
   Program Files, and runs only that verified file with the C++ workload and Spectre component.
   It deliberately does not resolve `winget.exe` or another privileged program through a
   user-controlled `PATH`. `/s` maps to Visual Studio's `--quiet`; a normal run uses
   `--passive`; both use `--norestart`. The installed `setup.exe` is invoked synchronously without
   `--wait` (that switch is bootstrapper-only), while the fresh-machine bootstrapper does receive
   `--wait`. Exit success is never trusted by itself: the script rechecks both the workload and real
   `.lib` files for x86 and x64. On an ARM64 host it additionally installs
   `Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre` and verifies ARM64 libraries while
   retaining x86/x64 for this repository's x64 packaging target.

   Microsoft requires quiet/passive Visual Studio commands to start elevated, even when enterprise
   policy delegates some Installer UI to a standard user. The bootstrap checks the token before
   starting an installer. If work is needed and the prompt is not elevated, it exits access-denied
   and prints an absolute command ending in `--silent --elevated-toolchain-only`. Run **only that
   helper command** in an Administrator Command Prompt, close the elevated prompt, then rerun the
   root BAT normally. Never run the root BAT or npm as Administrator. The helper never launches
   UAC: `/s` promises no prompts, and non-silent dependency installation is automatic too.
5. **Windows Python for node-gyp.** The locked dependency graph runs node-gyp during `npm ci`, and
   the C++ workload does not include Python. `scripts/ensure-windows-python.mjs` reuses a supported
   explicitly selected 64-bit Python 3.10-3.14 or its pinned private interpreter when available.
   It never launches bare `py.exe`/`python.exe` aliases as a probe because current Windows aliases
   can install a runtime or open UI. Otherwise it installs pinned Python 3.13 per-user through
   canonical winget, falling back to the official python.org installer only after verifying the
   manifest SHA-256. It installs no launcher and changes no persistent `PATH`; the verified absolute
   `python.exe` is exported process-locally as `PYTHON`, `NODE_GYP_FORCE_PYTHON`, and
   `npm_config_python`. Installer exit zero is followed by an
   isolated exact-version/architecture probe before npm may run.
6. **Windows build preflight.** After all bootstraps, and before npm can remove
   `node_modules`, `download-dependencies.bat` runs `scripts/check-build-preflight.mjs`.
   This placement is deliberate: on a truly fresh machine there was no Node with which to run
   the old pre-dependency preflight, so it was skipped and never retried before `npm ci`.
   The POSIX script has no equivalent because both checks are Windows-specific.
7. **npm project dependencies.** Runs `npm ci` when `package-lock.json` exists, otherwise
   `npm install`.

**Why a portable Node install never touches your real `PATH`.** `setx PATH "<huge string>"` on
Windows truncates silently once the value gets long enough, and this script has no way to know how
close to that limit an arbitrary machine's `PATH` already sits — so `PATH` is never rewritten
persistently. Instead, the portable Node's location is remembered in one dedicated variable
(`NODETERM_NODE_HOME`, a Windows user environment variable set via `[Environment]::SetEnvironmentVariable`,
or a one-line file at `~/.nodeterm/node-home` on macOS/Linux) and prepended to `PATH` for the
current command process — and to that process only. On Windows the batch file uses `setlocal` for
   its scratch values but explicitly exports this refreshed `PATH`, `NODETERM_NODE_HOME`, and the
   verified interpreter through `PYTHON`, `NODE_GYP_FORCE_PYTHON`, and `npm_config_python` when a
   caller uses `call`; otherwise `build.bat` would immediately lose the runtimes it had
just installed.
On macOS/Linux, add it to your shell profile yourself if you want it to persist:
```sh
export PATH="$(cat ~/.nodeterm/node-home):$PATH"
```

**Why the script re-reads `PATH` after a package-manager install (Windows).** A package manager
like `winget` writes the installed program's location into the registry for **future** processes
only — the shell that just launched it does not see the change. Without a refresh, the very next
command in the same script would still fail to find what was just installed, which reads as "the
install failed" when it in fact succeeded. `download-dependencies.bat` re-reads
`[Environment]::GetEnvironmentVariable('Path', 'Machine'/'User')` (with `ExpandEnvironmentVariables`,
because the registry stores segments like `%SystemRoot%` un-expanded) into the current process's
`PATH` immediately after every install that could have changed it.

**Failure messages.** Every failure names the exact dependency, the version constraint, the source
that was tried, and the underlying error — never a bare "failed". For example:

```
[FAILED] Node.js runtime
  Dependency : node.js (portable, win-x64)
  Constraint : sha256 57f71ab3... recorded in dependencies.manifest.json
  Source     : https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip
  Error      : downloaded file hashed to <other hash> instead - refusing to use an unverified binary
```

**`dependencies.manifest.json`** is the committed, hand-auditable record of exactly which binaries
and installer selections this script may place on disk: pinned Node.js/Python versions, canonical
winget package ids, the C++ workload/Spectre component ids, and exact URL + SHA-256 values for Node
portable archives, both Python architectures, and the Visual Studio Build Tools fallback. Winget
independently verifies packages against its own manifest hashes. Nothing the script downloads is
ever committed to the repository itself.

## `build.bat` / `.sh`

Takes a checkout with nothing installed to a built, runnable program:

0. Calls `download-dependencies.{bat,sh}` (by absolute path on Windows — see above), rather than
   duplicating its logic, so the two scripts can never silently drift apart. On Windows that
   script bootstraps Node, automatically ensures the Visual Studio C++ workload/Spectre libraries
   and Python, and then runs **the preflight** (`scripts/check-build-preflight.mjs`) before `npm ci`
   removes `node_modules` wholesale. Windows refuses to delete a
   binary a live process has mapped — so a forgotten dev window kills the install on
   `node_modules\electron\dist\electron.exe`, with npm's own `EPERM` and no mention of the app
   holding it. Measured: `build.bat /s` failed exactly that way, and all its report could say was
   *"see the npm output above for the real cause"*. It now names the file and the PID, and reports
   any still-missing Spectre libraries in the same run as an independent verification — both
   blockers in about three seconds rather than one after several minutes of the other.

   The preflight is no longer skipped when Node is initially absent: Node bootstrap is its explicit
   prerequisite, and npm install is its explicit successor. This also covers running
   `download-dependencies.bat` directly.

   The `.sh` scripts do not call it. Unlinking an open file is ordinary on macOS and Linux, and
   the Spectre check is Windows-only by construction, so there it would be a phase that can never
   fail.

1. Removes the complete generated `out/` tree, refuses to start npm if anything keeps that stale
   tree alive, runs `npm run build` (`electron-vite build`), and confirms the main, preload,
   renderer, and session-host outputs are regular non-empty files. A green no-output command can
   never inherit yesterday's artifact.
2. **Only then**, asks whether to launch the app (`npm start`). This prompt is deliberately the
   **last** thing the script does: a failed build never gets as far as offering to launch nothing.
   In silent mode, the app is never launched automatically — a CI run should not pop a desktop GUI
   on somebody's behalf — the script just prints how to start it by hand.

## `build-installer.bat` / `.sh`

Produces the same installable artifact CI publishes, through the same supported packaging path and
the same version as `package.json`:

1. Calls `download-dependencies.{bat,sh}` (by absolute path on Windows), including the Windows
   post-bootstrap/pre-npm preflight above.
2. Packages through `electron-builder`:
   - Windows: `npm run dist:win` → **Squirrel.Windows** (`dist/squirrel-windows/`: the setup
     `.exe`, the `RELEASES` index, and the full `.nupkg`).
   - macOS: `npm run dist` → `.dmg` + `.zip` (arm64 + x64) into `dist/`.
   - Linux: `npm run dist:linux` → `.AppImage` + `.deb` into `dist/`.
3. **Verifies what was actually built**, rather than trusting `electron-builder`'s exit code alone:
   - the expected artifact file exists;
   - it is at least 5 MiB (a plausible-size floor that only exists to catch an obviously
     truncated or empty file, not a target);
   - on Windows, the directory contains the exact versioned Setup and legacy `node-terminal`
     full package (plus only the matching delta when emitted), exact `RELEASES`, and no other
     entry. Every package has one semantic nuspec whose ID/version/title match `package.json`, and
     every RELEASES SHA-1, filename, and byte size is checked bidirectionally;
   - the generated seven-frame `build/icon.ico` is committed at the exact source SHA, downloadable
     from that immutable raw GitHub URL with identical bytes, and embedded byte-for-byte in Setup,
     `nodeterm.exe`, and `nodeterm_ExecutionStub.exe`; their product/version resources must match
     the package identity, and the full nupkg's nuspec must contain the same immutable `iconUrl`.
     The exact source commit must already be reachable from the public GitHub repository; a
     local-only commit fails rather than embedding an unreachable URL. Squirrel's vendor
     `Update.exe` remains vendor-branded because the pinned builder exposes no supported
     resource-edit hook;
   - Windows PowerShell must report exact Authenticode status `NotSigned`; every other status,
     an empty result, or a probe error fails closed;
   - reports the artifact's full path and its **SHA-256**, and (best-effort, if `git` is
     available) the exact commit it was built from and whether the working tree was clean or
     dirty at build time.
4. States plainly, every time, that **the installer is unsigned**. Code signing is permanently out
   of scope: root `build.forceCodeSigning` and `build.win.signExecutable` are `false`.
   `build.win.signAndEditExecutable` remains enabled at its default so electron-builder still writes
   the application icon and version resources; disabling signing must not disable resource editing.
   The mac build uses `identity=null` / `notarize=false`. Installing or opening the artifact triggers
   Windows SmartScreen /
   "unknown publisher" or macOS Gatekeeper warnings. That is expected, not a build defect.
5. **Never publishes, tags, pushes, or creates a release.** It only builds and verifies a local
   artifact. Shipping a real release is a separate, deliberate action outside these scripts.

## Windows batch implementation notes

For anyone maintaining `download-dependencies.bat`, `build.bat`, or `build-installer.bat`:

- **Line endings must be CRLF.** A `.bat` file saved with Unix LF-only line endings can silently
  break `goto`/label resolution deep in the file — a `goto :some_label` that works perfectly in a
  small standalone reproduction can fail with `The system cannot find the batch label specified`
  once more code follows it in the same file, purely because of the line-ending mismatch. This was
  hit and fixed while writing these scripts; all three are committed with CRLF line endings, and
  any edit that reintroduces LF-only endings will reintroduce the bug.
- **Exit codes are captured explicitly**, never left to a trailing command to mask a real failure:
  every `npm`/`electron-builder` invocation is followed by `set "X_EXIT=%ERRORLEVEL%"` on its own
  line (immediately, before any other command like `popd` can overwrite `%ERRORLEVEL%`), and the
  captured value is checked afterward.
- **`setlocal EnableExtensions DisableDelayedExpansion`** is set at the top of every script, and
  inherited `ERRORLEVEL`/`RANDOM` variables are cleared before use because they shadow cmd's
  dynamic pseudo-variables. Explicitly enabling extensions recovers safely from `cmd /e:off`;
  disabling delayed expansion preserves a legitimate `!` in an inherited `PATH`. The dependency
  script ends its local scope by exporting only `PATH`, `NODETERM_NODE_HOME`, `PYTHON`,
  `NODE_GYP_FORCE_PYTHON`, and `npm_config_python`; every scratch variable remains private to it.
- **PowerShell is invoked as inline `-Command` text, never as a `.ps1` script file** — timestamp
  arithmetic for phase timings, JSON parsing of `dependencies.manifest.json`, file hashing, and
  archive extraction all go through one-line `powershell -NoProfile -Command "..."` calls. Paths,
  URLs, and architecture selectors cross that boundary through environment variables, never by
  interpolation into PowerShell source, so spaces and apostrophes remain data. Execution
  policy only gates running script *files*; inline `-Command` text is unaffected, so there is
  nothing here that needs `-ExecutionPolicy Bypass`, and the machine's persistent policy is never
  touched. SHA-256 uses .NET directly, not `Get-FileHash`: a batch file launched from PowerShell 7
  can pass its module path to Windows PowerShell 5.1, where auto-loading that cmdlet then fails.

## Manual verification performed while writing these scripts

Earlier versions of `download-dependencies.bat` and `build.bat` were run end-to-end on a real
Windows checkout with `node_modules` removed; that run exposed the missing native-toolchain
bootstrap now handled above. `download-dependencies.sh`, `build.sh`, and `build-installer.sh` were
syntax-checked (`sh -n`) and exercised on the same machine through Git Bash for their
already-on-`PATH` fast path; their OS-specific install branches (Homebrew, `apt-get`, and the
macOS/Linux portable-Node fallback) could not be exercised on a Windows host and should be
verified on a real macOS/Linux machine before being relied on unattended.

The Windows entry points now also have an automated behavioral regression test
(`src/core/build-bat.test.ts`). It runs the production `.bat` files through a real `cmd.exe`
against an isolated checkout-shaped fixture; only external/expensive leaves are replaced. The test
proves toolchain and Python verification precede preflight/npm, the portable Node `PATH` and
verified `PYTHON` survive the called batch file's `setlocal`, silent build mode does not launch the
app, and the installer verifies exact versioned Squirrel/nuspec/RELEASES/signature/icon contracts
plus a real SHA-256. Mutation rows prove stale or incomplete output, an unsupported or
negatively-exiting PATH Node, poisoned cmd pseudo-variables, a stale exact portable directory,
manifest metacharacters, RELEASES hash/name/size changes, wrong-but-self-consistent package
identity, extra residue, non-`NotSigned` signatures, and valid-looking digests from failed hash
processes all turn the real BAT red. A forced portable
  route crosses real `cmd.exe` and a process-boundary PowerShell recorder with spaces, `!`, `&`,
  parentheses, and an apostrophe in its paths. It also plants a stale higher-version Node directory
  and proves the exact manifest-selected directory wins. Reintroducing a manifest path into
  PowerShell source makes that test fail before download; removing the `PATH` export makes both
  parent-entry tests fail with `npm is not recognized`. Installer verification clears an inherited
  digest and requires exactly 64 hexadecimal characters with no second line.

The prior hosted `windows-latest` run `31960569072` at
`19e8296b9f355e0e11e5ee7ab25856f9d3351cef` used Node `22.23.2` and produced the unsigned
`v0.3.0-ci.182` Squirrel set with Setup reported as Authenticode `NotSigned`. It used setup-node
plus direct npm packaging and predates this wrapper, icon, version-identity, and current root-BAT
contract. A production BAT build from the final integrated commit, real installation, launch,
update, and uninstall remain unverified.
