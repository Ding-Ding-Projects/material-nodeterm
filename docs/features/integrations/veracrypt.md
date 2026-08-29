# VeraCrypt file-container manager

The VeraCrypt node manages existing file-hosted containers on the Windows desktop. It does not
create containers, create hidden volumes, encrypt devices or partitions, or manage system
encryption.

## Behavior

The manager discovers `VeraCrypt.exe` from the validated Windows installation locations first. A
system executable lookup is only accepted when its result is an absolute regular file under one of
those trusted installation roots. PATH shadowing, directories, reparse points, control characters,
missing files, and unavailable paths are rejected before launch. When an executable is found, its
reported version is probed and exposed when the installed build reports one.

The drive-letter picker checks every logical drive root on the host and offers letters whose roots
are absent. The chosen letter is checked again immediately before mount. Mount arguments are a
fixed allowlist: the container path, drive letter, `/c n`, and the selected `/m ro`, `/m rm`, and
`/m ts` modes. Password, PIM, keyfile, and hidden-volume protection input are collected by
VeraCrypt's own native prompt. They never enter nodeterm state, logs, history, exports, or process
arguments.

VeraCrypt has no documented volume-list command, so the manager does not enumerate pre-existing
host mounts. It retains a mapping only for mounts started by this manager, then verifies the
requested drive root exists after mount and is absent after unmount. Explore is available only for
one of these independently verified manager-created mounts. Normal unmount is the default. Force
unmount is available from the node's destructive-action confirmation surface and is sent as the
explicit `/f` option only after that confirmation completes.

Favorites are stored only in the machine-local application-data directory. Each save or removal is
serialized with a cross-process transaction lock and published with the shared atomic-file writer.
They contain the container path, preferred letter, safe mount flags, and the Explore-after-mount
choice. They do not contain credentials or keyfile contents. The explicit Wipe password cache action
uses the app's two-key destructive confirmation and invokes only the documented VeraCrypt `/w`
cache-wipe command.

## Unsupported surfaces and failure modes

The Server Edition does not register VeraCrypt handlers because the capability is desktop-host local
and must not expose container mounting to browser clients. Relay sessions and the mobile companion
expose an explicit unsupported state. They never fall through to the viewing computer's VeraCrypt
installation. A missing executable,
unreadable container, occupied letter, failed native prompt, timeout, cancelled process, failed
volume observation, or failed file-manager launch is reported as a non-success operation state.

## Security boundaries

The service uses `spawn` with `shell: false`, a fixed executable, a fixed argument array, hidden
process windows, bounded output, and a deadline. It never accepts arbitrary command text or arbitrary
mount options. No password argument is supported, because passing one would expose a credential in
the process list. The service does not enable the VeraCrypt password cache for manager mounts.

## Verification boundary for the accelerated lane

Issue #210 is delivered through the accelerated feature lane. The lane does not run tests, type
checks, lint, reviews, accessibility or security audits, runtime interaction, or screenshots. Build
and packaging commands are the allowed delivery checks. A later release-grade pass must exercise
the native prompt, independent mount observation, cancellation, cache wipe, and unsupported
surfaces in the packaged application.

Suggested articles: [Windows diagnostics](../windows/windows-diagnostics.md),
[node kinds](../canvas/node-kinds.md), and [local history](../../local-history.md).
