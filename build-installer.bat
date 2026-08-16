@echo off
setlocal DisableDelayedExpansion
rem =============================================================================================
rem build-installer.bat -- produces the Windows installer a person downloads: the same artifact
rem CI publishes, through the same supported packaging path (electron-builder, Squirrel.Windows)
rem and the same version as package.json.
rem
rem Full contract: docs/building.md
rem
rem HOW TO INVOKE THIS FILE: always by ABSOLUTE PATH from automation, e.g.:
rem     cmd /c "C:\path\to\repo\build-installer.bat" /s
rem NoDefaultCurrentDirectoryInExePath=1 (a common hardened default) makes a relative
rem `cmd /c build-installer.bat` fail with "is not recognized as an internal or external command"
rem even though the file exists, because cmd then refuses to search the current directory for it.
rem
rem Flags: /s or --silent, or a SILENT=1 environment variable -- no prompts, no interactive
rem pause, and exits non-zero on the first real failure.
rem
rem Code signing is PERMANENTLY out of scope. This script never requests, discovers, or invokes a
rem signer, and never touches a code-signing certificate or credential. The installer it produces
rem is unsigned and will trigger Windows SmartScreen / "unknown publisher" -- this script says so
rem in its own output rather than leaving that as a surprise.
rem
rem This script NEVER publishes, tags, pushes, or creates a release. It only builds and verifies
rem a local artifact.
rem =============================================================================================

set "NODETERM_ROOT=%~dp0"
if "%NODETERM_ROOT:~-1%"=="\" set "NODETERM_ROOT=%NODETERM_ROOT:~0,-1%"
set "SQUIRREL_OUT=%NODETERM_ROOT%\dist\squirrel-windows"

set "NODETERM_SILENT=0"
if /I "%~1"=="/s" set "NODETERM_SILENT=1"
if /I "%~1"=="--silent" set "NODETERM_SILENT=1"
if /I "%SILENT%"=="1" set "NODETERM_SILENT=1"

set "NODETERM_SYSTEM_POWERSHELL=%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%NODETERM_SYSTEM_POWERSHELL%" (
    echo [FAILED] Privilege boundary - the inbox Windows PowerShell could not be found
    exit /b 1
)
"%NODETERM_SYSTEM_POWERSHELL%" -NoProfile -NonInteractive -Command "$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 86}else{exit 0}" >nul 2>nul
set "NODETERM_ELEVATION_PROBE=%ERRORLEVEL%"
if "%NODETERM_ELEVATION_PROBE%"=="86" (
    echo [FAILED] Privilege boundary - never run the root installer build as Administrator.
    echo Close this prompt and rerun normally; only the printed toolchain helper may be elevated.
    exit /b 5
)
if not "%NODETERM_ELEVATION_PROBE%"=="0" (
    echo [FAILED] Privilege boundary - could not prove this is a normal user prompt.
    exit /b 1
)

echo.
echo === nodeterm Windows installer build ===
echo Repository : "%NODETERM_ROOT%"
echo Target     : Squirrel.Windows ^(unsigned^)
echo.

rem ---------------------------------------------------------------------------------------------
rem Record which commit this build is coming from, so the report below can say plainly whether
rem the installer reflects a clean, known commit or a dirty working tree. Best-effort: a missing
rem git executable degrades to a warning, never a build failure -- packaging does not need git.
rem ---------------------------------------------------------------------------------------------
set "BUILD_COMMIT=unknown (git not available)"
set "BUILD_TREE_STATE=unknown"
where git >nul 2>nul
if not errorlevel 1 (
    pushd "%NODETERM_ROOT%"
    for /f "delims=" %%C in ('git rev-parse HEAD 2^>nul') do set "BUILD_COMMIT=%%C"
    set "BUILD_TREE_STATE=clean"
    for /f "delims=" %%S in ('git status --porcelain 2^>nul') do set "BUILD_TREE_STATE=DIRTY - contains uncommitted changes"
    popd
)
echo Commit     : %BUILD_COMMIT%
echo Tree state : %BUILD_TREE_STATE%
echo.

