@echo off
setlocal EnableDelayedExpansion
rem =============================================================================================
rem build.bat -- takes a checkout with NOTHING installed to a built, runnable nodeterm.
rem
rem Full contract: docs/building.md
rem
rem HOW TO INVOKE THIS FILE: always by ABSOLUTE PATH from automation, e.g.:
rem     cmd /c "C:\path\to\repo\build.bat" /s
rem NoDefaultCurrentDirectoryInExePath=1 (a common hardened default) makes a relative
rem `cmd /c build.bat` fail with "is not recognized as an internal or external command" even
rem though the file exists, because cmd then refuses to search the current directory for it.
rem Running it directly from an interactive prompt already sitting in this folder is unaffected.
rem
rem Flags: /s or --silent, or a SILENT=1 environment variable -- no prompts, no interactive
rem pause, no run-it-now prompt (a silent/CI build does not launch a desktop GUI on someone's
rem behalf), and exits non-zero on the first real failure.
rem =============================================================================================

set "NODETERM_ROOT=%~dp0"
if "%NODETERM_ROOT:~-1%"=="\" set "NODETERM_ROOT=%NODETERM_ROOT:~0,-1%"

set "NODETERM_SILENT=0"
if /I "%~1"=="/s" set "NODETERM_SILENT=1"
if /I "%~1"=="--silent" set "NODETERM_SILENT=1"
if /I "%SILENT%"=="1" set "NODETERM_SILENT=1"

echo.
echo === nodeterm build ===
echo Repository : %NODETERM_ROOT%
echo.

rem ---------------------------------------------------------------------------------------------
rem Phase 1: dependencies. Always delegated to download-dependencies.bat, by ABSOLUTE path, so
rem the two scripts can never silently drift apart.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Dependencies"
if "%NODETERM_SILENT%"=="1" (
    call "%NODETERM_ROOT%\download-dependencies.bat" /s
) else (
    call "%NODETERM_ROOT%\download-dependencies.bat"
)
if errorlevel 1 (
    echo.
    echo [FAILED] Dependencies
    echo   Dependency : see download-dependencies.bat output above for the exact one
    echo   Constraint : n/a
    echo   Source     : "%NODETERM_ROOT%\download-dependencies.bat"
    echo   Error      : download-dependencies.bat exited non-zero
    exit /b 1
)
call :phase_end "Dependencies"

rem ---------------------------------------------------------------------------------------------
rem Phase 2: build the real artifact through the project's own supported path.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Build (npm run build)"
pushd "%NODETERM_ROOT%"
call npm run build
set "BUILD_EXIT=%ERRORLEVEL%"
popd
if not "%BUILD_EXIT%"=="0" (
    echo.
    echo [FAILED] Build
    echo   Dependency : the project's own build ^(electron-vite build^)
    echo   Constraint : npm run build must exit 0
    echo   Source     : "%NODETERM_ROOT%\package.json" -^> scripts.build
    echo   Error      : npm exited with code %BUILD_EXIT% - see the build output above for the real cause
    exit /b 1
)
if not exist "%NODETERM_ROOT%\out\main\index.js" (
    echo.
    echo [FAILED] Build
    echo   Dependency : the built main-process entry point
    echo   Constraint : out/main/index.js must exist after a successful build
    echo   Source     : "%NODETERM_ROOT%\out\main\index.js"
    echo   Error      : npm run build reported success but the expected output file is missing
    exit /b 1
)
call :phase_end "Build (npm run build)"

echo.
echo === Build complete. ===
echo Built output : %NODETERM_ROOT%\out
echo.

rem ---------------------------------------------------------------------------------------------
rem Phase 3: offer to run it. This prompt is deliberately the LAST thing this script does, so a
rem failed build never gets as far as offering to launch nothing. Silent/CI runs never prompt and
rem never launch a desktop GUI on somebody's behalf.
rem ---------------------------------------------------------------------------------------------
if "%NODETERM_SILENT%"=="1" (
    echo Silent mode - not launching nodeterm. Run it yourself with: npm start
    exit /b 0
)

choice /C YN /N /M "Run nodeterm now? [Y/N]: "
if errorlevel 2 (
    echo Not launching. Run it yourself with: npm start
    exit /b 0
)

echo.
echo Launching nodeterm (npm start^) ...
pushd "%NODETERM_ROOT%"
call npm start
set "START_EXIT=%ERRORLEVEL%"
popd
exit /b %START_EXIT%

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
