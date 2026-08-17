# nodeterm Server Edition — container image (browser canvas backed by the headless server).
#
# The two native addons have to target Node's ABI. The repo's `postinstall` runs
# `electron-rebuild`, which targets ELECTRON's ABI — but this server runs under plain `node`.
# Every npm install therefore uses --ignore-scripts, then the deps stage explicitly rebuilds
# node-pty AND smart-whisper for Node. Keep the deps and runtime stages on the SAME Node major
# (the compiled binaries must match the runtime ABI).
#
# TLS is terminated by the reverse proxy in front (Dokploy/Traefik, nginx, Caddy…): the server
# speaks plain HTTP inside the Docker network, which is why CMD passes --insecure-http (the
# server refuses a non-loopback bind without it). It sets the Secure cookie flag by itself when
# the proxy forwards X-Forwarded-Proto: https. Do NOT publish the container port directly on a
# public interface.

# Node 24.15 is the first supported patch on this LTS line: node:sqlite is unflagged and the
# locked dependency graph accepts it. Keep all stages exact so a floating major cannot hide drift.
ARG NODE_VERSION=24.15.0

# ---- build: renderer + server bundle (needs devDependencies, no native builds) ----
FROM node:${NODE_VERSION}-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips electron-rebuild AND electron's own binary download (not needed to build)
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm run server:build

# ---- deps: production node_modules with node-pty compiled for Node (toolchain lives here) ----
FROM node:${NODE_VERSION}-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild node-pty smart-whisper

# ---- runtime: slim image, no compilers ----
FROM node:${NODE_VERSION}-bookworm-slim
# tmux: terminal session continuity (without it PtyManager falls back to a plain shell).
# git: the Source Control panel. curl: the managed agent-hook scripts POST through it,
# and the HEALTHCHECK uses it. ca-certificates: git/curl over https. gosu: the root entrypoint
# repairs old root-owned /data entries, then immediately execs node as the unprivileged user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tmux git curl ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/out ./out
COPY package.json ./
COPY --chmod=755 deploy/docker-entrypoint.sh /usr/local/bin/nodeterm-entrypoint

# Auth, sessions, workspace, settings and scrollback snapshots live here — reuse a named volume
# when replacing the container or the replacement loses the password and canvas. NOTE: the tmux
# server itself lives INSIDE the container, so a container restart/redeploy kills all tmux sessions
# (unlike the desktop, where only a machine reboot does); the cold-restore path replays scrollback
# and resumes resumable agents from /data on the next attach.
ENV HOME=/home/node \
    NODETERM_DATA_DIR=/data \
    NODETERM_HOST=0.0.0.0 \
    NODETERM_PORT=8443
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8443

# /login is served without auth — a cheap liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD gosu node curl -fsS "http://127.0.0.1:${NODETERM_PORT}/login" > /dev/null || exit 1

# NODETERM_SERVER_PASSWORD optionally seeds first boot and is ignored once an account exists;
# otherwise the one-time setup URL is available in the container logs. The entrypoint repairs
# root-owned files from the old image, then execs this command as `node`; node is still PID 1, so
# docker stop's SIGTERM reaches it directly.
ENTRYPOINT ["/usr/local/bin/nodeterm-entrypoint"]
CMD ["node", "out/server/main.cjs", "--insecure-http"]