rem ---------------------------------------------------------------------------------------------
rem Phase 0: dependencies. Always delegated to download-dependencies.bat, by ABSOLUTE path, so
rem the two scripts can never silently drift apart. That script bootstraps Node and the native
rem toolchain, then runs the Windows build preflight before npm ci/install; this ordering is what
rem makes a truly fresh machine diagnosable instead of silently skipping a Node-powered preflight.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Dependencies"
if "%NODETERM_SILENT%"=="1" (
    call "%NODETERM_ROOT%\download-dependencies.bat" /s
) else (
    call "%NODETERM_ROOT%\download-dependencies.bat"
)
set "DEPENDENCIES_EXIT=%ERRORLEVEL%"
if not "%DEPENDENCIES_EXIT%"=="0" (
    echo.
    echo [FAILED] Dependencies
    echo   Dependency : see download-dependencies.bat output above for the exact one
    echo   Constraint : n/a
    echo   Source     : "%NODETERM_ROOT%\download-dependencies.bat"
    echo   Error      : download-dependencies.bat exited with code %DEPENDENCIES_EXIT%
    exit /b %DEPENDENCIES_EXIT%
)
call :phase_end "Dependencies"

rem ---------------------------------------------------------------------------------------------
rem Phase 1: package the installer through the project's own supported path. package.json's
rem "win" / "squirrelWindows" blocks pin forceCodeSigning / signExecutable / signAndEditExecutable
rem to false, and this script never overrides that -- it is not this script's job to decide
rem whether the org's permanent no-signing policy applies today.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Package (npm run dist:win)"
if exist "%SQUIRREL_OUT%" rd /s /q "%SQUIRREL_OUT%" >nul 2>nul
if exist "%SQUIRREL_OUT%" (
    echo.
    echo [FAILED] Package
    echo   Dependency : clean Squirrel.Windows output directory
    echo   Constraint : stale artifacts must be removed before packaging
    echo   Source     : "%SQUIRREL_OUT%"
    echo   Error      : could not remove the previous output; close processes using it and retry
    exit /b 1
)
pushd "%NODETERM_ROOT%"
call npm run dist:win
set "DIST_EXIT=%ERRORLEVEL%"
popd
if not "%DIST_EXIT%"=="0" (
    echo.
    echo [FAILED] Package
    echo   Dependency : electron-builder ^(Squirrel.Windows target^)
    echo   Constraint : npm run dist:win must exit 0
    echo   Source     : "%NODETERM_ROOT%\package.json" -^> scripts.dist:win
    echo   Error      : npm exited with code %DIST_EXIT% - see the packaging output above for the real cause
    exit /b 1
)
call :phase_end "Package (npm run dist:win)"

rem ---------------------------------------------------------------------------------------------
rem Phase 2: verify what was actually built, rather than trusting electron-builder's exit code
rem alone. electron-builder --win squirrel writes the setup executable, RELEASES, and the full
rem .nupkg into dist/squirrel-windows/ (measured against this exact project).
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Verify installer"

if not exist "%SQUIRREL_OUT%" (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : the Squirrel.Windows output directory
    echo   Constraint : dist/squirrel-windows must exist after a successful package step
    echo   Source     : "%SQUIRREL_OUT%"
    echo   Error      : directory not found - packaging reported success but produced nothing there
    exit /b 1
)

set "SETUP_EXE="
for %%F in ("%SQUIRREL_OUT%\*Setup*.exe") do if not defined SETUP_EXE set "SETUP_EXE=%%~fF"
if not defined SETUP_EXE (
    for %%F in ("%SQUIRREL_OUT%\*.exe") do if not defined SETUP_EXE set "SETUP_EXE=%%~fF"
)
if not defined SETUP_EXE (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : the Squirrel setup executable
    echo   Constraint : at least one .exe must exist in dist/squirrel-windows
    echo   Source     : "%SQUIRREL_OUT%"
    echo   Error      : no .exe found - packaging reported success but the installer is missing
    exit /b 1
)

for %%F in ("%SETUP_EXE%") do set "SETUP_SIZE=%%~zF"
set /a SETUP_SIZE_MB=SETUP_SIZE/1048576
rem 5 MiB is a floor, not a target -- it only exists to catch an obviously truncated or empty
rem file. A real Electron installer is normally well into the tens of megabytes.
if %SETUP_SIZE% LSS 5242880 (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : the Squirrel setup executable
    echo   Constraint : file size must be at least 5 MiB ^(a plausible-size floor, not a target^)
    echo   Source     : "%SETUP_EXE%"
    echo   Error      : file is only %SETUP_SIZE% bytes - this looks truncated or empty, not a real installer
    exit /b 1
)

