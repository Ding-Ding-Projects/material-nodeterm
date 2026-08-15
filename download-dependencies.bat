@echo off
setlocal EnableDelayedExpansion
rem =============================================================================================
rem download-dependencies.bat -- obtains every dependency nodeterm needs to build, run and test,
rem from canonical upstreams, into per-project or user-scoped locations. Never machine-wide,
rem never requiring administrator rights when a user-scoped path exists.
rem
rem Full contract: docs/building.md
rem
rem HOW TO INVOKE THIS FILE:
rem   Always call it by ABSOLUTE PATH from another script or from automation, e.g.:
rem     cmd /c "C:\path\to\repo\download-dependencies.bat" /s
rem   or, from a sibling batch file in this same directory:
rem     call "%~dp0download-dependencies.bat" %*
rem   A RELATIVE invocation such as `cmd /c download-dependencies.bat` can fail with
rem   "'download-dependencies.bat' is not recognized as an internal or external command" on any
rem   machine where NoDefaultCurrentDirectoryInExePath=1 is set (a common hardened default) --
rem   cmd then refuses to search the current directory for it. Running it directly from an
rem   interactive prompt that is already sitting in this folder is unaffected; build.bat below
rem   always calls it by absolute path for exactly this reason.
rem
rem Flags: /s or --silent, or a SILENT=1 environment variable -- no prompts, no interactive
rem pause, exits non-zero on the first real failure so a caller can branch on it.
rem
rem Never installs a secret, a credential, or a code-signing certificate. Never touches the
rem machine's persistent PowerShell execution policy -- every PowerShell call in this script is
rem an inline -Command, and execution policy only gates running .ps1 SCRIPT FILES, not inline
rem -Command text, so there is nothing here that needs -ExecutionPolicy Bypass.
rem =============================================================================================

set "NODETERM_ROOT=%~dp0"
if "%NODETERM_ROOT:~-1%"=="\" set "NODETERM_ROOT=%NODETERM_ROOT:~0,-1%"
set "MANIFEST=%NODETERM_ROOT%\dependencies.manifest.json"
set "TOOLCHAIN_DIR=%LOCALAPPDATA%\nodeterm\toolchain"

set "NODETERM_SILENT=0"
if /I "%~1"=="/s" set "NODETERM_SILENT=1"
if /I "%~1"=="--silent" set "NODETERM_SILENT=1"
if /I "%SILENT%"=="1" set "NODETERM_SILENT=1"

echo.
echo === nodeterm dependency bootstrap ===
echo Repository : %NODETERM_ROOT%
echo Manifest   : %MANIFEST%
echo.

if not exist "%MANIFEST%" (
    echo [FAILED] dependencies.manifest.json is missing
    echo   Dependency : dependencies.manifest.json itself
    echo   Constraint : must sit next to this script at the repository root
    echo   Source     : %MANIFEST%
    echo   Error      : file not found
    exit /b 1
)

rem ---------------------------------------------------------------------------------------------
rem Phase 1: Node.js runtime
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Node.js runtime"

rem Pick up a portable Node this script installed on an earlier run before probing PATH -- see
rem the comment in :install_portable_node for why this is a dedicated variable rather than a
rem mutation of the user's real PATH.
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('NODETERM_NODE_HOME','User')"`) do set "NODETERM_NODE_HOME=%%H"
if defined NODETERM_NODE_HOME if exist "!NODETERM_NODE_HOME!\node.exe" set "PATH=!NODETERM_NODE_HOME!;%PATH%"

where node >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%V in ('node --version 2^>nul') do echo   Found node %%V already on PATH - nothing to install.
    goto :node_done
)

echo   node not found on PATH. Installing...
where winget >nul 2>nul
if errorlevel 1 (
    echo   winget is not available on this machine - using a portable extract instead.
    goto :node_portable
)

echo   Trying winget ^(package OpenJS.NodeJS.LTS, user scope^)...
winget install --id OpenJS.NodeJS.LTS --scope user -e --accept-source-agreements --accept-package-agreements --disable-interactivity 1>"%TEMP%\nodeterm-winget-node.log" 2>&1
if errorlevel 1 (
    echo   winget install failed - see "%TEMP%\nodeterm-winget-node.log" - falling back to a portable extract.
    goto :node_portable
)

call :refresh_path
where node >nul 2>nul
if errorlevel 1 (
    echo   winget reported success but node is still not resolvable on PATH after a refresh.
    echo   Falling back to a portable extract.
    goto :node_portable
)
for /f "delims=" %%V in ('node --version 2^>nul') do echo   Installed node %%V via winget.
goto :node_done

:node_portable
call :install_portable_node
if errorlevel 1 exit /b 1
goto :node_done

:node_done
call :phase_end "Node.js runtime"

rem ---------------------------------------------------------------------------------------------
rem Phase 2: npm project dependencies
rem ---------------------------------------------------------------------------------------------
call :phase_begin "npm project dependencies"

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo [FAILED] npm project dependencies
    echo   Dependency : npm ^(ships bundled with Node.js^)
    echo   Constraint : must be resolvable on PATH once the Node.js phase above finishes
    echo   Source     : n/a - the Node.js install did not put npm on PATH
    echo   Error      : `where npm` found nothing
    exit /b 1
)

pushd "%NODETERM_ROOT%"
if exist package-lock.json (
    echo   package-lock.json found - running: npm ci
    call npm ci
) else (
    echo   No package-lock.json found - running: npm install
    call npm install
)
set "NPM_EXIT=%ERRORLEVEL%"
popd

