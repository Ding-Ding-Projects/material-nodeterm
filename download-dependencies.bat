@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Environment variables shadow cmd's dynamic pseudo-variables. Clear inherited poison before
rem any privilege/status capture or collision-resistant temporary filename is derived.
set "ERRORLEVEL="
set "RANDOM="
rem =============================================================================================
rem download-dependencies.bat -- obtains every dependency nodeterm needs to build, run and test,
rem from canonical upstreams, into per-project or user-scoped locations wherever one exists. It
rem never requires administrator rights when a dependency supports a user-scoped path.
rem Visual Studio Build Tools has no user-scoped install. On an interactive run, if it is missing
rem or needs modification, this script hands only the exact helper to UAC, waits, then verifies from
rem the normal prompt. Silent mode reports the elevated-only requirement without opening UAC. The
rem root bootstrap and npm lifecycle scripts must never run as Administrator.
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

rem Refuse elevation before reading the manifest or running ANY user/package-manager executable.
rem Otherwise an elevated fresh root could bootstrap Node before the later toolchain helper had a
rem chance to protect npm. Use the inbox PowerShell by absolute system path, never PATH lookup.
set "NODETERM_SYSTEM_POWERSHELL=%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%NODETERM_SYSTEM_POWERSHELL%" (
    echo [FAILED] Privilege boundary - the inbox Windows PowerShell could not be found
    exit /b 1
)
"%NODETERM_SYSTEM_POWERSHELL%" -NoProfile -NonInteractive -Command "$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 86}else{exit 0}" >nul 2>nul
set "NODETERM_ELEVATION_PROBE=%ERRORLEVEL%"
if "%NODETERM_ELEVATION_PROBE%"=="86" (
    echo [FAILED] Privilege boundary - never run the root dependency bootstrap as Administrator.
    echo Close this prompt and rerun normally; only the printed toolchain helper may be elevated.
    exit /b 5
)
if not "%NODETERM_ELEVATION_PROBE%"=="0" (
    echo [FAILED] Privilege boundary - could not prove this is a normal user prompt.
    exit /b 1
)

echo.
echo === nodeterm dependency bootstrap ===
echo Repository : "%NODETERM_ROOT%"
echo Manifest   : "%MANIFEST%"
echo.

if not exist "%MANIFEST%" (
    echo [FAILED] dependencies.manifest.json is missing
    echo   Dependency : dependencies.manifest.json itself
    echo   Constraint : must sit next to this script at the repository root
    echo   Source     : "%MANIFEST%"
    echo   Error      : file not found
    exit /b 1
)

rem ---------------------------------------------------------------------------------------------
rem Phase 1: Node.js runtime
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Node.js runtime"
set "NODETERM_EXPECTED_NODE_VERSION="

rem Pick up a portable Node this script installed on an earlier run before probing PATH -- see
rem the comment in :install_portable_node for why this is a dedicated variable rather than a
rem mutation of the user's real PATH. A valid process-local value wins so an automation caller
rem can deliberately select an isolated toolchain without rewriting the user's environment.
if defined NODETERM_NODE_HOME if not exist "%NODETERM_NODE_HOME%\node.exe" set "NODETERM_NODE_HOME="
if not defined NODETERM_NODE_HOME for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('NODETERM_NODE_HOME','User')"`) do set "NODETERM_NODE_HOME=%%H"
if defined NODETERM_NODE_HOME if exist "%NODETERM_NODE_HOME%\node.exe" set "PATH=%NODETERM_NODE_HOME%;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :node_missing
call :probe_node
set "NODE_PATH_PROBE_EXIT=%ERRORLEVEL%"
if not "%NODE_PATH_PROBE_EXIT%"=="0" goto :node_unsupported
echo   Found manifest-pinned build node %NODE_PROBE_VERSION% already on PATH - nothing to install.
goto :node_done

:node_unsupported
echo   The node executable on PATH is missing, broken, outside the supported runtime range,
echo   or does not match the exact build version pinned in dependencies.manifest.json.
echo   Using the manifest-pinned portable runtime instead; details are in "%TEMP%\nodeterm-node-version.log".
goto :node_portable

:node_missing
echo   node not found on PATH. Installing...
where winget >nul 2>nul
if errorlevel 1 (
    echo   winget is not available on this machine - using a portable extract instead.
    goto :node_portable
)