set "RELEASES_FILE="
if exist "%SQUIRREL_OUT%\RELEASES" set "RELEASES_FILE=%SQUIRREL_OUT%\RELEASES"
if not defined RELEASES_FILE (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : the Squirrel RELEASES index
    echo   Constraint : dist/squirrel-windows/RELEASES must exist beside the setup executable
    echo   Source     : "%SQUIRREL_OUT%\RELEASES"
    echo   Error      : file not found - the update feed this installer registers would be incomplete
    exit /b 1
)

set "NUPKG_COUNT=0"
for %%F in ("%SQUIRREL_OUT%\*.nupkg") do set /a NUPKG_COUNT+=1
if "%NUPKG_COUNT%"=="0" (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : the full Squirrel .nupkg
    echo   Constraint : at least one .nupkg must exist in dist/squirrel-windows
    echo   Source     : "%SQUIRREL_OUT%"
    echo   Error      : no .nupkg found - the installer has nothing to actually install
    exit /b 1
)

rem Use .NET directly instead of Get-FileHash. A batch file launched from PowerShell 7 can inherit
rem its PSModulePath; Windows PowerShell 5.1 then sees incompatible PowerShell 7 modules first and
rem silently fails to auto-load Get-FileHash, leaving an empty digest on an otherwise green build.
rem Pass the path through the environment, not PowerShell source, so an apostrophe in the checkout
rem path is data rather than a broken quote (or executable text).
set "NODETERM_HASH_FILE=%SETUP_EXE%"
set "SETUP_SHA256="
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "$s=[Security.Cryptography.SHA256]::Create(); $f=[IO.File]::OpenRead($env:NODETERM_HASH_FILE); try { [BitConverter]::ToString($s.ComputeHash($f)).Replace('-','').ToLowerInvariant() } finally { $f.Dispose(); $s.Dispose() }"`) do set "SETUP_SHA256=%%H"
set "NODETERM_HASH_FILE="
if not defined SETUP_SHA256 (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : SHA-256 digest of the Squirrel setup executable
    echo   Constraint : hashing must produce exactly one non-empty digest
    echo   Source     : "%SETUP_EXE%"
    echo   Error      : PowerShell returned no digest
    exit /b %DIST_EXIT%
)
set "NODETERM_SETUP_SHA256=%SETUP_SHA256%"
powershell -NoProfile -NonInteractive -Command "if($env:NODETERM_SETUP_SHA256 -notmatch '^[a-fA-F0-9]{64}$'){exit 87}" >nul 2>nul
set "SETUP_HASH_VALID=%ERRORLEVEL%"
set "NODETERM_SETUP_SHA256="
if not "%SETUP_HASH_VALID%"=="0" (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : SHA-256 digest of the Squirrel setup executable
    echo   Constraint : hashing must produce exactly 64 hexadecimal characters
    echo   Source     : "%SETUP_EXE%"
    echo   Error      : the digest returned by PowerShell was malformed
    exit /b 1
)

call :phase_end "Verify installer"

echo === Installer built and verified. ===
echo.
echo Setup executable : "%SETUP_EXE%"
echo Size             : %SETUP_SIZE% bytes ^(~%SETUP_SIZE_MB% MiB^)
echo SHA-256          : %SETUP_SHA256%
echo RELEASES index   : "%RELEASES_FILE%"
echo .nupkg count     : %NUPKG_COUNT%
echo Built from       : commit %BUILD_COMMIT% ^(working tree: %BUILD_TREE_STATE%^)
echo.
echo *** This installer is UNSIGNED. *** Code signing is permanently out of scope for this
echo project. Installing it will trigger Windows SmartScreen / "unknown publisher" warnings --
echo that is expected, not a build defect. This script only builds and verifies the artifact
echo locally: it does not publish, tag, push, or create a release.
echo.
exit /b 0

rem =============================================================================================
rem Subroutines
rem =============================================================================================

:phase_begin
echo --- %~1 ---
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"`) do set "PHASE_T0=%%T"
exit /b 0

:phase_end
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"`) do set "PHASE_T1=%%T"
set /a PHASE_ELAPSED=PHASE_T1-PHASE_T0
echo --- %~1 done ^(%PHASE_ELAPSED%s^) ---
echo.
exit /b 0
