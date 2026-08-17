@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Environment variables shadow cmd's dynamic pseudo-variables. Clear inherited poison before
rem any privilege/status capture or collision-resistant temporary filename is derived.
set "ERRORLEVEL="
set "RANDOM="
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
set "ICON_METADATA=%NODETERM_ROOT%\dist\windows-icon-contract.json"

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
rem Record which commit this build is coming from without collapsing a failed read into "clean".
rem The packaging wrapper later requires Git, a clean checkout, and an exact reachable source SHA;
rem this early report is diagnostic only and never weakens that fail-closed provenance gate.
rem ---------------------------------------------------------------------------------------------
set "BUILD_COMMIT=unknown (git not available)"
set "BUILD_TREE_STATE=unknown"
where git >nul 2>nul
if errorlevel 1 goto :source_report
pushd "%NODETERM_ROOT%"
git rev-parse --verify HEAD >nul 2>nul
set "BUILD_COMMIT_STATUS=%ERRORLEVEL%"
if not "%BUILD_COMMIT_STATUS%"=="0" goto :source_status
for /f "delims=" %%C in ('git rev-parse --verify HEAD 2^>nul') do set "BUILD_COMMIT=%%C"
:source_status
set "BUILD_STATUS_FILE=%TEMP%\nodeterm-git-status-%RANDOM%-%RANDOM%.txt"
if exist "%BUILD_STATUS_FILE%" del /f /q "%BUILD_STATUS_FILE%" >nul 2>nul
git status --porcelain=v1 --untracked-files=all 1>"%BUILD_STATUS_FILE%" 2>nul
set "BUILD_STATUS_EXIT=%ERRORLEVEL%"
if "%BUILD_STATUS_EXIT%"=="0" set "BUILD_TREE_STATE=clean"
if "%BUILD_STATUS_EXIT%"=="0" for %%F in ("%BUILD_STATUS_FILE%") do if %%~zF GTR 0 set "BUILD_TREE_STATE=DIRTY - contains uncommitted changes"
if not "%BUILD_STATUS_EXIT%"=="0" set "BUILD_TREE_STATE=unknown - git status failed"
if exist "%BUILD_STATUS_FILE%" del /f /q "%BUILD_STATUS_FILE%" >nul 2>nul
set "BUILD_STATUS_FILE="
popd
:source_report
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
rem Phase 1: package the installer through the project's own supported path. package.json keeps
rem root forceCodeSigning and win.signExecutable false. signAndEditExecutable deliberately remains
rem enabled at its default so electron-builder still writes the icon and version resources.
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
if exist "%ICON_METADATA%" del /f /q "%ICON_METADATA%" >nul 2>nul
if exist "%ICON_METADATA%" (
    echo.
    echo [FAILED] Package
    echo   Dependency : clean Windows icon contract metadata
    echo   Constraint : stale package identity must be removed before packaging
    echo   Source     : "%ICON_METADATA%"
    echo   Error      : could not remove the previous metadata; close processes using it and retry
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
    exit /b %DIST_EXIT%
)
call :phase_end "Package (npm run dist:win)"

rem ---------------------------------------------------------------------------------------------
rem Phase 2: verify what was actually built, rather than trusting electron-builder's exit code
rem alone. electron-builder --win squirrel writes the setup executable, RELEASES, and the full
rem .nupkg into dist/squirrel-windows/ (measured against this exact project).
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Verify installer"

set "ASSET_RESULT=%TEMP%\nodeterm-installer-assets-%RANDOM%-%RANDOM%.txt"
if exist "%ASSET_RESULT%" del /f /q "%ASSET_RESULT%" >nul 2>nul
call node "%NODETERM_ROOT%\scripts\release-assets.mjs" collect-local "%SQUIRREL_OUT%" "%NODETERM_ROOT%\package.json" "%ASSET_RESULT%"
set "ASSET_EXIT=%ERRORLEVEL%"
if not "%ASSET_EXIT%"=="0" exit /b %ASSET_EXIT%
if not exist "%ASSET_RESULT%" (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : validated Squirrel release asset inventory
    echo   Constraint : the validator must return the one exact Setup executable
    echo   Source     : "%NODETERM_ROOT%\scripts\release-assets.mjs"
    echo   Error      : validator exited successfully without writing its result
    exit /b 1
)
set "SETUP_EXE="
set /p "SETUP_EXE="<"%ASSET_RESULT%"
del /f /q "%ASSET_RESULT%" >nul 2>nul
set "ASSET_RESULT="
if not defined SETUP_EXE exit /b 1

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

set "RELEASES_FILE=%SQUIRREL_OUT%\RELEASES"
set "NUPKG_COUNT=0"
for %%F in ("%SQUIRREL_OUT%\*.nupkg") do set /a NUPKG_COUNT+=1

call node "%NODETERM_ROOT%\scripts\windows-installer.mjs" assert-package "%SQUIRREL_OUT%" "%ICON_METADATA%"
set "ICON_CONTRACT_EXIT=%ERRORLEVEL%"
if not "%ICON_CONTRACT_EXIT%"=="0" exit /b %ICON_CONTRACT_EXIT%