echo   Trying winget ^(package OpenJS.NodeJS.LTS, user scope^)...
winget install --id OpenJS.NodeJS.LTS --source winget --scope user -e --accept-source-agreements --accept-package-agreements --disable-interactivity 1>"%TEMP%\nodeterm-winget-node.log" 2>&1
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
call :probe_node
set "NODE_WINGET_PROBE_EXIT=%ERRORLEVEL%"
if not "%NODE_WINGET_PROBE_EXIT%"=="0" (
    echo   winget installed a Node runtime that is broken or outside the supported range.
    echo   Falling back to the manifest-pinned portable runtime.
    goto :node_portable
)
echo   Installed node %NODE_PROBE_VERSION% via winget.
goto :node_done

:node_portable
call :install_portable_node
set "PORTABLE_NODE_EXIT=%ERRORLEVEL%"
if not "%PORTABLE_NODE_EXIT%"=="0" exit /b %PORTABLE_NODE_EXIT%
goto :node_done

:node_done
call :phase_end "Node.js runtime"

rem ---------------------------------------------------------------------------------------------
rem Phase 2: native Windows build toolchain. Visual Studio has no per-user installation path and
rem Microsoft's quiet/passive modes require an already-elevated caller. The helper refuses an
rem elevated ROOT bootstrap. Interactive mode may elevate only the helper, while silent mode stays
rem prompt-free and reports the exact elevated-only requirement. This MUST precede Python/preflight
rem so a missing component is repaired rather than merely diagnosed without ever handing npm an
rem Administrator token.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Visual Studio C++ build toolchain"
set "NODETERM_VS_RESULT_FILE=%TEMP%\nodeterm-vs-selection-%RANDOM%-%RANDOM%.txt"
if exist "%NODETERM_VS_RESULT_FILE%" del /f /q "%NODETERM_VS_RESULT_FILE%" >nul 2>nul
if "%NODETERM_SILENT%"=="1" (
    call node "%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs" --silent --result-file "%NODETERM_VS_RESULT_FILE%"
) else (
    call node "%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs" --result-file "%NODETERM_VS_RESULT_FILE%"
)
set "TOOLCHAIN_EXIT=%ERRORLEVEL%"
rem The Visual Studio installer is the one declared dependency that genuinely needs elevation.
rem An interactive one-click run may hand only this narrowly-scoped helper to UAC, wait for its
rem result, and then return to the normal-user process. Silent mode must never open UAC or hang;
rem the helper's exact elevated-only recovery text remains the honest result there.
if "%TOOLCHAIN_EXIT%"=="5" if not "%NODETERM_SILENT%"=="1" goto :elevate_toolchain
if not "%TOOLCHAIN_EXIT%"=="0" (
    del /f /q "%NODETERM_VS_RESULT_FILE%" >nul 2>nul
    exit /b %TOOLCHAIN_EXIT%
)
call :accept_toolchain_result
if errorlevel 1 exit /b %ERRORLEVEL%
:toolchain_phase_complete
rem The toolchain helper has independently validated one supported VS2022 v143 instance, its
rem Spectre libraries, and all manifest-declared C++ components. The result-file reader above has
rem already validated that exact installation path and set VCINSTALLDIR for the active toolset.
rem Pin both npm/node-gyp's version and node-gyp's exact installation path for this process. The
rem path is essential when multiple VS2022 instances exist, because the year alone permits
rem enumeration-order selection of an instance whose v143 Spectre directories are absent.
set "GYP_MSVS_VERSION=2022"
set "npm_config_msvs_version=2022"
set "GYP_MSVS_OVERRIDE_PATH=%NODETERM_VS_INSTALLATION%"
set "NODETERM_VS_TARGET_ARCH=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NODETERM_VS_TARGET_ARCH=arm64"
rem node-gyp 12.4.0 overwrites GYP_MSVS_OVERRIDE_PATH during configure after its own discovery.
rem VsDevCmd is the supported selection boundary for this version: it sets VCINSTALLDIR and the
rem target architecture, which node-gyp then uses to generate msbuild_path for this exact instance.
call "%GYP_MSVS_OVERRIDE_PATH%\Common7\Tools\VsDevCmd.bat" -arch=%NODETERM_VS_TARGET_ARCH% -host_arch=%NODETERM_VS_TARGET_ARCH%
if errorlevel 1 (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : selected Visual Studio 2022 developer environment
    echo   Constraint : VsDevCmd must initialize the validated installation and target architecture
    echo   Source     : "%GYP_MSVS_OVERRIDE_PATH%\Common7\Tools\VsDevCmd.bat"
    echo   Error      : VsDevCmd exited with code %ERRORLEVEL%
    exit /b 1
)
for %%P in ("%GYP_MSVS_OVERRIDE_PATH%") do set "NODETERM_EXPECTED_VS_ROOT=%%~fP"
for %%P in ("%VCINSTALLDIR%\..") do set "NODETERM_ACTIVE_VS_ROOT=%%~fP"
if /I not "%NODETERM_ACTIVE_VS_ROOT%"=="%NODETERM_EXPECTED_VS_ROOT%" (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : selected Visual Studio 2022 developer environment
    echo   Constraint : VCINSTALLDIR must resolve to the helper-selected installation
    echo   Source     : "%NODETERM_ACTIVE_VS_ROOT%"
    echo   Error      : VsDevCmd selected a different Visual Studio installation
    exit /b 1
)
if not exist "%VCToolsInstallDir%lib\spectre\%NODETERM_VS_TARGET_ARCH%" (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : VS2022 Spectre libraries for %NODETERM_VS_TARGET_ARCH%
    echo   Constraint : VsDevCmd must expose the real lib\spectre directory
    echo   Source     : "%VCToolsInstallDir%lib\spectre\%NODETERM_VS_TARGET_ARCH%"
    echo   Error      : selected developer environment does not expose the validated Spectre path
    exit /b 1
)
set "GYP_MSVS_OVERRIDE_PATH=%NODETERM_EXPECTED_VS_ROOT%"
echo   Selected Visual Studio 2022 at "%GYP_MSVS_OVERRIDE_PATH%" for node-gyp and electron-rebuild; VsDevCmd bound VCINSTALLDIR to the validated v143 Spectre environment.
call :phase_end "Visual Studio C++ build toolchain"

