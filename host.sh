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
COMPOSE=(docker compose)

say()  { printf '  %s\n' "$*"; }
fail() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }

# ── preflight ────────────────────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH. Install Docker, then re-run this."
docker compose version >/dev/null 2>&1 || fail "this Docker has no 'compose' subcommand (needs Docker Compose v2). Try: docker-compose up -d --build"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not reachable. Start Docker (or add yourself to the 'docker' group) and re-run."

# ── password: generated, never defaulted ─────────────────────────────────────────────────────
# A default password on something that serves interactive shells is not a default, it is an open
# door. Generate one on first run and keep it in .env with owner-only permissions.
ensure_password() {
  if [ -f "$ENV_FILE" ] && grep -q '^NODETERM_SERVER_PASSWORD=..' "$ENV_FILE"; then return; fi
  local pw
  if command -v openssl >/dev/null 2>&1; then
    pw="$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-24)"
  else
    pw="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-24)"
  fi
  [ -n "$pw" ] || fail "could not generate a password (no openssl and no /dev/urandom?)."
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  # Strip any previous empty assignment so we never end up with two.
  if [ -f "$ENV_FILE" ]; then sed -i.bak '/^NODETERM_SERVER_PASSWORD=/d' "$ENV_FILE" 2>/dev/null || true; rm -f "$ENV_FILE.bak"; fi
  printf 'NODETERM_SERVER_PASSWORD=%s\n' "$pw" >> "$ENV_FILE"
  say "generated a first-boot password into $ENV_FILE (chmod 600)"
  say "it seeds the account on FIRST boot only — changing it later in .env does nothing."
}

url_line() {
  local port; port="$(grep -E '^NODETERM_PUBLISH_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2)"
  printf 'http://127.0.0.1:%s' "${port:-8443}"
}

wait_healthy() {
  # The image declares its own HEALTHCHECK against /login, so wait on that rather than sleeping
  # and hoping — a container that is "up" is not necessarily a server that is listening.
  local i state
  for i in $(seq 1 60); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' nodeterm-server 2>/dev/null || echo missing)"
    case "$state" in
      healthy)  say "container is healthy"; return 0 ;;
      unhealthy) fail "container reported UNHEALTHY. Logs:  ./host.sh --logs" ;;
      missing)  sleep 2 ;;
      *)        printf '\r  waiting for health… (%s) %ds' "$state" "$((i * 2))"; sleep 2 ;;
    esac
  done
  printf '\n'
  fail "gave up waiting for the container to become healthy. Logs:  ./host.sh --logs"
}

case "${1:-}" in
  --stop)
    "${COMPOSE[@]}" --profile tls down
    say "stopped. The data volume is kept — ./host.sh brings it back with the same password and canvas."
    exit 0 ;;
  --logs)   exec "${COMPOSE[@]}" logs -f nodeterm ;;
  --status)
    docker ps --filter name=nodeterm-server --format '  {{.Names}}  {{.Status}}  {{.Ports}}' || true
    say "URL:      $(url_line)"
    say "password: $ENV_FILE  (first-boot seed only)"
    exit 0 ;;
  --tls)
    ensure_password
    [ -n "${NODETERM_DOMAIN:-}" ] || grep -q '^NODETERM_DOMAIN=..' "$ENV_FILE" 2>/dev/null \
      || fail "the tls profile needs a public hostname: NODETERM_DOMAIN=host.example.com ./host.sh --tls
           It must already resolve to THIS machine, and ports 80 and 443 must be reachable from the
           internet — Caddy proves control of the name over them to get a certificate. If this host
           is behind a Cloudflare Tunnel or similar, do not use this profile; see deploy/cloudflared.md."
    say "building and starting with Caddy in front…"
    "${COMPOSE[@]}" --profile tls up -d --build
    wait_healthy
    say "up at https://${NODETERM_DOMAIN:-$(grep '^NODETERM_DOMAIN=' "$ENV_FILE" | cut -d= -f2)}"
    exit 0 ;;
  ''|--start)
    ensure_password
    say "building and starting (first run compiles node-pty, which takes a few minutes)…"
    "${COMPOSE[@]}" up -d --build
    wait_healthy
    printf '\n'
    say "nodeterm is up at  $(url_line)"
    say "password:          in $ENV_FILE"
    say ""
    say "That address is loopback-only, by design. To reach it from another machine:"
    say "  ssh -N -L 8443:127.0.0.1:8443 $(whoami)@$(hostname)   then open $(url_line)"
    say "To publish it properly instead, see docker-compose.yml and deploy/cloudflared.md."
    exit 0 ;;
  *) fail "unknown option '$1'. Try: ./host.sh [--tls|--stop|--logs|--status]" ;;
esac
