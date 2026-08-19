# Docker host

## Behavior

Docker host shares one selected project over the existing relay transport. The host creates a
single-use offer; the joining device completes the end-to-end-encrypted handshake and both people
confirm the same short authentication string before project traffic is admitted. Hosting and
connecting are free.

## Configuration

Open **Settings → Docker host** or the active project's **Docker host…** menu. Choose the project,
Docker context, allowlisted image profile, read-only or deliberate writable workspace mode, network
policy, CPU, memory, and PID limits; then start hosting and copy the one-time code. These fields use
the same Global/Project inheritance as the rest of Settings. Packaged builds use the configured
relay. Development requires an explicit `NODETERM_RELAY_URL`.

The host creates one task-owned container with an argument-array invocation equivalent to:

```text
docker [--context NAME] run --detach --rm --name PREFIX-ID \
  --label dev.nodeterm.owner=relay-host \
  --cpus N --memory NNm --pids-limit N \
  --security-opt no-new-privileges --cap-drop ALL --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --network none|bridge \
  --mount type=bind,source=PROJECT,target=/workspace[,readonly] \
  --workdir /workspace IMAGE sleep infinity
```

Each encrypted relay PTY then runs through `docker [--context NAME] exec -i CONTAINER /bin/sh`,
not a host shell. No shell string is composed.

## Security and privacy

Host setup accepts no arbitrary shell or image text field. It never enables privileged mode, never
mounts the Docker socket into the container, defaults to no network, drops every capability, uses a
read-only root, and mounts the project read-only unless the user deliberately chooses writable.
Credentials are not stored in project files, command arguments, source, or logs. The relay carries
ciphertext and mutual approval remains mandatory.

## Failure modes and recovery

The start surface discovers real Docker contexts and reports missing Docker, no contexts, invalid
context/image/profile, container-start, relay, pairing-service, key-store, and seat errors in place.
Correct the named condition and retry there. Teardown force-removes only the randomly named,
labelled container owned by that host session. Bind-mounted project data is never removed.

## Surface parity

Desktop owns Docker discovery and container lifecycle. Server Edition deliberately exposes the
existing unsupported relay-host stub because a browser session cannot safely claim ownership of a
Docker daemon. The mobile companion can join the same sessions but is separately maintained; this
repository does not claim its private UI was changed here.

## Verification

This ultra-speed lane did not run tests, type-checking, lint, runtime interaction, accessibility
review, or screenshots.

## Suggested articles

- [Remote sessions](../../remote-sessions.md)
- [Global and project settings](../global-and-project-settings.md)