rem ---------------------------------------------------------------------------------------------
rem Phase 3: Python for node-gyp. The locked dependency graph runs native install scripts during
rem npm ci, and the Visual Studio C++ workload does not include a Python interpreter. This phase
rem runs only after the toolchain helper has refused an elevated root prompt, so Python is always
rem installed/reused under the normal user token and npm never inherits Administrator rights.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Python runtime for native builds"
set "NODETERM_PYTHON_RESULT_FILE=%TEMP%\nodeterm-python-path-%RANDOM%-%RANDOM%.txt"
if exist "%NODETERM_PYTHON_RESULT_FILE%" del /f /q "%NODETERM_PYTHON_RESULT_FILE%" >nul 2>nul
if "%NODETERM_SILENT%"=="1" (
    call node "%NODETERM_ROOT%\scripts\ensure-windows-python.mjs" --silent --result-file "%NODETERM_PYTHON_RESULT_FILE%"
) else (
    call node "%NODETERM_ROOT%\scripts\ensure-windows-python.mjs" --result-file "%NODETERM_PYTHON_RESULT_FILE%"
)
set "PYTHON_BOOTSTRAP_EXIT=%ERRORLEVEL%"
if not "%PYTHON_BOOTSTRAP_EXIT%"=="0" (
    del /f /q "%NODETERM_PYTHON_RESULT_FILE%" >nul 2>nul
    exit /b %PYTHON_BOOTSTRAP_EXIT%
)
if not exist "%NODETERM_PYTHON_RESULT_FILE%" (
    echo.
    echo [FAILED] Python runtime for native builds
    echo   Dependency : supported 64-bit Python for node-gyp
    echo   Constraint : helper must return the verified interpreter path
    echo   Source     : "%NODETERM_ROOT%\scripts\ensure-windows-python.mjs"
    echo   Error      : helper exited successfully without writing its result file
    exit /b 1
)
set "PYTHON="
set /p "PYTHON="<"%NODETERM_PYTHON_RESULT_FILE%"
del /f /q "%NODETERM_PYTHON_RESULT_FILE%" >nul 2>nul
set "NODETERM_PYTHON_RESULT_FILE="
if not defined PYTHON (
    echo.
    echo [FAILED] Python runtime for native builds
    echo   Dependency : supported 64-bit Python for node-gyp
    echo   Constraint : helper must return the verified interpreter path
    echo   Source     : "%NODETERM_ROOT%\scripts\ensure-windows-python.mjs"
    echo   Error      : helper returned an empty interpreter path
    exit /b 1
)
if not exist "%PYTHON%" (
    echo.
    echo [FAILED] Python runtime for native builds
    echo   Dependency : supported 64-bit Python for node-gyp
    echo   Constraint : PYTHON must name the verified python.exe
    echo   Source     : "%PYTHON%"
    echo   Error      : helper returned a path that no longer exists
    exit /b 1
)
rem node-gyp gives NODE_GYP_FORCE_PYTHON precedence over every other discovery channel, followed
rem by npm_config_python and PYTHON. Override all three so a stale inherited value cannot defeat the
rem interpreter this phase just verified.
set "NODE_GYP_FORCE_PYTHON=%PYTHON%"
set "npm_config_python=%PYTHON%"
call :phase_end "Python runtime for native builds"

