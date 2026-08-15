# Building nodeterm from source

Three scripts live at the repository root, each with a Windows `.bat` and a POSIX `.sh` sibling.
They are shipped surfaces, not conveniences: a checkout with nothing installed should reach a
running app (or a real installer) by running one of them, and a broken one is worse than none.

| Script | Windows | macOS / Linux | What it does |
| --- | --- | --- | --- |
| Dependencies | `download-dependencies.bat` | `download-dependencies.sh` | Installs Node.js (if missing) and every npm dependency the project needs. |
| Build | `build.bat` | `build.sh` | Runs the dependency script, builds `out/`, then offers to launch the app. |
| Installer | `build-installer.bat` | `build-installer.sh` | Runs the dependency script, then packages and verifies the platform installer. |

None of the three ever installs a secret, a credential, or a code-signing certificate. None of
them weakens the machine's persistent execution policy or requires administrator/sudo rights when
a user-scoped install path exists.

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

Obtains every dependency needed to build, run and test nodeterm, from canonical upstreams, into
per-project or user-scoped locations.

**Node.js.**
1. If `node` already resolves on `PATH`, nothing is installed.
2. Otherwise, on Windows: tries `winget install --id OpenJS.NodeJS.LTS --scope user` (a **user
   scope** install, no administrator rights). On macOS: tries `brew install node` if Homebrew is
   present. On Linux: tries `apt-get install nodejs npm` through a non-interactive `sudo -n` (skipped
   entirely if that would need a password prompt).
3. If the package manager is unavailable or fails, falls back to a **portable extract**: downloads
   the exact Node.js build pinned in `dependencies.manifest.json` for the current OS/architecture,
   verifies its SHA-256 against the value recorded there, and extracts it into a user-scoped
   toolchain directory (`%LOCALAPPDATA%\nodeterm\toolchain` on Windows, `~/.nodeterm/toolchain` on
   macOS/Linux). A file that does not match its recorded hash is deleted and treated as a failure —
   it is never used.
4. **npm project dependencies.** Runs `npm ci` when `package-lock.json` exists, otherwise
   `npm install`.

**Why a portable Node install never touches your real `PATH`.** `setx PATH "<huge string>"` on
Windows truncates silently once the value gets long enough, and this script has no way to know how
close to that limit an arbitrary machine's `PATH` already sits — so `PATH` is never rewritten
persistently. Instead, the portable Node's location is remembered in one dedicated variable
(`NODETERM_NODE_HOME`, a Windows user environment variable set via `[Environment]::SetEnvironmentVariable`,
or a one-line file at `~/.nodeterm/node-home` on macOS/Linux) and prepended to `PATH` for the
current process — and to the current process only. On macOS/Linux, add it to your shell profile
yourself if you want it to persist:
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
this script may place on disk: the pinned Node.js version, the `winget` package id, and the exact
URL + SHA-256 for every portable-install fallback (Windows x64/arm64, macOS x64/arm64, Linux x64).
Nothing the script downloads is ever committed to the repository itself.

## `build.bat` / `.sh`

Takes a checkout with nothing installed to a built, runnable program:

0. **Preflight** (`scripts/check-build-preflight.mjs`), on Windows the phase that matters most.
   `npm ci` in the next step removes `node_modules` wholesale, and Windows refuses to delete a
   binary a live process has mapped — so a forgotten dev window kills the install on
   `node_modules\electron\dist\electron.exe`, with npm's own `EPERM` and no mention of the app
   holding it. Measured: `build.bat /s` failed exactly that way, and all its report could say was
   *"see the npm output above for the real cause"*. It now names the file and the PID, and reports
   the missing Spectre-mitigated MSVC libraries in the same run — both blockers in about three
   seconds rather than one after several minutes of the other.

   Skipped, not failed, when `node` is not on `PATH` yet: the dependency phase is what installs
   node, so a genuinely fresh machine must not be blocked by a check that needs it.

   The `.sh` scripts do not call it. Unlinking an open file is ordinary on macOS and Linux, and
   the Spectre check is Windows-only by construction, so there it would be a phase that can never
   fail.

