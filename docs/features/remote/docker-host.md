# Docker host

## Behavior

Docker host shares one selected project over the existing relay transport. The host creates a
single-use offer; the joining device completes the end-to-end-encrypted handshake and both people
confirm the same short authentication string before project traffic is admitted. Hosting and
connecting are free.

## Configuration

Open **Settings → Docker host** or the active project's **Docker host…** menu. Choose the project,
start hosting, and copy the one-time code. Packaged builds use the configured relay. Development
requires an explicit `NODETERM_RELAY_URL`.

## Security and privacy

Host setup accepts no arbitrary shell. Credentials are not stored in project files, command
arguments, source, or logs. The relay carries ciphertext and mutual approval remains mandatory.

## Failure modes and recovery

The start surface reports relay availability, pairing-service, key-store, and seat errors in place.
Correct the named condition and retry there. Stopping closes the listener without deleting data.

## Surface parity

Desktop and Server Edition share core settings and relay contracts. The mobile companion can join
the same sessions but is separately maintained; this repository does not claim its private UI was
changed here.

## Verification

This ultra-speed lane did not run tests, type-checking, lint, runtime interaction, accessibility
review, or screenshots.

## Suggested articles

- [Remote sessions](../../remote-sessions.md)
- [Global and project settings](../global-and-project-settings.md)