rem ---------------------------------------------------------------------------------------------
rem Phase 4: build preflight. This MUST run after all bootstraps but before npm ci/install:
rem npm removes node_modules wholesale, so it is already too late to give an actionable diagnosis
rem after a mapped electron.exe blocks deletion. Keeping the preflight here also covers callers
rem that invoke download-dependencies.bat directly instead of going through either build script.
rem ---------------------------------------------------------------------------------------------
call :phase_begin "Build preflight"
call node "%NODETERM_ROOT%\scripts\check-build-preflight.mjs"
set "PREFLIGHT_EXIT=%ERRORLEVEL%"
if not "%PREFLIGHT_EXIT%"=="0" (
    echo.
    echo [FAILED] Build preflight
    echo   Dependency : a build precondition listed above
    echo   Constraint : every precondition must hold before npm removes node_modules
    echo   Source     : "%NODETERM_ROOT%\scripts\check-build-preflight.mjs"
    echo   Error      : preflight exited with code %PREFLIGHT_EXIT% - see the numbered problems above
    exit /b %PREFLIGHT_EXIT%
)
call :phase_end "Build preflight"

rem ---------------------------------------------------------------------------------------------
rem Phase 5: npm project dependencies
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

rem node-pty vendors winpty, whose winpty.gyp shells out to `cmd /c "cd shared && GetCommitHash.bat"`
rem -- a CWD-RELATIVE batch invocation, from a file we do not own and cannot change. On a machine
rem where NoDefaultCurrentDirectoryInExePath=1 is inherited, cmd refuses to search the current
rem directory, and the whole install dies with:
rem
rem     GetCommitHash.bat is not recognized as an internal or external command
rem     gyp: Call to cmd /c "cd shared && GetCommitHash.bat" returned exit status 1
rem
rem The comment at the top of this file already covers our OWN invocation; this covers the npm
rem CHILD, which is where the failure actually lands. Cleared for this process only -- `setlocal`
rem at the top of this file scopes it, so the caller keeps whatever it had and no persistent user
rem or machine setting is weakened.
set "NoDefaultCurrentDirectoryInExePath="

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
    exit /b %NPM_EXIT%
)
call :phase_end "npm project dependencies"

echo.
echo === All dependencies are ready. ===
goto :return_success

rem =============================================================================================
rem Subroutines
rem =============================================================================================

:return_success
rem `setlocal` protects callers from every scratch variable above, but PATH is an intentional
rem output: a portable or just-installed Node must remain callable by build.bat after this CALL
rem returns. Export only the two documented toolchain values. Delayed expansion is disabled for
rem the whole file so a legitimate `!` in an inherited PATH survives this handoff byte-for-byte.
set "NODETERM_RETURN_PATH=%PATH%"
set "NODETERM_RETURN_NODE_HOME=%NODETERM_NODE_HOME%"
set "NODETERM_RETURN_PYTHON=%PYTHON%"
set "NODETERM_RETURN_VCINSTALLDIR=%VCINSTALLDIR%"
set "NODETERM_RETURN_GYP_MSVS_VERSION=%GYP_MSVS_VERSION%"
set "NODETERM_RETURN_NPM_CONFIG_MSVS_VERSION=%npm_config_msvs_version%"
set "NODETERM_RETURN_GYP_MSVS_OVERRIDE_PATH=%GYP_MSVS_OVERRIDE_PATH%"
set "NODETERM_RETURN_VSINSTALLDIR=%VSINSTALLDIR%"
set "NODETERM_RETURN_VSCMD_VER=%VSCMD_VER%"
set "NODETERM_RETURN_VSCMD_ARG_TGT_ARCH=%VSCMD_ARG_TGT_ARCH%"
set "NODETERM_RETURN_VSCMD_ARG_HOST_ARCH=%VSCMD_ARG_HOST_ARCH%"
set "NODETERM_RETURN_VCTOOLS_INSTALL_DIR=%VCToolsInstallDir%"
endlocal & set "PATH=%NODETERM_RETURN_PATH%" & set "NODETERM_NODE_HOME=%NODETERM_RETURN_NODE_HOME%" & set "PYTHON=%NODETERM_RETURN_PYTHON%" & set "NODE_GYP_FORCE_PYTHON=%NODETERM_RETURN_PYTHON%" & set "npm_config_python=%NODETERM_RETURN_PYTHON%" & set "VCINSTALLDIR=%NODETERM_RETURN_VCINSTALLDIR%" & set "GYP_MSVS_VERSION=%NODETERM_RETURN_GYP_MSVS_VERSION%" & set "npm_config_msvs_version=%NODETERM_RETURN_NPM_CONFIG_MSVS_VERSION%" & set "GYP_MSVS_OVERRIDE_PATH=%NODETERM_RETURN_GYP_MSVS_OVERRIDE_PATH%" & set "VSINSTALLDIR=%NODETERM_RETURN_VSINSTALLDIR%" & set "VSCMD_VER=%NODETERM_RETURN_VSCMD_VER%" & set "VSCMD_ARG_TGT_ARCH=%NODETERM_RETURN_VSCMD_ARG_TGT_ARCH%" & set "VSCMD_ARG_HOST_ARCH=%NODETERM_RETURN_VSCMD_ARG_HOST_ARCH%" & set "VCToolsInstallDir=%NODETERM_RETURN_VCTOOLS_INSTALL_DIR%"
exit /b 0

