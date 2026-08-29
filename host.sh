#!/usr/bin/env bash
#
# nodeterm Server Edition — one command to stand up a host.
#
#   ./host.sh              start it (builds on first run), loopback-only
#   ./host.sh --tls        start it behind Caddy with a real certificate (needs NODETERM_DOMAIN)
#   ./host.sh --stop       stop it, keeping the data volume
#   ./host.sh --logs       follow the server log
#   ./host.sh --status     show health, the URL, and where the password lives
#
# Safe by default: the app is published on 127.0.0.1 only, so standing it up does not put a
# shell server on the internet by accident. See docker-compose.yml for how to expose it properly.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENV_FILE=.env
ENV_TEMP=
COMPOSE=()

say()  { printf '  %s\n' "$*"; }
fail() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }

restrict_owner_only() {
  local file="$1"
  if [ "$(uname -s)" = Darwin ]; then
    chmod -N "$file" || fail "could not remove inherited ACL entries from $file."
  fi
  chmod 600 "$file" || fail "could not restrict $file to its owner."
}

cleanup_env_temp() {
  if [ -n "$ENV_TEMP" ] && [ -f "$ENV_TEMP" ]; then rm -f -- "$ENV_TEMP"; fi
}
trap cleanup_env_temp EXIT

# ── preflight ────────────────────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH. Install Docker, then re-run this."
docker compose version >/dev/null 2>&1 || fail "this Docker has no 'compose' subcommand (needs Docker Compose v2). Try: docker-compose up -d --build"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not reachable. Start Docker (or add yourself to the 'docker' group) and re-run."
[ -z "${COMPOSE_FILE+x}${COMPOSE_PROJECT_NAME+x}${COMPOSE_PROFILES+x}${COMPOSE_ENV_FILES+x}" ] \
  || fail "COMPOSE_FILE, COMPOSE_PROJECT_NAME, COMPOSE_PROFILES and COMPOSE_ENV_FILES must be unset when using this wrapper."
wrapper_project_name="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
wrapper_project_name="${wrapper_project_name#${wrapper_project_name%%[a-z0-9]*}}"
[ -n "$wrapper_project_name" ] || fail "could not derive a safe Compose project name from $PWD."
export COMPOSE_FILE="$PWD/docker-compose.yml"
export COMPOSE_PROJECT_NAME="$wrapper_project_name"
export COMPOSE_PROFILES=__nodeterm_wrapper_no_profile__
# An explicit --env-file below supplies the managed file when it exists. Keep the predefined
# Compose fallback pinned as well, so a hand-edited .env cannot redirect interpolation elsewhere.
export COMPOSE_ENV_FILES=/dev/null
daemon_endpoint="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}"
case "$daemon_endpoint" in
  unix://*|npipe://*) ;;
  *) fail "the host wrappers require a local Docker socket; the active daemon endpoint is '$daemon_endpoint'." ;;
esac

configure_compose() {
  COMPOSE=(docker compose --project-directory "$PWD" -f "$PWD/docker-compose.yml" -p "$wrapper_project_name")
  if [ -f "$ENV_FILE" ]; then COMPOSE+=(--env-file "$ENV_FILE"); fi
}
configure_compose

# ── password: generated, never defaulted ─────────────────────────────────────────────────────
# A default password on something that serves interactive shells is not a default, it is an open
# door. Generate one on first run and keep it in .env with owner-only permissions.
ensure_password() {
  local line status seed pw
  [ -z "${NODETERM_SERVER_PASSWORD+x}" ] || fail "NODETERM_SERVER_PASSWORD is set in the process environment, which would override $ENV_FILE. Unset it when using this wrapper."
  if [ -f "$ENV_FILE" ]; then
    if line="$(grep -m1 '^NODETERM_SERVER_PASSWORD=' "$ENV_FILE")"; then
      seed="${line#*=}"
      seed="${seed%$'\r'}"
      [[ "$seed" =~ ^[A-Za-z0-9._~-]{8,}$ ]] \
        || fail "$ENV_FILE must contain one unquoted NODETERM_SERVER_PASSWORD of at least 8 safe characters. Refusing to start."
      restrict_owner_only "$ENV_FILE"
      return
    else
      status=$?
      [ "$status" -eq 1 ] || fail "could not read $ENV_FILE while checking its password seed."
    fi
  fi

  if command -v openssl >/dev/null 2>&1; then
    pw="$(openssl rand -hex 24)"
  else
    pw="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  [ "${#pw}" -eq 48 ] || fail "could not generate a 48-character random password (no working openssl or /dev/urandom?)."

  # mktemp creates mode 0600. Build the complete dotenv beside its destination, then rename it;
  # an interruption can leave only an ignored owner-only temp, never a readable backup secret.
  ENV_TEMP="$(mktemp "$PWD/.nodeterm-env-XXXXXX")" || fail "could not create an owner-only temporary password file."
  restrict_owner_only "$ENV_TEMP"
  if [ -f "$ENV_FILE" ]; then
    if grep -v '^NODETERM_SERVER_PASSWORD=' "$ENV_FILE" > "$ENV_TEMP"; then
      :
    else
      status=$?
      [ "$status" -eq 1 ] || fail "could not preserve the existing settings in $ENV_FILE."
    fi
  fi
  printf 'NODETERM_SERVER_PASSWORD=%s\n' "$pw" >> "$ENV_TEMP"
  mv -f -- "$ENV_TEMP" "$ENV_FILE" || fail "could not atomically replace $ENV_FILE with its owner-only update."
  ENV_TEMP=
  restrict_owner_only "$ENV_FILE"
  configure_compose
  say "generated a first-boot password into $ENV_FILE (chmod 600)"
  say "it seeds the account on FIRST boot only — changing it later in .env does nothing."
}

dotenv_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 1
  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2); sub(/\r$/, "", value); found = 1 }
    END { if (found) print value; else exit 1 }
  ' "$ENV_FILE"
}