set "SIGNATURE_RESULT=%TEMP%\nodeterm-installer-signature-%RANDOM%-%RANDOM%.txt"
if exist "%SIGNATURE_RESULT%" del /f /q "%SIGNATURE_RESULT%" >nul 2>nul
set "NODETERM_SIGNATURE_FILE=%SETUP_EXE%"
set "NODETERM_RESULT_FILE=%SIGNATURE_RESULT%"
set "NODETERM_SAVED_PSMODULEPATH=%PSModulePath%"
set "PSModulePath=%WINDIR%\System32\WindowsPowerShell\v1.0\Modules"
powershell -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $s=(Get-AuthenticodeSignature -LiteralPath $env:NODETERM_SIGNATURE_FILE).Status.ToString(); [IO.File]::WriteAllText($env:NODETERM_RESULT_FILE,$s,[Text.UTF8Encoding]::new($false))" >nul
set "SIGNATURE_EXIT=%ERRORLEVEL%"
set "PSModulePath=%NODETERM_SAVED_PSMODULEPATH%"
set "NODETERM_SAVED_PSMODULEPATH="
set "NODETERM_SIGNATURE_FILE="
set "NODETERM_RESULT_FILE="
if not "%SIGNATURE_EXIT%"=="0" (
    del /f /q "%SIGNATURE_RESULT%" >nul 2>nul
    echo [FAILED] Verify installer - Authenticode inspection exited with code %SIGNATURE_EXIT%
    exit /b %SIGNATURE_EXIT%
)
set "SETUP_SIGNATURE_STATUS="
if exist "%SIGNATURE_RESULT%" set /p "SETUP_SIGNATURE_STATUS="<"%SIGNATURE_RESULT%"
del /f /q "%SIGNATURE_RESULT%" >nul 2>nul
call node "%NODETERM_ROOT%\scripts\release-assets.mjs" assert-unsigned "%SETUP_SIGNATURE_STATUS%"
set "SIGNATURE_VALIDATE_EXIT=%ERRORLEVEL%"
if not "%SIGNATURE_VALIDATE_EXIT%"=="0" exit /b %SIGNATURE_VALIDATE_EXIT%

rem Use .NET directly instead of Get-FileHash. A batch file launched from PowerShell 7 can inherit
rem its PSModulePath; Windows PowerShell 5.1 then sees incompatible PowerShell 7 modules first and
rem silently fails to auto-load Get-FileHash, leaving an empty digest on an otherwise green build.
rem Pass the path through the environment, not PowerShell source, so an apostrophe in the checkout
rem path is data rather than a broken quote (or executable text).
set "NODETERM_HASH_FILE=%SETUP_EXE%"
set "HASH_RESULT=%TEMP%\nodeterm-installer-sha256-%RANDOM%-%RANDOM%.txt"
if exist "%HASH_RESULT%" del /f /q "%HASH_RESULT%" >nul 2>nul
set "NODETERM_RESULT_FILE=%HASH_RESULT%"
set "SETUP_SHA256="
powershell -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $s=[Security.Cryptography.SHA256]::Create(); $f=[IO.File]::OpenRead($env:NODETERM_HASH_FILE); try { $h=[BitConverter]::ToString($s.ComputeHash($f)).Replace('-','').ToLowerInvariant(); [IO.File]::WriteAllText($env:NODETERM_RESULT_FILE,$h,[Text.UTF8Encoding]::new($false)) } finally { $f.Dispose(); $s.Dispose() }" >nul
set "HASH_EXIT=%ERRORLEVEL%"
set "NODETERM_HASH_FILE="
set "NODETERM_RESULT_FILE="
if not "%HASH_EXIT%"=="0" (
    del /f /q "%HASH_RESULT%" >nul 2>nul
    echo [FAILED] Verify installer - hashing exited with code %HASH_EXIT%
    exit /b %HASH_EXIT%
)
if not exist "%HASH_RESULT%" (
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : SHA-256 digest of the Squirrel setup executable
    echo   Constraint : hashing must produce exactly one non-empty digest
    echo   Source     : "%SETUP_EXE%"
    echo   Error      : PowerShell returned no digest
    exit /b 1
)
call node "%NODETERM_ROOT%\scripts\release-assets.mjs" assert-sha256-file "%HASH_RESULT%"
set "SETUP_HASH_VALID=%ERRORLEVEL%"
if not "%SETUP_HASH_VALID%"=="0" (
    del /f /q "%HASH_RESULT%" >nul 2>nul
    echo.
    echo [FAILED] Verify installer
    echo   Dependency : SHA-256 digest of the Squirrel setup executable
    echo   Constraint : hashing must produce exactly 64 hexadecimal characters
    echo   Source     : "%SETUP_EXE%"
    echo   Error      : the digest returned by PowerShell was malformed
    exit /b 1
)
set /p "SETUP_SHA256="<"%HASH_RESULT%"
del /f /q "%HASH_RESULT%" >nul 2>nul

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