:accept_toolchain_result
if not exist "%NODETERM_VS_RESULT_FILE%" (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : selected Visual Studio installation path
    echo   Constraint : the helper must return the exact verified instance before npm runs
    echo   Source     : "%NODETERM_VS_RESULT_FILE%"
    echo   Error      : helper exited successfully without writing its result file
    exit /b 1
)
set "NODETERM_VS_INSTALLATION="
set /p "NODETERM_VS_INSTALLATION="<"%NODETERM_VS_RESULT_FILE%"
del /f /q "%NODETERM_VS_RESULT_FILE%" >nul 2>nul
set "NODETERM_VS_RESULT_FILE="
if not defined NODETERM_VS_INSTALLATION (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : selected Visual Studio installation path
    echo   Constraint : the helper must return a non-empty absolute installation path
    echo   Source     : "%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs"
    echo   Error      : helper returned an empty installation path
    exit /b 1
)
if not exist "%NODETERM_VS_INSTALLATION%\VC\Tools\MSVC" (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : selected Visual Studio installation path
    echo   Constraint : the selected path must still contain VC\Tools\MSVC
    echo   Source     : "%NODETERM_VS_INSTALLATION%"
    echo   Error      : validated installation path is no longer present
    exit /b 1
)
set "VCINSTALLDIR=%NODETERM_VS_INSTALLATION%\VC"
echo   Native build instance: "%NODETERM_VS_INSTALLATION%"
exit /b 0

