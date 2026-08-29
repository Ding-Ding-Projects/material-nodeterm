# Docker host manager

## Behavior

Docker host manager operates a real Docker daemon on this machine or on a saved SSH host. It stores
only a label, transport kind, and context/server id in `docker-hosts.json`; SSH connection details
and identity paths stay in the machine-local SSH credential store. A project projection therefore
carries intent and node identity without credentials, paths, process state, or host-specific ids.

The existing relay sharing flow remains available beside this manager. Relay hosting creates a
single-use offer; the joining device completes the end-to-end-encrypted handshake and both people
confirm the same short authentication string before project traffic is admitted. Hosting and
connecting are free.

## Configuration

Open **Settings → Docker host** and use **Docker host manager**. Choose a local context or a saved
SSH host, give it a label, save it, then select **Verify host** before using operations. Inventory is
split into Containers, Images, Volumes, and Networks with local text search and an adjacent regex
builder. Container rows expose typed Start/Stop actions. Stats and bounded logs are read from the
selected host, while typed exec accepts only registered executable choices (`sh`, `bash`, `node`,
`python`, and `env`) and rejects inline shell programs, shell metacharacters, and unbounded args.

Compose is represented by a typed profile containing a file path, project name, and selected service
names. Compose up and down construct CLI argv from that profile; raw Compose text and arbitrary
shell commands are never accepted. The same controls work over SSH, with the remote Docker CLI
reached through an argv-only SSH invocation.

The manager reports real host verification data: Engine/API version, operating system,
architecture, and daemon container/image counts. A failed read remains an unavailable/error state,
not an invented empty inventory. Long reads have bounded timeouts and output limits.

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

Lifecycle calls use the same argument-array discipline. Removal of containers, images, volumes,
networks, or a Compose project requires a preview listing the selected ids and affected host,
followed by explicit confirmation. A rejected or failed destructive call does not claim an item was
removed.

## Security and privacy

Host setup accepts no arbitrary shell or image text field. It never enables privileged mode, never
mounts the Docker socket into the container, defaults to no network, drops every capability, uses a
read-only root, and mounts the project read-only unless the user deliberately chooses writable.
SSH credentials are resolved from the machine-local credential/profile vault and are not stored in
project files, command arguments, source, or logs. The relay carries ciphertext and mutual approval
remains mandatory.

## Failure modes and recovery

The manager discovers and verifies the real selected daemon and reports missing Docker, unavailable
SSH credentials, invalid context/profile, container lifecycle, Compose, timeout, and output-limit
errors in place.
Correct the named condition and retry there. Teardown force-removes only the randomly named,
labelled container owned by that host session. Bind-mounted project data is never removed.

## Surface parity

Desktop and Server Edition use the same typed manager through their platform bridge. On Server
Edition, local operations address the server machine; SSH operations require a saved SSH profile on
that server and fail explicitly when one is unavailable. The mobile companion can join relay
sessions but is separately maintained; this repository does not claim its private UI was changed
here.

## Verification

This ultra-speed lane did not run tests, type-checking, lint, runtime interaction, accessibility
review, or screenshots.

## Suggested articles

- [Remote sessions](../../remote-sessions.md)
- [Global and project settings](../global-and-project-settings.md)