if not "%NPM_EXIT%"=="0" (
    echo.
    echo [FAILED] npm project dependencies
    echo   Dependency : the packages listed in package.json
    echo   Constraint : package-lock.json ^(or package.json when no lockfile exists^)
    echo   Source     : the npm registry ^(https://registry.npmjs.org/^)
    echo   Error      : npm exited with code %NPM_EXIT% - see the npm output above for the real cause
    exit /b 1
)
call :phase_end "npm project dependencies"

echo.
echo === All dependencies are ready. ===
exit /b 0

rem =============================================================================================
rem Subroutines
rem =============================================================================================

:refresh_path
rem A package manager (winget) writes PATH into the registry for FUTURE processes only -- the
rem shell that just launched it does not see the change, which reads as "the install failed" when
rem it in fact succeeded. [Environment]::GetEnvironmentVariable(...,'Machine'/'User') plus
rem ExpandEnvironmentVariables is used (instead of a raw `reg query`) because the registry stores
rem PATH un-expanded (literal "%SystemRoot%..." segments) -- a naive copy would leave those
rem un-expanded in our session PATH and break every tool that depends on them.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$m=[Environment]::GetEnvironmentVariable('Path','Machine'); $u=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::ExpandEnvironmentVariables((@($m,$u) -join ';'))"`) do set "PATH=%%P"
if defined NODETERM_NODE_HOME set "PATH=!NODETERM_NODE_HOME!;%PATH%"
exit /b 0

:install_portable_node
rem Never requires administrator rights: extracts a portable Node build into a per-user directory
rem and remembers that location through a DEDICATED NODETERM_NODE_HOME user environment variable
rem -- it never mutates the user's real PATH variable. `setx PATH "<huge string>"` truncates
rem silently past its length limit, and this script has no way to know how close to that limit an
rem arbitrary machine's PATH already sits, so PATH itself is never rewritten persistently here;
rem only prepended to for the lifetime of this process (and any script that calls this one).
set "NODE_ARCH=win-x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODE_ARCH=win-arm64"

set "NODE_URL="
set "NODE_SHA256="
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "(Get-Content -Raw '%MANIFEST%' | ConvertFrom-Json).node.portable.'%NODE_ARCH%'.url"`) do set "NODE_URL=%%U"
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "(Get-Content -Raw '%MANIFEST%' | ConvertFrom-Json).node.portable.'%NODE_ARCH%'.sha256"`) do set "NODE_SHA256=%%S"

if not defined NODE_URL (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : dependencies.manifest.json -^> node.portable.%NODE_ARCH%
    echo   Source     : %MANIFEST%
    echo   Error      : manifest has no portable entry for architecture %NODE_ARCH%
    exit /b 1
)

if not exist "%TOOLCHAIN_DIR%" mkdir "%TOOLCHAIN_DIR%" >nul 2>nul
set "NODE_ZIP=%TOOLCHAIN_DIR%\node-%NODE_ARCH%.zip"

echo   Downloading %NODE_URL%
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -UseBasicParsing"
if errorlevel 1 (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : pinned in dependencies.manifest.json
    echo   Source     : %NODE_URL%
    echo   Error      : download failed - see the PowerShell output above for the real cause
    exit /b 1
)

set "NODE_ACTUAL_SHA256="
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -Path '%NODE_ZIP%').Hash.ToLower()"`) do set "NODE_ACTUAL_SHA256=%%H"
if /I not "%NODE_ACTUAL_SHA256%"=="%NODE_SHA256%" (
    del /f /q "%NODE_ZIP%" >nul 2>nul
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : sha256 %NODE_SHA256% recorded in dependencies.manifest.json
    echo   Source     : %NODE_URL%
    echo   Error      : downloaded file hashed to %NODE_ACTUAL_SHA256% instead - refusing to use an unverified binary
    exit /b 1
)
echo   SHA-256 verified: %NODE_ACTUAL_SHA256%

echo   Extracting to %TOOLCHAIN_DIR%
powershell -NoProfile -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%TOOLCHAIN_DIR%' -Force"
if errorlevel 1 (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : n/a
    echo   Source     : %NODE_ZIP%
    echo   Error      : Expand-Archive failed - see the PowerShell output above for the real cause
    exit /b 1
)
del /f /q "%NODE_ZIP%" >nul 2>nul

set "NODE_EXTRACT_DIR="
for /d %%D in ("%TOOLCHAIN_DIR%\node-v*-%NODE_ARCH%") do set "NODE_EXTRACT_DIR=%%D"
if not defined NODE_EXTRACT_DIR (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : n/a
    echo   Source     : %TOOLCHAIN_DIR%
    echo   Error      : extracted archive did not contain the expected node-v*-%NODE_ARCH% folder
    exit /b 1
)

powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('NODETERM_NODE_HOME','%NODE_EXTRACT_DIR%','User')" >nul
set "NODETERM_NODE_HOME=%NODE_EXTRACT_DIR%"
set "PATH=%NODE_EXTRACT_DIR%;%PATH%"

"%NODE_EXTRACT_DIR%\node.exe" --version >nul 2>nul
if errorlevel 1 (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : n/a
    echo   Source     : %NODE_EXTRACT_DIR%\node.exe
    echo   Error      : the extracted node.exe would not run
    exit /b 1
)
for /f "delims=" %%V in ('"%NODE_EXTRACT_DIR%\node.exe" --version 2^>nul') do echo   Installed node %%V ^(portable, %NODE_ARCH%^) at %NODE_EXTRACT_DIR%
exit /b 0

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