:elevate_toolchain
set "NODETERM_NODE_EXE="
for /f "usebackq delims=" %%N in (`where node 2^>nul`) do if not defined NODETERM_NODE_EXE set "NODETERM_NODE_EXE=%%N"
if not defined NODETERM_NODE_EXE (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : elevated helper handoff
    echo   Constraint : a verified node.exe is required to run the narrow UAC helper
    echo   Source     : PATH lookup for node.exe
    echo   Error      : node.exe could not be resolved after the initial toolchain probe
    exit /b 1
)
set "NODETERM_ELEVATED_NODE=%NODETERM_NODE_EXE%"
set "NODETERM_ELEVATED_HELPER=%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs"
echo.
echo --- Elevating only the Visual Studio toolchain helper ---
echo A UAC prompt may appear for the Microsoft Visual Studio dependency. No npm or repository
echo lifecycle command runs in that elevated process.
%NODETERM_SYSTEM_POWERSHELL% -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; try { $args=[string]::Concat([char]34,$env:NODETERM_ELEVATED_HELPER,[char]34,' --elevated-toolchain-only'); $p=Start-Process -FilePath $env:NODETERM_ELEVATED_NODE -ArgumentList $args -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { Write-Error $_; exit 1 }"
set "ELEVATED_TOOLCHAIN_EXIT=%ERRORLEVEL%"
set "NODETERM_ELEVATED_NODE="
set "NODETERM_ELEVATED_HELPER="
if not "%ELEVATED_TOOLCHAIN_EXIT%"=="0" (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : elevated Visual Studio workload helper
    echo   Constraint : the UAC helper must complete successfully before npm runs
    echo   Source     : "%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs"
    echo   Error      : elevated helper exited with code %ELEVATED_TOOLCHAIN_EXIT%
    exit /b %ELEVATED_TOOLCHAIN_EXIT%
)
echo --- Elevated helper completed; verifying from the normal user process ---
call node "%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs" --result-file "%NODETERM_VS_RESULT_FILE%"
set "TOOLCHAIN_VERIFY_EXIT=%ERRORLEVEL%"
if not "%TOOLCHAIN_VERIFY_EXIT%"=="0" (
    echo.
    echo [FAILED] Visual Studio C++ build toolchain
    echo   Dependency : post-UAC Visual Studio workload verification
    echo   Constraint : the normal user process must independently rediscover the workload and Spectre libraries
    echo   Source     : "%NODETERM_ROOT%\scripts\ensure-windows-build-toolchain.mjs"
    echo   Error      : verification exited with code %TOOLCHAIN_VERIFY_EXIT%
    exit /b %TOOLCHAIN_VERIFY_EXIT%
)
call :accept_toolchain_result
if errorlevel 1 exit /b %ERRORLEVEL%
call :phase_end "Visual Studio C++ build toolchain"
goto :toolchain_phase_complete

:refresh_path
rem A package manager (winget) writes PATH into the registry for FUTURE processes only -- the
rem shell that just launched it does not see the change, which reads as "the install failed" when
rem it in fact succeeded. [Environment]::GetEnvironmentVariable(...,'Machine'/'User') plus
rem ExpandEnvironmentVariables is used (instead of a raw `reg query`) because the registry stores
rem PATH un-expanded (literal "%SystemRoot%..." segments) -- a naive copy would leave those
rem un-expanded in our session PATH and break every tool that depends on them.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$m=[Environment]::GetEnvironmentVariable('Path','Machine'); $u=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::ExpandEnvironmentVariables((@($m,$u) -join ';'))"`) do set "PATH=%%P"
if defined NODETERM_NODE_HOME set "PATH=%NODETERM_NODE_HOME%;%PATH%"
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
set "NODE_VERSION="
rem Parse AND validate manifest-controlled strings entirely inside PowerShell before cmd ever
rem expands them. Emitting an unvalidated quote/ampersand through FOR /F would turn JSON data into
rem batch source. Only canonical digits/dots, the exact official URL, and hex reach this file.
set "NODE_MANIFEST_RESULT=%TEMP%\nodeterm-node-manifest-%RANDOM%-%RANDOM%.txt"
if exist "%NODE_MANIFEST_RESULT%" del /f /q "%NODE_MANIFEST_RESULT%" >nul 2>nul
set "NODETERM_MANIFEST_FILE=%MANIFEST%"
set "NODETERM_NODE_ARCH=%NODE_ARCH%"
set "NODETERM_MANIFEST_RESULT=%NODE_MANIFEST_RESULT%"
powershell -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $d=Get-Content -Raw -LiteralPath $env:NODETERM_MANIFEST_FILE | ConvertFrom-Json; $v=[string]$d.node.version; $e=$d.node.portable.($env:NODETERM_NODE_ARCH); $u=[string]$e.url; $s=[string]$e.sha256; $expected='https://nodejs.org/dist/v'+$v+'/node-v'+$v+'-'+$env:NODETERM_NODE_ARCH+'.zip'; if($v -notmatch '^\d+\.\d+\.\d+$' -or $u -ne $expected -or $s -notmatch '^[a-fA-F0-9]{64}$'){ throw 'portable Node manifest entry failed validation' }; [IO.File]::WriteAllText($env:NODETERM_MANIFEST_RESULT, ('NODE_VERSION='+$v+'`nNODE_URL='+$u+'`nNODE_SHA256='+$s+'`n'), [Text.UTF8Encoding]::new($false))" 1>"%TEMP%\nodeterm-node-version.log" 2>&1
set "NODE_MANIFEST_VALID=%ERRORLEVEL%"
set "NODETERM_MANIFEST_FILE="
set "NODETERM_NODE_ARCH="
if not "%NODE_MANIFEST_VALID%"=="0" goto :node_manifest_invalid
if not exist "%NODE_MANIFEST_RESULT%" goto :node_manifest_invalid
for /f "usebackq tokens=1,* delims==" %%K in ("%NODE_MANIFEST_RESULT%") do set "%%K=%%L"
del /f /q "%NODE_MANIFEST_RESULT%" >nul 2>nul
set "NODE_MANIFEST_RESULT="
if not defined NODE_VERSION goto :node_manifest_invalid
if not defined NODE_URL goto :node_manifest_invalid
if not defined NODE_SHA256 goto :node_manifest_invalid
goto :node_manifest_valid

:node_manifest_invalid
if defined NODE_MANIFEST_RESULT if exist "%NODE_MANIFEST_RESULT%" del /f /q "%NODE_MANIFEST_RESULT%" >nul 2>nul
set "NODE_MANIFEST_RESULT="
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : exact version, official nodejs.org URL, and 64-hex SHA-256
    echo   Source     : "%MANIFEST%"
    echo   Error      : portable manifest entry failed validation
    exit /b 1

:node_manifest_valid

if not exist "%TOOLCHAIN_DIR%" mkdir "%TOOLCHAIN_DIR%" >nul 2>nul
set "NODE_ZIP=%TOOLCHAIN_DIR%\node-%NODE_ARCH%.zip"

echo   Downloading "%NODE_URL%"
set "NODETERM_DOWNLOAD_URL=%NODE_URL%"
set "NODETERM_DOWNLOAD_FILE=%NODE_ZIP%"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $env:NODETERM_DOWNLOAD_URL -OutFile $env:NODETERM_DOWNLOAD_FILE -UseBasicParsing"
set "NODE_DOWNLOAD_EXIT=%ERRORLEVEL%"
set "NODETERM_DOWNLOAD_URL="
set "NODETERM_DOWNLOAD_FILE="
if not "%NODE_DOWNLOAD_EXIT%"=="0" (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : pinned in dependencies.manifest.json
    echo   Source     : "%NODE_URL%"
    echo   Error      : download failed - see the PowerShell output above for the real cause
    exit /b 1
)

set "NODE_ACTUAL_SHA256="
rem Use .NET directly instead of Get-FileHash. A batch file launched from PowerShell 7 can inherit
rem its PSModulePath; Windows PowerShell 5.1 then sees incompatible PowerShell 7 modules first and
rem silently fails to auto-load Get-FileHash, which must never turn a missing digest into trust.
rem Pass the path through the environment, not PowerShell source, so an apostrophe in LOCALAPPDATA
rem is data rather than a broken quote (or executable text).
set "NODETERM_HASH_FILE=%NODE_ZIP%"
set "NODE_HASH_RESULT=%TEMP%\nodeterm-node-sha256-%RANDOM%-%RANDOM%.txt"
if exist "%NODE_HASH_RESULT%" del /f /q "%NODE_HASH_RESULT%" >nul 2>nul
set "NODETERM_HASH_RESULT=%NODE_HASH_RESULT%"
powershell -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $s=[Security.Cryptography.SHA256]::Create(); $f=[IO.File]::OpenRead($env:NODETERM_HASH_FILE); try { $h=[BitConverter]::ToString($s.ComputeHash($f)).Replace('-','').ToLowerInvariant(); [IO.File]::WriteAllText($env:NODETERM_HASH_RESULT,$h,[Text.UTF8Encoding]::new($false)) } finally { $f.Dispose(); $s.Dispose() }" >nul
set "NODE_HASH_EXIT=%ERRORLEVEL%"
set "NODETERM_HASH_FILE="
set "NODETERM_HASH_RESULT="
if not "%NODE_HASH_EXIT%"=="0" (
    if exist "%NODE_HASH_RESULT%" del /f /q "%NODE_HASH_RESULT%" >nul 2>nul
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : SHA-256 digest of the portable Node archive
    echo   Constraint : the hashing process must succeed before its output is trusted
    echo   Source     : "%NODE_ZIP%"
    echo   Error      : hashing exited with code %NODE_HASH_EXIT%
    exit /b %NODE_HASH_EXIT%
)
if not exist "%NODE_HASH_RESULT%" (
    echo [FAILED] Node.js runtime - hashing returned no digest
    exit /b 1
)
set /p "NODE_ACTUAL_SHA256="<"%NODE_HASH_RESULT%"
del /f /q "%NODE_HASH_RESULT%" >nul 2>nul
set "NODE_HASH_RESULT="
if /I not "%NODE_ACTUAL_SHA256%"=="%NODE_SHA256%" (
    del /f /q "%NODE_ZIP%" >nul 2>nul
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : sha256 "%NODE_SHA256%" recorded in dependencies.manifest.json
    echo   Source     : "%NODE_URL%"
    echo   Error      : downloaded file hashed to "%NODE_ACTUAL_SHA256%" instead - refusing to use an unverified binary
    exit /b 1
)
echo   SHA-256 verified: %NODE_ACTUAL_SHA256%

set "NODE_EXTRACT_DIR=%TOOLCHAIN_DIR%\node-v%NODE_VERSION%-%NODE_ARCH%"
if exist "%NODE_EXTRACT_DIR%" rd /s /q "%NODE_EXTRACT_DIR%" >nul 2>nul
if exist "%NODE_EXTRACT_DIR%" (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : clean portable Node extraction directory
    echo   Constraint : stale exact-version files must be removed before extraction
    echo   Source     : "%NODE_EXTRACT_DIR%"
    echo   Error      : could not remove the previous extraction; close processes using it and retry
    exit /b 1
)

echo   Extracting to "%TOOLCHAIN_DIR%"
set "NODETERM_ARCHIVE_FILE=%NODE_ZIP%"
set "NODETERM_ARCHIVE_DESTINATION=%TOOLCHAIN_DIR%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath $env:NODETERM_ARCHIVE_FILE -DestinationPath $env:NODETERM_ARCHIVE_DESTINATION -Force"
set "NODE_EXPAND_EXIT=%ERRORLEVEL%"
set "NODETERM_ARCHIVE_FILE="
set "NODETERM_ARCHIVE_DESTINATION="
if not "%NODE_EXPAND_EXIT%"=="0" (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : n/a
    echo   Source     : "%NODE_ZIP%"
    echo   Error      : Expand-Archive failed - see the PowerShell output above for the real cause
    exit /b 1
)
del /f /q "%NODE_ZIP%" >nul 2>nul

if not exist "%NODE_EXTRACT_DIR%\node.exe" (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : archive must contain node-v%NODE_VERSION%-%NODE_ARCH%\node.exe
    echo   Source     : "%TOOLCHAIN_DIR%"
    echo   Error      : extracted archive did not contain the exact manifest-selected Node folder
    exit /b 1
)

set "NODETERM_NODE_HOME=%NODE_EXTRACT_DIR%"
set "PATH=%NODE_EXTRACT_DIR%;%PATH%"

set "NODETERM_EXPECTED_NODE_VERSION=%NODE_VERSION%"
call :probe_node
set "PORTABLE_NODE_PROBE_EXIT=%ERRORLEVEL%"
set "NODETERM_EXPECTED_NODE_VERSION="
if not "%PORTABLE_NODE_PROBE_EXIT%"=="0" (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : node.js ^(portable, %NODE_ARCH%^)
    echo   Constraint : executable version must exactly match manifest version %NODE_VERSION% and satisfy package.json engines.node
    echo   Source     : "%NODE_EXTRACT_DIR%\node.exe"
    echo   Error      : the extracted node.exe was missing, broken, unsupported, or reported the wrong version
    exit /b 1
)
set "NODETERM_PERSIST_NODE_HOME=%NODE_EXTRACT_DIR%"
powershell -NoProfile -NonInteractive -Command "[Environment]::SetEnvironmentVariable('NODETERM_NODE_HOME',$env:NODETERM_PERSIST_NODE_HOME,'User')" >nul
set "NODE_PERSIST_EXIT=%ERRORLEVEL%"
set "NODETERM_PERSIST_NODE_HOME="
if not "%NODE_PERSIST_EXIT%"=="0" (
    echo.
    echo [FAILED] Node.js runtime
    echo   Dependency : user-scoped portable Node selection
    echo   Constraint : NODETERM_NODE_HOME must persist only after the exact runtime passes its probe
    echo   Source     : "%NODE_EXTRACT_DIR%"
    echo   Error      : could not persist NODETERM_NODE_HOME ^(exit %NODE_PERSIST_EXIT%^)
    exit /b %NODE_PERSIST_EXIT%
)
echo   Installed node %NODE_PROBE_VERSION% ^(portable, %NODE_ARCH%^) at "%NODE_EXTRACT_DIR%"
exit /b 0

:probe_node
set "NODE_PROBE_VERSION="
set "NODE_PROBE_RESULT=%TEMP%\nodeterm-node-version-%RANDOM%-%RANDOM%.txt"
if exist "%NODE_PROBE_RESULT%" del /f /q "%NODE_PROBE_RESULT%" >nul 2>nul
rem Native package lifecycle scripts inherit Node's own build configuration. Node 26.4.0 was built
rem with Clang thin LTO, so its common.gypi passes -flto=thin and /opt:lldltojobs to MSVC while
rem compiling smart-whisper. The shipped application supports a wider runtime range, but this
rem source build must use the exact SHA-pinned Node version from dependencies.manifest.json.
call node "%NODETERM_ROOT%\scripts\check-node-version.cjs" --manifest-pin 1>"%NODE_PROBE_RESULT%" 2>"%TEMP%\nodeterm-node-version.log"
set "NODE_PROBE_EXIT=%ERRORLEVEL%"
if not "%NODE_PROBE_EXIT%"=="0" goto :probe_node_done
if not exist "%NODE_PROBE_RESULT%" set "NODE_PROBE_EXIT=1"
if "%NODE_PROBE_EXIT%"=="0" set /p "NODE_PROBE_VERSION="<"%NODE_PROBE_RESULT%"
if not defined NODE_PROBE_VERSION set "NODE_PROBE_EXIT=1"
:probe_node_done
if exist "%NODE_PROBE_RESULT%" del /f /q "%NODE_PROBE_RESULT%" >nul 2>nul
set "NODE_PROBE_RESULT="
exit /b %NODE_PROBE_EXIT%

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