effective_value() {
  local process_is_set="$1" process_value="$2" key="$3" fallback="$4" value status
  if [ -n "$process_is_set" ]; then
    # Compose interpolation uses ${VAR:-fallback}: an explicitly empty process variable masks the
    # dotenv value and selects the literal fallback, rather than falling through to .env.
    value="${process_value:-$fallback}"
  elif value="$(dotenv_value "$key")"; then
    :
  else
    status=$?
    [ "$status" -eq 1 ] || fail "could not read $ENV_FILE while resolving $key."
    value="$fallback"
  fi
  printf '%s' "${value:-$fallback}"
}

effective_bind()   { effective_value "${NODETERM_BIND+x}" "${NODETERM_BIND:-}" NODETERM_BIND 127.0.0.1; }
effective_port()   { effective_value "${NODETERM_PUBLISH_PORT+x}" "${NODETERM_PUBLISH_PORT:-}" NODETERM_PUBLISH_PORT 8443; }
effective_domain() { effective_value "${NODETERM_DOMAIN+x}" "${NODETERM_DOMAIN:-}" NODETERM_DOMAIN ''; }

prepare_compose_environment() {
  local domain="$1" password
  password="$(dotenv_value NODETERM_SERVER_PASSWORD)" \
    || fail "could not resolve the wrapper-managed password from $ENV_FILE."
  [[ "$password" =~ ^[A-Za-z0-9._~-]{8,}$ ]] \
    || fail "$ENV_FILE contains an unsafe or too-short password seed."
  # Export the values the wrapper validated. Shell environment has higher Compose precedence than
  # every dotenv spelling, so whitespace/quote/interpolation variants cannot bypass loopback.
  export NODETERM_SERVER_PASSWORD="$password"
  export NODETERM_BIND="$(effective_bind)"
  export NODETERM_PUBLISH_PORT="$(effective_port)"
  export NODETERM_DOMAIN="$domain"
  configure_compose
}

validate_loopback_config() {
  local bind port
  bind="$(effective_bind)"
  port="$(effective_port)"
  [ "$bind" = '127.0.0.1' ] || fail "NODETERM_BIND resolves to '$bind'. The host wrappers refuse to publish plaintext outside 127.0.0.1."
  case "$port" in ''|*[!0-9]*) fail "NODETERM_PUBLISH_PORT must be a decimal TCP port, got '$port'." ;; esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail "NODETERM_PUBLISH_PORT must be between 1 and 65535, got '$port'."
}

validate_domain() {
  local domain="$1" label
  local labels=()
  [ -n "$domain" ] || fail "the tls profile needs a public hostname: NODETERM_DOMAIN=host.example.com ./host.sh --tls
           It must already resolve to THIS machine, and ports 80 and 443 must be reachable from the
           internet — Caddy proves control of the name over them to get a certificate. If this host
           is behind a Cloudflare Tunnel or similar, do not use this profile; see deploy/cloudflared.md."
  [ "${#domain}" -le 253 ] || fail "NODETERM_DOMAIN is longer than the 253-character DNS limit."
  IFS=. read -r -a labels <<< "$domain"
  [ "${#labels[@]}" -ge 2 ] || fail "NODETERM_DOMAIN must be a fully-qualified hostname, got '$domain'."
  for label in "${labels[@]}"; do
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] \
      || fail "NODETERM_DOMAIN contains an invalid DNS label, got '$domain'."
  done
}

