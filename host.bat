@echo off
rem nodeterm Server Edition - one command to stand up a Docker host on Windows.
rem
rem   host.bat              start it (builds on first run), loopback-only
rem   host.bat --tls        start it behind Caddy (needs NODETERM_DOMAIN)
rem   host.bat --stop       stop it, keeping the data volume
rem   host.bat --logs       follow the server log
rem   host.bat --status     show health, URL, and password-file location
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem NODETERM_SERVER_ENV_DIR is set by the desktop app's deployment service so the generated
rem .env (first-boot password) lives outside the install directory - a packaged install sits in
rem a Squirrel version folder that is replaced wholesale on every update, and anything written
rem beside this script there would be silently lost on the next update. Unset (the normal manual
rem `host.bat` invocation) keeps the historical behavior of writing .env next to this script.
if defined NODETERM_SERVER_ENV_DIR (
  set "ENV_FILE=%NODETERM_SERVER_ENV_DIR%\.env"
) else (
  set "ENV_FILE=%CD%\.env"
)
call :preflight
if errorlevel 1 exit /b 1

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=--start"

if /i "%ACTION%"=="--stop" (
  call :compose --profile tls down
  if errorlevel 1 exit /b 1
  echo   stopped. The data volume is kept - host.bat brings it back with the same account and canvas.
  exit /b 0
)

if /i "%ACTION%"=="--logs" (
  call :compose logs -f nodeterm
  exit /b !ERRORLEVEL!
)

if /i "%ACTION%"=="--status" (
  docker ps --filter name=nodeterm-server --format "  {{.Names}}  {{.Status}}  {{.Ports}}"
  if errorlevel 1 exit /b 1
  call :running_url
  if errorlevel 1 (
    call :published_url
    if errorlevel 1 exit /b 1
    echo   configured URL ^(no running mapping^): !HOST_URL!
  ) else (
    echo   running URL: !RUNNING_URL!
  )
  call :effective_bind
  if errorlevel 1 exit /b 1
  if /i not "!HOST_BIND!"=="127.0.0.1" echo   WARNING: configured bind is not loopback; the wrappers will refuse to start this configuration.
  echo   password: !ENV_FILE!  ^(first-boot seed only^)
  exit /b 0
)

if /i "%ACTION%"=="--tls" goto action_tls

if /i not "%ACTION%"=="--start" (
  echo.
  echo   ERROR: unknown option "%ACTION%". Try: host.bat [--tls^|--stop^|--logs^|--status]
  echo.
  exit /b 1
)

call :ensure_password
if errorlevel 1 exit /b 1
call :validate_loopback_config
if errorlevel 1 exit /b 1
call :prepare_compose_environment
if errorlevel 1 exit /b 1
echo   building and starting ^(the first native build can take a few minutes^)...
call :compose up -d --build
if errorlevel 1 exit /b 1
call :wait_healthy
if errorlevel 1 exit /b 1
call :published_url
if errorlevel 1 exit /b 1
echo.
echo   nodeterm is up at  !HOST_URL!
echo   password:          in !ENV_FILE!
echo.
echo   That address is loopback-only, by design. Use an SSH tunnel or the documented TLS profile
echo   to reach it from another machine; do not publish the app port on 0.0.0.0.
exit /b 0

:action_tls
call :ensure_password
if errorlevel 1 exit /b 1
call :validate_loopback_config
if errorlevel 1 exit /b 1
call :tls_domain
if not defined TLS_DOMAIN goto missing_tls_domain
call :validate_tls_domain
if errorlevel 1 exit /b 1
call :prepare_compose_environment
if errorlevel 1 exit /b 1
where curl.exe >nul 2>&1
if errorlevel 1 (
  echo   ERROR: curl.exe is required to verify the public TLS endpoint.
  exit /b 1
)
echo   building and starting with Caddy in front...
call :compose --profile tls up -d --build
if errorlevel 1 exit /b 1
call :wait_healthy
if errorlevel 1 exit /b 1
call :wait_tls
if errorlevel 1 exit /b 1
echo   up at https://!TLS_DOMAIN!
exit /b 0