1. Calls `download-dependencies.{bat,sh}` (by absolute path on Windows — see above), rather than
   duplicating its logic, so the two scripts can never silently drift apart.
2. Runs `npm run build` (`electron-vite build`) and confirms `out/main/index.js` actually exists
   afterward — never trusting a green exit code alone.
3. **Only then**, asks whether to launch the app (`npm start`). This prompt is deliberately the
   **last** thing the script does: a failed build never gets as far as offering to launch nothing.
   In silent mode, the app is never launched automatically — a CI run should not pop a desktop GUI
   on somebody's behalf — the script just prints how to start it by hand.

## `build-installer.bat` / `.sh`

Produces the same installable artifact CI publishes, through the same supported packaging path and
the same version as `package.json`:

1. Calls `download-dependencies.{bat,sh}` (by absolute path on Windows).
2. Packages through `electron-builder`:
   - Windows: `npm run dist:win` → **Squirrel.Windows** (`dist/squirrel-windows/`: the setup
     `.exe`, the `RELEASES` index, and the full `.nupkg`).
   - macOS: `npm run dist` → `.dmg` + `.zip` (arm64 + x64) into `dist/`.
   - Linux: `npm run dist:linux` → `.AppImage` + `.deb` into `dist/`.
3. **Verifies what was actually built**, rather than trusting `electron-builder`'s exit code alone:
   - the expected artifact file exists;
   - it is at least 5 MiB (a plausible-size floor that only exists to catch an obviously
     truncated or empty file, not a target);
   - on Windows, the Squirrel `RELEASES` index and at least one `.nupkg` also exist beside the
     setup executable;
   - reports the artifact's full path and its **SHA-256**, and (best-effort, if `git` is
     available) the exact commit it was built from and whether the working tree was clean or
     dirty at build time.
4. States plainly, every time, that **the installer is unsigned**. Code signing is permanently out
   of scope for this project (see `package.json`'s `win.forceCodeSigning` / `signExecutable` /
   `signAndEditExecutable`, all pinned to `false`, and the mac build's `identity=null` /
   `notarize=false`) — installing or opening the artifact will trigger Windows SmartScreen /
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
- **`setlocal EnableDelayedExpansion`** is set at the top of every script. Plain `%VAR%` expansion
  is used everywhere it is safe (any read that happens as its own statement, outside a parenthesized
  block that both set and needs to re-read the same variable); `!VAR!` delayed expansion is used the
  few places a variable is both set and read within the same `(...)` block.
- **PowerShell is invoked as inline `-Command` text, never as a `.ps1` script file** — timestamp
  arithmetic for phase timings, JSON parsing of `dependencies.manifest.json`, file hashing, and
  archive extraction all go through one-line `powershell -NoProfile -Command "..."` calls. Execution
  policy only gates running script *files*; inline `-Command` text is unaffected, so there is
  nothing here that needs `-ExecutionPolicy Bypass`, and the machine's persistent policy is never
  touched.

## Manual verification performed while writing these scripts

`download-dependencies.bat` and `build.bat` were run end-to-end on a real Windows checkout with
`node_modules` removed. Both correctly detected an already-installed Node.js, ran `npm ci`, and
propagated `npm ci`'s own failure (a native toolchain gap unrelated to these scripts — this
checkout's `node-pty`/`winpty` native rebuild needs a working MSVC/Windows SDK toolchain, which is
a pre-existing project prerequisite, not something these scripts install) with the documented
honest failure format. `download-dependencies.sh`, `build.sh`, and `build-installer.sh` were
syntax-checked (`sh -n`) and exercised on the same machine through Git Bash for their
already-on-`PATH` fast path; their OS-specific install branches (Homebrew, `apt-get`, and the
macOS/Linux portable-Node fallback) could not be exercised on a Windows host and should be
verified on a real macOS/Linux machine before being relied on unattended.