url_line() {
  printf 'http://%s:%s' "$(effective_bind)" "$(effective_port)"
}

running_url() {
  local running mapping host port
  running="$(docker inspect --format '{{.State.Running}}' nodeterm-server 2>/dev/null)" || return 1
  [ "$running" = true ] || return 1
  mapping="$(docker port nodeterm-server 8443/tcp 2>/dev/null | head -n 1)" || return 1
  [ -n "$mapping" ] || return 1
  port="${mapping##*:}"
  host="${mapping%:*}"
  printf 'http://%s:%s' "$host" "$port"
}

wait_healthy() {
  # The image declares its own HEALTHCHECK against /login, so wait on that rather than sleeping
  # and hoping — a container that is "up" is not necessarily a server that is listening.
  local i state
  for i in $(seq 1 60); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' nodeterm-server 2>/dev/null)" \
      || fail "could not inspect nodeterm-server after Compose created it; the Docker daemon may be unavailable."
    case "$state" in
      healthy)  say "container is healthy"; return 0 ;;
      unhealthy) fail "container reported UNHEALTHY. Logs:  ./host.sh --logs" ;;
      nohealth) fail "container has no health check; refusing to treat an unknown image/configuration as ready." ;;
      *)        printf '\r  waiting for health… (%s) %ds' "$state" "$((i * 2))"; sleep 2 ;;
    esac
  done
  printf '\n'
  fail "gave up waiting for the container to become healthy. Logs:  ./host.sh --logs"
}

wait_tls() {
  local domain="$1" i state
  for i in $(seq 1 60); do
    state="$(docker inspect --format '{{.State.Status}}' nodeterm-caddy 2>/dev/null)" \
      || fail "could not inspect nodeterm-caddy after Compose created it; the Docker daemon may be unavailable."
    case "$state" in
      exited|dead) fail "Caddy became $state before HTTPS was ready. Inspect it with: docker compose --profile tls logs caddy" ;;
    esac
    if [ "$state" = running ] && curl -fsS --noproxy '*' --resolve "$domain:443:127.0.0.1" --connect-timeout 3 --max-time 5 "https://$domain/login" >/dev/null 2>&1; then
      say "certificate-valid HTTPS /login is reachable"
      return 0
    fi
    sleep 2
  done
  "${COMPOSE[@]}" --profile tls logs --tail 50 caddy >&2 || true
  fail "Caddy never served a certificate-valid https://$domain/login response. Containers were left running for inspection."
}

case "${1:-}" in
  --stop)
    "${COMPOSE[@]}" --profile tls down
    say "stopped. The data volume is kept — ./host.sh brings it back with the same password and canvas."
    exit 0 ;;
  --logs)   exec "${COMPOSE[@]}" logs -f nodeterm ;;
  --status)
    docker ps --filter name=nodeterm-server --format '  {{.Names}}  {{.Status}}  {{.Ports}}' \
      || fail "could not read container status from the Docker daemon."
    if active_url="$(running_url)"; then
      say "running URL: $active_url"
    else
      say "configured URL (no running mapping): $(url_line)"
    fi
    [ "$(effective_bind)" = '127.0.0.1' ] || say "WARNING: configured bind is not loopback; the wrappers will refuse to start this configuration."
    say "password: $ENV_FILE  (first-boot seed only)"
    exit 0 ;;
  --tls)
    ensure_password
    validate_loopback_config
    domain="$(effective_domain)"
    validate_domain "$domain"
    prepare_compose_environment "$domain"
    command -v curl >/dev/null 2>&1 || fail "curl is required to verify the public TLS endpoint."
    say "building and starting with Caddy in front…"
    "${COMPOSE[@]}" --profile tls up -d --build
    wait_healthy
    wait_tls "$domain"
    say "up at https://$domain"
    exit 0 ;;
  ''|--start)
    ensure_password
    validate_loopback_config
    prepare_compose_environment "$(effective_domain)"
    say "building and starting (the first native-addon build can take a few minutes)…"
    "${COMPOSE[@]}" up -d --build
    wait_healthy
    printf '\n'
    say "nodeterm is up at  $(url_line)"
    say "password:          in $ENV_FILE"
    say ""
    say "That address is loopback-only, by design. To reach it from another machine:"
    port="$(effective_port)"
    say "  ssh -N -L $port:127.0.0.1:$port $(whoami)@$(hostname)   then open $(url_line)"
    say "To publish it properly instead, see docker-compose.yml and deploy/cloudflared.md."
    exit 0 ;;
  *) fail "unknown option '$1'. Try: ./host.sh [--tls|--stop|--logs|--status]" ;;
esac