:missing_tls_domain
echo.
echo   ERROR: the tls profile needs a public hostname.
echo          set NODETERM_DOMAIN=host.example.com ^&^& host.bat --tls
echo          The name must resolve to this machine and ports 80/443 must be reachable.
echo.
exit /b 1

:preflight
where docker >nul 2>&1
if errorlevel 1 (
  echo   ERROR: Docker is not installed or not on PATH. Install Docker Desktop, then re-run.
  exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 (
  echo   ERROR: this Docker has no Compose v2 subcommand. Update Docker Desktop, then re-run.
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo   ERROR: the Docker daemon is not reachable. Start Docker Desktop, then re-run.
  exit /b 1
)
powershell -NoProfile -Command "$names='COMPOSE_FILE','COMPOSE_PROJECT_NAME','COMPOSE_PROFILES','COMPOSE_ENV_FILES'; $envs=[Environment]::GetEnvironmentVariables('Process'); if(@($names | Where-Object {$envs.Contains($_)}).Count){exit 1}"
if errorlevel 1 (
  echo   ERROR: COMPOSE_FILE, COMPOSE_PROJECT_NAME, COMPOSE_PROFILES and COMPOSE_ENV_FILES must be unset when using this wrapper.
  exit /b 1
)
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$n=(Split-Path -Leaf (Get-Location).Path).ToLowerInvariant() -replace '[^a-z0-9_-]','' -replace '^[^a-z0-9]+',''; [Console]::Write($n)"`) do set "WRAPPER_PROJECT_NAME=%%P"
if not defined WRAPPER_PROJECT_NAME (
  echo   ERROR: could not derive a safe Compose project name from !CD!.
  exit /b 1
)
set "COMPOSE_FILE=!CD!\docker-compose.yml"
set "COMPOSE_PROJECT_NAME=!WRAPPER_PROJECT_NAME!"
set "COMPOSE_PROFILES=__nodeterm_wrapper_no_profile__"
rem Explicit --env-file supplies the managed file. NUL also masks any hand-edited
rem COMPOSE_ENV_FILES value in .env without requiring a throwaway file on disk.
set "COMPOSE_ENV_FILES=NUL"
set "DOCKER_ENDPOINT=%DOCKER_HOST%"
if not defined DOCKER_ENDPOINT (
  for /f "usebackq delims=" %%H in (`docker context inspect --format "{{.Endpoints.docker.Host}}" 2^>nul`) do set "DOCKER_ENDPOINT=%%H"
)
if /i "!DOCKER_ENDPOINT:~0,8!"=="npipe://" exit /b 0
if /i "!DOCKER_ENDPOINT:~0,7!"=="unix://" exit /b 0
echo   ERROR: the host wrappers require a local Docker socket; the active daemon endpoint is "!DOCKER_ENDPOINT!".
exit /b 1

:compose
if exist "%ENV_FILE%" (
  docker compose --project-directory "%CD%" -f "%CD%\docker-compose.yml" -p "!WRAPPER_PROJECT_NAME!" --env-file "%ENV_FILE%" %*
) else (
  docker compose --project-directory "%CD%" -f "%CD%\docker-compose.yml" -p "!WRAPPER_PROJECT_NAME!" %*
)
exit /b !ERRORLEVEL!

:ensure_password
powershell -NoProfile -Command "if([Environment]::GetEnvironmentVariables('Process').Contains('NODETERM_SERVER_PASSWORD')){exit 1}"
if errorlevel 1 (
  echo   ERROR: NODETERM_SERVER_PASSWORD is set in the process environment, which would override !ENV_FILE!. Unset it when using this wrapper.
  exit /b 1
)
if exist "%ENV_FILE%" (
  findstr /b /r /c:"NODETERM_SERVER_PASSWORD=........" "%ENV_FILE%" >nul 2>&1
  if not errorlevel 1 (
    call :prepare_restricted_temp
    if errorlevel 1 (
      echo   ERROR: could not create an owner-only temporary file. Refusing to use !ENV_FILE!.
      exit /b 1
    )
    set "NODETERM_HOST_ENV_FILE=%ENV_FILE%"
    powershell -NoProfile -Command "$ErrorActionPreference='Stop'; [IO.File]::WriteAllBytes($env:NODETERM_HOST_ENV_TEMP,[IO.File]::ReadAllBytes($env:NODETERM_HOST_ENV_FILE))"
    set "WRITE_EXIT=!ERRORLEVEL!"
    if "!WRITE_EXIT!"=="0" (
      move /y "!NODETERM_HOST_ENV_TEMP!" "%ENV_FILE%" >nul 2>&1
      set "WRITE_EXIT=!ERRORLEVEL!"
    )
    set "NODETERM_HOST_ENV_FILE="
    if not "!WRITE_EXIT!"=="0" (
      del /q "!NODETERM_HOST_ENV_TEMP!" >nul 2>&1
      set "NODETERM_HOST_ENV_TEMP="
      echo   ERROR: could not replace !ENV_FILE! with an owner-only copy. The original file was left unchanged and will not be used.
      exit /b 1
    )
    set "NODETERM_HOST_ENV_TEMP="
    exit /b 0
  )
  findstr /b /c:"NODETERM_SERVER_PASSWORD=" "%ENV_FILE%" >nul 2>&1
  if not errorlevel 1 (
    echo   ERROR: !ENV_FILE! contains a NODETERM_SERVER_PASSWORD shorter than 8 characters. Refusing to start.
    exit /b 1
  )
)

call :prepare_restricted_temp
if errorlevel 1 (
  echo   ERROR: could not create an owner-only temporary password file. The existing !ENV_FILE! was left unchanged.
  exit /b 1
)

for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$b=New-Object byte[] 24; $r=[Security.Cryptography.RandomNumberGenerator]::Create(); try{$r.GetBytes($b)}finally{$r.Dispose()}; [BitConverter]::ToString($b).Replace('-','').ToLowerInvariant()"`) do set "NODETERM_HOST_GENERATED_PASSWORD=%%P"
if not defined NODETERM_HOST_GENERATED_PASSWORD (
  del /q "%NODETERM_HOST_ENV_TEMP%" >nul 2>&1
  set "NODETERM_HOST_ENV_TEMP="
  echo   ERROR: could not generate a cryptographically random first-boot password.
  exit /b 1
)

set "NODETERM_HOST_ENV_FILE=%ENV_FILE%"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $p=$env:NODETERM_HOST_ENV_FILE; $t=$env:NODETERM_HOST_ENV_TEMP; $lines=if(Test-Path -LiteralPath $p){@(Get-Content -LiteralPath $p)}else{@()}; $kept=@(); foreach($line in $lines){if($line -notmatch '^NODETERM_SERVER_PASSWORD='){$kept += $line}}; $kept += 'NODETERM_SERVER_PASSWORD=' + $env:NODETERM_HOST_GENERATED_PASSWORD; [IO.File]::WriteAllLines($t,$kept,[Text.UTF8Encoding]::new($false))"
set "WRITE_EXIT=%ERRORLEVEL%"
if "%WRITE_EXIT%"=="0" (
  move /y "%NODETERM_HOST_ENV_TEMP%" "%ENV_FILE%" >nul 2>&1
  set "WRITE_EXIT=!ERRORLEVEL!"
)
set "NODETERM_HOST_GENERATED_PASSWORD="
set "NODETERM_HOST_ENV_FILE="
if not "%WRITE_EXIT%"=="0" (
  del /q "%NODETERM_HOST_ENV_TEMP%" >nul 2>&1
  set "NODETERM_HOST_ENV_TEMP="
  echo   ERROR: could not replace !ENV_FILE! with the owner-only password file. The existing file was left unchanged.
  exit /b 1
)
set "NODETERM_HOST_ENV_TEMP="
echo   generated a first-boot password into !ENV_FILE! ^(ACL: current user only^)
echo   it seeds the account on FIRST boot only - changing it later does nothing.
exit /b 0

:prepare_restricted_temp
:pick_env_temp
set "NODETERM_HOST_ENV_TEMP=%CD%\.nodeterm-env-%RANDOM%-%RANDOM%.tmp"
if exist "%NODETERM_HOST_ENV_TEMP%" goto pick_env_temp
type nul > "%NODETERM_HOST_ENV_TEMP%"
if errorlevel 1 exit /b 1
rem The file is new, so every pre-existing ACE is inherited. Remove inheritance before any
rem credential bytes are written, then add only the current account as an explicit ACE.
icacls "%NODETERM_HOST_ENV_TEMP%" /inheritance:r /grant:r "%USERDOMAIN%\%USERNAME%:(F)" >nul 2>&1
if errorlevel 1 (
  del /q "%NODETERM_HOST_ENV_TEMP%" >nul 2>&1
  set "NODETERM_HOST_ENV_TEMP="
  exit /b 1
)
exit /b 0

:prepare_compose_environment
call :load_password_seed
if errorlevel 1 exit /b 1
call :effective_bind
if errorlevel 1 exit /b 1
call :effective_port
if errorlevel 1 exit /b 1
call :tls_domain
if errorlevel 1 exit /b 1
rem Process environment outranks every accepted dotenv spelling. Export exactly the values
rem validated by this wrapper so spaces, quotes, interpolation, or alternate env files cannot
rem turn the loopback-only start into a public plaintext listener.
set "NODETERM_SERVER_PASSWORD=!NODETERM_HOST_PASSWORD!"
set "NODETERM_BIND=!HOST_BIND!"
set "NODETERM_PUBLISH_PORT=!HOST_PORT!"
set "NODETERM_DOMAIN=!TLS_DOMAIN!"
set "NODETERM_HOST_PASSWORD="
exit /b 0

:load_password_seed
set "NODETERM_HOST_PASSWORD="
set "NODETERM_HOST_ENV_FILE=!ENV_FILE!"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $m=@(Get-Content -LiteralPath $env:NODETERM_HOST_ENV_FILE | Where-Object {$_ -match '^NODETERM_SERVER_PASSWORD='}); if($m.Count -ne 1){exit 1}; $p=$m[0].Substring('NODETERM_SERVER_PASSWORD='.Length); if($p -notmatch '^[A-Za-z0-9._~-]{8,}$'){exit 1}"
set "LOAD_EXIT=!ERRORLEVEL!"
if not "!LOAD_EXIT!"=="0" (
  set "NODETERM_HOST_ENV_FILE="
  echo   ERROR: !ENV_FILE! must contain exactly one unquoted NODETERM_SERVER_PASSWORD of at least 8 safe characters.
  exit /b 1
)
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$m=@(Get-Content -LiteralPath $env:NODETERM_HOST_ENV_FILE | Where-Object {$_ -match '^NODETERM_SERVER_PASSWORD='}); [Console]::Write($m[0].Substring('NODETERM_SERVER_PASSWORD='.Length))"`) do set "NODETERM_HOST_PASSWORD=%%P"
set "NODETERM_HOST_ENV_FILE="
if not defined NODETERM_HOST_PASSWORD (
  echo   ERROR: could not resolve the wrapper-managed password from !ENV_FILE!.
  exit /b 1
)
exit /b 0

:wait_healthy
for /l %%I in (1,1,60) do (
  docker inspect nodeterm-server >nul 2>&1
  if errorlevel 1 (
    echo   ERROR: could not inspect nodeterm-server after Compose created it; the Docker daemon may be unavailable.
    exit /b 1
  )
  set "HEALTH_STATE="
  for /f "usebackq delims=" %%S in (`docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}" nodeterm-server 2^>nul`) do set "HEALTH_STATE=%%S"
  if not defined HEALTH_STATE (
    echo   ERROR: could not read nodeterm-server health after Compose created it.
    exit /b 1
  )
  if /i "!HEALTH_STATE!"=="healthy" (
    echo   container is healthy
    exit /b 0
  )
  if /i "!HEALTH_STATE!"=="unhealthy" (
    echo   ERROR: container reported UNHEALTHY. Run: host.bat --logs
    exit /b 1
  )
  if /i "!HEALTH_STATE!"=="nohealth" (
    echo   ERROR: container has no health check; refusing to treat an unknown image/configuration as ready.
    exit /b 1
  )
  rem `timeout` aborts immediately when stdin is redirected (normal in automation), turning this
  rem into a noisy busy-loop. A loopback ping is available on every supported Windows host and
  rem supplies the same approximately two-second, noninteractive wait.
  >nul ping -n 3 127.0.0.1
)
echo   ERROR: gave up waiting for the container to become healthy. Run: host.bat --logs
exit /b 1

:wait_tls
for /l %%I in (1,1,60) do (
  docker inspect nodeterm-caddy >nul 2>&1
  if errorlevel 1 (
    echo   ERROR: could not inspect nodeterm-caddy after Compose created it; the Docker daemon may be unavailable.
    exit /b 1
  )
  set "CADDY_STATE="
  for /f "usebackq delims=" %%S in (`docker inspect --format "{{.State.Status}}" nodeterm-caddy 2^>nul`) do set "CADDY_STATE=%%S"
  if not defined CADDY_STATE (
    echo   ERROR: could not read nodeterm-caddy state after Compose created it.
    exit /b 1
  )
  if /i "!CADDY_STATE!"=="exited" (
    echo   ERROR: Caddy exited before HTTPS was ready. Run: docker compose --profile tls logs caddy
    exit /b 1
  )
  if /i "!CADDY_STATE!"=="dead" (
    echo   ERROR: Caddy became dead before HTTPS was ready. Run: docker compose --profile tls logs caddy
    exit /b 1
  )
  if /i "!CADDY_STATE!"=="running" (
    curl.exe -fsS --noproxy "*" --resolve "!TLS_DOMAIN!:443:127.0.0.1" --connect-timeout 3 --max-time 5 "https://!TLS_DOMAIN!/login" >nul 2>&1
    if not errorlevel 1 (
      echo   certificate-valid HTTPS /login is reachable
      exit /b 0
    )
  )
  >nul ping -n 3 127.0.0.1
)
call :compose --profile tls logs --tail 50 caddy
echo   ERROR: Caddy never served a certificate-valid https://!TLS_DOMAIN!/login response. Containers were left running for inspection.
exit /b 1

:running_url
set "RUNNING_STATE="
for /f "usebackq delims=" %%S in (`docker inspect --format "{{.State.Running}}" nodeterm-server 2^>nul`) do set "RUNNING_STATE=%%S"
if /i not "!RUNNING_STATE!"=="true" exit /b 1
set "RUNNING_PORT_LINE="
for /f "usebackq delims=" %%P in (`docker port nodeterm-server 8443/tcp 2^>nul`) do if not defined RUNNING_PORT_LINE set "RUNNING_PORT_LINE=%%P"
if not defined RUNNING_PORT_LINE exit /b 1
for /f "tokens=1,2 delims=:" %%A in ("!RUNNING_PORT_LINE!") do set "RUNNING_URL=http://%%A:%%B"
if not defined RUNNING_URL exit /b 1
exit /b 0

:published_url
call :effective_bind
if errorlevel 1 exit /b 1
call :effective_port
if errorlevel 1 exit /b 1
set "HOST_URL=http://!HOST_BIND!:!HOST_PORT!"
exit /b 0

:effective_bind
call :process_env_state NODETERM_BIND
if errorlevel 1 exit /b 1
if /i "!PROCESS_ENV_STATE!"=="set" goto effective_bind_process
set "HOST_BIND="
if exist "%ENV_FILE%" (
  findstr /b /c:"NODETERM_BIND=" "%ENV_FILE%" >nul 2>&1
  if errorlevel 2 (
    echo   ERROR: could not read !ENV_FILE! while resolving NODETERM_BIND.
    exit /b 1
  )
  for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"NODETERM_BIND=" "%ENV_FILE%" 2^>nul') do set "HOST_BIND=%%B"
)
if not defined HOST_BIND set "HOST_BIND=127.0.0.1"
exit /b 0
:effective_bind_process
set "HOST_BIND=%NODETERM_BIND%"
if not defined HOST_BIND set "HOST_BIND=127.0.0.1"
exit /b 0

:effective_port
call :process_env_state NODETERM_PUBLISH_PORT
if errorlevel 1 exit /b 1
if /i "!PROCESS_ENV_STATE!"=="set" goto effective_port_process
set "HOST_PORT="
if exist "%ENV_FILE%" (
  findstr /b /c:"NODETERM_PUBLISH_PORT=" "%ENV_FILE%" >nul 2>&1
  if errorlevel 2 (
    echo   ERROR: could not read !ENV_FILE! while resolving NODETERM_PUBLISH_PORT.
    exit /b 1
  )
  for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"NODETERM_PUBLISH_PORT=" "%ENV_FILE%" 2^>nul') do set "HOST_PORT=%%B"
)
if not defined HOST_PORT set "HOST_PORT=8443"
exit /b 0
:effective_port_process
set "HOST_PORT=%NODETERM_PUBLISH_PORT%"
if not defined HOST_PORT set "HOST_PORT=8443"
exit /b 0

:validate_loopback_config
call :effective_bind
if errorlevel 1 exit /b 1
if /i not "!HOST_BIND!"=="127.0.0.1" (
  echo   ERROR: NODETERM_BIND resolves to "!HOST_BIND!". The host wrappers refuse to publish plaintext outside 127.0.0.1.
  exit /b 1
)
call :effective_port
if errorlevel 1 exit /b 1
set "NODETERM_HOST_EFFECTIVE_PORT=!HOST_PORT!"
powershell -NoProfile -Command "$p=0; if(-not [int]::TryParse($env:NODETERM_HOST_EFFECTIVE_PORT,[ref]$p) -or $p -lt 1 -or $p -gt 65535){exit 1}"
set "PORT_EXIT=!ERRORLEVEL!"
set "NODETERM_HOST_EFFECTIVE_PORT="
if not "!PORT_EXIT!"=="0" (
  echo   ERROR: NODETERM_PUBLISH_PORT must be a decimal TCP port between 1 and 65535; got "!HOST_PORT!".
  exit /b 1
)
exit /b 0

:tls_domain
call :process_env_state NODETERM_DOMAIN
if errorlevel 1 exit /b 1
if /i "!PROCESS_ENV_STATE!"=="set" goto tls_domain_process
set "TLS_DOMAIN="
if exist "%ENV_FILE%" (
  findstr /b /c:"NODETERM_DOMAIN=" "%ENV_FILE%" >nul 2>&1
  if errorlevel 2 (
    echo   ERROR: could not read !ENV_FILE! while resolving NODETERM_DOMAIN.
    exit /b 1
  )
  for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"NODETERM_DOMAIN=" "%ENV_FILE%" 2^>nul') do set "TLS_DOMAIN=%%B"
)
exit /b 0
:tls_domain_process
set "TLS_DOMAIN=%NODETERM_DOMAIN%"
exit /b 0

:process_env_state
set "PROCESS_ENV_STATE="
set "NODETERM_HOST_ENV_KEY=%~1"
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$e=[Environment]::GetEnvironmentVariables('Process'); if($e.ContainsKey($env:NODETERM_HOST_ENV_KEY)){'set'}else{'unset'}"`) do set "PROCESS_ENV_STATE=%%S"
set "NODETERM_HOST_ENV_KEY="
if not defined PROCESS_ENV_STATE (
  echo   ERROR: could not inspect the process environment safely.
  exit /b 1
)
exit /b 0

:validate_tls_domain
set "NODETERM_HOST_TLS_DOMAIN=!TLS_DOMAIN!"
powershell -NoProfile -Command "$d=$env:NODETERM_HOST_TLS_DOMAIN; $labels=$d.Split('.'); if($d.Length -gt 253 -or $labels.Count -lt 2){exit 1}; foreach($label in $labels){if($label -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'){exit 1}}"
set "DOMAIN_EXIT=!ERRORLEVEL!"
set "NODETERM_HOST_TLS_DOMAIN="
if not "!DOMAIN_EXIT!"=="0" (
  echo   ERROR: NODETERM_DOMAIN must be a plain fully-qualified hostname; got "!TLS_DOMAIN!".
  exit /b 1
)
exit /b 0
